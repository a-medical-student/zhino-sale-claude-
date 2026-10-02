'use strict';
// Shared test helpers: boot Code.gs on top of the Apps Script emulator, build sheets, tiny test runner.
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.resolve(ROOT, p), 'utf8');
// FH_CODE=path/to/Code.gs runs the suite against another version of the backend
const SRC = { mock: read('test/gas-mock.js'), v22: read(process.env.FH_CODE || 'src/Code.gs'), v21: read('test/fixtures/v2.1-Code.gs') };

const ORDERS = 'سفارش‌ها', SETTINGS = 'تنظیمات', MAIN = 'مشتریان';
const LEGACY_HDR = ['نام مرکز/پزشک', 'نوع', 'شهر', 'فرد رابط', 'تلفن', 'مسیر جذب', 'مرحله', 'تاریخ ورود به مرحله',
  'تاریخ پیگیری بعدی', 'وضعیت پیگیری', 'توصیه اقدام', 'تعداد خرید', 'یادداشت‌ها'];
const CUSTOMERS = [
  ['کلینیک آرامش', 'کلینیک', 'تهران', 'دکتر صالحی', '0912', 'معرفی/رفرال', 'خرید اول', '', '1405/07/20', '', '', 1, ''],
  ['بیمارستان مدنی کرج', 'بیمارستان', 'کرج', 'خانم نوری', '0935', 'کنگره یا نمایشگاه', 'در حال فالوآپ', '', '1405/07/08', '', '', 0, ''],
  ['Clinic Nova', 'پزشک', 'شیراز', '', '', 'آنلاین', 'نمونه ارسال شد', '', '', '', '', 0, ''],
  ['داروخانه سینا', 'داروخانه', 'اصفهان', '', '', 'تماس سرد', 'مخاطب جدید', '', '1405/07/10', '', '', 0, ''],
  ['پخش البرز', 'واسطه', 'تهران', 'آقای کریمی', '021', 'شبکه شخصی/حضوری', 'خرید مجدد/فعال', '', '1405/08/01', '', '', 3, ''],
  ['مرکز درمانی سایر', 'سایر', 'تبریز', '', '', 'سایر', 'معرفی اولیه شد', '', '', '', '', 0, '']
];

// Fresh global (vm context) with the emulator; optionally evaluate one or more Code.gs versions in it.
function boot(opts, ...codes) {
  const ctx = vm.createContext({});
  vm.runInContext(SRC.mock, ctx, { filename: 'gas-mock.js' });
  ctx.__opts = opts || {};
  const env = vm.runInContext('createGasEnv(__opts)', ctx);
  codes.forEach(c => load(ctx, c));
  return { ctx, env };
}
function load(ctx, which) { vm.runInContext(SRC[which], ctx, { filename: which + '/Code.gs' }); }

// Server functions return JSON strings (like the real web app); parse them.
function call(ctx, fn, ...args) {
  const r = ctx[fn].apply(null, JSON.parse(JSON.stringify(args)));
  return typeof r === 'string' && /^[{[]/.test(r) ? JSON.parse(r) : r;
}

function makeMain(env, rows) {
  const sh = env.ss.insertSheet(MAIN, 200, LEGACY_HDR.length);
  sh.getRange(1, 1, 1, LEGACY_HDR.length).setValues([LEGACY_HDR]);
  if (rows.length) sh.getRange(2, 1, rows.length, LEGACY_HDR.length).setValues(rows);
  return sh;
}

// Mulberry32 — deterministic random data
function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: arr => arr[Math.floor(next() * arr.length)], chance: p => next() < p };
}

// today's serial day number in the spreadsheet time zone
const todaySerial = env => Math.floor(env.dateToSerial(new Date(env.clock.now)));

// ---------- tiny runner ----------
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
async function run(filter) {
  let pass = 0, fail = 0;
  for (const t of tests) {
    if (filter && !t.name.includes(filter)) continue;
    const t0 = Date.now();
    try { await t.fn(); pass++; console.log('  ✓ ' + t.name + ' (' + (Date.now() - t0) + 'ms)'); }
    catch (e) { fail++; console.log('  ✗ ' + t.name + '\n    ' + (e && e.stack || e).toString().split('\n').slice(0, 6).join('\n    ')); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  return fail;
}

module.exports = { boot, load, call, makeMain, rng, test, run, tests, SRC, ORDERS, SETTINGS, MAIN, LEGACY_HDR, CUSTOMERS, todaySerial };
