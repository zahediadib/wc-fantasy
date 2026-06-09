/* Persian number formatting + general format helpers */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export function toFaDigits(n) {
  return String(n).replace(/\d/g, (d) => FA_DIGITS[+d]);
}

export function fmtCoins(n) {
  if (n === null || n === undefined || Number.isNaN(+n)) return "—";
  const v = Number(n);
  const fixed = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
  return toFaDigits(fixed.replace(/\.0$/, ""));
}

export function fmtSigned(n) {
  const v = Number(n);
  if (v > 0) return "+" + fmtCoins(v);
  return fmtCoins(v);
}

export const STAGE_LABEL = {
  group: "مرحله گروهی",
  r32: "یک‌شانزدهم نهایی",
  r16: "یک‌هشتم نهایی",
  qf: "یک‌چهارم نهایی",
  sf: "نیمه‌نهایی",
  third: "رده‌بندی",
  final: "فینال",
};

export const TIER_COLOR = {
  1: "from-red-600 to-rose-500 text-white",       // تایر ۱: قرمز (قدرت مطلق / درجه یک)
  2: "from-orange-500 to-amber-500 text-black",   // تایر ۲: نارنجی (بسیار قوی)
  3: "from-yellow-400 to-lime-400 text-black",    // تایر ۳: زرد (متوسط رو به بالا)
  4: "from-emerald-500 to-green-400 text-black",  // تایر ۴: سبز (متوسط و عادی)
  5: "from-sky-500 to-blue-500 text-white",       // تایر ۵: آبی (ضعیف)
  6: "from-slate-500 to-zinc-400 text-white",     // تایر ۶: خاکستری (خیلی ضعیف / سطح صفر)
};

export function flagUrl(code, w = 80) {
  // return `https://flagcdn.com/w${w}/${code}.png`;
  return `https://flagicons.lipis.dev/flags/4x3/${code}.svg`

}

export function avatarUrl(seed) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed || "x")}`;
}
