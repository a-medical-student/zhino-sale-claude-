/**
 * FeelHeal Sales Tracker — v2.1 (28-09-2026)
 * تراکر مشتریان + لاگ سفارش‌ها + وضعیت وصول + نوع کانال خریدار
 *
 * تغییرات این نسخه:
 *  - سرعت: getData فقط تا آخرین ردیف واقعی می‌خواند (نه تا انتهای شیت)، flush فقط در صورت لزوم
 *  - افزودن saveOrder و فهرست‌های meta.customerNames / orderTypes / skus (مورد نیاز ثبت سفارش در Index)
 *
 * اجرای اولیه: از منوی ویرایشگر تابع setup را اجرا کنید (یک‌بار).
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
  ['annVol', 'حجم خالص سالانه (واحد)', 'formula'],
  ['annAmt', 'مبلغ خالص سالانه (تومان)', 'formula'],
  ['annCnt', 'تعداد سفارش خرید سال جاری', 'formula'],
  ['qVol', 'حجم خالص فصل جاری (واحد)', 'formula'],
  ['volBCD', 'حجم سالانه BCD', 'formula'],
  ['volBCW', 'حجم سالانه BCW', 'formula'],
  ['volBCP', 'حجم سالانه BCP', 'formula'],
  ['thr', 'وضعیت آستانه حجمی', 'formula'],
  ['coll', 'وضعیت وصول مطالبات', 'formula']
];

// ستون‌های تب سفارش‌ها (جایگاه ثابت A..Q)
// A = کد سفارش/فاکتور (فرمولی، خودکار: ZH-[سال شمسی]-[شماره ترتیبی])
// B..J = ورودی دستی (۹ ستون) | K..Q = فرمولی
var ORDER_HEADERS = [
  'کد سفارش/فاکتور',
  'نام مشتری', 'تاریخ سفارش', 'نوع خرید', 'SKU/محصول', 'تعداد واحد', 'ارزش سفارش (تومان)',
  'تاریخ سررسید پرداخت', 'تاریخ پرداخت واقعی', 'نکول (علامت دستی)',
  'وضعیت پرداخت (کد)', 'چندمین سفارش این مشتری', 'تاریخ سفارش قبلی این مشتری',
  'تاریخ سفارش (شمسی)', 'سررسید (شمسی)', 'پرداخت (شمسی)', 'سفارش قبلی (شمسی)'
];
// ستون‌های ورودی دستی (۱-پایه): B..J
var ORDER_INPUT_COLS_1IDX = [2, 3, 4, 5, 6, 7, 8, 9, 10];
// ستون‌های فرمولی (۱-پایه، پیوسته نیست): A + K..Q
var ORDER_FORMULA_COLS_1IDX = [1, 11, 12, 13, 14, 15, 16, 17];
var ORDER_DATE_COLS = [3, 8, 9]; // C (تاریخ سفارش), H (سررسید), I (پرداخت واقعی) — تبدیل خودکار شمسی→میلادی

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
function faDigitsToEn_(s) {
  return String(s).replace(/[۰-۹]/g, function (c) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(c); })
    .replace(/[٠-٩]/g, function (c) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(c); });
}
function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
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
function isoOf_(v, tz) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
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
function headerMap_(sh) {
  var map = {};
  var lc = sh.getLastColumn();
  if (lc < 1) return map;
  var hdr = headerTexts_(sh, lc);
  var byNorm = {};
  hdr.forEach(function (h, i) { var k = norm_(h); if (k && !(k in byNorm)) byNorm[k] = i + 1; });
  MAIN_FIELDS.forEach(function (f) { var c = byNorm[norm_(f[1])]; if (c) map[f[0]] = c; });
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
  var sTz = ss.getSpreadsheetTimeZone();
  out.push(sTz === 'Asia/Tehran' ? '✅ منطقه زمانی شیت: Asia/Tehran'
                                 : '⚠️ منطقه زمانی شیت ' + sTz + ' است؛ برای درست بودن «امروز» آن را Asia/Tehran کنید (README گام ۲).');
  return report_(out);
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
// 6) فاز ۰+۱+۳: setup (قابل اجرای مکرر)
// ============================================================
function setup() {
  var ss = SpreadsheetApp.getActive();
  var lock = LockService.getDocumentLock(); lock.waitLock(30000);
  var out = [];
  try {
    var main = findMainSheet_(ss);
    if (!main) throw new Error('تب اصلی پیدا نشد (عنوان «نام مرکز/پزشک» در ردیف ۱).');

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
      out.push('🔀 نوع کانال: ' + mapped + ' ردیف خودکار نگاشت شد');
      if (review.length) out.push('🟨 نیازمند بازبینی دستی (سایر/داروخانه‌وفروشگاه/نامشخص) — ردیف‌های: ' + review.join('، '));
    }
    var chRule = SpreadsheetApp.newDataValidation().requireValueInList(CFG.CHANNELS, true).setAllowInvalid(false).build();
    main.getRange(2, map.channel, main.getMaxRows() - 1, 1).setDataValidation(chRule);

    // تب سفارش‌ها
    ensureOrders_(ss, main, map, out);

    // فرمول‌های تب اصلی (در ردیف عنوان، تا حذف/مرتب‌سازی ردیف‌ها آن‌ها را نشکند)
    if (main.getFrozenRows() < 1) main.setFrozenRows(1);
    writeMainFormulas_(main, map);
    main.getRange(2, map.annAmt, main.getMaxRows() - 1, 1).setNumberFormat('#,##0');
    main.getRange(2, map.stageDate, main.getMaxRows() - 1, 1).setNumberFormat(DATE_FMT);
    main.getRange(2, map.nextDate, main.getMaxRows() - 1, 1).setNumberFormat(DATE_FMT);
    protectFormulaCols_(main, MAIN_FIELDS.filter(function (f) { return f[2] === 'formula'; }).map(function (f) { return map[f[0]]; }));

    refreshPeriods_(ss);
    ensureDailyTrigger_();
    var bn = badNameRows_(main, map);
    if (bn.length) out.push('⚠️ نام‌های دارای * ? ~ یا شروع با = < > (جمع‌ها را خراب می‌کنند) — ردیف‌های: ' + bn.join('، '));
    out.push('✅ ساختار آماده است. گام بعد: استقرار Web App (README).');
    if (ss.getSpreadsheetTimeZone() !== 'Asia/Tehran') out.push('⚠️ منطقه زمانی شیت Asia/Tehran نیست — README گام ۲.');
  } finally {
    lock.releaseLock();
  }
  return report_(out);
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
 * تب سفارش‌ها را می‌سازد/ترمیم می‌کند.
 * مهاجرت خودکار: اگر تب با ساختار قدیم (۱۶ ستون، بدون «کد سفارش/فاکتور») موجود باشد،
 * یک ستون خالی قبل از A درج می‌شود (داده‌های موجود بدون تغییر به راست منتقل می‌شوند)
 * و سپس تمام ستون‌ها/فرمول‌ها بر اساس ساختار جدید (۱۷ ستون، A..Q) بازنویسی می‌شوند.
 */
function ensureOrders_(ss, main, map, out) {
  var sh = ss.getSheetByName(CFG.ORDERS_SHEET);
  var justMigrated = false;
  if (sh) {
    if (sh.getLastColumn() >= 1 && norm_(sh.getRange(1, 1).getDisplayValue()) === norm_('نام مشتری')) {
      sh.insertColumnBefore(1);
      justMigrated = true;
      out.push('➕ ستون «' + ORDER_HEADERS[0] + '» به ابتدای تب «سفارش‌ها» اضافه شد؛ ستون‌های قبلی (B تا Q) با داده‌های موجود دست‌نخورده یک واحد جابه‌جا شدند');
    }
    if (!justMigrated) {
      var hdr = headerTexts_(sh, ORDER_HEADERS.length);
      for (var i = 0; i < ORDER_HEADERS.length; i++) {
        if (norm_(hdr[i]) !== norm_(ORDER_HEADERS[i])) {
          throw new Error('تب «' + CFG.ORDERS_SHEET + '» موجود است ولی ستون ' + colLetter_(i + 1) +
            ' عنوان «' + ORDER_HEADERS[i] + '» ندارد. تب را تغییر نام دهید یا حذف کنید و دوباره setup را اجرا کنید.');
        }
      }
    }
  } else {
    sh = ss.insertSheet(CFG.ORDERS_SHEET);
    sh.setRightToLeft(true);
    out.push('➕ تب سفارش‌ها ساخته شد');
  }
  sh.getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS]).setFontWeight('bold').setWrap(true);
  ORDER_FORMULA_COLS_1IDX.forEach(function (c) {
    sh.getRange(1, c).setBackground('#eef2f6');
  });
  sh.setFrozenRows(1);
  sh.getRange('K1').setNote('۱=در جریان، ۲=پرداخت‌شده، ۳=معوق، ۴=نکول. نکول را با تیک ستون J بزنید، نه با تایپ در این ستون.');
  sh.getRange('C1').setNote('تاریخ را شمسی (1405/07/02) یا میلادی تایپ کنید؛ خودکار به میلادی ذخیره می‌شود.');
  sh.getRange('A1').setNote('خودکار تولید می‌شود: ' + CFG.ORDER_ID_PREFIX + '-[سال شمسی تاریخ سفارش]-[شماره ترتیبی همان سال] — چیزی در این ستون تایپ نکنید.');

  var n = sh.getMaxRows() - 1;
  var nameCol = colLetter_(map.name);
  var mainRef = "'" + main.getName() + "'!" + nameCol + '2:' + nameCol;
  sh.getRange(2, 2, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getRange(mainRef), true).setAllowInvalid(false).build());
  sh.getRange(2, 4, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(CFG.ORDER_TYPES, true).setAllowInvalid(false).build());
  sh.getRange(2, 5, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getRange("'" + CFG.SETTINGS_SHEET + "'!D2:D"), true).setAllowInvalid(false).build());
  sh.getRange(2, 6, n, 2).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).build());
  sh.getRange(2, 10, n, 1).insertCheckboxes();
  sh.getRange(2, 7, n, 1).setNumberFormat('#,##0');
  ORDER_DATE_COLS.concat([13]).forEach(function (c) { sh.getRange(2, c, n, 1).setNumberFormat(DATE_FMT); });

  // فرمول‌ها در ردیف عنوان (A1 و K1..Q1) و کل ستون را پوشش می‌دهند؛ حذف/مرتب‌سازی ردیف‌های داده آن‌ها را نمی‌شکند
  ORDER_FORMULA_COLS_1IDX.forEach(function (c) { sh.getRange(2, c, n, 1).clearContent(); });
  var OF = {
    // A — کد سفارش/فاکتور: ZH-[سال شمسی تاریخ سفارش]-[شماره ترتیبی همان سال شمسی]
    // به‌جای صداکردن دوباره JALALI() برای هر ردیف، از ستون N (تاریخ سفارش شمسی، همین‌جا پایین‌تر محاسبه می‌شود) استفاده می‌شود.
    1: 'MAP(B2:B,C2:C,N2:N,SEQUENCE(ROWS(B2:B)),LAMBDA(n,d,js,i,' +
       'IF(OR(n="",d=""),"",LET(jy,LEFT(js,4),' +
       'seq,SUMPRODUCT((B2:INDEX(B2:B,i)<>"")*(LEFT(N2:INDEX(N2:N,i),4)=jy)),' +
       '"' + CFG.ORDER_ID_PREFIX + '-"&jy&"-"&TEXT(seq,"000")))))',
    11: 'MAP(B2:B,D2:D,H2:H,I2:I,J2:J,LAMBDA(n,t,due,paid,def,' +
        'IF(OR(n="",t<>"خرید"),"",IF(paid<>"",2,IF(def=TRUE,4,IF(AND(due<>"",TODAY()>due),3,1))))))',
    12: 'MAP(B2:B,C2:C,SEQUENCE(ROWS(B2:B)),LAMBDA(n,d,i,IF(OR(n="",d=""),"",' +
        'COUNTIFS(B2:B,n,C2:C,"<"&d)+SUMPRODUCT((B2:B=n)*(C2:C=d)*(SEQUENCE(ROWS(B2:B))<=i)))))',
    13: 'MAP(B2:B,C2:C,LAMBDA(n,d,IF(OR(n="",d=""),"",LET(m,MAXIFS(C2:C,B2:B,n,C2:C,"<"&d),IF(m=0,"",m)))))',
    14: 'JALALI(C2:C)', 15: 'JALALI(H2:H)', 16: 'JALALI(I2:I)', 17: 'JALALI(M2:M)'
  };
  Object.keys(OF).forEach(function (c) {
    sh.getRange(1, +c).setFormula('={"' + ORDER_HEADERS[c - 1] + '";' + OF[c] + '}');
  });

  // رنگ وضعیت پرداخت (ستون K)
  var jr = sh.getRange(2, 11, n, 1);
  var rules = sh.getConditionalFormatRules().filter(function (r) {
    return !r.getRanges().some(function (x) { return x.getColumn() === 11; });
  });
  [[2, '#d8f0dd'], [3, '#fde2c8'], [4, '#f6c6c6']].forEach(function (p) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberEqualTo(p[0]).setBackground(p[1]).setRanges([jr]).build());
  });
  sh.setConditionalFormatRules(rules);
  protectFormulaCols_(sh, ORDER_FORMULA_COLS_1IDX);
}

function writeMainFormulas_(main, map) {
  var L = function (k) { return colLetter_(map[k]); };
  var N = L('name');
  var O = "'" + CFG.ORDERS_SHEET + "'!";
  var S = "'" + CFG.SETTINGS_SHEET + "'!";
  var yS = S + '$B$3', yE = S + '$B$4', qS = S + '$B$5', qE = S + '$B$6';
  // ستون‌های سفارش‌ها (۱۷ ستونه): B=نام مشتری، C=تاریخ سفارش، D=نوع خرید، E=SKU، F=تعداد واحد، G=ارزش سفارش، K=وضعیت پرداخت
  function period(from, to) { return ',' + O + 'C:C,">="&' + from + ',' + O + 'C:C,"<"&' + to; }
  function net(valCol, from, to, extra) {
    extra = extra || '';
    return '(SUMIFS(' + O + valCol + ':' + valCol + ',' + O + 'B:B,n,' + O + 'D:D,"خرید"' + period(from, to) + extra + ')' +
           '-SUMIFS(' + O + valCol + ':' + valCol + ',' + O + 'B:B,n,' + O + 'D:D,"مرجوعی"' + period(from, to) + extra + '))';
  }
  function perName(body) { return '=MAP(' + N + '2:' + N + ',LAMBDA(n,IF(n=\"\",\"\",' + body + ')))'; }
  var f = {
    fuStatus: '=MAP(' + N + '2:' + N + ',' + L('nextDate') + '2:' + L('nextDate') + ',LAMBDA(n,d,IF(n="","",' +
      'IFERROR(IF(d="","بدون تاریخ",IF(INT(d)<TODAY(),"عقب‌افتاده",IF(INT(d)=TODAY(),"امروز",' +
      'IF(INT(d)<=TODAY()+3,"تا ۳ روز آینده","بعداً")))),"تاریخ نامعتبر"))))',
    action: '=MAP(' + N + '2:' + N + ',' + L('stage') + '2:' + L('stage') + ',LAMBDA(n,s,IF(n="","",' +
      "IFERROR(VLOOKUP(s,'" + CFG.REF_SHEET + "'!A:C,3,FALSE),\"\"))))",
    annVol: perName(net('F', yS, yE)),
    annAmt: perName(net('G', yS, yE)),
    annCnt: perName('COUNTIFS(' + O + 'B:B,n,' + O + 'D:D,"خرید"' + period(yS, yE) + ')'),
    qVol: perName(net('F', qS, qE)),
    volBCD: perName(net('F', yS, yE, ',' + O + 'E:E,"BCD*"')),
    volBCW: perName(net('F', yS, yE, ',' + O + 'E:E,"BCW*"')),
    volBCP: perName(net('F', yS, yE, ',' + O + 'E:E,"BCP*"')),
    thr: '=MAP(' + N + '2:' + N + ',' + L('annVol') + '2:' + L('annVol') + ',' + L('annCnt') + '2:' + L('annCnt') +
      ',LAMBDA(n,v,c,IF(n="","",IF(v>=' + S + '$B$1,IF(c>' + S + '$B$2,"✅ تعهد حجمی واقعی",' +
      '"⚠️ خرید یک‌باره حجیم — نیازمند پیگیری تکرار"),"زیر آستانه"))))',
    coll: perName('IFS(COUNTIFS(' + O + 'B:B,n,' + O + 'K:K,4)>0,"نکول",COUNTIFS(' + O + 'B:B,n,' + O + 'K:K,3)>0,"معوق",' +
      'COUNTIFS(' + O + 'B:B,n,' + O + 'K:K,1)>0,"در جریان",TRUE,"بدون مطالبه باز")')
  };
  var rows = main.getMaxRows() - 1;
  Object.keys(f).forEach(function (k) {
    main.getRange(2, map[k], rows, 1).clearContent();
    // فرمول در ردیف عنوان: {"عنوان"; MAP(...)} — حذف ردیف ۲ یا مرتب‌سازی، فرمول را از بین نمی‌برد
    main.getRange(1, map[k]).setFormula('={"' + fieldHeader_(k) + '";' + f[k].replace(/^=/, '') + '}')
      .setBackground('#eef2f6').setFontWeight('bold');
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

// بازه‌های سال/فصل شمسی — در setup، هر بار خواندن داده، و روزانه به‌روز می‌شود
// خروجی: true اگر مقادیر تغییر کردند (برای تصمیم‌گیری درباره flush)
function refreshPeriods_(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CFG.SETTINGS_SHEET);
  if (!sh) return false;
  var t = todayYMD_(ss.getSpreadsheetTimeZone());
  var j = toJalaali_(t.y, t.m, t.d);
  var q = Math.floor((j.jm - 1) / 3);
  var g = function (y, m, d) { var x = toGregorian_(y, m, d); return serialFromYMD_(x.gy, x.gm, x.gd); };
  var vals = [
    [g(j.jy, 1, 1)], [g(j.jy + 1, 1, 1)],
    [g(j.jy, q * 3 + 1, 1)], [q === 3 ? g(j.jy + 1, 1, 1) : g(j.jy, q * 3 + 4, 1)],
    [j.jy + ' — فصل ' + (q + 1)]
  ];
  var cur = sh.getRange('B7').getValue();
  if (String(cur) !== vals[4][0]) { sh.getRange('B3:B7').setValues(vals); return true; }
  return false;
}
function dailyRefresh() { refreshPeriods_(SpreadsheetApp.getActive()); }
function ensureDailyTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyRefresh'; });
  if (!exists) ScriptApp.newTrigger('dailyRefresh').timeBased().everyDays(1).atHour(0).create();
}

// ============================================================
// 7) منو، onEdit، تابع سفارشی JALALI
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('FeelHeal')
    .addItem('بررسی ساختار (بدون تغییر)', 'checkSchema')
    .addItem('راه‌اندازی / ترمیم ساختار', 'setup')
    .addItem('به‌روزرسانی سال/فصل جاری', 'dailyRefresh')
    .addToUi();
}

// تاریخ تایپ‌شده در ستون‌های تاریخ تب سفارش‌ها → میلادی
function onEdit(e) {
  try {
    var rng = e.range, sh = rng.getSheet();
    if (rng.getRow() < 2) return;
    var cols;
    if (sh.getName() === CFG.ORDERS_SHEET) cols = ORDER_DATE_COLS;
    else {
      if ([CFG.SETTINGS_SHEET, CFG.REF_SHEET].indexOf(sh.getName()) >= 0) return;
      var mp = headerMap_(sh);
      if (!mp.name || !mp.stageDate || !mp.nextDate) return;   // تب اصلی نیست
      cols = [mp.stageDate, mp.nextDate];
    }
    var c0 = rng.getColumn(), c1 = c0 + rng.getNumColumns() - 1;
    cols.forEach(function (c) {
      if (c < c0 || c > c1) return;
      var sub = sh.getRange(rng.getRow(), c, rng.getNumRows(), 1);
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
  } catch (err) { /* simple trigger: بی‌صدا */ }
}

/**
 * تبدیل تاریخ میلادی به شمسی برای نمایش.
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
// 8) Web App — فاز ۲
// ============================================================
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('FeelHeal — پیگیری فروش')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function ctx_() {
  var ss = SpreadsheetApp.getActive();
  var main = findMainSheet_(ss);
  if (!main) throw new Error('تب اصلی پیدا نشد.');
  var map = headerMap_(main);
  var need = MAIN_FIELDS.filter(function (f) { return !map[f[0]]; });
  if (need.length || !ss.getSheetByName(CFG.ORDERS_SHEET)) throw new Error('ساختار ناقص است — ابتدا setup را از منوی FeelHeal اجرا کنید.');
  return { ss: ss, main: main, map: map, tz: ss.getSpreadsheetTimeZone() };
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

// خروجی به‌صورت رشته‌ی JSON برگردانده می‌شود: google.script.run هر شیء دارای مقدار غیرقابل‌انتقال (مثل Date) را بی‌صدا null می‌کند
function getData() { return JSON.stringify(getData_()); }

function getData_() {
  var c = ctx_();
  // flush فقط وقتی بازه‌های سال/فصل تازه عوض شده‌اند (فرمول‌ها باید دوباره محاسبه شوند)
  if (refreshPeriods_(c.ss)) SpreadsheetApp.flush();

  // سرعت: فقط تا آخرین ردیف واقعی می‌خوانیم؛ فرمول‌های آرایه‌ای ردیف عنوان، getDataRange را تا انتهای شیت می‌کشند
  var lastMain = lastDataRow_(c.main, c.map.name);
  var vals = lastMain >= 2 ? c.main.getRange(1, 1, lastMain, c.main.getLastColumn()).getValues() : [[]];
  var customers = [];
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    var name = String(row[c.map.name - 1]).trim();
    if (!name) continue;
    var o = { row: r + 1 };
    MAIN_FIELDS.forEach(function (f) {
      var v = row[c.map[f[0]] - 1];
      o[f[0]] = v instanceof Date ? isoOf_(v, c.tz) : (v == null ? '' : v);
    });
    o.name = name;
    o.notes = parseNotes_(row[c.map.notes - 1]);
    customers.push(o);
  }
  var osh = c.ss.getSheetByName(CFG.ORDERS_SHEET);
  // ۱۳ ستون (A..M): کد سفارش، نام، تاریخ، نوع، SKU، واحد، مبلغ، سررسید، پرداخت، نکول، وضعیت، چندمین سفارش، تاریخ سفارش قبلی
  var lastOrd = lastDataRow_(osh, 2);
  var ov = lastOrd >= 2 ? osh.getRange(2, 1, lastOrd - 1, 13).getValues() : [];
  var orders = ov.filter(function (x) { return String(x[1]).trim(); }).map(function (x) {
    return { id: String(x[0]).trim(), name: String(x[1]).trim(), date: isoOf_(x[2], c.tz), type: x[3], sku: x[4], units: x[5], amount: x[6],
             due: isoOf_(x[7], c.tz), paid: isoOf_(x[8], c.tz), status: x[10], nth: x[11] };
  });
  var st = c.ss.getSheetByName(CFG.SETTINGS_SHEET);
  // ستون فرمولی خراب؟ (مثلاً کسی داخل ستون فرمولی تایپ کرده → #REF!)
  var hdrShown = vals[0];
  var broken = MAIN_FIELDS.filter(function (f) { return f[2] === 'formula' && hdrShown[c.map[f[0]] - 1] !== f[1]; })
    .map(function (f) { return f[1]; });
  var oHdr = osh.getRange(1, 1, 1, ORDER_HEADERS.length).getDisplayValues()[0];
  ORDER_FORMULA_COLS_1IDX.forEach(function (oc1) {
    if (oHdr[oc1 - 1] !== ORDER_HEADERS[oc1 - 1]) broken.push('سفارش‌ها: ' + ORDER_HEADERS[oc1 - 1]);
  });
  // فهرست SKU از تب تنظیمات (ستون D)؛ اگر خالی بود از CFG
  var skuRows = st.getRange(2, 4, Math.max(st.getLastRow() - 1, 1), 1).getValues()
    .map(function (x) { return String(x[0]).trim(); }).filter(Boolean);
  return {
    broken: broken,
    customers: customers,
    orders: orders,
    ref: refTable_(c.ss),
    settings: { threshold: st.getRange('B1').getValue(), minOrders: st.getRange('B2').getValue(), period: st.getRange('B7').getValue() },
    meta: {
      channels: CFG.CHANNELS, sources: CFG.SOURCES,
      orderTypes: CFG.ORDER_TYPES,
      skus: skuRows.length ? skuRows : CFG.SKUS,
      customerNames: customers.map(function (x) { return x.name; }),
      ordersUrl: c.ss.getUrl() + '#gid=' + osh.getSheetId(),
      today: Utilities.formatDate(new Date(), c.tz, 'yyyy-MM-dd')
    }
  };
}

/**
 * rec: {row?, originalName?, name, channel, city, contact, phone, source, stage, nextDate(ISO)?, newNote?}
 * row خالی = مشتری جدید. فیلدهای ارسال‌نشده دست نمی‌خورند.
 */
function saveRecord(rec) {
  var lock = LockService.getDocumentLock(); lock.waitLock(20000);
  try {
    var c = ctx_(), sh = c.main, map = c.map;
    var ref = refTable_(c.ss);
    var today = Utilities.formatDate(new Date(), c.tz, 'yyyy-MM-dd');
    var lastRow = lastDataRow_(sh, map.name);
    var names = lastRow >= 2 ? sh.getRange(2, map.name, lastRow - 1, 1).getValues().map(function (x) { return String(x[0]).trim(); }) : [];

    var row = null, cur = {};
    if (rec.row) {
      row = Number(rec.row);
      if (names[row - 2] !== String(rec.originalName || '').trim()) {
        var idx = names.indexOf(String(rec.originalName || '').trim());
        if (idx < 0) throw new Error('رکورد پیدا نشد — صفحه را تازه کنید.');
        row = idx + 2;
      }
      var rv = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
      MAIN_FIELDS.forEach(function (f) { cur[f[0]] = rv[map[f[0]] - 1]; });
    }

    var name = rec.name !== undefined ? String(rec.name).trim() : String(cur.name || '').trim();
    if (!name) throw new Error('نام مرکز/پزشک الزامی است.');
    if (badName_(name)) throw new Error('نام نباید شامل * ? ~ باشد یا با = < > شروع شود (جمع‌های تب سفارش‌ها را خراب می‌کند).');
    var dup = names.some(function (n, i) { return norm_(n) === norm_(name) && (i + 2) !== row; });
    if (dup) throw new Error('مشتری دیگری با همین نام وجود دارد.');
    var channel = rec.channel !== undefined ? rec.channel : cur.channel;
    if (CFG.CHANNELS.indexOf(channel) < 0) throw new Error('«نوع کانال خریدار» را انتخاب کنید.');

    var w = {};
    ['city', 'contact', 'phone', 'source'].forEach(function (k) { if (rec[k] !== undefined) w[k] = String(rec[k]).trim(); });
    w.name = name; w.channel = channel;

    var oldStage = row ? String(cur.stage || '').trim() : '';
    var stage = rec.stage !== undefined && rec.stage !== '' ? rec.stage : (oldStage || ref[0].stage);
    var stageChanged = !row || stage !== oldStage;
    w.stage = stage;
    var refRow = ref.filter(function (x) { return x.stage === stage; })[0] || { days: 7 };
    if (stageChanged) {
      w.stageDate = serialFromIso_(today);
      if (row && stage === CFG.REPEAT_STAGE) w.purchases = (Number(cur.purchases) || 0) + 1;
    }
    if (!row) w.purchases = stage === CFG.REPEAT_STAGE ? 1 : 0;
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

    if (!row) {
      row = lastRow + 1;
      if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
    }
    Object.keys(w).forEach(function (k) {
      var cell = sh.getRange(row, map[k]);
      if (k === 'stageDate' || k === 'nextDate') cell.setNumberFormat(DATE_FMT);
      cell.setValue(w[k]);
    });

    // تغییر نام → اصلاح نام در سفارش‌ها
    var oldName = String(cur.name || '').trim();
    if (oldName && oldName !== name) renameInOrders_(c.ss, oldName, name);
  } finally {
    lock.releaseLock();
  }
  return getData();
}

/**
 * ثبت یک سفارش در تب سفارش‌ها (ستون‌های ورودی B..J؛ A و K..Q فرمولی‌اند و دست نمی‌خورند).
 * rec: {name, type, sku, units, amount, date(ISO), due(ISO)?, paid(ISO)?, defaulted}
 */
function saveOrder(rec) {
  var lock = LockService.getDocumentLock(); lock.waitLock(20000);
  try {
    var c = ctx_(), osh = c.ss.getSheetByName(CFG.ORDERS_SHEET);
    var name = String(rec.name || '').trim();
    if (!name) throw new Error('مشتری را انتخاب کنید.');
    var lastMain = lastDataRow_(c.main, c.map.name);
    var names = lastMain >= 2 ? c.main.getRange(2, c.map.name, lastMain - 1, 1).getValues().map(function (x) { return String(x[0]).trim(); }) : [];
    if (names.indexOf(name) < 0) throw new Error('مشتری در تب اصلی پیدا نشد — صفحه را تازه کنید.');
    if (CFG.ORDER_TYPES.indexOf(rec.type) < 0) throw new Error('نوع خرید نامعتبر است.');
    var units = Number(rec.units);
    if (!(units > 0)) throw new Error('تعداد واحد باید بزرگ‌تر از صفر باشد.');
    var amount = Number(rec.amount) || 0;
    if (amount < 0) throw new Error('ارزش سفارش نمی‌تواند منفی باشد.');
    var today = Utilities.formatDate(new Date(), c.tz, 'yyyy-MM-dd');
    var ds = serialFromIso_(rec.date || today);
    if (ds === null) throw new Error('تاریخ سفارش نامعتبر است.');
    var due = rec.due ? serialFromIso_(rec.due) : '';
    var paid = rec.paid ? serialFromIso_(rec.paid) : '';
    if (due === null || paid === null) throw new Error('تاریخ سررسید/پرداخت نامعتبر است.');

    var row = lastDataRow_(osh, 2) + 1;
    if (row > osh.getMaxRows()) osh.insertRowsAfter(osh.getMaxRows(), 1);
    // B..J = نام، تاریخ، نوع، SKU، واحد، مبلغ، سررسید، پرداخت، نکول
    var rng = osh.getRange(row, 2, 1, 9);
    rng.setValues([[name, ds, rec.type, String(rec.sku || ''), units, amount, due, paid, !!rec.defaulted]]);
    [3, 8, 9].forEach(function (col) { osh.getRange(row, col).setNumberFormat(DATE_FMT); });
  } finally {
    lock.releaseLock();
  }
  return getData();
}

function renameInOrders_(ss, oldName, newName) {
  var osh = ss.getSheetByName(CFG.ORDERS_SHEET);
  var lr = osh.getLastRow();
  if (lr < 2) return;
  var rng = osh.getRange(2, 2, lr - 1, 1), v = rng.getValues(), hit = false; // ستون B = نام مشتری
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === oldName) { v[i][0] = newName; hit = true; }
  if (hit) rng.setValues(v);
}

function deleteRecord(row, name) {
  var lock = LockService.getDocumentLock(); lock.waitLock(20000);
  try {
    var c = ctx_();
    name = String(name || '').trim();
    var lastRow = lastDataRow_(c.main, c.map.name);
    var names = c.main.getRange(2, c.map.name, Math.max(lastRow - 1, 1), 1).getValues().map(function (x) { return String(x[0]).trim(); });
    var r = names[row - 2] === name ? row : names.indexOf(name) + 2;
    if (r < 2) throw new Error('رکورد پیدا نشد — صفحه را تازه کنید.');
    var osh = c.ss.getSheetByName(CFG.ORDERS_SHEET);
    var has = osh.getLastRow() > 1 && osh.getRange(2, 2, osh.getLastRow() - 1, 1).getValues() // ستون B = نام مشتری
      .some(function (x) { return String(x[0]).trim() === name; });
    if (has) throw new Error('این مشتری سفارش ثبت‌شده دارد؛ حذف او سفارش‌ها را بی‌صاحب می‌کند. به‌جای حذف، مرحله را «غیرفعال/از دست رفته» کنید.');
    c.main.deleteRow(r);
  } finally {
    lock.releaseLock();
  }
  return getData();
}
