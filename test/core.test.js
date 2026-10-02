'use strict';
// Server-side tests for src/Code.gs on the Apps Script emulator (node test/run.js)
const assert = require('assert');
const { boot, load, call, makeMain, rng, test, ORDERS, SETTINGS, MAIN, CUSTOMERS, todaySerial } = require('./lib');
const { v21, JALALI, jparts } = require('./v21-reference');

const ID_RE = /^ZH-(\d{4})-(\d{3,})$/;
const SKUS = ['BCD 1010', 'BCD 1015', 'BCW 1010', 'BCW 0505', 'BCP 0505'];

// fresh install: legacy main sheet → v2.2 setup
function fresh(opts) {
  const b = boot(opts, 'v22');
  makeMain(b.env, CUSTOMERS);
  b.ctx.setup();
  return b;
}
function mainCols(env) {
  const sh = env.sheet(MAIN), lc = sh._lastColRaw(), m = {};
  for (let c = 1; c <= lc; c++) m[sh._valueOf(1, c)] = c;
  return m;
}
const CALC = { annVol: 'حجم خالص سالانه (واحد)', annAmt: 'مبلغ خالص سالانه (تومان)', annCnt: 'تعداد سفارش خرید سال جاری',
  qVol: 'حجم خالص فصل جاری (واحد)', volBCD: 'حجم سالانه BCD', volBCW: 'حجم سالانه BCW', volBCP: 'حجم سالانه BCP',
  thr: 'وضعیت آستانه حجمی', coll: 'وضعیت وصول مطالبات' };
function lastNamed(env, sheet, col) {
  const sh = env.sheet(sheet);
  for (let r = sh.maxRows; r >= 2; r--) if (String(sh._valueOf(r, col)).trim() !== '') return r;
  return 1;
}
function orderRows(env) {
  const out = [], last = lastNamed(env, ORDERS, 2);
  for (let r = 2; r <= last; r++) {
    const g = c => env.raw(ORDERS, r, c);
    out.push({ A: g(1), B: g(2), C: g(3), D: g(4), E: g(5), F: g(6), G: g(7), H: g(8), I: g(9), J: g(10) });
  }
  return out;
}
function mainNames(env) {
  const m = mainCols(env), last = lastNamed(env, MAIN, m['نام مرکز/پزشک']), out = [];
  for (let r = 2; r <= last; r++) out.push(String(env.raw(MAIN, r, m['نام مرکز/پزشک'])));
  return out;
}
function settings(env) { return { threshold: env.raw(SETTINGS, 1, 2), minOrders: env.raw(SETTINGS, 2, 2) }; }

// Random order rows typed straight into the sheet (B..J), with the messy cases v2.1's formulas had to cope with
function randomOrders(env, R, n) {
  const sh = env.sheet(ORDERS), today = todaySerial(env), names = CUSTOMERS.map(c => c[0]);
  const rows = [];
  sh.getRange(2, 1, n, 17).clearDataValidations();   // deliberately invalid rows (bad SKU, blank names…) as left by old data
  for (let i = 0; i < n; i++) {
    const prev = rows[rows.length - 1];
    let name = R.chance(0.05) ? '' : R.pick(names);
    if (name === 'Clinic Nova' && R.chance(0.3)) name = 'clinic nova';            // SUMIFS is case-insensitive
    let date = R.chance(0.06) ? 'نامشخص' : R.chance(0.05) ? '' : today - R.int(-30, 520);
    if (prev && R.chance(0.12)) { name = prev[0]; date = prev[1]; }              // same customer, same day
    const type = R.chance(0.7) ? 'خرید' : R.chance(0.5) ? 'نمونه' : 'مرجوعی';
    const sku = R.chance(0.08) ? 'bcw 0505' : R.chance(0.05) ? 'XYZ' : R.pick(SKUS);
    const units = R.chance(0.04) ? 'ده' : R.chance(0.04) ? '' : R.chance(0.05) ? R.int(1, 9) + 0.5 : R.int(1, 200);
    const amount = R.chance(0.04) ? '' : R.chance(0.05) ? R.int(1, 900) * 1000 + 0.5 : R.int(0, 900) * 100000;
    const due = R.chance(0.45) ? today + R.int(-90, 60) : R.chance(0.03) ? 'بعداً' : '';
    const paid = R.chance(0.3) ? today - R.int(0, 300) : '';
    const def = R.chance(0.08);
    rows.push([name, date, type, sku, units, amount, due, paid, def]);
  }
  rows.forEach((row, i) => row.forEach((v, j) => sh._set(2 + i, 2 + j, v)));
  return rows;
}

// arrays/objects created inside the vm context have another realm's prototypes — compare as plain JSON
const plain = x => JSON.parse(JSON.stringify(x));
const eq = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);
const near = (a, b) => (a === b) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);

// ------------------------------------------------------------------
test('fresh install: setup builds the v2.2 structure', () => {
  const { ctx, env } = fresh();
  assert.strictEqual(env.docProps.fh_schema, '2.2');
  const m = mainCols(env);
  Object.values(CALC).forEach(h => assert.ok(m[h], 'missing column ' + h));
  assert.ok(m['نوع کانال خریدار']);
  // channel mapping: «سایر» stays empty for manual review, داروخانه → بیمارستان
  const ch = r => env.raw(MAIN, r, m['نوع کانال خریدار']);
  assert.strictEqual(ch(2), 'کلینیک/پزشک مستقیم');
  assert.strictEqual(ch(5), 'بیمارستان');
  assert.strictEqual(ch(7), '');
  // Jalali text dates in the legacy sheet became real dates
  assert.strictEqual(env.ymdOfSerial(env.raw(MAIN, 2, m['تاریخ پیگیری بعدی'])), '2026-10-12');
  // orders sheet: plain headers except K (light formula), A..Q
  assert.strictEqual(env.raw(ORDERS, 1, 1), 'کد سفارش/فاکتور');
  assert.strictEqual(env.formula(ORDERS, 1, 1), '');
  assert.ok(/^=\{"وضعیت پرداخت \(کد\)";MAP\(/.test(env.formula(ORDERS, 1, 11)));
  for (let c = 12; c <= 17; c++) assert.strictEqual(env.formula(ORDERS, 1, c), '', 'formula left in column ' + c);
  // triggers: daily (in the sheet time zone) + onChange
  const fns = env.triggers.map(t => t.getHandlerFunction()).sort();
  eq(fns, ['dailyRefresh', 'onSheetChange']);
  ctx.setup();                                                       // re-running setup keeps one daily trigger, at 00:00 sheet time
  const daily = env.triggers.filter(t => t.getHandlerFunction() === 'dailyRefresh');
  assert.strictEqual(daily.length, 1);
  assert.strictEqual(daily[0].spec.tz, 'Asia/Tehran');
  assert.strictEqual(daily[0].spec.hour, 0);
  const d = call(ctx, 'getData');
  assert.strictEqual(d.customers.length, CUSTOMERS.length);
  eq(d.broken, []);
});

test('compute_ reproduces the v2.1 formulas exactly (random data, 5 dates incl. Nowruz and quarter edges)', () => {
  const NOWS = [Date.UTC(2026, 9, 2, 8), Date.UTC(2026, 2, 20, 8), Date.UTC(2026, 2, 21, 8), Date.UTC(2026, 5, 21, 8), Date.UTC(2026, 5, 22, 8)];
  let checked = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const now = NOWS[seed % NOWS.length];
    const { ctx, env } = fresh({ now });
    const R = rng(seed);
    env.sheet(SETTINGS)._set(1, 2, R.int(20, 400));
    env.sheet(SETTINGS)._set(2, 2, R.int(0, 3));
    randomOrders(env, R, R.int(15, 140));
    const rows = orderRows(env), names = mainNames(env), today = todaySerial(env);
    const ref = v21(rows, names, settings(env), today);

    const snap = ctx.readSnap_(ctx.ctx_()), comp = ctx.compute_(snap);
    rows.forEach((r, i) => {
      const o = comp.O[i], e = ref.orders[i], at = 'seed ' + seed + ' order row ' + (i + 2);
      assert.strictEqual(o.status, e.K, at + ' K');
      assert.strictEqual(o.jDate, e.N, at + ' N'); assert.strictEqual(o.jDue, e.O, at + ' O'); assert.strictEqual(o.jPaid, e.P, at + ' P');
      if (typeof r.C === 'number') {        // text dates: v2.1 did a text comparison in COUNTIFS; v2.2 leaves L/M empty
        assert.strictEqual(o.nth, e.L, at + ' L'); assert.strictEqual(o.prev, e.M, at + ' M'); assert.strictEqual(o.jPrev, e.Q, at + ' Q');
      }
      checked++;
    });
    names.forEach((n, i) => {
      if (!n) return;
      Object.keys(CALC).forEach(k => assert.ok(near(comp.C[i][k], ref.customers[i][k]), 'seed ' + seed + ' ' + n + ' ' + k + ': ' + comp.C[i][k] + ' ≠ ' + ref.customers[i][k]));
    });

    // write + read back: the sheet now holds the same values, and a second pass finds nothing to write
    assert.ok(ctx.recalcLocked_(0, true));
    const m = mainCols(env);
    names.forEach((n, i) => { if (n) Object.keys(CALC).forEach(k => assert.ok(near(env.raw(MAIN, i + 2, m[CALC[k]]), ref.customers[i][k]), 'sheet ' + k)); });
    rows.forEach((r, i) => {
      if (typeof r.C !== 'number') return;
      const e = ref.orders[i], g = c => env.raw(ORDERS, i + 2, c);
      eq([g(12), g(13), g(14), g(15), g(16), g(17)], [e.L, e.M, e.N, e.O, e.P, e.Q], 'sheet L..Q row ' + (i + 2));
    });
    const snap2 = ctx.readSnap_(ctx.ctx_());
    assert.strictEqual(ctx.writeDerived_(snap2, ctx.compute_(snap2), false, true), 0, 'not converged, seed ' + seed);

    // invoice codes: every order with a name and a real date has one, unique, year = Jalali year of the order date
    const seen = new Set(), perYear = {};
    orderRows(env).forEach(r => {
      const has = r.B !== '' && typeof r.C === 'number' && r.C > 0;
      if (!has) { assert.strictEqual(r.A, ''); return; }
      const mm = ID_RE.exec(r.A);
      assert.ok(mm, 'bad id ' + r.A);
      assert.strictEqual(+mm[1], jparts(r.C).y);
      assert.ok(!seen.has(r.A), 'duplicate ' + r.A); seen.add(r.A);
      (perYear[mm[1]] = perYear[mm[1]] || []).push(+mm[2]);
    });
    Object.values(perYear).forEach(s => eq(s, s.map((x, i) => i + 1)));   // fresh: 001.. in row order
  }
  assert.ok(checked > 1000, 'only ' + checked + ' rows checked');
});

test('saveOrder: ZH-<year>-<seq>, and a deleted number is never handed out again', () => {
  const { ctx, env } = fresh();
  const o = (name, date, extra) => call(ctx, 'saveOrder', Object.assign({ name, type: 'خرید', sku: 'BCD 1010', units: 10, amount: 1000000, date }, extra || {}));
  const r1 = o('کلینیک آرامش', '2026-09-28'), r2 = o('پخش البرز', '2026-10-01'), r3 = o('کلینیک آرامش', '2026-10-02');
  eq([r1.result.orderId, r2.result.orderId, r3.result.orderId], ['ZH-1405-001', 'ZH-1405-002', 'ZH-1405-003']);
  // an order dated in 1404 gets its own sequence
  assert.strictEqual(o('پخش البرز', '2026-01-15').result.orderId, 'ZH-1404-001');
  // the response already contains the computed values (no second round trip)
  const a = r3.customers.find(c => c.name === 'کلینیک آرامش');
  assert.strictEqual(a.annVol, 20); assert.strictEqual(a.annCnt, 2); assert.strictEqual(a.coll, 'در جریان');
  assert.strictEqual(r3.orders.find(x => x.id === 'ZH-1405-003').nth, 2);
  // user deletes the newest order (row 4) → its number must not come back
  env.userDeleteRow(ORDERS, 4);
  assert.strictEqual(o('Clinic Nova', '2026-10-02').result.orderId, 'ZH-1405-004');
  // validation
  assert.throws(() => o('ناشناس', '2026-10-02'), /پیدا نشد/);
  assert.throws(() => o('کلینیک آرامش', '2026-10-02', { sku: 'ZZZ' }), /SKU/);
  assert.throws(() => o('کلینیک آرامش', '2026-10-02', { units: 0 }), /بزرگ‌تر از صفر/);
});

test('IDs survive sorting and row deletion; nth/prev follow the dates', () => {
  const { ctx, env } = fresh();
  const dates = ['2026-09-30', '2026-09-01', '2026-09-15', '2026-09-15'];
  const ids = dates.map(d => call(ctx, 'saveOrder', { name: 'کلینیک آرامش', type: 'خرید', sku: 'BCD 1010', units: 5, amount: 0, date: d }).result.orderId);
  const byDate = () => { const d = call(ctx, 'getData'); return d.orders.map(o => o.date + ' ' + o.id + ' #' + o.nth); };
  const before = byDate().sort();
  env.userSortRows(ORDERS, 17, r => r[2]);   // Data → Sort range A..Q by column C
  ctx.onSheetChange({ changeType: 'EDIT' });   // a sort fires no onEdit; the change event's type is undocumented → worst case
  const after = byDate();
  eq(after.slice().sort(), before, 'an order changed its code or its nth after sorting');
  eq(after.map(s => s.split(' ')[1]), [ids[1], ids[2], ids[3], ids[0]]);
  eq(after.map(s => s.split('#')[1]), ['1', '2', '3', '4']);
  env.userDeleteRow(ORDERS, 2);   // the 2026-09-01 order
  const d = call(ctx, 'getData');
  eq(d.orders.map(o => o.id + '#' + o.nth), [ids[2] + '#1', ids[3] + '#2', ids[0] + '#3']);
  assert.strictEqual(env.raw(ORDERS, 2, 13), '');   // no earlier order any more
});

test('copy-pasted row: duplicate-code warning, clearing A gives a fresh code', () => {
  const { ctx, env } = fresh();
  ['2026-09-20', '2026-09-25'].forEach(d => call(ctx, 'saveOrder', { name: 'پخش البرز', type: 'خرید', sku: 'BCW 1010', units: 3, amount: 0, date: d }));
  const sh = env.sheet(ORDERS);
  env.userEdit(ORDERS, 4, 1, [Array.from({ length: 10 }, (_, j) => env.raw(ORDERS, 2, j + 1))]);   // paste row 2 → row 4 (incl. code)
  let d = call(ctx, 'getData');
  assert.strictEqual(d.warnings.length, 1);
  assert.ok(/ZH-1405-001/.test(d.warnings[0]));
  env.userEdit(ORDERS, 4, 1, [['']]);                                              // user clears the copied code
  assert.strictEqual(env.raw(ORDERS, 4, 1), 'ZH-1405-003');
  d = call(ctx, 'getData');
  eq(d.warnings, []);
});

test('typing an order directly in the sheet: Jalali date converted, code and L..Q filled by onEdit', () => {
  const { ctx, env } = fresh();
  env.userEdit(ORDERS, 2, 2, [['بیمارستان مدنی کرج', '1405/07/05', 'خرید', 'BCP 0505', 40, 25000000, '1405/08/05', '', false]]);
  assert.strictEqual(env.ymdOfSerial(env.raw(ORDERS, 2, 3)), '2026-09-27');
  assert.strictEqual(env.raw(ORDERS, 2, 1), 'ZH-1405-001');
  eq([12, 14, 15].map(c => env.raw(ORDERS, 2, c)), [1, '1405/07/05', '1405/08/05']);
  const m = mainCols(env);
  assert.strictEqual(env.raw(MAIN, 3, m[CALC.volBCP]), 40);
  // a later fix of the date keeps the code (codes never change)
  env.userEdit(ORDERS, 2, 3, [['1404/12/28']]);
  assert.strictEqual(env.raw(ORDERS, 2, 1), 'ZH-1405-001');
  assert.strictEqual(env.raw(ORDERS, 2, 14), '1404/12/28');
  assert.strictEqual(env.raw(MAIN, 3, m[CALC.volBCP]), 0);       // no longer in the current year
});

test('server cache: hit costs no sheet reads; saves and direct edits invalidate it', () => {
  const { ctx, env } = fresh();
  call(ctx, 'getData');
  env.resetStats();
  const d1 = call(ctx, 'getData');
  assert.strictEqual(env.stats.reads, 0, 'cache hit read the sheet');
  assert.ok(!d1._ms);
  // save on an existing row (row count unchanged — the plan's key would not have changed)
  const c = d1.customers[0];
  call(ctx, 'saveRecord', { row: c.row, originalName: c.name, newNote: 'تماس گرفته شد', stage: 'در حال فالوآپ' });
  const d2 = call(ctx, 'getData');
  assert.strictEqual(d2.customers[0].stage, 'در حال فالوآپ');
  assert.strictEqual(d2.customers[0].notes.slice(-1)[0].text, 'تماس گرفته شد');
  // direct edit in the sheet (onEdit bumps the version)
  env.userEdit(MAIN, 2, mainCols(env)['شهر'], [['مشهد']]);
  assert.strictEqual(call(ctx, 'getData').customers[0].city, 'مشهد');
});

test('server cache: payloads over 100KB are split into chunks', () => {
  const { ctx, env } = fresh();
  const notes = JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ date: '2026-09-01', text: 'یادداشت طولانی شماره ' + i + ' '.repeat(10) + 'x'.repeat(200) })));
  const sh = env.sheet(MAIN), nc = mainCols(env)['یادداشت‌ها'];
  for (let r = 2; r <= 7; r++) sh._set(r, nc, notes);
  for (let i = 0; i < 25; i++) call(ctx, 'saveRecord', { name: 'مشتری آزمایشی ' + i, channel: 'عمده‌فروش', newNote: 'x'.repeat(5000) });
  const big = JSON.stringify(call(ctx, 'getData'));
  assert.ok(big.length > 150000, 'payload only ' + big.length);
  env.resetStats();
  assert.strictEqual(JSON.stringify(call(ctx, 'getData')).length, big.length);
  assert.strictEqual(env.stats.reads, 0);
  assert.ok(Object.keys(env.cacheStore).some(k => /_2$/.test(k)), 'expected several chunks');
});

test('new year / new quarter: annual values reset without any edit', () => {
  const { ctx, env } = fresh({ now: Date.UTC(2026, 2, 19, 8) });     // 1404/12/28
  call(ctx, 'saveOrder', { name: 'پخش البرز', type: 'خرید', sku: 'BCD 1010', units: 600, amount: 0, date: '2026-03-10' });
  call(ctx, 'saveOrder', { name: 'پخش البرز', type: 'خرید', sku: 'BCD 1010', units: 50, amount: 0, date: '2026-03-15' });
  let p = call(ctx, 'getData').customers.find(c => c.name === 'پخش البرز');
  assert.strictEqual(p.annVol, 650); assert.strictEqual(p.thr, '✅ تعهد حجمی واقعی');
  env.setNow(Date.UTC(2026, 2, 21, 8));                               // 1405/01/01 — cache key includes the date
  const d = call(ctx, 'getData');
  p = d.customers.find(c => c.name === 'پخش البرز');
  assert.strictEqual(p.annVol, 0); assert.strictEqual(p.thr, 'زیر آستانه');
  assert.strictEqual(d.settings.period, '1405 — فصل 1');
  assert.strictEqual(env.raw(MAIN, 6, mainCols(env)[CALC.annVol]), 0, 'sheet not refreshed');
  // the daily trigger does the same without anyone opening the app
  env.setNow(Date.UTC(2026, 5, 22, 8));                               // 1405/04/01
  ctx.dailyRefresh();
  assert.strictEqual(env.raw(SETTINGS, 7, 2), '1405 — فصل 2');
});

test('overdue payments flip to «معوق» the day after the due date', () => {
  const { ctx, env } = fresh();
  call(ctx, 'saveOrder', { name: 'Clinic Nova', type: 'خرید', sku: 'BCW 1010', units: 2, amount: 100, date: '2026-09-20', due: '2026-10-02' });
  assert.strictEqual(call(ctx, 'getData').customers.find(c => c.name === 'Clinic Nova').coll, 'در جریان');
  env.setNow(Date.UTC(2026, 9, 3, 8));
  ctx.dailyRefresh();
  assert.strictEqual(env.raw(MAIN, 4, mainCols(env)[CALC.coll]), 'معوق');
  assert.strictEqual(call(ctx, 'getData').customers.find(c => c.name === 'Clinic Nova').coll, 'معوق');
});

test('saveRecord: new customer, rename follows into orders, delete rules', () => {
  const { ctx, env } = fresh();
  let d = call(ctx, 'saveRecord', { name: 'کلینیک نو', channel: 'کلینیک/پزشک مستقیم', city: 'قم', stage: 'خرید مجدد/فعال' });
  let c = d.customers.find(x => x.name === 'کلینیک نو');
  assert.strictEqual(c.purchases, 1); assert.strictEqual(c.stageDate, '2026-10-02'); assert.strictEqual(c.nextDate, '2026-11-01');
  assert.strictEqual(c.annVol, 0); assert.strictEqual(c.coll, 'بدون مطالبه باز');
  assert.throws(() => call(ctx, 'saveRecord', { name: 'کلینیک  نو ', channel: 'عمده‌فروش' }), /همین نام/);
  call(ctx, 'saveOrder', { name: 'کلینیک نو', type: 'خرید', sku: 'BCD 1015', units: 7, amount: 0, date: '2026-10-01' });
  d = call(ctx, 'saveRecord', { row: c.row, originalName: 'کلینیک نو', name: 'کلینیک نوین' });
  assert.strictEqual(d.orders[0].name, 'کلینیک نوین');
  assert.strictEqual(d.customers.find(x => x.name === 'کلینیک نوین').annVol, 7);
  c = d.customers.find(x => x.name === 'کلینیک نوین');
  assert.throws(() => call(ctx, 'deleteRecord', c.row, c.name), /سفارش ثبت‌شده/);
  const before = d.customers.length, nova = d.customers.find(x => x.name === 'Clinic Nova');
  d = call(ctx, 'deleteRecord', nova.row, nova.name);
  assert.strictEqual(d.customers.length, before - 1);
  // rows below moved up together with their computed values
  const s2 = ctx.readSnap_(ctx.ctx_());
  assert.strictEqual(ctx.writeDerived_(s2, ctx.compute_(s2), false, true), 0);
});

test('cmp_: floating-point noise is not a change, real differences are', () => {
  const { ctx } = fresh();
  assert.strictEqual(ctx.cmp_(0.1 + 0.2, 'UTC'), ctx.cmp_(0.3, 'UTC'));
  assert.notStrictEqual(ctx.cmp_(1234567.5, 'UTC'), ctx.cmp_(1234567, 'UTC'));
  assert.notStrictEqual(ctx.cmp_(0, 'UTC'), ctx.cmp_('', 'UTC'));
});

test('web app refuses to write before setup (schema check)', () => {
  const { ctx, env } = boot({}, 'v22');
  makeMain(env, CUSTOMERS);
  assert.throws(() => call(ctx, 'getData'), /setup/);
  assert.throws(() => call(ctx, 'saveOrder', { name: 'x' }), /setup/);
});

// ------------------------------------------------------------------
// Upgrade from a real v2.1 sheet (built by the v2.1 code itself; formula results filled in from the reference)
function v21Sheet(seed, opts) {
  const { ctx, env } = boot(opts, 'v21');
  makeMain(env, CUSTOMERS);
  ctx.setup();
  const R = rng(seed), names = CUSTOMERS.map(c => c[0]), today = todaySerial(env);
  for (let i = 0; i < 40; i++) {
    const iso = env.ymdOfSerial(today - R.int(0, 420));
    call(ctx, 'saveOrder', { name: R.pick(names), type: R.chance(0.8) ? 'خرید' : 'مرجوعی', sku: R.pick(SKUS), units: R.int(1, 90), amount: R.int(1, 50) * 100000, date: iso, due: R.chance(0.5) ? env.ymdOfSerial(today + R.int(-40, 40)) : '' });
  }
  evaluateV21(env);
  return { ctx, env };
}
// what the v2.1 formulas display, written as spilled values under their header formulas
function evaluateV21(env) {
  const rows = orderRows(env), names = mainNames(env), ref = v21(rows, names, settings(env), todaySerial(env));
  const osh = env.sheet(ORDERS);
  osh._spill(1, 1, ref.orders.map(o => o.A));
  ['K', 'L', 'M', 'N', 'O', 'P', 'Q'].forEach((k, j) => osh._spill(1, 11 + j, ref.orders.map(o => o[k])));
  const msh = env.sheet(MAIN), m = mainCols(env);
  Object.keys(CALC).forEach(k => msh._spill(1, m[CALC[k]], ref.customers.map(c => c ? c[k] : '')));
  return ref;
}
function dumpAll(env) { return JSON.stringify(env.ss.getSheets().map(s => [s.getName(), env.dump(s.getName())])); }

test('upgrade v2.1 → v2.2: invoice codes frozen exactly as displayed, numbers unchanged', () => {
  const { ctx, env } = v21Sheet(7);
  const shown = env.sheet(ORDERS).getRange(2, 1, lastNamed(env, ORDERS, 2) - 1, 1).getDisplayValues().map(r => r[0]);
  assert.ok(shown.length === 40 && shown.every(s => ID_RE.test(s)));
  const refBefore = evaluateV21(env);
  const m = mainCols(env), mainBefore = mainNames(env).map((n, i) => Object.keys(CALC).map(k => env.raw(MAIN, i + 2, m[CALC[k]])));
  load(ctx, 'v22');

  const snapshot = dumpAll(env);
  const report = ctx.checkSchema();
  assert.strictEqual(dumpAll(env), snapshot, 'checkSchema changed the sheet');
  assert.ok(report.includes('40 سفارش'), report);

  ctx.setup();
  const after = orderRows(env).map(r => r.A);
  eq(after, shown, 'invoice codes changed during the upgrade');
  assert.strictEqual(env.formula(ORDERS, 1, 1), '');
  assert.strictEqual(env.docProps.fh_schema, '2.2');
  orderRows(env).forEach((r, i) => {
    const e = refBefore.orders[i], g = c => env.raw(ORDERS, i + 2, c);
    eq([g(12), g(13), g(14), g(15), g(16), g(17)], [e.L, e.M, e.N, e.O, e.P, e.Q], 'L..Q changed, row ' + (i + 2));
  });
  mainNames(env).forEach((n, i) => Object.keys(CALC).forEach((k, j) => assert.ok(near(env.raw(MAIN, i + 2, m[CALC[k]]), mainBefore[i][j]), n + ' ' + k)));
  // the next code continues after the highest frozen number of the year
  const max1405 = Math.max(...shown.filter(s => s.startsWith('ZH-1405')).map(s => +s.slice(8)));
  const r = call(ctx, 'saveOrder', { name: 'کلینیک آرامش', type: 'خرید', sku: 'BCD 1010', units: 1, amount: 0, date: '2026-10-02' });
  assert.strictEqual(r.result.orderId, 'ZH-1405-' + String(max1405 + 1).padStart(3, '0'));
  // running setup again leaves the codes alone
  ctx.setup();
  eq(orderRows(env).map(x => x.A).slice(0, 40), shown);
});

test('upgrade preflight: if column A is not fully calculated, setup stops before changing anything', () => {
  const { ctx, env } = v21Sheet(11);
  const osh = env.sheet(ORDERS);
  osh._cell(5, 1).v = 'Loading...';
  osh._cell(9, 1).v = '#ERROR!';
  load(ctx, 'v22');
  const snapshot = dumpAll(env), backups = env.backups.length;
  assert.throws(() => ctx.setup(), /Loading|#ERROR|محاسبه/);
  assert.strictEqual(dumpAll(env), snapshot, 'setup modified the sheet before aborting');
  assert.strictEqual(env.backups.length, backups);
  assert.notStrictEqual(env.docProps.fh_schema, '2.2');
  assert.ok(ctx.checkSchema().includes('⛔'), 'checkSchema should flag the rows');
  // explicit escape hatch: the two broken rows get fresh codes after the highest existing number, the rest stay frozen
  const shown = orderRows(env).map(r => r.A);
  ctx.setupRenewBrokenCodes();
  assert.strictEqual(env.docProps.fh_schema, '2.2');
  const after = orderRows(env).map(r => r.A);
  after.forEach((id, i) => { if (i !== 3 && i !== 7) assert.strictEqual(id, shown[i]); });
  [after[3], after[7]].forEach(id => {
    const m = ID_RE.exec(id), same = shown.filter(s => ID_RE.test(s) && s.slice(3, 7) === m[1]).map(s => +s.slice(8));
    assert.ok(+m[2] > Math.max(...same), id + ' reuses a number');
  });
});

// Reported from a real sheet: setup died with «The data you entered in cell A2 violates the data validation rules set on this cell».
// A sheet that was upgraded from v2.0 had its customer-name rule (value must be in the customers list) on the new column A too.
function withColumnARule(env) {
  const main = env.sheet(MAIN), m = mainCols(env), nc = m['نام مرکز/پزشک'];
  const rule = SpreadsheetApp_(env).newDataValidation().requireValueInRange(main.getRange(2, nc, 100, 1)).setAllowInvalid(false).build();
  env.sheet(ORDERS).getRange(2, 1, 150, 1).setDataValidation(rule);
}
const SpreadsheetApp_ = env => ({ newDataValidation: () => env.ctx.SpreadsheetApp.newDataValidation() });

test('upgrade: a leftover validation rule on column A must not block freezing the invoice codes', () => {
  const { ctx, env } = v21Sheet(7);
  env.ctx = ctx;
  const shown = env.sheet(ORDERS).getRange(2, 1, 40, 1).getDisplayValues().map(r => r[0]);
  withColumnARule(env);
  load(ctx, 'v22');
  ctx.setup();
  eq(orderRows(env).map(r => r.A), shown);
  assert.strictEqual(env.docProps.fh_schema, '2.2');
  // and the web app can write a new code into A afterwards
  assert.ok(call(ctx, 'saveOrder', { name: 'کلینیک آرامش', type: 'خرید', sku: 'BCD 1010', units: 1, amount: 0, date: '2026-10-02' }).result.orderId);
});

test('upgrade: if freezing the codes fails midway, the live sheet keeps its formulas and setup can be rerun', () => {
  const { ctx, env } = v21Sheet(7);
  const shown = env.sheet(ORDERS).getRange(2, 1, 40, 1).getDisplayValues().map(r => r[0]);
  const f = [1, 12, 13, 14, 15, 16, 17].map(c => env.formula(ORDERS, 1, c));
  load(ctx, 'v22');
  env.failWrites((sheet, r, c) => sheet === ORDERS && c === 1 && r === 2);
  assert.throws(() => ctx.setup(), /simulated write failure/);
  eq([1, 12, 13, 14, 15, 16, 17].map(c => env.formula(ORDERS, 1, c)), f, 'header formulas not restored');
  evaluateV21(env);                                   // Sheets recalculates the restored formulas (the emulator has no formula engine)
  eq(env.sheet(ORDERS).getRange(2, 1, 40, 1).getDisplayValues().map(r => r[0]), shown, 'codes lost');
  assert.notStrictEqual(env.docProps.fh_schema, '2.2');
  env.failWrites(null);
  ctx.setup();
  eq(orderRows(env).map(r => r.A), shown);
});

test('API usage per operation (emulator counts, cache miss vs hit)', () => {
  const { ctx, env } = fresh();
  const R = rng(3);
  randomOrders(env, R, 120);
  ctx.recalcLocked_(0, true);
  const measure = (label, fn) => { env.resetStats(); fn(); const s = env.stats; console.log('      ' + label.padEnd(34) + 'reads ' + String(s.reads).padStart(2) + ' · writes ' + String(s.writes).padStart(2) + ' · flush ' + s.flushes); return Object.assign({}, s); };
  measure('getData (cache miss)', () => { ctx.bumpCache_(); call(ctx, 'getData'); });
  const hit = measure('getData (cache hit)', () => call(ctx, 'getData'));
  const c = call(ctx, 'getData').customers[1];
  const fu = measure('saveRecord (follow-up)', () => call(ctx, 'saveRecord', { row: c.row, originalName: c.name, newNote: 'fu', nextDate: '2026-10-09' }));
  const so = measure('saveOrder', () => call(ctx, 'saveOrder', { name: c.name, type: 'خرید', sku: 'BCD 1010', units: 1, amount: 0, date: '2026-10-02' }));
  assert.strictEqual(hit.reads, 0);
  assert.ok(fu.reads <= 12 && so.reads <= 12, 'too many reads');
  assert.strictEqual(fu.flushes, 1); assert.strictEqual(so.flushes, 1);
});

module.exports = { fresh, v21Sheet, evaluateV21, orderRows, mainCols, randomOrders, CALC };
