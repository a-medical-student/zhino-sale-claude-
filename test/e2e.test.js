'use strict';
// Browser tests: the real src/Index.html in Chromium, google.script.run backed by src/Code.gs on the emulator.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test } = require('./lib');

const ROOT = path.join(__dirname, '..');
function playwright() {
  try { return require('playwright'); } catch (e) {}
  try { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e) { return null; }
}
const pw = playwright();

const FILES = {
  '/': () => fs.readFileSync(path.resolve(ROOT, process.env.FH_INDEX || 'src/Index.html'), 'utf8').replace('<head>', '<head>\n<script src="/shim.js"></script>'),
  '/shim.js': () => fs.readFileSync(path.join(__dirname, 'e2e/shim.js'), 'utf8'),
  '/seed.js': () => fs.readFileSync(path.join(__dirname, 'e2e/seed.js'), 'utf8'),
  '/gas-mock.js': () => fs.readFileSync(path.join(__dirname, 'gas-mock.js'), 'utf8'),
  '/Code.gs.js': () => fs.readFileSync(path.resolve(ROOT, process.env.FH_CODE || 'src/Code.gs'), 'utf8'),
  '/server.html': () => '<!doctype html><meta charset="utf-8"><script src="/gas-mock.js"></script>' +
    '<script>var __env = createGasEnv({ now: Date.UTC(2026, 9, 2, 8) });</script>' +
    '<script src="/Code.gs.js"></script><script src="/seed.js"></script>'
};

let browser;
async function open() {
  browser = browser || await pw.chromium.launch();
  const ctx = await browser.newContext({ locale: 'fa-IR' });
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    const f = u.host === 'fh.test' && FILES[u.pathname];
    if (!f) return route.abort();   // e.g. the web font CDN
    return route.fulfill({ status: 200, contentType: /\.js$/.test(u.pathname) ? 'application/javascript' : 'text/html; charset=utf-8', body: f() });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://fh.test/');
  await page.waitForSelector('.card');
  await settled(page);
  return { page, errors, close: () => ctx.close() };
}
const settled = page => page.waitForFunction(() => window.S && S.inflight === 0 && __srv.pending === 0 && !S.loading);
const card = (page, name) => page.locator('.card', { has: page.locator('h3', { hasText: new RegExp('^' + name + '$') }) });
const toast = page => page.locator('#toast').textContent();
const isOpen = (page, id) => page.evaluate(i => document.getElementById(i).classList.contains('on'), id);
const server = (page, expr) => page.evaluate(e => { const d = JSON.parse(__srv.win.getData()); return Function('d', 'return ' + e)(d); }, expr);

function e2e(name, fn) {
  test('browser: ' + name, async () => {
    if (!pw) { console.log('    (skipped — playwright not installed)'); return; }
    const t = await open();
    try { await fn(t.page); assert.deepStrictEqual(t.errors, [], 'page errors'); }
    finally { await t.close(); }
  });
}

e2e('initial load renders the cards and KPIs from the server', async page => {
  assert.strictEqual(await page.locator('.card').count(), 6);
  assert.ok((await page.locator('#kpis').textContent()).includes('کل مشتریان'));
  assert.ok(await page.locator('#banner').isVisible(), 'customer without channel → banner');   // «سایر» needs manual review
});

e2e('follow-up: modal closes at once, card shows ⏳ until the sheet confirms, note is saved', async page => {
  await page.evaluate(() => { __srv.latency = 1500; });
  const c = card(page, 'کلینیک آرامش');
  await c.locator('button', { hasText: 'ثبت فالوآپ' }).click();
  await page.fill('#fuNote', 'تماس گرفتم؛ سفارش بعدی هفته‌ی آینده');
  const t0 = Date.now();
  await page.click('#fuSave');
  assert.strictEqual(await isOpen(page, 'mFu'), false);
  assert.ok(await c.evaluate(el => el.classList.contains('pend')), 'card not marked pending');
  assert.ok((await c.textContent()).includes('در حال ذخیره'));
  assert.ok((await page.locator('#sync').textContent()).includes('در حال ذخیره در شیت'));
  assert.ok(Date.now() - t0 < 1000, 'UI waited for the server');
  await c.locator('h3').click();                                       // same customer while pending → blocked
  assert.ok((await toast(page)).includes('هنوز در جریان'));
  assert.strictEqual(await isOpen(page, 'mEdit'), false);
  await settled(page);
  assert.ok(!(await c.evaluate(el => el.classList.contains('pend'))));
  assert.strictEqual(await page.locator('#sync').isVisible(), false);
  await c.locator('h3').click();
  assert.ok((await page.locator('#eExtra .notes').textContent()).includes('سفارش بعدی هفته‌ی آینده'));
  assert.ok(await server(page, "d.customers[0].notes.some(n => n.text.includes('هفته‌ی آینده'))"));
});

e2e('order from the details panel: ⏳ row at once, real invoice code after confirmation', async page => {
  await page.evaluate(() => { __srv.latency = 1200; });
  await card(page, 'پخش البرز').locator('h3').click();
  await page.locator('#eExtra button', { hasText: 'سفارش جدید' }).click();
  await page.fill('#oUnits', '12');
  await page.fill('#oAmount', '3000000');
  await page.click('#oSave');
  assert.strictEqual(await isOpen(page, 'mOrder'), false);
  assert.ok((await toast(page)).includes('در انتظار کد فاکتور'));
  const rows = page.locator('#eExtra table tr');
  assert.strictEqual(await rows.count(), 3);                          // header + seeded order + pending one
  assert.ok((await page.locator('#eExtra table').textContent()).includes('⏳'));
  await settled(page);
  assert.ok((await page.locator('#eExtra table').textContent()).includes('ZH-1405-003'));
  assert.ok((await toast(page)).includes('ZH-1405-003'));
  assert.strictEqual(await server(page, "d.orders.length"), 3);
});

e2e('failed save: change disappears, error shown, form reopens with what the user typed', async page => {
  await page.evaluate(() => { __srv.latency = 900; __srv.fail.saveRecord = 'Lock timeout: another process was holding the lock for too long.'; });
  const c = card(page, 'Clinic Nova');
  await c.locator('h3').click();
  await page.fill('#eCity', 'یزد');
  await page.click('#eSave');
  assert.ok((await c.locator('.sub').first().textContent()).includes('یزد'), 'no optimistic update');
  await settled(page);
  assert.ok((await c.locator('.sub').first().textContent()).includes('شیراز'), 'not rolled back');
  assert.ok((await page.locator('#toast').getAttribute('class')).includes('err'));
  assert.ok((await toast(page)).includes('Lock timeout'));
  assert.strictEqual(await isOpen(page, 'mEdit'), true);
  assert.strictEqual(await page.inputValue('#eCity'), 'یزد');
  assert.strictEqual(await server(page, "d.customers.find(x => x.name === 'Clinic Nova').city"), 'شیراز');
});

e2e('two saves in flight, one fails: only the successful one remains', async page => {
  await page.evaluate(() => { __srv.latency = 1000; __srv.fail.saveOrder = 'خطای آزمایشی'; });
  const a = card(page, 'بیمارستان مدنی کرج'), b = card(page, 'داروخانه سینا');
  await a.locator('button', { hasText: 'ثبت فالوآپ' }).click();
  await page.fill('#fuNote', 'جلسه با مدیر خرید');
  await page.click('#fuSave');
  await b.locator('button', { hasText: 'ثبت سفارش' }).click();
  await page.fill('#oUnits', '5');
  await page.click('#oSave');
  assert.strictEqual(await page.evaluate(() => S.inflight), 2);
  await settled(page);
  assert.strictEqual(await server(page, "d.orders.filter(o => o.name === 'داروخانه سینا').length"), 0);
  assert.strictEqual(await page.evaluate(() => S.data.orders.filter(o => o.name === 'داروخانه سینا').length), 0);
  assert.ok(await page.evaluate(() => S.data.customers.find(c => c.name === 'بیمارستان مدنی کرج').notes.some(n => n.text === 'جلسه با مدیر خرید')));
  assert.strictEqual(await isOpen(page, 'mOrder'), true, 'failed order form not reopened');
  assert.strictEqual(await page.inputValue('#oUnits'), '5');
});

e2e('new customer: listed for orders right away, ordering waits for confirmation', async page => {
  await page.evaluate(() => { __srv.latency = 1500; });
  await page.locator('header button', { hasText: 'مشتری جدید' }).click();
  await page.fill('#eName', 'کلینیک تازه');
  await page.selectOption('#eChannel', 'عمده‌فروش');
  await page.click('#eSave');
  assert.ok(await card(page, 'کلینیک تازه').evaluate(el => el.classList.contains('pend')));
  await page.locator('header button', { hasText: 'ثبت سفارش جدید' }).click();
  await page.selectOption('#oName', 'کلینیک تازه');
  await page.fill('#oUnits', '1');
  await page.click('#oSave');
  assert.ok((await toast(page)).includes('هنوز در جریان'));
  await settled(page);
  assert.ok(!(await card(page, 'کلینیک تازه').evaluate(el => el.classList.contains('pend'))));
  assert.ok(await server(page, "d.customers.some(c => c.name === 'کلینیک تازه')"));
});

test('browser: (close)', async () => { if (browser) await browser.close(); });
