'use strict';
/*
 * Evidence for docs/PLAN_REVIEW.md: the code snippets of the original optimisation plan (PERFORMANCE_OPTIMIZATION_PLAN.md),
 * run as written on top of v2.1 in the emulator. Each test PASSES when it reproduces the defect it is named after.
 */
const assert = require('assert');
const vm = require('vm');
const { call, test, ORDERS } = require('./lib');
const { v21Sheet, orderRows } = require('./core.test');

// Plan, stage D.1 + D.4 — verbatim
const PLAN_D = `
function generateOrderId_(name, date) {
  var j = toJalaali_(+date.slice(0, 4), +date.slice(5, 7), +date.slice(8, 10));
  var jy = j.jy;
  var osh = SpreadsheetApp.getActive().getSheetByName(CFG.ORDERS_SHEET);
  var lr = osh.getLastRow();
  if (lr < 2) return CFG.ORDER_ID_PREFIX + '-' + jy + '-001';
  var allIds = osh.getRange(2, 1, lr - 1, 1).getValues();
  var maxSeq = 0;
  allIds.forEach(function(x) {
    var m = /^ZH-(\\d{4})-(\\d{3})$/.exec(String(x[0]).trim());
    if (m && +m[1] === jy) maxSeq = Math.max(maxSeq, +m[2]);
  });
  return CFG.ORDER_ID_PREFIX + '-' + jy + '-' + ('00' + (maxSeq + 1)).slice(-3);
}
function migrateOrderIds() {
  var ss = SpreadsheetApp.getActive();
  var osh = ss.getSheetByName(CFG.ORDERS_SHEET);
  var lr = osh.getLastRow();
  if (lr < 2) return;
  var rng = osh.getRange(2, 1, lr - 1, 4);
  var vals = rng.getValues();
  var modified = false;
  for (var i = 0; i < vals.length; i++) {
    var curId = String(vals[i][0]).trim();
    var name = String(vals[i][1]).trim();
    var dateRaw = vals[i][2];
    if (!curId || /^=/.test(curId)) {
      if (name && dateRaw) {
        var iso = typeof dateRaw === 'string' ? dateRaw : isoOf_(dateRaw, ss.getSpreadsheetTimeZone());
        vals[i][0] = generateOrderId_(name, iso);
        modified = true;
      }
    }
  }
  if (modified) {
    osh.getRange(2, 1, vals.length, 1).setValues(vals.map(function(r) { return [r[0]]; }));
  }
}`;

// Plan, stage A.1/A.2 — verbatim key/get/put; getData_ wrapped around v2.1's body ("محاسبات (مثل قبل)")
const PLAN_A = `
function getCacheKey_() {
  var ss = SpreadsheetApp.getActive();
  var main = findMainSheet_(ss);
  var lastMain = lastDataRow_(main, headerMap_(main).name);
  var osh = ss.getSheetByName(CFG.ORDERS_SHEET);
  var lastOrd = lastOrd = osh ? lastDataRow_(osh, 2) : 1;
  return 'fh_v2_' + ss.getId() + '_' + lastMain + '_' + lastOrd + '_' + Math.floor(new Date().getTime() / 600000);
}
function cacheGet_() {
  var cache = CacheService.getDocumentCache();
  var key = getCacheKey_();
  var hit = cache.get(key);
  return hit ? JSON.parse(hit) : null;
}
function cachePut_(data) {
  var cache = CacheService.getDocumentCache();
  var key = getCacheKey_();
  try { cache.put(key, JSON.stringify(data), 600); }
  catch (e) { }
}
var __v21getData_ = getData_;
getData = function () {
  var cached = cacheGet_();
  if (cached) return JSON.stringify(cached);
  return JSON.stringify(getData_());
};
getData_ = function () {
  var cached = cacheGet_();
  if (cached) return cached;
  var result = __v21getData_();
  cachePut_(result);
  return result;
};`;

test('plan D.4 as written: migrating a v2.1 sheet gives every 1405 order the same invoice code', () => {
  const { ctx, env } = v21Sheet(7);
  const before = orderRows(env).map(r => r.A);
  vm.runInContext(PLAN_D, ctx);
  env.sheet(ORDERS).getRange(1, 1).setValue('کد سفارش/فاکتور');     // D.3: formula removed from A
  ctx.migrateOrderIds();
  const after = orderRows(env).map(r => r.A);
  const n1405 = after.filter(a => a === 'ZH-1405-001').length;
  assert.ok(n1405 > 10, 'expected many duplicates, got ' + n1405);
  assert.strictEqual(new Set(after).size, 2);                       // one code per year for ~40 orders
  assert.notDeepStrictEqual(after, before);                         // and the codes already printed on invoices are gone
});

test('plan D.1 as written: deleting the newest order hands its number to the next one', () => {
  const { ctx, env } = v21Sheet(7);
  vm.runInContext(PLAN_D, ctx);
  const sh = env.sheet(ORDERS);
  sh.getRange(1, 1).setValue('کد سفارش/فاکتور');
  ctx.migrateOrderIds();
  ['ZH-1405-001', 'ZH-1405-002', 'ZH-1405-003'].forEach((id, i) => sh.getRange(2 + i, 1).setValue(id));
  for (let r = 5; r <= 41; r++) sh.getRange(r, 1).setValue('');
  sh.deleteRow(4);                                                   // invoice ZH-1405-003 voided
  assert.strictEqual(ctx.generateOrderId_('x', '2026-10-02'), 'ZH-1405-003');
});

test('plan D.1 as written: order #1000 of a year gets code …-000', () => {
  const { ctx, env } = v21Sheet(7);
  vm.runInContext(PLAN_D, ctx);
  env.sheet(ORDERS).getRange(2, 1).setValue('ZH-1405-999');
  assert.strictEqual(ctx.generateOrderId_('x', '2026-10-02'), 'ZH-1405-000');
});

test('plan A as written: after saving a change to an existing customer the app shows the old data', () => {
  const { ctx } = v21Sheet(7);
  vm.runInContext(PLAN_A, ctx);
  const d = call(ctx, 'getData');
  const c = d.customers[0];
  assert.notStrictEqual(c.stage, 'در حال فالوآپ');
  const after = call(ctx, 'saveRecord', { row: c.row, originalName: c.name, stage: 'در حال فالوآپ', newNote: 'یادداشت تازه' });
  assert.strictEqual(after.customers[0].stage, c.stage, 'stale cache expected');                 // row count unchanged → same key
  assert.strictEqual(after.customers[0].notes.length, c.notes.length);
});
