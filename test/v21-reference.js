/*
 * Independent re-implementation of what the v2.1 sheet formulas DISPLAY (Code 28092026.gs, ensureOrders_ and
 * writeMainFormulas_), written from the formula text with Google Sheets semantics — it shares no code with Code.gs:
 *  - criteria matching (SUMIFS/COUNTIFS/MAXIFS and "=" inside SUMPRODUCT) is case-insensitive and does not trim
 *  - SUMIFS only sums numeric cells; numeric criteria (">="&date) never match text cells
 *  - "BCD*" is a case-insensitive prefix wildcard
 *  - JALALI() uses the ICU Persian calendar here (Code.gs uses its own jalaali-js port)
 *
 * Input dates are raw serial numbers (what the cell holds), text, or ''.
 */
'use strict';

const persian = new Intl.DateTimeFormat('en-US-u-ca-persian', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
function jparts(serial) {
  const o = {};
  persian.formatToParts(new Date(Math.round((Math.floor(serial) - 25569) * 86400000))).forEach(p => { o[p.type] = p.value; });
  return { y: +o.year, m: +o.month, d: +o.day };
}
// JALALI(): '' for anything that is not a positive number
function JALALI(v) {
  if (typeof v !== 'number' || !(v > 0)) return '';
  const j = jparts(v);
  return j.y + '/' + String(j.m).padStart(2, '0') + '/' + String(j.d).padStart(2, '0');
}
// refreshPeriods_: current Jalali year/quarter bounds, found by walking the calendar day by day
function periods(today) {
  const j = jparts(today), q = Math.floor((j.m - 1) / 3);
  let yS = today, yE = today + 1, qS = today, qE = today + 1;
  while (!(jparts(yS).m === 1 && jparts(yS).d === 1)) yS--;
  while (!(jparts(yE).m === 1 && jparts(yE).d === 1)) yE++;
  while (!(jparts(qS).d === 1 && jparts(qS).m === q * 3 + 1)) qS--;
  while (!(jparts(qE).d === 1 && (jparts(qE).m - 1) % 3 === 0)) qE++;
  return { yS, yE, qS, qE };
}

const isNum = v => typeof v === 'number';
const eqCI = (cell, crit) => typeof cell === 'string' && typeof crit === 'string' && cell !== '' && cell.toLowerCase() === crit.toLowerCase();

/**
 * rows: [{A?, B, C, D, E, F, G, H, I, J}] — orders sheet rows 2.. (raw values)
 * names: main sheet names (raw, row order) | set: {threshold, minOrders} | today: serial
 * returns { orders: [{A, K, L, M, N, O, P, Q}], customers: [{annVol, annAmt, annCnt, qVol, volBCD, volBCW, volBCP, thr, coll}] }
 */
function v21(rows, names, set, today) {
  const P = periods(today);
  const N = rows.map(r => JALALI(r.C));
  const orders = rows.map((r, i) => {
    const n = r.B, d = r.C, o = {};
    // K: IF(OR(n="",t<>"خرید"),"",IF(paid<>"",2,IF(def=TRUE,4,IF(AND(due<>"",TODAY()>due),3,1))))
    // (TODAY()>text is FALSE in Sheets: numbers sort before text)
    o.K = (n === '' || r.D !== 'خرید') ? '' : r.I !== '' ? 2 : r.J === true ? 4 : (r.H !== '' && isNum(r.H) && today > r.H) ? 3 : 1;
    // A: "ZH-"&LEFT(N,4)&"-"&TEXT(count of rows 2..i with B<>"" and LEFT(N,4)=jy,"000")
    if (n === '' || d === '') o.A = '';
    else {
      const jy = N[i].slice(0, 4);
      let seq = 0;
      for (let k = 0; k <= i; k++) if (rows[k].B !== '' && N[k].slice(0, 4) === jy) seq++;
      o.A = 'ZH-' + jy + '-' + String(seq).padStart(3, '0');
    }
    // L: COUNTIFS(B,n,C,"<"&d)+SUMPRODUCT((B=n)*(C=d)*(SEQUENCE<=i)) ; M: MAXIFS(C,B,n,C,"<"&d), 0 → ""
    if (n === '' || d === '') { o.L = ''; o.M = ''; }
    else {
      let cnt = 0, mx = 0;
      rows.forEach((p, k) => {
        if (!eqCI(p.B, n)) return;
        if (isNum(p.C) && isNum(d) && p.C < d) { cnt++; if (p.C > mx) mx = p.C; }
        if (k <= i && p.C === d) cnt++;
      });
      o.L = cnt; o.M = mx === 0 ? '' : mx;
    }
    o.N = N[i]; o.O = JALALI(r.H); o.P = JALALI(r.I); o.Q = JALALI(o.M);
    return o;
  });

  const inP = (c, from, to) => isNum(c) && c >= from && c < to;
  const sumifs = (col, n, type, from, to, skuPrefix) => rows.reduce((s, r) => {
    if (!eqCI(r.B, n) || r.D !== type || !inP(r.C, from, to)) return s;
    if (skuPrefix && !(typeof r.E === 'string' && r.E.toLowerCase().startsWith(skuPrefix.toLowerCase()))) return s;
    return isNum(r[col]) ? s + r[col] : s;
  }, 0);
  const net = (col, from, to, sku) => sumifs(col, n0, 'خرید', from, to, sku) - sumifs(col, n0, 'مرجوعی', from, to, sku);
  let n0;
  const customers = names.map(n => {
    if (n === '') return null;
    n0 = n;
    const c = {
      annVol: net('F', P.yS, P.yE), annAmt: net('G', P.yS, P.yE),
      annCnt: rows.filter(r => eqCI(r.B, n) && r.D === 'خرید' && inP(r.C, P.yS, P.yE)).length,
      qVol: net('F', P.qS, P.qE),
      volBCD: net('F', P.yS, P.yE, 'BCD'), volBCW: net('F', P.yS, P.yE, 'BCW'), volBCP: net('F', P.yS, P.yE, 'BCP')
    };
    c.thr = c.annVol >= (Number(set.threshold) || 0) ? (c.annCnt > (Number(set.minOrders) || 0) ? '✅ تعهد حجمی واقعی' : '⚠️ خرید یک‌باره حجیم — نیازمند پیگیری تکرار') : 'زیر آستانه';
    const has = k => orders.some((o, i) => eqCI(rows[i].B, n) && o.K === k);
    c.coll = has(4) ? 'نکول' : has(3) ? 'معوق' : has(1) ? 'در جریان' : 'بدون مطالبه باز';
    return c;
  });
  return { orders, customers, periods: P };
}

module.exports = { v21, JALALI, periods, jparts };
