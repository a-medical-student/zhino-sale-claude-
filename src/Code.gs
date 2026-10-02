/**
 * FeelHeal Sales Tracker — v2.2 (02-10-2026)
 * تراکر مشتریان + لاگ سفارش‌ها + وضعیت وصول + نوع کانال خریدار
 *
 * تغییرات این نسخه (طرح بهینه‌سازی — نسخه بازبینی‌شده):
 *  - کد فاکتور ثابت: ستون A تب سفارش‌ها دیگر فرمول نیست. کد یک‌بار هنگام ثبت ساخته می‌شود و با مرتب‌سازی،
 *    حذف ردیف یا تغییر تاریخ عوض نمی‌شود. setup کدهای فعلی را دقیقاً همان‌طور که الان نمایش داده می‌شوند ثابت می‌کند.
 *  - محاسبات سنگین (حجم/مبلغ سالانه و فصل، BCD/BCW/BCP، آستانه، وصول، چندمین سفارش، سفارش قبلی، تاریخ‌های شمسی)
 *    از فرمول شیت به اسکریپت منتقل شد: یک گذر روی سفارش‌ها و نوشتن نتیجه به‌صورت مقدار ثابت در همان ستون‌ها.
 *    فقط فرمول‌های سبک می‌مانند: «وضعیت پیگیری» و «توصیه اقدام» (تب اصلی) و «وضعیت پرداخت» (ستون K سفارش‌ها).
 *  - هر ذخیره: یک‌بار خواندن، یک‌بار نوشتن، بدون خواندن دوباره پس از نوشتن؛ فقط سلول‌هایی که واقعاً عوض شده‌اند نوشته می‌شوند.
 *  - کش سرور با شماره نسخه: هر ذخیره، هر ویرایش مستقیم شیت (onEdit) و هر تغییر ساختاری (onChange) کش را باطل می‌کند.
 *  - زمان‌سنجی: هر فراخوانی زمان مراحلش را در Executions ثبت می‌کند؛ تابع benchmark برای اندازه‌گیری.
 *
 * اصلاحات نسخه‌ی نهایی نسبت به پیش‌نویس v2.2 (بازبینی و آزمون: docs/PLAN_REVIEW.md و پوشه‌ی test):
 *  - setup پیش از هر تغییری بررسی می‌کند ستون A (کد فرمولی v2.1) کامل محاسبه شده باشد؛ اگر جایی «Loading…» یا خطا
 *    نشان دهد، متوقف می‌شود — وگرنه آن متن به‌جای شماره‌ی فاکتور ثابت می‌شد (checkSchema هم همین را گزارش می‌کند).
 *  - مرتب‌سازی شیت (که onEdit را صدا نمی‌زند) هم کش را باطل می‌کند.
 *  - تریگر روزانه دقیقاً ساعت ۰ به وقت منطقه زمانی شیت اجرا می‌شود.
 *  - پاسخ‌های کش‌شده دیگر زمان‌سنجی و نتیجه‌ی یک درخواست قدیمی را با خود نمی‌آورند.
 *  - خطای ممیز شناور در مبالغ اعشاری باعث بازنویسی بی‌پایان ستون‌های محاسبه‌ای نمی‌شود.
 *
 * ارتقا از v2.1: کد را جایگزین کنید و setup را یک‌بار اجرا کنید (README.md).
 * پیش از آن می‌توانید checkSchema را اجرا کنید تا بدون هیچ تغییری گزارش بگیرید.
 */

// ============================================================
// 1) تنظیمات ثابت
// ============================================================
var CFG = {
  ORDERS_SHEET: 'سفارش‌ها',
  SETTINGS_SHEET: 'تنظیمات',
  REF_SHEET: 'REF',
  CHANNELS: ['کلینیک/پزشک مستقیم', 'عمده‌فروش', 'بیمارستان'],
  SOURCES: ['معرفی/رفرال', 'شبکه شخصی/حضوری', 'کنگره یا نمایشگاه', 'آنلاین', 'تماس سرد', 'سایر'],
  ORDER_TYPES: ['خرید', 'نمونه', 'مرجوعی'],
  SKUS: ['BCD 1010', 'BCD 1015', 'BCW 1010', 'BCW 0505', 'BCP 0505'],
  REPEAT_STAGE: 'خرید مجدد/فعال',
  ORDER_ID_PREFIX: 'ZH',
  SCHEMA: '2.2',        // نسخه ساختار شیت؛ setup آن را ثبت می‌کند
  CACHE_TTL: 1800,      // ثانیه — سقف عمر کش؛ ابطال اصلی با شماره نسخه است
  LOCK_MS: 20000,
  // مقادیر پیش‌فرض REF فقط وقتی استفاده می‌شوند که تب REF وجود نداشته باشد — بازبینی کنید.
  DEFAULT_REF: [
    ['مخاطب جدید', 2, 'تماس اول و معرفی کوتاه'],
    ['معرفی اولیه شد', 3, 'ارسال کاتالوگ/اطلاعات محصول'],
    ['اطلاعات ارسال شد', 5, 'پیگیری دریافت اطلاعات و پیشنهاد نمونه'],
    ['نمونه ارسال شد', 7, 'دریافت بازخورد نمونه'],
    ['خرید اول', 14, 'پیگیری رضایت و مصرف'],
    ['در حال فالوآپ', 14, 'پیگیری سفارش بعدی'],
    ['خرید مجدد/فعال', 30, 'پیگیری دوره‌ای و پیشنهاد سفارش بعدی'],
    ['غیرفعال/از دست رفته', 90, 'تماس بازفعال‌سازی']
  ]
};

// نگاشت خودکار «نوع» قدیم به «نوع کانال خریدار» (طبق تأیید مریم)
// «سایر» و «داروخانه/فروشگاه» عمداً نگاشت نمی‌شوند → بازبینی دستی
var TYPE_MAP = {
  'کلینیک': 'کلینیک/پزشک مستقیم',
  'پزشک/فرد': 'کلینیک/پزشک مستقیم',
  'پزشک': 'کلینیک/پزشک مستقیم',
  'فرد': 'کلینیک/پزشک مستقیم',
  'بیمارستان': 'بیمارستان',
  'داروخانه': 'بیمارستان',
  'فروشگاه': 'عمده‌فروش',
  'واسطه': 'عمده‌فروش',
  'عمده‌فروش': 'عمده‌فروش'
};

// ستون‌های تب اصلی (تطبیق بر اساس عنوان، نه جایگاه)
// نوع: input = ورودی | formula = فرمول سبک در ردیف عنوان | calc = مقدار ثابت که اسکریپت محاسبه و می‌نویسد
var MAIN_FIELDS = [
  ['name', 'نام مرکز/پزشک', 'input'],
  ['typeOld', 'نوع', 'input'],
  ['city', 'شهر', 'input'],
  ['contact', 'فرد رابط', 'input'],
  ['phone', 'تلفن', 'input'],
  ['source', 'مسیر جذب', 'input'],
  ['stage', 'مرحله', 'input'],
  ['stageDate', 'تاریخ ورود به مرحله', 'input'],
  ['nextDate', 'تاریخ پیگیری بعدی', 'input'],
  ['fuStatus', 'وضعیت پیگیری', 'formula'],
  ['action', 'توصیه اقدام', 'formula'],
  ['purchases', 'تعداد خرید', 'input'],
  ['notes', 'یادداشت‌ها', 'input'],
  ['channel', 'نوع کانال خریدار', 'input'],
  ['annVol', 'حجم خالص سالانه (واحد)', 'calc'],
  ['annAmt', 'مبلغ خالص سالانه (تومان)', 'calc'],
  ['annCnt', 'تعداد سفارش خرید سال جاری', 'calc'],
  ['qVol', 'حجم خالص فصل جاری (واحد)', 'calc'],
  ['volBCD', 'حجم سالانه BCD', 'calc'],
  ['volBCW', 'حجم سالانه BCW', 'calc'],
  ['volBCP', 'حجم سالانه BCP', 'calc'],
  ['thr', 'وضعیت آستانه حجمی', 'calc'],
  ['coll', 'وضعیت وصول مطالبات', 'calc']
];
var CALC_KEYS = MAIN_FIELDS.filter(function (f) { return f[2] === 'calc'; }).map(function (f) { return f[0]; });
var INPUT_KEYS = MAIN_FIELDS.filter(function (f) { return f[2] === 'input'; }).map(function (f) { return f[0]; });

// ستون‌های تب سفارش‌ها (جایگاه ثابت A..Q)
// A = کد فاکتور (ثابت، یک‌بار ساخته می‌شود) | B..J = ورودی | K = فرمول سبک | L..Q = مقدار ثابت محاسبه‌شده توسط اسکریپت
var ORDER_HEADERS = [
  'کد سفارش/فاکتور',
  'نام مشتری', 'تاریخ سفارش', 'نوع خرید', 'SKU/محصول', 'تعداد واحد', 'ارزش سفارش (تومان)',
  'تاریخ سررسید پرداخت', 'تاریخ پرداخت واقعی', 'نکول (علامت دستی)',
  'وضعیت پرداخت (کد)', 'چندمین سفارش این مشتری', 'تاریخ سفارش قبلی این مشتری',
  'تاریخ سفارش (شمسی)', 'سررسید (شمسی)', 'پرداخت (شمسی)', 'سفارش قبلی (شمسی)'
];
var OC = { id: 1, name: 2, date: 3, type: 4, sku: 5, units: 6, amount: 7, due: 8, paid: 9, def: 10,
           status: 11, nth: 12, prev: 13, jDate: 14, jDue: 15, jPaid: 16, jPrev: 17 };
var ORDER_NCOLS = ORDER_HEADERS.length;                     // 17
var ORDER_FORMULA_COLS_1IDX = [OC.status];                  // K
var ORDER_AUTO_COLS_1IDX = [1, 11, 12, 13, 14, 15, 16, 17]; // A + K..Q — محافظت هشداری
var ORDER_DATE_COLS = [OC.date, OC.due, OC.paid];           // تبدیل خودکار شمسی→میلادی در onEdit
// وضعیت پرداخت (K): ۱=در جریان، ۲=پرداخت‌شده، ۳=معوق، ۴=نکول — همان منطقی که compute_ در اسکریپت دارد
var ORDER_STATUS_FORMULA = 'MAP(B2:B,D2:D,H2:H,I2:I,J2:J,LAMBDA(n,t,due,paid,def,' +
  'IF(OR(n="",t<>"خرید"),"",IF(paid<>"",2,IF(def=TRUE,4,IF(AND(due<>"",TODAY()>due),3,1))))))';

// ============================================================
// 2) تقویم جلالی (پورت jalaali-js؛ تقسیم با برش به سمت صفر = Math.trunc)
// ============================================================
var JBREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
function jdiv_(a, b) { return Math.trunc(a / b); }
function jmod_(a, b) { return a - Math.trunc(a / b) * b; }
function jalCal_(jy) {
  var bl = JBREAKS.length, gy = jy + 621, leapJ = -14, jp = JBREAKS[0], jm, jump = 0, leap, leapG, march, n, i;
  for (i = 1; i < bl; i++) {
    jm = JBREAKS[i]; jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + jdiv_(jump, 33) * 8 + jdiv_(jmod_(jump, 33), 4);
    jp = jm;
  }
  n = jy - jp;
  leapJ = leapJ + jdiv_(n, 33) * 8 + jdiv_(jmod_(n, 33) + 3, 4);
  if (jmod_(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  leapG = jdiv_(gy, 4) - jdiv_((jdiv_(gy, 100) + 1) * 3, 4) - 150;
  march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + jdiv_(jump + 4, 33) * 33;
  leap = jmod_(jmod_(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap: leap, gy: gy, march: march };
}
function g2d_(gy, gm, gd) {
  var d = jdiv_((gy + jdiv_(gm - 8, 6) + 100100) * 1461, 4) + jdiv_(153 * jmod_(gm + 9, 12) + 2, 5) + gd - 34840408;
  return d - jdiv_(jdiv_(gy + 100100 + jdiv_(gm - 8, 6), 100) * 3, 4) + 752;
}
function d2g_(jdn) {
  var j = 4 * jdn + 139361631;
  j = j + jdiv_(jdiv_(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  var i = jdiv_(jmod_(j, 1461), 4) * 5 + 308;
  var gd = jdiv_(jmod_(i, 153), 5) + 1;
  var gm = jmod_(jdiv_(i, 153), 12) + 1;
  var gy = jdiv_(j, 1461) - 100100 + jdiv_(8 - gm, 6);
  return { gy: gy, gm: gm, gd: gd };
}
function j2d_(jy, jm, jd) {
  var r = jalCal_(jy);
  return g2d_(r.gy, 3, r.march) + (jm - 1) * 31 - jdiv_(jm, 7) * (jm - 7) + jd - 1;
}
function d2j_(jdn) {
  var gy = d2g_(jdn).gy, jy = gy - 621, r = jalCal_(jy), jdn1f = g2d_(gy, 3, r.march), jd, jm, k;
  k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) { jm = 1 + jdiv_(k, 31); jd = jmod_(k, 31) + 1; return { jy: jy, jm: jm, jd: jd }; }
    k -= 186;
  } else {
    jy -= 1; k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + jdiv_(k, 30); jd = jmod_(k, 30) + 1;
  return { jy: jy, jm: jm, jd: jd };
}
function toJalaali_(gy, gm, gd) { return d2j_(g2d_(gy, gm, gd)); }
function toGregorian_(jy, jm, jd) { return d2g_(j2d_(jy, jm, jd)); }
function isValidJalaali_(jy, jm, jd) {
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1) return false;
  var len = jm <= 6 ? 31 : jm <= 11 ? 30 : (jalCal_(jy).leap === 0 ? 30 : 29);
  return jd <= len;
}

// ============================================================
// 3) ابزارهای عمومی
// ============================================================
function norm_(s) {
  return String(s == null ? '' : s)
    .replace(/[‌‎‏\s]/g, '')
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[\/\\\-_.()]/g, '');
}
// کلید تطبیق نام مشتری بین تب اصلی و سفارش‌ها (مثل SUMIFS: حساس به حروف بزرگ/کوچک نیست)
function nk_(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function faDigitsToEn_(s) {
  return String(s).replace(/[۰-۹]/g, function (c) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(c); })
    .replace(/[٠-٩]/g, function (c) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(c); });
}
function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function pad2_(n) { return ('0' + n).slice(-2); }
// تاریخ‌ها به‌صورت «شماره سریال روز» نوشته می‌شوند (مستقل از منطقه زمانی اسکریپت و Locale شیت)
var DATE_FMT = 'yyyy-mm-dd';
function serialFromYMD_(y, m, d) { return Date.UTC(y, m - 1, d) / 86400000 + 25569; }
function serialFromIso_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  var y = +m[1], mo = +m[2], d = +m[3], t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return serialFromYMD_(y, mo, d);
}
function ymdFromSerial_(s) {
  var t = new Date(Math.round((s - 25569) * 86400000));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function isoFromSerial_(s) { var x = ymdFromSerial_(s); return x.y + '-' + pad2_(x.m) + '-' + pad2_(x.d); }
// متن شمسی yyyy/mm/dd از شماره سریال (همان خروجی تابع سفارشی JALALI)
function jalStr_(s) {
  if (typeof s !== 'number' || !(s > 0)) return '';
  var x = ymdFromSerial_(s), j = toJalaali_(x.y, x.m, x.d);
  return j.jy + '/' + pad2_(j.jm) + '/' + pad2_(j.jd);
}
function isoOf_(v, tz) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return '';
}
// مقدار خام سلول تاریخ → '' (خالی) | شماره سریال روز (تاریخ یا عدد) | null (متن/نامعتبر)
function serialOf_(v, tz) {
  if (v === '' || v == null) return '';
  if (v instanceof Date) return isNaN(v) ? null : serialFromIso_(isoOf_(v, tz));
  if (typeof v === 'number') return Math.floor(v);
  return null;
}
// خروجی تاریخ برای برنامه وب: ISO یا ''
function isoOut_(v, tz) {
  if (v instanceof Date) return isoOf_(v, tz);
  if (typeof v === 'number' && v > 0) return isoFromSerial_(v);
  return '';
}
function todayYMD_(tz) {
  var s = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd').split('-');
  return { y: +s[0], m: +s[1], d: +s[2] };
}
function addDaysIso_(iso, n) {
  var p = String(iso).split('-'), t = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return t.getUTCFullYear() + '-' + ('0' + (t.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + t.getUTCDate()).slice(-2);
}
// بازه‌های سال/فصل شمسی جاری (شماره سریال) — همان مقادیری که در تنظیمات B3:B7 نمایش داده می‌شود
function periods_(t) {
  var j = toJalaali_(t.y, t.m, t.d), q = Math.floor((j.jm - 1) / 3);
  var g = function (y, m, d) { var x = toGregorian_(y, m, d); return serialFromYMD_(x.gy, x.gm, x.gd); };
  return {
    yS: g(j.jy, 1, 1), yE: g(j.jy + 1, 1, 1),
    qS: g(j.jy, q * 3 + 1, 1), qE: q === 3 ? g(j.jy + 1, 1, 1) : g(j.jy, q * 3 + 4, 1),
    label: j.jy + ' — فصل ' + (q + 1)
  };
}
// گروه‌بندی ستون‌های مجاور: [{col,...}] مرتب‌شده → [[...], [...]]
function runs_(items) {
  var out = [];
  items.slice().sort(function (a, b) { return a.col - b.col; }).forEach(function (x) {
    var last = out[out.length - 1];
    if (last && last[last.length - 1].col === x.col - 1) last.push(x); else out.push([x]);
  });
  return out;
}
// مقایسه مقدار خام شیت با مقدار محاسبه‌شده (تاریخ → شماره سریال؛ عدد → ۱۵ رقم معنادار، تا خطای ممیز شناور
// مثل 0.1+0.2 باعث بازنویسی بی‌پایان نشود)
function cmp_(v, tz) {
  if (v instanceof Date) { var s = serialOf_(v, tz); return s === null ? '?' : String(s); }
  if (typeof v === 'number') return String(Number(v.toPrecision(15)));
  return v == null ? '' : String(v);
}

/**
 * متن نمایشی یک سلول تاریخ (مثل «1405-07-02»، «1405/7/2»، «2026-09-24»، ارقام فارسی مجاز) را تفسیر می‌کند.
 * سال < ۱۷۰۰ → شمسی (شیت «1405/07/02» را سال ۱۴۰۵ میلادی ذخیره می‌کند)، وگرنه میلادی.
 * چون از متن نمایشی خوانده می‌شود، به منطقه زمانی اسکریپت وابسته نیست.
 * خروجی: {serial, jalali} یا null اگر نامعتبر
 */
function parseDateText_(s) {
  var mt = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(faDigitsToEn_(s).trim());
  if (!mt) return null;
  var y = +mt[1], m = +mt[2], d = +mt[3];
  if (y >= 1700) {
    var iso = y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
    var sr = serialFromIso_(iso);
    return sr === null ? null : { serial: sr, jalali: false };
  }
  if (!isValidJalaali_(y, m, d)) return null;
  var g = toGregorian_(y, m, d);
  return { serial: serialFromYMD_(g.gy, g.gm, g.gd), jalali: true };
}

// کد فاکتور: ZH-[سال شمسی تاریخ سفارش]-[شماره ترتیبی همان سال، حداقل ۳ رقم]
function idRe_() {
  return new RegExp('^' + CFG.ORDER_ID_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d{4})-(\\d{3,})$');
}
function fmtId_(jy, seq) { return CFG.ORDER_ID_PREFIX + '-' + jy + '-' + (seq < 1000 ? ('00' + seq).slice(-3) : String(seq)); }

// زمان‌سنج مراحل هر فراخوانی — نتیجه در Executions (console) و در پاسخ (_ms)
function timer_(name) {
  var t0 = Date.now(), last = t0, laps = {};
  return {
    lap: function (k) { var n = Date.now(); laps[k] = (laps[k] || 0) + (n - last); last = n; },
    done: function () { laps.total = Date.now() - t0; console.log('[FH] ' + name + ' ' + JSON.stringify(laps)); return laps; }
  };
}

// ============================================================
// 4) پیدا کردن تب‌ها و ستون‌ها
// ============================================================
function findMainSheet_(ss) {
  var target = norm_('نام مرکز/پزشک');
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    if (sh.getLastColumn() < 1) continue;
    var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    for (var c = 0; c < hdr.length; c++) if (norm_(hdr[c]) === target) return sh;
  }
  return null;
}
// عنوان ستون‌ها؛ برای ستون‌های فرمولی ={"عنوان";...} خود متن داخل فرمول خوانده می‌شود
// تا اگر فرمول خطا بدهد (#REF! و…) ستون گم نشود و setup ستون تکراری نسازد.
function headerTexts_(sh, n) {
  var rng = sh.getRange(1, 1, 1, n), v = rng.getValues()[0], f = rng.getFormulas()[0];
  return v.map(function (x, i) { var m = /^=\{"([^"]+)";/.exec(f[i] || ''); return m ? m[1] : x; });
}
function mapHeaders_(hdr) {
  var byNorm = {}, map = {};
  hdr.forEach(function (h, i) { var k = norm_(h); if (k && !(k in byNorm)) byNorm[k] = i + 1; });
  MAIN_FIELDS.forEach(function (f) { var c = byNorm[norm_(f[1])]; if (c) map[f[0]] = c; });
  return map;
}
// سرعت: اول فقط مقادیر عنوان خوانده می‌شود؛ متن فرمول‌ها فقط اگر ستونی پیدا نشد (مثلاً فرمول عنوان خطا داده)
function headerMap_(sh) {
  var lc = sh.getLastColumn();
  if (lc < 1) return {};
  var map = mapHeaders_(sh.getRange(1, 1, 1, lc).getValues()[0]);
  if (map.name && Object.keys(map).length < MAIN_FIELDS.length) map = mapHeaders_(headerTexts_(sh, lc));
  return map;
}
function refTable_(ss) {
  var sh = ss.getSheetByName(CFG.REF_SHEET);
  var rows = sh ? sh.getDataRange().getValues().slice(1) : CFG.DEFAULT_REF;
  return rows.filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) { return { stage: String(r[0]).trim(), days: Number(r[1]) || 7, action: String(r[2] || '') }; });
}
function lastDataRow_(sh, col) {
  var lr = sh.getLastRow();
  if (lr < 2) return 1;
  var vals = sh.getRange(2, col, lr - 1, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]).trim() !== '') return i + 2;
  return 1;
}

// ============================================================
// 5) فاز ۰: پشتیبان + بررسی ساختار بدون تغییر
// ============================================================
function checkSchema() {
  var ss = SpreadsheetApp.getActive();
  var out = [];
  var main = findMainSheet_(ss);
  if (!main) { out.push('❌ تب اصلی پیدا نشد (ستونی با عنوان «نام مرکز/پزشک» در هیچ تبی نیست).'); return report_(out); }
  out.push('✅ تب اصلی: «' + main.getName() + '»');
  var map = headerMap_(main);
  var missing = MAIN_FIELDS.filter(function (f) { return !map[f[0]]; }).map(function (f) { return f[1]; });
  out.push('ستون‌های پیدا‌شده: ' + Object.keys(map).length + ' از ' + MAIN_FIELDS.length);
  if (missing.length) out.push('ستون‌هایی که setup اضافه می‌کند: ' + missing.join('، '));
  if (map.typeOld) {
    var last = lastDataRow_(main, map.name);
    if (last >= 2) {
      var types = main.getRange(2, map.typeOld, last - 1, 1).getValues();
      var counts = {};
      types.forEach(function (r) { var t = String(r[0]).trim() || '(خالی)'; counts[t] = (counts[t] || 0) + 1; });
      out.push('مقادیر فعلی «نوع»: ' + Object.keys(counts).map(function (k) {
        return k + '=' + counts[k] + (TYPE_MAP[k] ? ' → ' + TYPE_MAP[k] : ' → بازبینی دستی');
      }).join(' | '));
    }
  }
  [CFG.ORDERS_SHEET, CFG.SETTINGS_SHEET, CFG.REF_SHEET].forEach(function (n) {
    out.push((ss.getSheetByName(n) ? 'موجود: ' : 'ساخته می‌شود: ') + n);
  });
  var refSh = ss.getSheetByName(CFG.REF_SHEET);
  if (refSh) {
    var rv = refSh.getRange(1, 1, Math.min(3, refSh.getLastRow() || 1), 3).getDisplayValues();
    out.push('نمونه تب REF (باید A=مرحله، B=روز، C=توصیه باشد): ' + rv.map(function (r) { return r.join(' | '); }).join(' ⏎ '));
  }
  var stages = refTable_(ss).map(function (r) { return r.stage; });
  if (stages.indexOf(CFG.REPEAT_STAGE) < 0) out.push('⚠️ مرحله «' + CFG.REPEAT_STAGE + '» در REF نیست — شمارنده «تعداد خرید» کار نمی‌کند (README گام ۱-ب).');
  if (map.stage) {
    var lastS = lastDataRow_(main, map.name);
    if (lastS >= 2) {
      var unknown = {};
      main.getRange(2, map.stage, lastS - 1, 1).getValues().forEach(function (r) {
        var s = String(r[0]).trim(); if (s && stages.indexOf(s) < 0) unknown[s] = (unknown[s] || 0) + 1;
      });
      if (Object.keys(unknown).length) out.push('⚠️ مراحلی در داده که در REF نیستند: ' + Object.keys(unknown).map(function (k) { return k + '=' + unknown[k]; }).join(' | '));
    }
  }
  var bn = badNameRows_(main, map);
  if (bn.length) out.push('⚠️ نام‌های دارای * ? ~ یا شروع با = < > — ردیف‌های: ' + bn.join('، ') + ' (پیش از setup اصلاح کنید)');

  // v2.2: وضعیت ارتقا
  var schema = PropertiesService.getDocumentProperties().getProperty('fh_schema');
  out.push(schema === CFG.SCHEMA ? '✅ ساختار شیت: نسخه ' + CFG.SCHEMA
                                 : '⚠️ ساختار شیت هنوز نسخه ' + CFG.SCHEMA + ' نیست — setup را اجرا کنید.');
  var lg = legacyIds_(ss.getSheetByName(CFG.ORDERS_SHEET));
  if (lg) {
    out.push('🔒 کد فاکتور هنوز فرمولی است؛ setup کد ' + lg.valid + ' سفارش را دقیقاً همان‌طور که الان نمایش داده می‌شود ثابت می‌کند' +
             (lg.renew ? ' (' + lg.renew + ' سفارش بدون کد معتبر — تاریخ خالی یا متنی — پس از اصلاح تاریخ کد تازه می‌گیرد)' : '') + '.');
    if (lg.bad.length) out.push('⛔ ستون A این ردیف‌ها به‌جای کد، خطا یا «در حال محاسبه» نشان می‌دهد: ' + lg.bad.slice(0, 10).join('، ') +
             (lg.bad.length > 10 ? ' …' : '') + ' — تا وقتی همه‌ی کدها درست نمایش داده نشوند، setup اجرا نمی‌شود (README گام ۲).');
  }

  var sTz = ss.getSpreadsheetTimeZone();
  out.push(sTz === 'Asia/Tehran' ? '✅ منطقه زمانی شیت: Asia/Tehran'
                                 : '⚠️ منطقه زمانی شیت ' + sTz + ' است؛ برای درست بودن «امروز» آن را Asia/Tehran کنید (README گام ۲).');
  return report_(out);
}

/**
 * ساختار v2.1 (کد فاکتور فرمولی در A1): کدهایی که الان در ستون A نمایش داده می‌شوند. null اگر ستون A فرمولی نیست.
 * {ids: [[متن]], valid: تعداد کد معتبر, renew: سفارش دارای نام بدون کد معتبر (تاریخ خالی/متنی → «ZH--…»),
 *  bad: ['ردیف («متن»)'] — سفارش دارای نام که به‌جای کد، خطا یا «Loading…» نشان می‌دهد}
 */
function legacyIds_(sh) {
  if (!sh || sh.getLastColumn() < 1 || !sh.getRange(1, 1).getFormula()) return null;
  var last = lastDataRow_(sh, OC.name);
  var rows = last >= 2 ? sh.getRange(2, 1, last - 1, 2).getDisplayValues() : [];
  var re = idRe_(), noDate = CFG.ORDER_ID_PREFIX + '--', res = { ids: [], valid: 0, renew: 0, bad: [] };
  rows.forEach(function (r, i) {
    var id = String(r[0]).trim();
    res.ids.push([r[0]]);
    if (re.test(id)) res.valid++;
    else if (!String(r[1]).trim()) return;
    else if (!id || id.indexOf(noDate) === 0) res.renew++;
    else res.bad.push((i + 2) + ' («' + id + '»)');
  });
  return res;
}

function backup_(ss) {
  var tz = ss.getSpreadsheetTimeZone();
  var name = ss.getName() + ' — backup ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH-mm');
  var copy = DriveApp.getFileById(ss.getId()).makeCopy(name);
  return copy.getUrl();
}

function report_(lines) {
  var txt = lines.join('\n');
  Logger.log(txt);
  try { SpreadsheetApp.getUi().alert('FeelHeal', txt, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return txt;
}

// ============================================================
// 6) setup (قابل اجرای مکرر) — ارتقای v2.1 → v2.2 هم همین است
// ============================================================
function setup() {
  var ss = SpreadsheetApp.getActive();
  var lock = LockService.getDocumentLock(); lock.waitLock(30000);
  var out = [];
  try {
    var main = findMainSheet_(ss);
    if (!main) throw new Error('تب اصلی پیدا نشد (عنوان «نام مرکز/پزشک» در ردیف ۱).');

    // پیش‌شرط ارتقای v2.1، پیش از هر تغییری: کدهای فرمولی ستون A باید کامل محاسبه شده باشند،
    // وگرنه «Loading…» یا #ERROR! به‌جای کد ثابت می‌شد و آن سفارش‌ها شماره‌ی فاکتورشان را از دست می‌دادند.
    var lg = legacyIds_(ss.getSheetByName(CFG.ORDERS_SHEET));
    if (lg && lg.bad.length && !RENEW_BROKEN_IDS_) {
      throw new Error('setup متوقف شد و چیزی را تغییر نداد: ستون A تب «' + CFG.ORDERS_SHEET + '» در این ردیف‌ها به‌جای کد فاکتور، ' +
        'خطا یا «در حال محاسبه» نشان می‌دهد: ' + lg.bad.slice(0, 10).join('، ') + (lg.bad.length > 10 ? ' …' : '') +
        '. شیت را باز کنید، صبر کنید تا همه‌ی کدها نمایش داده شوند و دوباره setup را اجرا کنید (README گام ۲).');
    }

    // فاز ۰ — پشتیبان
    out.push('📦 نسخه پشتیبان: ' + backup_(ss));

    // تب REF و تنظیمات قبل از فرمول‌ها
    ensureRef_(ss, out);
    ensureSettings_(ss, out);

    // ستون‌های تب اصلی
    var map = headerMap_(main);
    MAIN_FIELDS.forEach(function (f) {
      if (!map[f[0]]) {
        var c = main.getLastColumn() + 1;
        if (c > main.getMaxColumns()) main.insertColumnsAfter(main.getMaxColumns(), c - main.getMaxColumns());
        main.getRange(1, c).setValue(f[1]).setFontWeight('bold');
        map[f[0]] = c;
        out.push('➕ ستون اضافه شد: ' + f[1]);
      }
    });

    // فاز ۳ — تبدیل تاریخ‌های قدیمی به میلادی واقعی
    var last = lastDataRow_(main, map.name);
    ['stageDate', 'nextDate'].forEach(function (k) {
      if (last < 2) return;
      var rng = main.getRange(2, map[k], last - 1, 1);
      rng.setNumberFormat(DATE_FMT);
      var raw = rng.getValues(), disp = rng.getDisplayValues(), fixed = 0, bad = [];
      for (var i = 0; i < raw.length; i++) {
        if (raw[i][0] === '') continue;
        var p = parseDateText_(disp[i][0]);
        if (!p) { bad.push(i + 2); continue; }                       // نامعتبر: دست نمی‌خورد، گزارش می‌شود
        if (!p.jalali && !(typeof raw[i][0] === 'string')) continue;  // میلادی واقعی: دست نمی‌خورد
        rng.getCell(i + 1, 1).setValue(p.serial);
        fixed++;
      }
      if (fixed) out.push('📅 ' + fixed + ' تاریخ در «' + fieldHeader_(k) + '» به میلادی تبدیل شد');
      if (bad.length) out.push('⚠️ تاریخ نامعتبر در «' + fieldHeader_(k) + '» ردیف‌های: ' + bad.join('، '));
    });

    // فاز ۰ — مهاجرت نوع → نوع کانال خریدار
    if (last >= 2) {
      var oldR = main.getRange(2, map.typeOld, last - 1, 1).getValues();
      var chR = main.getRange(2, map.channel, last - 1, 1);
      var chV = chR.getValues(), mapped = 0, review = [];
      for (var r = 0; r < chV.length; r++) {
        var cur = String(chV[r][0]).trim();
        if (CFG.CHANNELS.indexOf(cur) >= 0) continue;
        var m = TYPE_MAP[String(oldR[r][0]).trim()];
        if (m) { chV[r][0] = m; mapped++; }
        else { chV[r][0] = ''; review.push(r + 2); }
      }
      chR.setValues(chV);
      chR.setBackground(null);
      review.forEach(function (row) { main.getRange(row, map.channel).setBackground('#fff3c4'); });
      if (mapped) out.push('🔀 نوع کانال: ' + mapped + ' ردیف خودکار نگاشت شد');
      if (review.length) out.push('🟨 نیازمند بازبینی دستی (سایر/داروخانه‌وفروشگاه/نامشخص) — ردیف‌های: ' + review.join('، '));
    }
    var chRule = SpreadsheetApp.newDataValidation().requireValueInList(CFG.CHANNELS, true).setAllowInvalid(false).build();
    main.getRange(2, map.channel, main.getMaxRows() - 1, 1).setDataValidation(chRule);

    // تب سفارش‌ها (شامل ثابت‌کردن کدهای فاکتور v2.1)
    var osh = ensureOrders_(ss, main, map, out);

    // فرمول‌های سبک در ردیف عنوان + عنوان ساده برای ستون‌های محاسبه‌ای
    if (main.getFrozenRows() < 1) main.setFrozenRows(1);
    writeMainFormulas_(main, map);
    main.getRange(2, map.annAmt, main.getMaxRows() - 1, 1).setNumberFormat('#,##0');
    main.getRange(2, map.stageDate, main.getMaxRows() - 1, 1).setNumberFormat(DATE_FMT);
    main.getRange(2, map.nextDate, main.getMaxRows() - 1, 1).setNumberFormat(DATE_FMT);
    protectFormulaCols_(main, MAIN_FIELDS.filter(function (f) { return f[2] !== 'input'; }).map(function (f) { return map[f[0]]; }));

    // ثبت مشخصات و بازمحاسبه کامل ستون‌های محاسبه‌ای
    var dp = PropertiesService.getDocumentProperties();
    dp.setProperties({ fh_main: main.getName(), fh_orders_url: ss.getUrl() + '#gid=' + osh.getSheetId() });
    SpreadsheetApp.flush();
    var snap = readSnap_(ctx_({ setup: true }));
    var res = commit_(snap, null, null, true);
    dp.setProperty('fh_schema', CFG.SCHEMA);
    bumpCache_();
    out.push('🧮 ستون‌های محاسبه‌ای (تب اصلی + L..Q سفارش‌ها) به‌صورت مقدار ثابت نوشته شد — ' + res.writes + ' سلول');
    if (res.ids.length) out.push('🏷️ ' + res.ids.length + ' کد فاکتور تازه برای سفارش‌های بدون کد: ' +
                                 res.ids.slice(0, 10).join('، ') + (res.ids.length > 10 ? ' …' : ''));
    if (snap.dupIds.length) out.push('⚠️ کد فاکتور تکراری: ' + snap.dupIds.join(' | ') + ' — کد ردیف کپی‌شده را پاک کنید تا کد تازه بگیرد.');

    ensureTriggers_(ss);
    var bn = badNameRows_(main, map);
    if (bn.length) out.push('⚠️ نام‌های دارای * ? ~ یا شروع با = < > (جمع‌ها را خراب می‌کنند) — ردیف‌های: ' + bn.join('، '));
    out.push('✅ ساختار نسخه ' + CFG.SCHEMA + ' آماده است. گام بعد: Deploy → New version (README).');
    if (ss.getSpreadsheetTimeZone() !== 'Asia/Tehran') out.push('⚠️ منطقه زمانی شیت Asia/Tehran نیست — README گام ۲.');
  } finally {
    lock.releaseLock();
  }
  return report_(out);
}

/**
 * فقط وقتی setup به‌خاطر کدهای خطادار ستون A متوقف شد، خطا با بازکردن دوباره‌ی شیت برطرف نمی‌شود،
 * و مطمئنید آن سفارش‌ها هنوز فاکتوری با آن کد ندارند: setup اجرا و آن ردیف‌ها کد تازه می‌گیرند (README گام ۲).
 */
var RENEW_BROKEN_IDS_ = false;
function setupRenewBrokenCodes() {
  RENEW_BROKEN_IDS_ = true;
  return setup();
}

// SUMIFS/COUNTIFS این نویسه‌ها را wildcard یا عملگر می‌خوانند
function badName_(n) { return /[*?~]/.test(n) || /^[=<>]/.test(n); }
function badNameRows_(sh, map) {
  var last = lastDataRow_(sh, map.name);
  if (last < 2) return [];
  return sh.getRange(2, map.name, last - 1, 1).getValues()
    .map(function (r, i) { return badName_(String(r[0]).trim()) ? i + 2 : 0; }).filter(Boolean);
}

function fieldHeader_(key) {
  for (var i = 0; i < MAIN_FIELDS.length; i++) if (MAIN_FIELDS[i][0] === key) return MAIN_FIELDS[i][1];
  return key;
}

function ensureRef_(ss, out) {
  if (ss.getSheetByName(CFG.REF_SHEET)) return;
  var sh = ss.insertSheet(CFG.REF_SHEET);
  sh.getRange(1, 1, 1, 3).setValues([['مرحله', 'بازه پیگیری (روز)', 'توصیه اقدام']]).setFontWeight('bold');
  sh.getRange(2, 1, CFG.DEFAULT_REF.length, 3).setValues(CFG.DEFAULT_REF);
  sh.setRightToLeft(true);
  out.push('➕ تب REF با مقادیر پیش‌فرض ساخته شد — بازه‌ها و توصیه‌ها را بازبینی کنید');
}

function ensureSettings_(ss, out) {
  var sh = ss.getSheetByName(CFG.SETTINGS_SHEET);
  var fresh = !sh;
  if (fresh) { sh = ss.insertSheet(CFG.SETTINGS_SHEET); sh.setRightToLeft(true); out.push('➕ تب تنظیمات ساخته شد'); }
  var labels = [
    ['آستانه حجمی (واحد)'], ['حداقل تعداد سفارش برای «تعهد واقعی» (بیش از)'],
    ['شروع سال شمسی جاری (خودکار)'], ['شروع سال بعد (خودکار)'],
    ['شروع فصل جاری (خودکار)'], ['شروع فصل بعد (خودکار)'], ['دوره جاری (خودکار)']
  ];
  sh.getRange(1, 1, 7, 1).setValues(labels).setFontWeight('bold');
  if (sh.getRange('B1').getValue() === '') sh.getRange('B1').setValue(500);
  if (sh.getRange('B2').getValue() === '') sh.getRange('B2').setValue(1);
  sh.getRange('B3:B6').setNumberFormat(DATE_FMT);
  sh.getRange('D1').setValue('فهرست SKU').setFontWeight('bold');
  if (sh.getRange('D2').getValue() === '') sh.getRange(2, 4, CFG.SKUS.length, 1).setValues(CFG.SKUS.map(function (s) { return [s]; }));
  sh.getRange('B3:B7').setBackground('#eef2f6');
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (x) {
    if (x.getDescription() === 'FH-auto') x.remove();
  });
  var p = sh.getRange('B3:B7').protect().setDescription('FH-auto'); p.setWarningOnly(true);
  sh.setColumnWidth(1, 300);
}

/**
 * تب سفارش‌ها را می‌سازد/ترمیم می‌کند و برمی‌گرداند.
 * - ساختار v2.0 (۱۶ ستون، بدون «کد سفارش/فاکتور»): یک ستون خالی قبل از A درج می‌شود؛ کدها بعداً به ترتیب ردیف ساخته می‌شوند.
 * - ساختار v2.1 (کد فرمولی در A1): کدها «همان‌طور که الان نمایش داده می‌شوند» خوانده، فرمول برداشته و کدها به‌صورت مقدار ثابت نوشته می‌شوند.
 * - ساختار v2.2: کدها دست نمی‌خورند.
 */
function ensureOrders_(ss, main, map, out) {
  var sh = ss.getSheetByName(CFG.ORDERS_SHEET);
  var justMigrated = false, frozen = null;
  if (sh) {
    if (sh.getLastColumn() >= 1 && norm_(sh.getRange(1, 1).getDisplayValue()) === norm_('نام مشتری')) {
      sh.insertColumnBefore(1);
      justMigrated = true;
      out.push('➕ ستون «' + ORDER_HEADERS[0] + '» به ابتدای تب «سفارش‌ها» اضافه شد؛ ستون‌های قبلی با داده‌های موجود دست‌نخورده یک واحد جابه‌جا شدند');
    }
    if (!justMigrated) {
      var hdr = headerTexts_(sh, ORDER_HEADERS.length);
      for (var i = 0; i < ORDER_HEADERS.length; i++) {
        if (norm_(hdr[i]) !== norm_(ORDER_HEADERS[i])) {
          throw new Error('تب «' + CFG.ORDERS_SHEET + '» موجود است ولی ستون ' + colLetter_(i + 1) +
            ' عنوان «' + ORDER_HEADERS[i] + '» ندارد. تب را تغییر نام دهید یا حذف کنید و دوباره setup را اجرا کنید.');
        }
      }
      // v2.1 → v2.2: پیش از برداشتن فرمول، کدهای نمایش‌داده‌شده را بردار (setup پیش‌تر خطا/«Loading…» را رد کرده است)
      var lg = legacyIds_(sh);
      if (lg) frozen = lg.ids;
    }
  } else {
    sh = ss.insertSheet(CFG.ORDERS_SHEET);
    sh.setRightToLeft(true);
    out.push('➕ تب سفارش‌ها ساخته شد');
  }
  // ستون A کد فاکتور است: هر قاعده‌ی اعتبارسنجی که از ستون «نام مشتری» به آن رسیده (مثلاً با درج ستون در ارتقا از v2.0)
  // نوشتن کد را رد می‌کرد («The data you entered in cell A2 violates the data validation rules»).
  var n = sh.getMaxRows() - 1;
  sh.getRange(2, OC.id, n, 1).clearDataValidations();
  // عنوان‌ها به‌صورت متن ساده — فرمول‌های قدیمی A1 و L1..Q1 برداشته می‌شوند (K1 پایین‌تر دوباره نوشته می‌شود).
  // اگر ثابت‌کردن کدها وسط کار شکست خورد، فرمول‌های عنوان برمی‌گردند؛ وگرنه کدهای نمایش‌داده‌شده از شیت گم می‌شدند
  // و اجرای دوباره‌ی setup آن‌ها را به ترتیب ردیف از نو می‌ساخت (شماره‌ی فاکتورها عوض می‌شد).
  var oldHdr = frozen ? sh.getRange(1, 1, 1, ORDER_NCOLS).getFormulas()[0] : null;
  try {
    sh.getRange(1, 1, 1, ORDER_NCOLS).setValues([ORDER_HEADERS]).setFontWeight('bold').setWrap(true);
    sh.getRange(2, OC.id, n, 1).setNumberFormat('@');
    if (frozen) {
      var re = idRe_(), seen = {}, kept = 0, renew = [];
      var vals = frozen.map(function (x, i) {
        var id = String(x[0]).trim();
        if (!re.test(id) || seen[id]) { if (id) renew.push(i + 2); return ['']; }
        seen[id] = true; kept++;
        return [id];
      });
      if (vals.length) sh.getRange(2, OC.id, vals.length, 1).setValues(vals);
      out.push('🔒 ' + kept + ' کد فاکتور موجود ثابت شد (دیگر با مرتب‌سازی، حذف ردیف یا تغییر تاریخ عوض نمی‌شود)');
      if (renew.length) out.push('⚠️ ردیف‌هایی که کد معتبر/یکتا نداشتند و کد تازه می‌گیرند: ' + renew.join('، '));
    }
  } catch (err) {
    if (oldHdr) {
      oldHdr.forEach(function (f, i) { if (f) sh.getRange(1, i + 1).setFormula(f); });
      sh.getRange(2, OC.id, n, 1).setNumberFormat('General');
    }
    throw err;
  }
  ORDER_AUTO_COLS_1IDX.forEach(function (c) { sh.getRange(1, c).setBackground('#eef2f6'); });
  sh.setFrozenRows(1);
  sh.getRange('K1').setNote('۱=در جریان، ۲=پرداخت‌شده، ۳=معوق، ۴=نکول. نکول را با تیک ستون J بزنید، نه با تایپ در این ستون.');
  sh.getRange('C1').setNote('تاریخ را شمسی (1405/07/02) یا میلادی تایپ کنید؛ خودکار به میلادی ذخیره می‌شود.');
  sh.getRange('A1').setNote('کد فاکتور یک‌بار هنگام ثبت ساخته می‌شود و دیگر عوض نمی‌شود: ' + CFG.ORDER_ID_PREFIX +
    '-[سال شمسی تاریخ سفارش]-[شماره ترتیبی]. چیزی تایپ نکنید؛ اگر ردیفی را کپی کردید، کد آن را پاک کنید تا کد تازه بگیرد.');
  sh.getRange('L1').setNote('ستون‌های L تا Q را اسکریپت محاسبه و به‌صورت مقدار ثابت می‌نویسد (هنگام هر ثبت/ویرایش). چیزی تایپ نکنید.');

  var nameCol = colLetter_(map.name);
  var mainRef = "'" + main.getName() + "'!" + nameCol + '2:' + nameCol;
  sh.getRange(2, OC.name, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getRange(mainRef), true).setAllowInvalid(false).build());
  sh.getRange(2, OC.type, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(CFG.ORDER_TYPES, true).setAllowInvalid(false).build());
  sh.getRange(2, OC.sku, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getRange("'" + CFG.SETTINGS_SHEET + "'!D2:D"), true).setAllowInvalid(false).build());
  sh.getRange(2, OC.units, n, 2).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).build());
  sh.getRange(2, OC.def, n, 1).insertCheckboxes();
  sh.getRange(2, OC.amount, n, 1).setNumberFormat('#,##0');
  ORDER_DATE_COLS.concat([OC.prev]).forEach(function (c) { sh.getRange(2, c, n, 1).setNumberFormat(DATE_FMT); });
  sh.getRange(2, OC.jDate, n, 4).setNumberFormat('@');   // N..Q متن شمسی — بدون این، «1405/07/02» تاریخ تفسیر می‌شود

  // فرمول سبک K در ردیف عنوان (حذف/مرتب‌سازی ردیف‌ها آن را نمی‌شکند)
  ORDER_FORMULA_COLS_1IDX.forEach(function (c) { sh.getRange(2, c, n, 1).clearContent(); });
  sh.getRange(1, OC.status).setFormula('={"' + ORDER_HEADERS[OC.status - 1] + '";' + ORDER_STATUS_FORMULA + '}');

  // رنگ وضعیت پرداخت (ستون K)
  var jr = sh.getRange(2, OC.status, n, 1);
  var rules = sh.getConditionalFormatRules().filter(function (r) {
    return !r.getRanges().some(function (x) { return x.getColumn() === OC.status; });
  });
  [[2, '#d8f0dd'], [3, '#fde2c8'], [4, '#f6c6c6']].forEach(function (p) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberEqualTo(p[0]).setBackground(p[1]).setRanges([jr]).build());
  });
  sh.setConditionalFormatRules(rules);
  protectFormulaCols_(sh, ORDER_AUTO_COLS_1IDX);
  return sh;
}

// تب اصلی: فرمول‌های سبک (وضعیت پیگیری، توصیه اقدام) در ردیف عنوان؛ ستون‌های محاسبه‌ای فقط عنوان ساده می‌گیرند
function writeMainFormulas_(main, map) {
  var L = function (k) { return colLetter_(map[k]); };
  var N = L('name');
  var f = {
    fuStatus: '=MAP(' + N + '2:' + N + ',' + L('nextDate') + '2:' + L('nextDate') + ',LAMBDA(n,d,IF(n="","",' +
      'IFERROR(IF(d="","بدون تاریخ",IF(INT(d)<TODAY(),"عقب‌افتاده",IF(INT(d)=TODAY(),"امروز",' +
      'IF(INT(d)<=TODAY()+3,"تا ۳ روز آینده","بعداً")))),"تاریخ نامعتبر"))))',
    action: '=MAP(' + N + '2:' + N + ',' + L('stage') + '2:' + L('stage') + ',LAMBDA(n,s,IF(n="","",' +
      "IFERROR(VLOOKUP(s,'" + CFG.REF_SHEET + "'!A:C,3,FALSE),\"\"))))"
  };
  var rows = main.getMaxRows() - 1;
  Object.keys(f).forEach(function (k) {
    main.getRange(2, map[k], rows, 1).clearContent();
    // فرمول در ردیف عنوان: {"عنوان"; MAP(...)} — حذف ردیف ۲ یا مرتب‌سازی، فرمول را از بین نمی‌برد
    main.getRange(1, map[k]).setFormula('={"' + fieldHeader_(k) + '";' + f[k].replace(/^=/, '') + '}')
      .setBackground('#eef2f6').setFontWeight('bold');
  });
  // ستون‌های محاسبه‌ای: فرمول قدیمی عنوان (v2.1) برداشته می‌شود؛ مقادیر را commit_ می‌نویسد
  CALC_KEYS.forEach(function (k) {
    main.getRange(1, map[k]).setValue(fieldHeader_(k)).setBackground('#eef2f6').setFontWeight('bold');
    main.getRange(2, map[k], rows, 1).clearContent();
  });
}

function protectFormulaCols_(sh, cols) {
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (p.getDescription() === 'FH-formula') p.remove();
  });
  cols.forEach(function (c) {
    var p = sh.getRange(1, c, sh.getMaxRows(), 1).protect().setDescription('FH-formula');
    p.setWarningOnly(true);
  });
}

// تریگرهای نصبی: بازمحاسبه روزانه (وضعیت معوق/پیگیری به «امروز» وابسته است) + تغییرات ساختاری (حذف/درج ردیف)
// تریگر روزانه هر بار از نو ساخته می‌شود تا ساعت ۰ به وقت منطقه زمانی شیت باشد، نه منطقه زمانی پروژه‌ی اسکریپت.
function ensureTriggers_(ss) {
  var tr = ScriptApp.getProjectTriggers();
  tr.forEach(function (t) { if (t.getHandlerFunction() === 'dailyRefresh') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyRefresh').timeBased().everyDays(1).atHour(0).inTimezone(ss.getSpreadsheetTimeZone()).create();
  if (!tr.some(function (t) { return t.getHandlerFunction() === 'onSheetChange'; })) {
    ScriptApp.newTrigger('onSheetChange').forSpreadsheet(ss).onChange().create();
  }
}

// ============================================================
// 7) منو، onEdit، onChange، تابع سفارشی JALALI
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('FeelHeal')
    .addItem('بررسی ساختار (بدون تغییر)', 'checkSchema')
    .addItem('راه‌اندازی / ترمیم ساختار', 'setup')
    .addItem('بازمحاسبه ستون‌های محاسبه‌ای و کدهای فاکتور', 'recalcAll')
    .addItem('اندازه‌گیری سرعت (benchmark)', 'benchmark')
    .addToUi();
}

/**
 * ویرایش مستقیم در شیت:
 *  ۱) تاریخ تایپ‌شده در ستون‌های تاریخ → میلادی (مثل قبل)
 *  ۲) کش سرور باطل می‌شود (هر ویرایشی، هر تبی)
 *  ۳) اگر ویرایش روی داده‌ای بود که ستون‌های محاسبه‌ای یا کد فاکتور به آن وابسته‌اند → بازمحاسبه
 */
function onEdit(e) {
  var recalc = false;
  try {
    var rng = e.range, sh = rng.getSheet(), name = sh.getName();
    var r0 = rng.getRow(), r1 = r0 + rng.getNumRows() - 1, c0 = rng.getColumn(), c1 = c0 + rng.getNumColumns() - 1;
    if (name === CFG.ORDERS_SHEET) {
      if (r1 >= 2) { convertDates_(sh, rng, ORDER_DATE_COLS); if (c0 <= ORDER_NCOLS) recalc = true; }
    } else if (name === CFG.SETTINGS_SHEET) {
      if (r0 <= 2 && c0 <= 2 && c1 >= 2) recalc = true;   // B1:B2 — آستانه
    } else if (name !== CFG.REF_SHEET) {
      var mp = headerMap_(sh);
      if (mp.name && mp.stageDate && mp.nextDate) {         // تب اصلی
        if (r1 >= 2) convertDates_(sh, rng, [mp.stageDate, mp.nextDate]);
        var touched = [mp.name].concat(CALC_KEYS.map(function (k) { return mp[k]; }));
        if (r1 >= 2 && touched.some(function (c) { return c >= c0 && c <= c1; })) recalc = true;
      }
    }
  } catch (err) { /* simple trigger: بی‌صدا */ }
  try { bumpCache_(); } catch (err) {}
  if (recalc) { try { recalcLocked_(10000, true); } catch (err) { console.error('onEdit recalc: ' + err); } }
}

function convertDates_(sh, rng, cols) {
  var r0 = Math.max(rng.getRow(), 2), nr = rng.getRow() + rng.getNumRows() - r0;
  if (nr < 1) return;
  var c0 = rng.getColumn(), c1 = c0 + rng.getNumColumns() - 1;
  cols.forEach(function (c) {
    if (c < c0 || c > c1) return;
    var sub = sh.getRange(r0, c, nr, 1);
    sub.setNumberFormat(DATE_FMT);   // اگر پیست قالب را عوض کرده بود، برگردان
    var raw = sub.getValues(), disp = sub.getDisplayValues();
    for (var i = 0; i < raw.length; i++) {
      var cell = sub.getCell(i + 1, 1);
      if (raw[i][0] === '') { cell.clearNote(); continue; }
      var p = parseDateText_(disp[i][0]);
      if (!p) { cell.setNote('⚠️ تاریخ نامعتبر — قالب: 1405/07/02'); continue; }
      cell.clearNote();
      if (p.jalali || typeof raw[i][0] === 'string') cell.setValue(p.serial);
    }
  });
}

// تریگر نصبی onChange: درج/حذف ردیف و ستون و تغییرات ساختاری دیگر → بازمحاسبه.
// کش در هر حال باطل می‌شود: مرتب‌سازی (Data → Sort range) onEdit را صدا نمی‌زند و نوع تغییرش مستند نیست.
function onSheetChange(e) {
  try { bumpCache_(); } catch (x) {}
  var t = e && e.changeType;
  if (t === 'EDIT' || t === 'FORMAT') return;   // ویرایش عادی را onEdit بازمحاسبه می‌کند
  try { recalcLocked_(20000, true); } catch (x) { console.error('onSheetChange: ' + x); }
}

// تریگر روزانه: سال/فصل جاری + وضعیت‌های وابسته به «امروز» (معوق، وصول)
function dailyRefresh() {
  recalcLocked_(60000, true);
}

// منو: بازمحاسبه کامل ستون‌های محاسبه‌ای + ساخت کد برای سفارش‌های بی‌کد
function recalcAll() {
  var res = recalcLocked_(30000, true);
  if (!res) return report_(['⏳ قفل در دسترس نبود (ذخیره‌ی دیگری در جریان است) — چند ثانیه بعد دوباره امتحان کنید.']);
  var out = ['✅ بازمحاسبه انجام شد — ' + res.writes + ' سلول به‌روز شد.'];
  if (res.ids.length) out.push('🏷️ کد فاکتور تازه: ' + res.ids.join('، '));
  if (res.dupIds.length) out.push('⚠️ کد فاکتور تکراری: ' + res.dupIds.join(' | ') + ' — کد ردیف کپی‌شده را پاک کنید تا کد تازه بگیرد.');
  return report_(out);
}

function recalcLocked_(waitMs, full) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(waitMs)) return null;
  try {
    var snap = readSnap_(ctx_());
    var res = commit_(snap, null, null, full);
    res.dupIds = snap.dupIds;
    return res;
  } finally {
    lock.releaseLock();
  }
}

/**
 * تبدیل تاریخ میلادی به شمسی برای نمایش (برای سازگاری نگه داشته شده؛ setup دیگر از آن استفاده نمی‌کند).
 * @param {Date|Array} input سلول یا ستون تاریخ
 * @return متن شمسی yyyy/mm/dd
 * @customfunction
 */
function JALALI(input) {
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var one = function (v) {
    var y, m, d;
    if (v instanceof Date && !isNaN(v)) {
      var p = Utilities.formatDate(v, tz, 'yyyy-M-d').split('-'); y = +p[0]; m = +p[1]; d = +p[2];
    } else if (typeof v === 'number' && v > 0) {
      var dt = new Date(Math.round((v - 25569) * 86400000));
      y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
    } else return '';
    var j = toJalaali_(y, m, d);
    return j.jy + '/' + ('0' + j.jm).slice(-2) + '/' + ('0' + j.jd).slice(-2);
  };
  if (Array.isArray(input)) return input.map(function (r) { return r.map(one); });
  return one(input);
}

// ============================================================
// 8) هسته‌ی داده: خواندن یک‌باره، محاسبه در حافظه، نوشتن فقط تغییرات
// ============================================================
function ctx_(opt) {
  var ss = SpreadsheetApp.getActive();
  var props = PropertiesService.getDocumentProperties().getProperties();
  if (!(opt && opt.setup) && props.fh_schema !== CFG.SCHEMA) {
    throw new Error('ساختار شیت هنوز به نسخه ' + CFG.SCHEMA + ' ارتقا نیافته — از منوی FeelHeal «راه‌اندازی / ترمیم ساختار» (setup) را یک‌بار اجرا کنید.');
  }
  // سرعت: نام تب اصلی ذخیره می‌شود تا هر بار همه‌ی تب‌ها گشته نشوند
  var main = props.fh_main ? ss.getSheetByName(props.fh_main) : null;
  var map = main ? headerMap_(main) : {};
  if (!map.name) {
    main = findMainSheet_(ss);
    if (!main) throw new Error('تب اصلی پیدا نشد.');
    map = headerMap_(main);
    try { PropertiesService.getDocumentProperties().setProperty('fh_main', main.getName()); props.fh_main = main.getName(); } catch (e) {}
  }
  var need = MAIN_FIELDS.filter(function (f) { return !map[f[0]]; });
  var osh = ss.getSheetByName(CFG.ORDERS_SHEET), st = ss.getSheetByName(CFG.SETTINGS_SHEET);
  if (need.length || !osh || !st) throw new Error('ساختار ناقص است — ابتدا setup را از منوی FeelHeal اجرا کنید.');
  return { ss: ss, main: main, map: map, osh: osh, st: st, tz: ss.getSpreadsheetTimeZone(), props: props };
}

/**
 * یک «عکس» از داده‌ها: تب اصلی تا آخرین نام، سفارش‌ها (A..Q) تا آخرین نام مشتری، تنظیمات، REF.
 * ردیف‌ها پیوسته‌اند: main.rows[i].row === i + 2 و ord.rows[i].row === i + 2.
 */
function readSnap_(c) {
  var t = todayYMD_(c.tz);
  var snap = {
    c: c, tz: c.tz, today: t.y + '-' + pad2_(t.m) + '-' + pad2_(t.d),
    todaySerial: serialFromYMD_(t.y, t.m, t.d), per: periods_(t), dupIds: []
  };
  var lastMain = lastDataRow_(c.main, c.map.name), lc = c.main.getLastColumn();
  var mv = c.main.getRange(1, 1, Math.max(lastMain, 1), lc).getValues();
  snap.main = { lastCol: lc, hdr: mv[0], last: lastMain, rows: [] };
  for (var r = 1; r < mv.length; r++) snap.main.rows.push({ row: r + 1, v: mv[r] });

  var lastOrd = lastDataRow_(c.osh, OC.name);
  var ov = c.osh.getRange(1, 1, Math.max(lastOrd, 1), ORDER_NCOLS).getValues();
  snap.ord = { hdr: ov[0], last: lastOrd, rows: [] };
  for (r = 1; r < ov.length; r++) snap.ord.rows.push({ row: r + 1, v: ov[r] });

  var sv = c.st.getRange(1, 1, Math.max(c.st.getLastRow(), 7), 4).getValues();
  snap.set = {
    threshold: sv[0][1], minOrders: sv[1][1], period: sv[6][1],
    skus: sv.slice(1).map(function (x) { return String(x[3]).trim(); }).filter(Boolean)
  };
  snap.ref = refTable_(c.ss);
  return snap;
}

/**
 * همه‌ی مقادیر محاسبه‌ای — منطق دقیقاً همان فرمول‌های v2.1:
 *  K وضعیت پرداخت، L چندمین سفارش (بر اساس تاریخ؛ هم‌تاریخ‌ها به ترتیب ردیف)، M تاریخ سفارش قبلی،
 *  N..Q متن شمسی، و برای هر مشتری: حجم/مبلغ خالص (خرید − مرجوعی) سال و فصل شمسی جاری، تفکیک SKU، آستانه، وصول.
 */
function compute_(snap) {
  var tz = snap.tz, today = snap.todaySerial, P = snap.per, map = snap.c.map;
  var O = snap.ord.rows.map(function (r, i) {
    var v = r.v;
    return {
      i: i, name: String(v[OC.name - 1]).trim(), k: nk_(v[OC.name - 1]),
      dRaw: v[OC.date - 1], d: serialOf_(v[OC.date - 1], tz),
      type: String(v[OC.type - 1]).trim(), sku: String(v[OC.sku - 1]).trim().toUpperCase(),
      units: typeof v[OC.units - 1] === 'number' ? v[OC.units - 1] : 0,     // SUMIFS متن را نادیده می‌گیرد
      amount: typeof v[OC.amount - 1] === 'number' ? v[OC.amount - 1] : 0,
      due: serialOf_(v[OC.due - 1], tz), paidRaw: v[OC.paid - 1], paid: serialOf_(v[OC.paid - 1], tz),
      def: v[OC.def - 1] === true
    };
  });
  var byName = {};
  O.forEach(function (o) { if (o.name) (byName[o.k] = byName[o.k] || []).push(o); });

  O.forEach(function (o) {
    // K
    o.status = (!o.name || o.type !== 'خرید') ? '' :
      (o.paidRaw !== '' && o.paidRaw != null) ? 2 : o.def ? 4 : (typeof o.due === 'number' && today > o.due) ? 3 : 1;
    // L و M
    o.nth = ''; o.prev = '';
    if (o.name && o.dRaw !== '' && typeof o.d === 'number') {
      var same = byName[o.k], cnt = 0, mx = 0;
      for (var j = 0; j < same.length; j++) {
        var p = same[j];
        if (typeof p.d !== 'number') continue;
        if (p.d < o.d) { cnt++; if (p.d > mx) mx = p.d; }
        else if (p.d === o.d && p.i <= o.i) cnt++;
      }
      o.nth = cnt;
      o.prev = mx > 0 ? mx : '';
    }
    // N..Q
    o.jDate = jalStr_(o.d); o.jDue = jalStr_(o.due); o.jPaid = jalStr_(o.paid); o.jPrev = jalStr_(o.prev);
  });

  // جمع‌های هر مشتری — یک گذر روی سفارش‌ها
  var agg = {};
  var A = function (k) { return agg[k] || (agg[k] = { annVol: 0, annAmt: 0, annCnt: 0, qVol: 0, volBCD: 0, volBCW: 0, volBCP: 0, st: {} }); };
  O.forEach(function (o) {
    if (!o.name) return;
    if (o.status !== '') A(o.k).st[o.status] = true;                    // وصول: همه‌ی تاریخ‌ها
    var sign = o.type === 'خرید' ? 1 : o.type === 'مرجوعی' ? -1 : 0;
    if (!sign || typeof o.d !== 'number') return;
    var a = A(o.k);
    if (o.d >= P.yS && o.d < P.yE) {
      a.annVol += sign * o.units; a.annAmt += sign * o.amount;
      if (sign > 0) a.annCnt++;
      if (o.sku.indexOf('BCD') === 0) a.volBCD += sign * o.units;
      else if (o.sku.indexOf('BCW') === 0) a.volBCW += sign * o.units;
      else if (o.sku.indexOf('BCP') === 0) a.volBCP += sign * o.units;
    }
    if (o.d >= P.qS && o.d < P.qE) a.qVol += sign * o.units;
  });

  var th = Number(snap.set.threshold), mo = Number(snap.set.minOrders);
  var refBy = {};
  snap.ref.forEach(function (r) { var k = nk_(r.stage); if (!(k in refBy)) refBy[k] = r.action; });
  var C = snap.main.rows.map(function (r) {
    var v = r.v, name = String(v[map.name - 1]).trim(), out = {};
    if (!name) {
      CALC_KEYS.forEach(function (k) { out[k] = ''; });
      out.fuStatus = ''; out.action = '';
      return out;
    }
    var a = agg[nk_(name)] || A(nk_(name));
    out.annVol = a.annVol; out.annAmt = a.annAmt; out.annCnt = a.annCnt; out.qVol = a.qVol;
    out.volBCD = a.volBCD; out.volBCW = a.volBCW; out.volBCP = a.volBCP;
    out.thr = a.annVol >= th ? (a.annCnt > mo ? '✅ تعهد حجمی واقعی' : '⚠️ خرید یک‌باره حجیم — نیازمند پیگیری تکرار') : 'زیر آستانه';
    out.coll = a.st[4] ? 'نکول' : a.st[3] ? 'معوق' : a.st[1] ? 'در جریان' : 'بدون مطالبه باز';
    out.fuStatus = fuStatus_(v[map.nextDate - 1], tz, today);
    var ak = nk_(v[map.stage - 1]);
    out.action = ak && (ak in refBy) ? refBy[ak] : '';
    return out;
  });
  return { O: O, C: C };
}

function fuStatus_(d, tz, today) {
  if (d === '' || d == null) return 'بدون تاریخ';
  var s;
  if (d instanceof Date) s = isNaN(d) ? null : serialFromIso_(isoOf_(d, tz));
  else if (typeof d === 'number') s = Math.floor(d);
  else { var p = parseDateText_(String(d)); s = p ? p.serial : null; }
  if (s === null) return 'تاریخ نامعتبر';
  return s < today ? 'عقب‌افتاده' : s === today ? 'امروز' : s <= today + 3 ? 'تا ۳ روز آینده' : 'بعداً';
}

/**
 * سفارش‌های دارای نام و تاریخ معتبر ولی بدون کد → کد تازه (شماره بعد از بیشترین شماره‌ی همان سال در ستون A
 * و شمارنده‌ی ذخیره‌شده؛ پس شماره‌ی سفارش حذف‌شده دوباره استفاده نمی‌شود). کدهای موجود هرگز تغییر نمی‌کنند.
 * dry=true: فقط شمارش، بدون نوشتن. خروجی: فهرست کدهای ساخته‌شده (یا تعداد در حالت dry).
 */
function fillMissingIds_(snap, dry) {
  var re = idRe_(), max = {}, seen = {}, dups = [], need = [];
  snap.ord.rows.forEach(function (r) {
    var id = String(r.v[OC.id - 1]).trim();
    if (id) {
      var m = re.exec(id);
      if (m) { var y = +m[1], s = +m[2]; if (!(max[y] >= s)) max[y] = s; }
      if (seen[id]) dups.push(id + ' (ردیف‌های ' + seen[id] + ' و ' + r.row + ')'); else seen[id] = r.row;
      return;
    }
    var d = serialOf_(r.v[OC.date - 1], snap.tz);
    if (String(r.v[OC.name - 1]).trim() && typeof d === 'number' && d > 0) need.push({ r: r, d: d });
  });
  snap.dupIds = dups;
  if (dry) return need.length;

  var pv = snap.c.props, upd = {};
  var seqOf = function (y) { return Math.max(max[y] || 0, Number(upd['fh_seq_' + y] || pv['fh_seq_' + y]) || 0); };
  Object.keys(max).forEach(function (y) { if (max[y] > (Number(pv['fh_seq_' + y]) || 0)) upd['fh_seq_' + y] = String(max[y]); });
  var made = [];
  need.forEach(function (x) {
    var ymd = ymdFromSerial_(x.d), jy = toJalaali_(ymd.y, ymd.m, ymd.d).jy;
    var seq = seqOf(jy) + 1;
    max[jy] = seq; upd['fh_seq_' + jy] = String(seq);
    x.r.v[OC.id - 1] = fmtId_(jy, seq);
    made.push(x.r);
  });
  if (Object.keys(upd).length) {
    PropertiesService.getDocumentProperties().setProperties(upd);
    Object.keys(upd).forEach(function (k) { pv[k] = upd[k]; });
  }
  runs_(made.map(function (r) { return { col: r.row, r: r }; })).forEach(function (run) {
    snap.c.osh.getRange(run[0].col, OC.id, run.length, 1).setNumberFormat('@')
      .setValues(run.map(function (x) { return [x.r.v[OC.id - 1]]; }));
  });
  return made.map(function (r) { return r.v[OC.id - 1]; });
}

/**
 * مقادیر محاسبه‌ای را با مقدار فعلی شیت مقایسه و فقط بازه‌ی ردیف‌های متفاوت را می‌نویسد.
 * full=true: مقادیر جامانده زیر آخرین ردیف داده هم پاک می‌شود. dry=true: فقط شمارش سلول‌های متفاوت.
 * خروجی: تعداد سلول‌های نوشته‌شده (یا متفاوت).
 */
function writeDerived_(snap, comp, full, dry) {
  var c = snap.c, tz = snap.tz, count = 0;
  // تب اصلی
  var items = CALC_KEYS.map(function (k) { return { col: c.map[k], k: k }; });
  var mainLR = full && !dry ? c.main.getLastRow() : 0;
  runs_(items).forEach(function (run) {
    var lo = -1, hi = -1;
    snap.main.rows.forEach(function (r, i) {
      for (var j = 0; j < run.length; j++) {
        if (cmp_(r.v[run[j].col - 1], tz) !== cmp_(comp.C[i][run[j].k], tz)) { if (lo < 0) lo = i; hi = i; return; }
      }
    });
    if (lo >= 0) {
      count += (hi - lo + 1) * run.length;
      if (!dry) {
        var vals = [];
        for (var i = lo; i <= hi; i++) {
          vals.push(run.map(function (x) { return comp.C[i][x.k]; }));
          run.forEach(function (x) { snap.main.rows[i].v[x.col - 1] = comp.C[i][x.k]; });
        }
        c.main.getRange(snap.main.rows[lo].row, run[0].col, hi - lo + 1, run.length).setValues(vals);
      }
    }
    if (mainLR > snap.main.last) c.main.getRange(snap.main.last + 1, run[0].col, mainLR - snap.main.last, run.length).clearContent();
  });

  // تب سفارش‌ها L..Q
  var KEYS = ['nth', 'prev', 'jDate', 'jDue', 'jPaid', 'jPrev'], C0 = OC.nth;
  var lo2 = -1, hi2 = -1;
  snap.ord.rows.forEach(function (r, i) {
    var o = comp.O[i];
    for (var j = 0; j < KEYS.length; j++) {
      if (cmp_(r.v[C0 - 1 + j], tz) !== cmp_(o[KEYS[j]], tz)) { if (lo2 < 0) lo2 = i; hi2 = i; return; }
    }
  });
  if (lo2 >= 0) {
    count += (hi2 - lo2 + 1) * KEYS.length;
    if (!dry) {
      var r0 = snap.ord.rows[lo2].row, nr = hi2 - lo2 + 1, ov = [];
      for (var i2 = lo2; i2 <= hi2; i2++) {
        var row = KEYS.map(function (k) { return comp.O[i2][k]; });
        ov.push(row);
        row.forEach(function (x, j) { snap.ord.rows[i2].v[C0 - 1 + j] = x; });
      }
      c.osh.getRange(r0, OC.prev, nr, 1).setNumberFormat(DATE_FMT);
      c.osh.getRange(r0, OC.jDate, nr, 4).setNumberFormat('@');
      c.osh.getRange(r0, C0, nr, KEYS.length).setValues(ov);
    }
  }
  if (full && !dry) {
    var ordLR = c.osh.getLastRow();
    if (ordLR > snap.ord.last) c.osh.getRange(snap.ord.last + 1, C0, ordLR - snap.ord.last, KEYS.length).clearContent();
  }
  return count;
}

// سال/فصل جاری در تنظیمات B3:B7 (فقط نمایش؛ محاسبات از periods_ می‌خوانند)
function syncPeriods_(snap, dry) {
  if (String(snap.set.period) === snap.per.label) return false;
  if (!dry) {
    var p = snap.per;
    snap.c.st.getRange('B3:B7').setValues([[p.yS], [p.yE], [p.qS], [p.qE], [p.label]]);
    snap.set.period = p.label;
  }
  return true;
}

/**
 * پایان هر عملیات نوشتنی (زیر قفل): کد فاکتورهای جاافتاده، محاسبه، نوشتن تغییرات، flush،
 * ساخت پاسخ، ابطال کش و ذخیره‌ی پاسخ تازه در کش. خروجی: {json, ids, writes}
 */
function commit_(snap, t, extra, full) {
  syncPeriods_(snap, false);
  var ids = fillMissingIds_(snap, false);
  var comp = compute_(snap);
  var writes = writeDerived_(snap, comp, full, false);
  if (t) t.lap('derive');
  SpreadsheetApp.flush();
  if (t) t.lap('flush');
  var obj = build_(snap, comp);
  obj._stamp = Date.now();
  var json = JSON.stringify(obj);
  var cache = cache_(), ver = bumpCache_(cache);
  cachePutData_(cache, ver, snap.today, json);
  return { json: withTail_(json, { result: extra || undefined, _ms: t ? t.done() : undefined }), ids: ids, writes: writes };
}

// نتیجه‌ی همین درخواست (result، _ms) فقط به پاسخ اضافه می‌شود، نه به نسخه‌ی کش‌شده —
// وگرنه پاسخ‌های بعدی از کش، زمان‌سنجی و کد فاکتورِ یک درخواست قدیمی را با خود می‌آوردند.
function withTail_(json, tail) {
  var t = JSON.stringify(tail);   // کلیدهای undefined حذف می‌شوند
  return t === '{}' ? json : json.slice(0, -1) + ',' + t.slice(1);
}

// پاسخ برنامه وب — همان شکل v2.1 به‌اضافه‌ی warnings، meta.repeatStage، _stamp و _ms
function build_(snap, comp) {
  var c = snap.c, map = c.map, tz = snap.tz;
  var customers = [];
  snap.main.rows.forEach(function (r, i) {
    var name = String(r.v[map.name - 1]).trim();
    if (!name) return;
    var o = { row: r.row };
    MAIN_FIELDS.forEach(function (f) {
      var k = f[0];
      if (f[2] !== 'input') { o[k] = comp.C[i][k]; return; }
      var v = r.v[map[k] - 1];
      if (v instanceof Date) o[k] = isoOf_(v, tz);
      else if ((k === 'stageDate' || k === 'nextDate') && typeof v === 'number' && v > 0) o[k] = isoFromSerial_(v);
      else o[k] = v == null ? '' : v;
    });
    o.name = name;
    o.notes = parseNotes_(r.v[map.notes - 1]);
    customers.push(o);
  });
  var orders = [];
  snap.ord.rows.forEach(function (r, i) {
    var v = r.v, name = String(v[OC.name - 1]).trim();
    if (!name) return;
    orders.push({
      row: r.row, id: String(v[OC.id - 1]).trim(), name: name, date: isoOut_(v[OC.date - 1], tz),
      type: v[OC.type - 1], sku: v[OC.sku - 1], units: v[OC.units - 1], amount: v[OC.amount - 1],
      due: isoOut_(v[OC.due - 1], tz), paid: isoOut_(v[OC.paid - 1], tz),
      status: comp.O[i].status, nth: comp.O[i].nth
    });
  });
  // ستون فرمولی خراب؟ (مثلاً کسی داخل ستون فرمولی تایپ کرده → #REF!)
  var broken = MAIN_FIELDS.filter(function (f) { return f[2] === 'formula' && snap.main.hdr[map[f[0]] - 1] !== f[1]; })
    .map(function (f) { return f[1]; });
  ORDER_FORMULA_COLS_1IDX.forEach(function (oc1) {
    if (snap.ord.hdr[oc1 - 1] !== ORDER_HEADERS[oc1 - 1]) broken.push('سفارش‌ها: ' + ORDER_HEADERS[oc1 - 1]);
  });
  var warnings = [];
  if (snap.dupIds.length) warnings.push('کد فاکتور تکراری در تب سفارش‌ها: ' + snap.dupIds.join(' | ') +
    ' — کد ردیف کپی‌شده را در شیت پاک کنید تا خودکار کد تازه بگیرد.');
  return {
    broken: broken,
    warnings: warnings,
    customers: customers,
    orders: orders,
    ref: snap.ref,
    settings: { threshold: snap.set.threshold, minOrders: snap.set.minOrders, period: snap.per.label },
    meta: {
      channels: CFG.CHANNELS, sources: CFG.SOURCES,
      orderTypes: CFG.ORDER_TYPES,
      skus: snap.set.skus.length ? snap.set.skus : CFG.SKUS,
      customerNames: customers.map(function (x) { return x.name; }),
      ordersUrl: c.props.fh_orders_url || (c.ss.getUrl() + '#gid=' + c.osh.getSheetId()),
      today: snap.today,
      repeatStage: CFG.REPEAT_STAGE,
      idPrefix: CFG.ORDER_ID_PREFIX
    }
  };
}

function parseNotes_(v) {
  if (v === '' || v == null) return [];
  try {
    var a = JSON.parse(v);
    if (!Array.isArray(a)) a = [a];
    return a.map(function (x) {
      if (typeof x === 'string') return { date: '', text: x };
      return { date: String(x.date || x.d || x['تاریخ'] || ''), text: String(x.text || x.t || x.note || x['متن'] || '') };
    });
  } catch (e) { return [{ date: '', text: String(v) }]; }
}

// ============================================================
// 9) کش سرور (CacheService) با شماره نسخه
//    کلید داده = نسخه + تاریخ امروز. هر نوشتن/ویرایش نسخه را عوض می‌کند → کش قدیمی دیگر خوانده نمی‌شود.
//    پاسخ بزرگ در چند تکه ذخیره می‌شود (سقف هر مقدار ۱۰۰ کیلوبایت).
// ============================================================
var CACHE_VER_KEY = 'fh22_ver';
function cache_() { return CacheService.getDocumentCache() || CacheService.getScriptCache(); }
function cacheVer_(cache) {
  var v = cache.get(CACHE_VER_KEY);
  if (!v) { v = String(Date.now()) + '_' + Math.floor(Math.random() * 1e6); cache.put(CACHE_VER_KEY, v, 21600); }
  return v;
}
function bumpCache_(cache) {
  cache = cache || cache_();
  var v = String(Date.now()) + '_' + Math.floor(Math.random() * 1e6);
  cache.put(CACHE_VER_KEY, v, 21600);
  return v;
}
function cacheBase_(ver, today) { return 'fh22_d_' + ver + '_' + today; }
function cachePutData_(cache, ver, today, json) {
  try {
    var base = cacheBase_(ver, today), CH = 24000, n = Math.ceil(json.length / CH);   // ۲۴۰۰۰ نویسه ≤ ۱۰۰KB حتی با UTF-8 چهاربایتی
    if (n > 40) return;
    var o = {};
    for (var i = 0; i < n; i++) o[base + '_' + i] = json.substr(i * CH, CH);
    o[base + '_n'] = String(n);
    cache.putAll(o, CFG.CACHE_TTL);
  } catch (e) { console.warn('cache put: ' + e); }
}
function cacheGetData_(cache, ver, today) {
  try {
    var base = cacheBase_(ver, today), n = Number(cache.get(base + '_n'));
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(base + '_' + i);
    var got = cache.getAll(keys), s = '';
    for (i = 0; i < n; i++) { if (got[keys[i]] == null) return null; s += got[keys[i]]; }
    return s;
  } catch (e) { return null; }
}

// ============================================================
// 10) Web App
// ============================================================
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('FeelHeal — پیگیری فروش')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// خروجی به‌صورت رشته‌ی JSON: google.script.run هر شیء دارای مقدار غیرقابل‌انتقال (مثل Date) را بی‌صدا null می‌کند
function getData() {
  var t = timer_('getData');
  var ss = SpreadsheetApp.getActive();
  var today = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  var cache = cache_(), ver = cacheVer_(cache);     // نسخه پیش از خواندن داده — اگر ذخیره‌ای وسط کار رخ دهد، این پاسخ زیر نسخه‌ی قدیمی می‌ماند
  var hit = cacheGetData_(cache, ver, today);
  if (hit) { t.lap('cache'); t.done(); return hit; }

  var snap = readSnap_(ctx_());
  t.lap('read');
  var comp = compute_(snap);
  // خودترمیمی: اگر شیت مستقیم ویرایش شده و ستون‌های محاسبه‌ای/کدها عقب‌اند (مثلاً تریگری اجرا نشده)، زیر قفل اصلاح کن
  var pStale = syncPeriods_(snap, true), idMissing = fillMissingIds_(snap, true), diff = writeDerived_(snap, comp, false, true);
  var stale = pStale || idMissing > 0 || diff > 0;   // بدون اتصال کوتاه: fillMissingIds_ هشدار کد تکراری را هم پر می‌کند
  if (stale) {
    var lock = LockService.getDocumentLock();
    if (lock.tryLock(5000)) {
      try { return commit_(readSnap_(ctx_()), t, null, false).json; }
      finally { lock.releaseLock(); }
    }
  }
  var obj = build_(snap, comp);
  obj._stamp = Date.now();
  var json = JSON.stringify(obj);
  cachePutData_(cache, ver, today, json);
  return withTail_(json, { _ms: t.done() });
}

/**
 * rec: {row?, originalName?, name, channel, city, contact, phone, source, stage, nextDate(ISO)?, newNote?}
 * row خالی = مشتری جدید. فیلدهای ارسال‌نشده دست نمی‌خورند.
 */
function saveRecord(rec) {
  var t = timer_('saveRecord');
  var lock = LockService.getDocumentLock(); lock.waitLock(CFG.LOCK_MS);
  try {
    t.lap('lock');
    var c = ctx_(), snap = readSnap_(c), sh = c.main, map = c.map;
    t.lap('read');
    var ref = snap.ref, today = snap.today, M = snap.main.rows;
    var names = M.map(function (r) { return String(r.v[map.name - 1]).trim(); });

    var idx = -1, cur = {};
    if (rec.row) {
      idx = Number(rec.row) - 2;
      if (names[idx] !== String(rec.originalName || '').trim()) {
        idx = names.indexOf(String(rec.originalName || '').trim());
        if (idx < 0) throw new Error('رکورد پیدا نشد — صفحه را تازه کنید.');
      }
      MAIN_FIELDS.forEach(function (f) { cur[f[0]] = M[idx].v[map[f[0]] - 1]; });
    }
    var isNew = idx < 0;

    var name = rec.name !== undefined ? String(rec.name).trim() : String(cur.name || '').trim();
    if (!name) throw new Error('نام مرکز/پزشک الزامی است.');
    if (badName_(name)) throw new Error('نام نباید شامل * ? ~ باشد یا با = < > شروع شود (جمع‌های تب سفارش‌ها را خراب می‌کند).');
    var dup = names.some(function (n, i) { return norm_(n) === norm_(name) && i !== idx; });
    if (dup) throw new Error('مشتری دیگری با همین نام وجود دارد.');
    var channel = rec.channel !== undefined ? rec.channel : cur.channel;
    if (CFG.CHANNELS.indexOf(channel) < 0) throw new Error('«نوع کانال خریدار» را انتخاب کنید.');

    var w = {};
    ['city', 'contact', 'phone', 'source'].forEach(function (k) { if (rec[k] !== undefined) w[k] = String(rec[k]).trim(); });
    w.name = name; w.channel = channel;

    var oldStage = isNew ? '' : String(cur.stage || '').trim();
    var stage = rec.stage !== undefined && rec.stage !== '' ? rec.stage : (oldStage || (ref[0] ? ref[0].stage : ''));
    var stageChanged = isNew || stage !== oldStage;
    w.stage = stage;
    var refRow = ref.filter(function (x) { return x.stage === stage; })[0] || { days: 7 };
    if (stageChanged) {
      w.stageDate = serialFromIso_(today);
      if (!isNew && stage === CFG.REPEAT_STAGE) w.purchases = (Number(cur.purchases) || 0) + 1;
    }
    if (isNew) w.purchases = stage === CFG.REPEAT_STAGE ? 1 : 0;
    if (rec.nextDate) {
      var nd = serialFromIso_(rec.nextDate);
      if (nd === null) throw new Error('تاریخ پیگیری نامعتبر است.');
      w.nextDate = nd;
    } else if (stageChanged) {
      w.nextDate = serialFromIso_(addDaysIso_(today, refRow.days));
    }
    if (rec.newNote && String(rec.newNote).trim()) {
      var notes = parseNotes_(cur.notes);
      notes.push({ date: today, text: String(rec.newNote).trim() });
      w.notes = JSON.stringify(notes);
    }

    var row;
    if (isNew) {
      row = snap.main.last + 1;
      if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
      var blank = [];
      for (var b = 0; b < snap.main.lastCol; b++) blank.push('\u0000');   // نشانگر «نامعلوم» → ستون‌های محاسبه‌ای قطعاً نوشته می‌شوند
      M.push({ row: row, v: blank }); snap.main.last = row; idx = M.length - 1;
      // ردیف تازه: همه‌ی ستون‌های ورودی نوشته می‌شوند تا باقی‌مانده‌ی ردیف پاک‌شده‌ی قبلی نماند
      INPUT_KEYS.forEach(function (k) { if (!(k in w)) w[k] = ''; });
    } else {
      row = M[idx].row;
    }
    // نوشتن: ستون‌های مجاور در یک فراخوانی
    var cells = Object.keys(w).map(function (k) { return { col: map[k], val: w[k], date: k === 'stageDate' || k === 'nextDate' }; });
    runs_(cells).forEach(function (run) {
      run.forEach(function (x) { if (x.date) sh.getRange(row, x.col).setNumberFormat(DATE_FMT); });
      sh.getRange(row, run[0].col, 1, run.length).setValues([run.map(function (x) { return x.val; })]);
    });
    cells.forEach(function (x) { M[idx].v[x.col - 1] = x.val; });
    t.lap('write');

    // تغییر نام → اصلاح نام در سفارش‌ها
    var oldName = String(cur.name || '').trim();
    if (oldName && oldName !== name) renameInOrders_(snap, oldName, name);
    return commit_(snap, t, null, false).json;
  } finally {
    lock.releaseLock();
  }
}

/**
 * ثبت یک سفارش در تب سفارش‌ها: A = کد فاکتور ثابت، B..J = ورودی؛ K فرمول است و L..Q را commit_ می‌نویسد.
 * rec: {name, type, sku, units, amount, date(ISO), due(ISO)?, paid(ISO)?, defaulted}
 */
function saveOrder(rec) {
  var t = timer_('saveOrder');
  var lock = LockService.getDocumentLock(); lock.waitLock(CFG.LOCK_MS);
  try {
    t.lap('lock');
    var c = ctx_(), snap = readSnap_(c), osh = c.osh;
    t.lap('read');
    var name = String(rec.name || '').trim();
    if (!name) throw new Error('مشتری را انتخاب کنید.');
    var names = snap.main.rows.map(function (r) { return String(r.v[c.map.name - 1]).trim(); });
    if (names.indexOf(name) < 0) throw new Error('مشتری در تب اصلی پیدا نشد — صفحه را تازه کنید.');
    if (CFG.ORDER_TYPES.indexOf(rec.type) < 0) throw new Error('نوع خرید نامعتبر است.');
    var skus = snap.set.skus.length ? snap.set.skus : CFG.SKUS, sku = String(rec.sku || '').trim();
    if (skus.indexOf(sku) < 0) throw new Error('SKU نامعتبر است — فهرست SKU در تب تنظیمات (ستون D) را ببینید.');
    var units = Number(rec.units);
    if (!(units > 0)) throw new Error('تعداد واحد باید بزرگ‌تر از صفر باشد.');
    var amount = Number(rec.amount) || 0;
    if (amount < 0) throw new Error('ارزش سفارش نمی‌تواند منفی باشد.');
    var ds = serialFromIso_(rec.date || snap.today);
    if (ds === null) throw new Error('تاریخ سفارش نامعتبر است.');
    var due = rec.due ? serialFromIso_(rec.due) : '';
    var paid = rec.paid ? serialFromIso_(rec.paid) : '';
    if (due === null || paid === null) throw new Error('تاریخ سررسید/پرداخت نامعتبر است.');

    var row = snap.ord.last + 1, maxR = osh.getMaxRows();
    if (row > maxR) { osh.insertRowsAfter(maxR, 1); osh.getRange(row, OC.def).insertCheckboxes(); }
    // L..Q با نشانگر «نامعلوم» → commit_ آن‌ها را قطعاً می‌نویسد (باقی‌مانده‌ی احتمالی ردیف پاک‌شده‌ی قبلی هم پاک می‌شود)
    var v = ['', name, ds, rec.type, sku, units, amount, due, paid, !!rec.defaulted, '', '\u0000', '\u0000', '\u0000', '\u0000', '\u0000', '\u0000'];
    snap.ord.rows.push({ row: row, v: v }); snap.ord.last = row;
    fillMissingIds_(snap, false);   // کد این سفارش (و هر سفارش بی‌کد دیگر) — زیر قفل، پس یکتا
    var id = v[OC.id - 1];

    osh.getRange(row, OC.date).setNumberFormat(DATE_FMT);
    osh.getRange(row, OC.due, 1, 2).setNumberFormat(DATE_FMT);
    osh.getRange(row, OC.amount).setNumberFormat('#,##0');
    osh.getRange(row, OC.name, 1, 9).setValues([v.slice(OC.name - 1, OC.def)]);
    t.lap('write');
    return commit_(snap, t, { orderId: id }, false).json;
  } finally {
    lock.releaseLock();
  }
}

function renameInOrders_(snap, oldName, newName) {
  var R = snap.ord.rows, lo = -1, hi = -1;
  R.forEach(function (r, i) {
    if (String(r.v[OC.name - 1]).trim() === oldName) { r.v[OC.name - 1] = newName; if (lo < 0) lo = i; hi = i; }
  });
  if (lo < 0) return;
  snap.c.osh.getRange(R[lo].row, OC.name, hi - lo + 1, 1)
    .setValues(R.slice(lo, hi + 1).map(function (r) { return [r.v[OC.name - 1]]; }));
}

function deleteRecord(row, name) {
  var t = timer_('deleteRecord');
  var lock = LockService.getDocumentLock(); lock.waitLock(CFG.LOCK_MS);
  try {
    t.lap('lock');
    var c = ctx_(), snap = readSnap_(c), M = snap.main.rows;
    t.lap('read');
    name = String(name || '').trim();
    var names = M.map(function (r) { return String(r.v[c.map.name - 1]).trim(); });
    var idx = names[row - 2] === name ? row - 2 : names.indexOf(name);
    if (!name || idx < 0) throw new Error('رکورد پیدا نشد — صفحه را تازه کنید.');
    var has = snap.ord.rows.some(function (r) { return String(r.v[OC.name - 1]).trim() === name; });
    if (has) throw new Error('این مشتری سفارش ثبت‌شده دارد؛ حذف او سفارش‌ها را بی‌صاحب می‌کند. به‌جای حذف، مرحله را «غیرفعال/از دست رفته» کنید.');
    c.main.deleteRow(M[idx].row);
    // عکس حافظه را هم‌تراز کن (ردیف‌های بعدی یکی بالا می‌روند؛ مقادیر محاسبه‌ای همراه ردیف جابه‌جا شده‌اند)
    M.splice(idx, 1);
    for (var i = idx; i < M.length; i++) M[i].row--;
    snap.main.last--;
    t.lap('write');
    return commit_(snap, t, null, false).json;
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// 11) اندازه‌گیری سرعت — از ویرایشگر یا منوی FeelHeal اجرا کنید؛ نتیجه در پاپ‌آپ و Execution log
// ============================================================
function benchmark() {
  var out = [], t;
  t = Date.now(); var c = ctx_(); out.push('ctx_ (پیدا کردن تب‌ها و ستون‌ها): ' + (Date.now() - t) + 'ms');
  t = Date.now(); var snap = readSnap_(c); out.push('readSnap_ (خواندن همه داده‌ها): ' + (Date.now() - t) + 'ms');
  t = Date.now(); var comp = compute_(snap); out.push('compute_ (همه محاسبات): ' + (Date.now() - t) + 'ms');
  t = Date.now(); var diff = writeDerived_(snap, comp, false, true); out.push('مقایسه با شیت: ' + (Date.now() - t) + 'ms — ' + diff + ' سلول متفاوت');
  t = Date.now(); var json = JSON.stringify(build_(snap, comp)); out.push('ساخت پاسخ: ' + (Date.now() - t) + 'ms — ' + Math.round(json.length / 1024) + ' KB');
  bumpCache_();
  t = Date.now(); getData(); out.push('getData بدون کش: ' + (Date.now() - t) + 'ms');
  t = Date.now(); getData(); out.push('getData از کش: ' + (Date.now() - t) + 'ms');
  out.push('مشتریان: ' + snap.main.rows.length + ' | سفارش‌ها: ' + snap.ord.rows.length);
  return report_(out);
}
