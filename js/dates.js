// Dates are plain "YYYY-MM-DD" strings and months are "YYYY-MM", always in local time,
// so they sort as text and never shift across time zones.

const pad = (n) => String(n).padStart(2, '0');
const parts = (iso) => iso.split('-').map(Number);
const MONTH = /^\d{4}-\d{2}$/;

export function todayISO(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const monthOf = (iso) => iso.slice(0, 7);
export const dayOf = (iso) => Number(iso.slice(8, 10));

export function addMonths(month, n) {
  const [y, m] = parts(month);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

export function daysInMonth(month) {
  const [y, m] = parts(month);
  return new Date(y, m, 0).getDate();
}

// Day 31 in a 30-day month (or February) becomes that month's last day.
export function dateInMonth(month, day) {
  return `${month}-${pad(Math.min(day, daysInMonth(month)))}`;
}

export function monthRange(from, to) {
  if (!MONTH.test(from) || !MONTH.test(to)) return [];
  const months = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) months.push(m);
  return months;
}

export function isValidDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [, m, d] = parts(iso);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(iso.slice(0, 7));
}

const toDate = (iso) => {
  const [y, m, d = 1] = parts(iso);
  return new Date(y, m - 1, d);
};

// Monday = 0 … Sunday = 6.
export const dayOfWeek = (iso) => (toDate(iso).getDay() + 6) % 7;

const formats = new Map();
function format(iso, options) {
  const key = JSON.stringify(options);
  if (!formats.has(key)) formats.set(key, new Intl.DateTimeFormat(undefined, options));
  return formats.get(key).format(toDate(iso));
}

export const formatMonth = (month) => format(month, { month: 'long', year: 'numeric' });
export const formatMonthShort = (month) => format(month, { month: 'short' });
export const formatMonthName = (month) => format(month, { month: 'long' });
export const formatDay = (iso) => format(iso, { weekday: 'short', day: 'numeric', month: 'short' });
export const formatShortDate = (iso) => format(iso, { day: 'numeric', month: 'short' });
export const formatDate = (iso) => format(iso, { day: 'numeric', month: 'short', year: 'numeric' });

export function ordinal(n) {
  const suffix = { one: 'st', two: 'nd', few: 'rd', other: 'th' }[new Intl.PluralRules('en', { type: 'ordinal' }).select(n)];
  return `${n}${suffix}`;
}
