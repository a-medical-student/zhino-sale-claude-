/*
 * Minimal in-memory emulation of the Apps Script services Code.gs uses
 * (SpreadsheetApp, Utilities, PropertiesService, CacheService, LockService, ScriptApp, DriveApp, ...).
 *
 * Plain browser/Node script, no require(): evaluate it in a fresh global (Node vm context or an iframe),
 * call createGasEnv(), then evaluate Code.gs in the same global.
 *
 * Emulated Sheets behaviour that the tracker relies on:
 *  - getValues() returns Date objects (local midnight in the spreadsheet time zone) for date-formatted numbers
 *  - setValue(s) parses strings like a user entry unless the cell is formatted '@' (so "1405/07/02" becomes a date)
 *  - insertCheckboxes() fills cells with FALSE, header-row array formulas ={"title";...} spill to the bottom,
 *    so getLastRow() returns getMaxRows() — the code must find the real last row itself
 *  - writing a non-empty value into a spill area breaks the anchor formula (#REF!)
 *  - CacheService rejects values larger than 100KB
 *  - every read/write call is counted (env.stats) so tests can assert on API usage
 */
(function (G) {
  'use strict';
  var RealDate = G.Date;

  function createGasEnv(opts) {
    opts = opts || {};
    var TZ = opts.tz || 'Asia/Tehran';
    var clock = { now: opts.now != null ? opts.now : RealDate.UTC(2026, 9, 2, 8, 0, 0) };   // 2026-10-02 11:30 Tehran

    // ---------------- fixed, controllable clock ----------------
    function FakeDate() {
      var a = Array.prototype.slice.call(arguments);
      var d = a.length ? new (Function.prototype.bind.apply(RealDate, [null].concat(a)))() : new RealDate(clock.now);
      Object.setPrototypeOf(d, FakeDate.prototype);
      return d;
    }
    FakeDate.prototype = Object.create(RealDate.prototype);
    FakeDate.prototype.constructor = FakeDate;
    FakeDate.now = function () { return clock.now; };
    FakeDate.UTC = RealDate.UTC;
    FakeDate.parse = RealDate.parse;
    G.Date = FakeDate;

    var stats = { reads: 0, writes: 0, flushes: 0, calls: {} };
    function count(kind, name) { stats[kind]++; stats.calls[name] = (stats.calls[name] || 0) + 1; }
    function resetStats() { stats.reads = 0; stats.writes = 0; stats.flushes = 0; stats.calls = {}; }

    // ---------------- dates ----------------
    var dtf = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    function partsIn(ms, tz) {
      var f = tz === TZ ? dtf : new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric',
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      var o = {};
      f.formatToParts(new RealDate(ms)).forEach(function (p) { o[p.type] = p.value; });
      return { y: +o.year, M: +o.month, d: +o.day, H: +o.hour % 24, m: +o.minute, s: +o.second };
    }
    function offsetMin(ms) { var p = partsIn(ms, TZ); return (RealDate.UTC(p.y, p.M - 1, p.d, p.H, p.m, p.s) - ms) / 60000; }
    function serialToDate(serial) {
      var day = Math.floor(serial), ms = Math.round((day - 25569) * 86400000);
      var t = ms - offsetMin(ms) * 60000;
      t = ms - offsetMin(t) * 60000;
      return new FakeDate(t + Math.round((serial - day) * 86400000));
    }
    function dateToSerial(d) {
      var p = partsIn(d.getTime(), TZ);
      return RealDate.UTC(p.y, p.M - 1, p.d) / 86400000 + 25569 + (p.H * 3600 + p.m * 60 + p.s) / 86400;
    }
    function ymdOfSerial(s) {
      var t = new RealDate(Math.round((Math.floor(s) - 25569) * 86400000));
      return t.getUTCFullYear() + '-' + ('0' + (t.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + t.getUTCDate()).slice(-2);
    }
    function isDateFmt(f) { return !!f && f !== '@' && /y|d/.test(f) && !/#/.test(f); }

    var Utilities = {
      formatDate: function (date, tz, fmt) {
        var p = partsIn(date.getTime(), tz), z = function (n, w) { return ('000' + n).slice(-(w || 2)); };
        return fmt.replace(/yyyy|MM|M|dd|d|HH|mm|ss/g, function (k) {
          return { yyyy: z(p.y, 4), MM: z(p.M), M: String(p.M), dd: z(p.d), d: String(p.d), HH: z(p.H), mm: z(p.m), ss: z(p.s) }[k];
        });
      }
    };

    // ---------------- spreadsheet model ----------------
    var sheetSeq = 0;
    function Cell() { this.v = ''; this.f = ''; this.fmt = ''; this.note = ''; this.spillOf = null; }

    function Sheet(ss, name, rows, cols) {
      this.ss = ss; this.name = name; this.id = ++sheetSeq;
      this.maxRows = rows || 1000; this.maxCols = cols || 26;
      this.grid = [];            // grid[r][c] (1-based) → Cell
      this.frozen = 0; this.protections = []; this.cf = []; this.anchors = {};   // anchors["r,c"] = true
    }
    Sheet.prototype._cell = function (r, c, create) {
      var row = this.grid[r];
      if (!row) { if (!create) return null; row = this.grid[r] = []; }
      var cell = row[c];
      if (!cell && create) cell = row[c] = new Cell();
      return cell || null;
    };
    Sheet.prototype._anchorFor = function (r, c) {
      for (var k in this.anchors) {
        var p = k.split(','), ar = +p[0], ac = +p[1];
        if (ac === c && r > ar) return k;
      }
      return null;
    };
    Sheet.prototype._breakAnchor = function (key) {
      var p = key.split(','), cell = this._cell(+p[0], +p[1], true);
      cell.v = '#REF!';
      this._clearSpill(key);
    };
    Sheet.prototype._clearSpill = function (key) {
      var self = this;
      this.grid.forEach(function (row) { if (row) row.forEach(function (cell) { if (cell && cell.spillOf === key) { cell.v = ''; cell.spillOf = null; } }); });
    };
    Sheet.prototype._dropAnchor = function (r, c) {
      var key = r + ',' + c;
      if (this.anchors[key]) { delete this.anchors[key]; this._clearSpill(key); }
    };
    Sheet.prototype._valueOf = function (r, c) {
      var cell = this._cell(r, c);
      return cell ? cell.v : '';
    };
    Sheet.prototype._hasContent = function (r, c) {
      var cell = this._cell(r, c);
      return !!cell && (cell.v !== '' || cell.f !== '');
    };
    // user-entered parsing (setValue / setValues on a non-text cell)
    Sheet.prototype._set = function (r, c, val) {
      if (r > this.maxRows || c > this.maxCols) throw new Error('Range out of bounds: ' + r + ',' + c + ' on ' + this.name);
      var cell = this._cell(r, c, true);
      if (this.anchors[r + ',' + c]) this._dropAnchor(r, c);
      cell.f = '';
      if (val instanceof RealDate) { val = dateToSerial(val); if (!isDateFmt(cell.fmt)) cell.fmt = 'yyyy-mm-dd'; }
      else if (typeof val === 'string' && cell.fmt !== '@') {
        var s = val.trim(), m;
        if (/^=/.test(s)) { return this._setFormula(r, c, s); }
        if (/^-?\d+(\.\d+)?$/.test(s)) val = Number(s);
        else if ((m = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/.exec(s))) {
          val = RealDate.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569;
          if (!isDateFmt(cell.fmt)) cell.fmt = 'yyyy-mm-dd';
        }
      }
      if (val == null) val = '';
      var anchor = this._anchorFor(r, c);
      if (anchor) {
        if (val !== '') { this._breakAnchor(anchor); cell.spillOf = null; }
        else if (cell.spillOf) { return; }   // writing '' into a spilled cell is a no-op
      }
      cell.v = val; cell.spillOf = null;
    };
    Sheet.prototype._setFormula = function (r, c, f) {
      var cell = this._cell(r, c, true);
      this._dropAnchor(r, c);
      cell.f = f.charAt(0) === '=' ? f : '=' + f;
      var m = /^=\{"([^"]+)";/.exec(cell.f);
      cell.v = m ? m[1] : '';
      cell.spillOf = null;
      if (m) {
        this.anchors[r + ',' + c] = true;
        for (var rr = r + 1; rr <= this.maxRows; rr++) {           // anything typed under it breaks it, like in Sheets
          var below = this._cell(rr, c);
          if (below && below.v !== '' && !below.spillOf) { this._breakAnchor(r + ',' + c); break; }
        }
      }
    };
    // test helper: give a header formula concrete spilled values (rows r+1..)
    Sheet.prototype._spill = function (r, c, values) {
      var key = r + ',' + c;
      if (!this.anchors[key]) throw new Error('no anchor at ' + key);
      for (var i = 0; i < values.length; i++) {
        var cell = this._cell(r + 1 + i, c, true);
        cell.v = values[i]; cell.spillOf = values[i] === '' ? null : key; cell.f = '';
      }
    };
    Sheet.prototype._lastRowRaw = function () {
      for (var k in this.anchors) return this.maxRows;          // array formulas reach the bottom of the sheet
      for (var r = this.grid.length - 1; r >= 1; r--) {
        var row = this.grid[r];
        if (row) for (var c = 1; c < row.length; c++) if (row[c] && (row[c].v !== '' || row[c].f !== '')) return r;
      }
      return 0;
    };
    Sheet.prototype._lastColRaw = function () {
      var mx = 0;
      this.grid.forEach(function (row) {
        if (row) for (var c = row.length - 1; c > mx; c--) if (row[c] && (row[c].v !== '' || row[c].f !== '')) { mx = c; break; }
      });
      return mx;
    };
    Sheet.prototype._shiftRows = function (from, delta) {   // rows >= from move by delta (delta may be negative)
      var g = this.grid, n = [], self = this, anchors = {};
      for (var r = 0; r < g.length; r++) {
        if (!g[r]) continue;
        var nr = r >= from ? r + delta : r;
        if (nr >= 1) n[nr] = g[r];
      }
      this.grid = n;
      Object.keys(this.anchors).forEach(function (k) { var p = k.split(','); var r = +p[0]; anchors[(r >= from ? r + delta : r) + ',' + p[1]] = true; });
      this.anchors = anchors;
      this.grid.forEach(function (row) { if (row) row.forEach(function (cell) { if (cell && cell.spillOf) { var p = cell.spillOf.split(','); var r = +p[0]; cell.spillOf = (r >= from ? r + delta : r) + ',' + p[1]; } }); });
    };

    // Sheet API
    Sheet.prototype.getName = function () { return this.name; };
    Sheet.prototype.getSheetId = function () { return this.id; };
    Sheet.prototype.getParent = function () { return this.ss; };
    Sheet.prototype.getLastRow = function () { count('reads', 'getLastRow'); return this._lastRowRaw(); };
    Sheet.prototype.getLastColumn = function () { count('reads', 'getLastColumn'); return this._lastColRaw(); };
    Sheet.prototype.getMaxRows = function () { return this.maxRows; };
    Sheet.prototype.getMaxColumns = function () { return this.maxCols; };
    Sheet.prototype.getRange = function (a, b, c, d) {
      if (typeof a === 'string') return parseA1(this, a);
      return new Range(this, a, b, c || 1, d || 1);
    };
    Sheet.prototype.getDataRange = function () {
      return new Range(this, 1, 1, Math.max(this._lastRowRaw(), 1), Math.max(this._lastColRaw(), 1));
    };
    Sheet.prototype.insertRowsAfter = function (after, n) { count('writes', 'insertRowsAfter'); this._shiftRows(after + 1, n); this.maxRows += n; };
    Sheet.prototype.insertColumnsAfter = function (after, n) { count('writes', 'insertColumnsAfter'); this.maxCols += n; };
    Sheet.prototype.insertColumnBefore = function (col) {
      count('writes', 'insertColumnBefore');
      this.grid.forEach(function (row) { if (row) row.splice(col, 0, undefined); });
      var anchors = {}; Object.keys(this.anchors).forEach(function (k) { var p = k.split(','); anchors[p[0] + ',' + (+p[1] >= col ? +p[1] + 1 : +p[1])] = true; });
      this.anchors = anchors;
      this.maxCols++;
    };
    Sheet.prototype.deleteRow = function (r) {
      count('writes', 'deleteRow');
      this.grid[r] = undefined;
      var g = this.grid; g.splice(r, 1);
      var anchors = {}; Object.keys(this.anchors).forEach(function (k) { var p = k.split(','); anchors[(+p[0] > r ? +p[0] - 1 : +p[0]) + ',' + p[1]] = true; });
      this.anchors = anchors;
      this.maxRows--;
    };
    Sheet.prototype.setFrozenRows = function (n) { this.frozen = n; };
    Sheet.prototype.getFrozenRows = function () { return this.frozen; };
    Sheet.prototype.setRightToLeft = function () { return this; };
    Sheet.prototype.setColumnWidth = function () { return this; };
    Sheet.prototype.getProtections = function () { return this.protections.slice(); };
    Sheet.prototype.getConditionalFormatRules = function () { return this.cf.slice(); };
    Sheet.prototype.setConditionalFormatRules = function (r) { this.cf = r.slice(); };

    function colNum(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
    function parseA1(sheet, a1) {
      var m = /^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/.exec(a1);
      if (!m) throw new Error('bad A1: ' + a1);
      var c0 = colNum(m[1]), r0 = m[2] ? +m[2] : 1, c1 = m[3] ? colNum(m[3]) : c0;
      var r1 = m[3] ? (m[4] ? +m[4] : sheet.maxRows) : r0;
      return new Range(sheet, r0, c0, r1 - r0 + 1, c1 - c0 + 1);
    }

    function Range(sheet, r, c, nr, nc) {
      if (nr < 1 || nc < 1) throw new Error('The number of rows/columns in the range must be at least 1.');
      this.sheet = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc;
    }
    Range.prototype._each = function (fn) { for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) fn(this.r + i, this.c + j, i, j); };
    Range.prototype.getSheet = function () { return this.sheet; };
    Range.prototype.getRow = function () { return this.r; };
    Range.prototype.getColumn = function () { return this.c; };
    Range.prototype.getNumRows = function () { return this.nr; };
    Range.prototype.getNumColumns = function () { return this.nc; };
    Range.prototype.getCell = function (i, j) { return new Range(this.sheet, this.r + i - 1, this.c + j - 1, 1, 1); };
    Range.prototype.getValues = function () {
      count('reads', 'getValues');
      var out = [], sh = this.sheet;
      for (var i = 0; i < this.nr; i++) {
        var row = [];
        for (var j = 0; j < this.nc; j++) {
          var cell = sh._cell(this.r + i, this.c + j), v = cell ? cell.v : '';
          if (typeof v === 'number' && cell && isDateFmt(cell.fmt)) v = serialToDate(v);
          row.push(v);
        }
        out.push(row);
      }
      return out;
    };
    Range.prototype.getValue = function () { return this.getValues()[0][0]; };
    Range.prototype.getDisplayValues = function () {
      count('reads', 'getDisplayValues');
      var out = [], sh = this.sheet;
      for (var i = 0; i < this.nr; i++) {
        var row = [];
        for (var j = 0; j < this.nc; j++) {
          var cell = sh._cell(this.r + i, this.c + j), v = cell ? cell.v : '', f = cell ? cell.fmt : '';
          if (typeof v === 'number') v = isDateFmt(f) ? ymdOfSerial(v) : f === '#,##0' ? Math.round(v).toLocaleString('en-US') : String(v);
          else if (typeof v === 'boolean') v = v ? 'TRUE' : 'FALSE';
          row.push(String(v));
        }
        out.push(row);
      }
      return out;
    };
    Range.prototype.getDisplayValue = function () { return this.getDisplayValues()[0][0]; };
    Range.prototype.getFormulas = function () {
      count('reads', 'getFormulas');
      var out = [], sh = this.sheet;
      for (var i = 0; i < this.nr; i++) {
        var row = [];
        for (var j = 0; j < this.nc; j++) { var cell = sh._cell(this.r + i, this.c + j); row.push(cell ? cell.f : ''); }
        out.push(row);
      }
      return out;
    };
    Range.prototype.getFormula = function () { return this.getFormulas()[0][0]; };
    Range.prototype.setValues = function (vals) {
      count('writes', 'setValues');
      if (vals.length !== this.nr || vals[0].length !== this.nc)
        throw new Error('The number of rows/columns in the data does not match the range: data ' + vals.length + 'x' + vals[0].length + ', range ' + this.nr + 'x' + this.nc);
      var sh = this.sheet;
      this._each(function (r, c, i, j) { sh._set(r, c, vals[i][j]); });
      return this;
    };
    Range.prototype.setValue = function (v) { count('writes', 'setValue'); var sh = this.sheet; this._each(function (r, c) { sh._set(r, c, v); }); return this; };
    Range.prototype.setFormula = function (f) { count('writes', 'setFormula'); this.sheet._setFormula(this.r, this.c, f); return this; };
    Range.prototype.clearContent = function () {
      count('writes', 'clearContent');
      var sh = this.sheet;
      this._each(function (r, c) {
        var cell = sh._cell(r, c);
        if (!cell) return;
        if (sh.anchors[r + ',' + c]) sh._dropAnchor(r, c);
        if (cell.spillOf) return;
        cell.v = ''; cell.f = '';
      });
      return this;
    };
    Range.prototype.setNumberFormat = function (f) {
      count('writes', 'setNumberFormat');
      var sh = this.sheet;
      this._each(function (r, c) { sh._cell(r, c, true).fmt = f; });
      return this;
    };
    Range.prototype.getNumberFormat = function () { var c = this.sheet._cell(this.r, this.c); return c ? c.fmt : ''; };
    Range.prototype.insertCheckboxes = function () {
      count('writes', 'insertCheckboxes');
      var sh = this.sheet;
      this._each(function (r, c) { var cell = sh._cell(r, c, true); if (cell.v === '') cell.v = false; });
      return this;
    };
    Range.prototype.setNote = function (n) { var sh = this.sheet; this._each(function (r, c) { sh._cell(r, c, true).note = n; }); return this; };
    Range.prototype.clearNote = function () { var sh = this.sheet; this._each(function (r, c) { var x = sh._cell(r, c); if (x) x.note = ''; }); return this; };
    Range.prototype.getNote = function () { var c = this.sheet._cell(this.r, this.c); return c ? c.note : ''; };
    ['setFontWeight', 'setBackground', 'setWrap', 'setDataValidation'].forEach(function (m) {
      Range.prototype[m] = function () { return this; };
    });
    Range.prototype.protect = function () {
      var sh = this.sheet, p = {
        desc: '', setDescription: function (d) { this.desc = d; return this; }, getDescription: function () { return this.desc; },
        setWarningOnly: function () { return this; }, remove: function () { var i = sh.protections.indexOf(p); if (i >= 0) sh.protections.splice(i, 1); }
      };
      sh.protections.push(p);
      return p;
    };

    function Spreadsheet(name) {
      this.name = name; this.sheets = []; this.id = 'ss-' + Math.floor(Math.random() * 1e9);
    }
    Spreadsheet.prototype.getSheets = function () { return this.sheets.slice(); };
    Spreadsheet.prototype.getSheetByName = function (n) { for (var i = 0; i < this.sheets.length; i++) if (this.sheets[i].name === n) return this.sheets[i]; return null; };
    Spreadsheet.prototype.insertSheet = function (n, rows, cols) { var s = new Sheet(this, n, rows, cols); this.sheets.push(s); return s; };
    Spreadsheet.prototype.getId = function () { return this.id; };
    Spreadsheet.prototype.getName = function () { return this.name; };
    Spreadsheet.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; };
    Spreadsheet.prototype.getSpreadsheetTimeZone = function () { return TZ; };
    Spreadsheet.prototype.getRange = function (a1) {
      var m = /^'([^']+)'!(.+)$/.exec(a1);
      if (!m) throw new Error('only sheet-qualified ranges supported: ' + a1);
      return this.getSheetByName(m[1]).getRange(m[2]);
    };

    var ss = new Spreadsheet(opts.name || 'FeelHeal tracker');

    // ---------------- services ----------------
    function chain() {   // builder stub: every method returns the builder, build()/create() return a plain object
      var o = {};
      return new Proxy(o, { get: function (t, k) { if (k === 'build' || k === 'create') return function () { return {}; }; return function () { return o.__p || (o.__p = this); }; } });
    }
    var SpreadsheetApp = {
      getActive: function () { return ss; },
      getActiveSpreadsheet: function () { return ss; },
      flush: function () { stats.flushes++; },
      getUi: function () { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); },
      newDataValidation: function () { return chain(); },
      newConditionalFormatRule: function () {
        var ranges = [], b = {
          whenNumberEqualTo: function () { return b; }, setBackground: function () { return b; },
          setRanges: function (r) { ranges = r; return b; }, build: function () { return { getRanges: function () { return ranges; } }; }
        };
        return b;
      },
      ProtectionType: { RANGE: 'RANGE' }
    };

    var docProps = {};
    var PropertiesService = {
      getDocumentProperties: function () {
        return {
          getProperty: function (k) { return k in docProps ? docProps[k] : null; },
          getProperties: function () { var o = {}; for (var k in docProps) o[k] = docProps[k]; return o; },
          setProperty: function (k, v) { docProps[k] = String(v); return this; },
          setProperties: function (o) { for (var k in o) docProps[k] = String(o[k]); return this; },
          deleteProperty: function (k) { delete docProps[k]; return this; }
        };
      }
    };

    var cacheStore = {}, cacheStats = { puts: 0, hits: 0 };
    function byteLen(s) { return unescape(encodeURIComponent(s)).length; }
    var cacheObj = {
      get: function (k) { if (k in cacheStore) { cacheStats.hits++; return cacheStore[k]; } return null; },
      getAll: function (keys) { var o = {}; keys.forEach(function (k) { if (k in cacheStore) o[k] = cacheStore[k]; }); return o; },
      put: function (k, v) { if (byteLen(String(v)) > 100 * 1024) throw new Error('Argument too large: value'); cacheStore[k] = String(v); cacheStats.puts++; },
      putAll: function (o) { for (var k in o) cacheObj.put(k, o[k]); },
      remove: function (k) { delete cacheStore[k]; }
    };
    var CacheService = { getDocumentCache: function () { return cacheObj; }, getScriptCache: function () { return cacheObj; } };

    var lockHeld = 0, lockStats = { max: 0 };
    var LockService = {
      getDocumentLock: function () {
        var mine = false;
        return {
          waitLock: function () { if (lockHeld) throw new Error('Lock timeout: another process was holding the lock for too long.'); lockHeld++; mine = true; lockStats.max = Math.max(lockStats.max, lockHeld); },
          tryLock: function () { if (lockHeld) return false; lockHeld++; mine = true; return true; },
          releaseLock: function () { if (mine) { lockHeld--; mine = false; } },
          hasLock: function () { return mine; }
        };
      }
    };

    var triggers = [];
    var ScriptApp = {
      getProjectTriggers: function () { return triggers.slice(); },
      deleteTrigger: function (t) { var i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: function (fn) {
        var spec = { fn: fn, tz: null };
        var tb = {
          timeBased: function () { spec.kind = 'time'; return tb; }, everyDays: function (n) { spec.days = n; return tb; },
          atHour: function (h) { spec.hour = h; return tb; }, inTimezone: function (z) { spec.tz = z; return tb; },
          forSpreadsheet: function () { spec.kind = 'sheet'; return tb; }, onChange: function () { spec.event = 'change'; return tb; },
          create: function () {
            var t = { spec: spec, getHandlerFunction: function () { return spec.fn; } };
            triggers.push(t); return t;
          }
        };
        return tb;
      }
    };
    var backups = [];
    var DriveApp = { getFileById: function () { return { makeCopy: function (n) { backups.push(n); return { getUrl: function () { return 'https://drive.google.com/backup/' + backups.length; } }; } }; } };
    var logs = [];
    var Logger = { log: function (s) { logs.push(String(s)); } };
    var HtmlService = { createHtmlOutputFromFile: function () { return chain(); } };

    G.SpreadsheetApp = SpreadsheetApp; G.Utilities = Utilities; G.PropertiesService = PropertiesService;
    G.CacheService = CacheService; G.LockService = LockService; G.ScriptApp = ScriptApp; G.DriveApp = DriveApp;
    G.Logger = Logger; G.HtmlService = HtmlService;
    if (!opts.verbose) G.console = { log: function (s) { logs.push(String(s)); }, warn: function (s) { logs.push('WARN ' + s); }, error: function (s) { logs.push('ERROR ' + s); } };

    // ---------------- helpers for tests ----------------
    var env = {
      ss: ss, stats: stats, resetStats: resetStats, cacheStats: cacheStats, cacheStore: cacheStore, lockStats: lockStats,
      docProps: docProps, triggers: triggers, backups: backups, logs: logs, tz: TZ, clock: clock,
      serialToDate: serialToDate, dateToSerial: dateToSerial, ymdOfSerial: ymdOfSerial,
      setNow: function (ms) { clock.now = ms; },
      sheet: function (n) { return ss.getSheetByName(n); },
      // raw cell value, bypassing Date conversion (numbers stay serials)
      raw: function (sheet, r, c) { return ss.getSheetByName(sheet)._valueOf(r, c); },
      fmt: function (sheet, r, c) { var x = ss.getSheetByName(sheet)._cell(r, c); return x ? x.fmt : ''; },
      formula: function (sheet, r, c) { var x = ss.getSheetByName(sheet)._cell(r, c); return x ? x.f : ''; },
      // whole sheet as a plain matrix of raw values (rows 1..last), for snapshots/comparisons
      dump: function (sheet) {
        var sh = ss.getSheetByName(sheet), out = [], lr = 0, lc = sh._lastColRaw();
        for (var r = sh.grid.length - 1; r >= 1; r--) { var row = sh.grid[r]; if (row && row.some(function (x) { return x && (x.v !== '' && x.v !== false || x.f); })) { lr = r; break; } }
        for (var i = 1; i <= lr; i++) { var a = []; for (var j = 1; j <= lc; j++) { var x = sh._cell(i, j); a.push(x ? (x.f || x.v) : ''); } out.push(a); }
        return out;
      },
      // a user typing into the sheet: values are parsed like user input, then the simple onEdit trigger fires
      userEdit: function (sheet, r, c, values) {
        var sh = ss.getSheetByName(sheet), rng = sh.getRange(r, c, values.length, values[0].length);
        values.forEach(function (row, i) { row.forEach(function (v, j) { sh._set(r + i, c + j, v); }); });
        if (typeof G.onEdit === 'function') G.onEdit({ range: rng, source: ss });
      },
      userDeleteRow: function (sheet, r) {
        ss.getSheetByName(sheet).deleteRow(r);
        if (typeof G.onSheetChange === 'function') G.onSheetChange({ changeType: 'REMOVE_ROW' });
      },
      // Data → Sort range on rows 2..n of the given columns (no trigger fires for a sort)
      userSortRows: function (sheet, ncols, keyFn) {
        var sh = ss.getSheetByName(sheet), rows = [];
        for (var r = 2; r < sh.grid.length; r++) {
          var row = sh.grid[r] || [];
          if (!row.slice(1, ncols + 1).some(function (x) { return x && x.v !== '' && x.v !== false && !x.spillOf; })) continue;
          rows.push({ r: r, cells: row.slice(1, ncols + 1).map(function (x) { return x && !x.spillOf ? { v: x.v, fmt: x.fmt } : { v: '', fmt: x ? x.fmt : '' }; }) });
        }
        var vals = rows.map(function (x) { return x.cells.map(function (c) { return c.v; }); });
        var order = rows.map(function (x, i) { return i; }).sort(function (a, b) { var ka = keyFn(vals[a]), kb = keyFn(vals[b]); return ka < kb ? -1 : ka > kb ? 1 : a - b; });
        order.forEach(function (src, i) {
          var dst = rows[i].r;
          rows[src].cells.forEach(function (c, j) { var cell = sh._cell(dst, j + 1, true); if (cell.spillOf) return; cell.v = c.v; cell.fmt = c.fmt; cell.f = ''; });
        });
      }
    };
    return env;
  }

  G.createGasEnv = createGasEnv;
})(typeof globalThis !== 'undefined' ? globalThis : this);
