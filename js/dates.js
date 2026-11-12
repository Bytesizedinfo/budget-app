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

export function addDays(iso, n) {
  const d = toDate(iso);
  d.setDate(d.getDate() + n);
  return todayISO(d);
}

export const daysBetween = (from, to) => Math.round((toDate(to) - toDate(from)) / 86400000);

// The time frames transactions and totals can be looked at for. A whole-month choice carries `month`, so pay
// marked for that month counts in it; any other range goes by the date each entry happened.
export const TIMEFRAMES = [
  ['today', 'Today'], ['week', 'This week'], ['last7', 'Last 7 days'], ['last30', 'Last 30 days'],
  ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year'], ['all', 'All time'], ['custom', 'Custom dates'],
];

export function timeframe(choice, today, custom = {}) {
  const wholeMonth = (month) => ({ choice, from: `${month}-01`, to: dateInMonth(month, 31), month, label: formatMonth(month) });
  switch (choice) {
    case 'today': return { choice, from: today, to: today, label: 'Today' };
    case 'week': {
      const from = addDays(today, -dayOfWeek(today));
      return { choice, from, to: addDays(from, 6), label: 'This week' };
    }
    case 'last7': return { choice, from: addDays(today, -6), to: today, label: 'Last 7 days' };
    case 'last30': return { choice, from: addDays(today, -29), to: today, label: 'Last 30 days' };
    case 'lastmonth': return wholeMonth(addMonths(monthOf(today), -1));
    case 'year': {
      const year = today.slice(0, 4);
      return { choice, from: `${year}-01-01`, to: `${year}-12-31`, label: year };
    }
    case 'all': return { choice, from: '0000-01-01', to: '9999-12-31', label: 'All time' };
    case 'custom': {
      let from = isValidDate(custom.from) ? custom.from : addDays(today, -29);
      let to = isValidDate(custom.to) ? custom.to : today;
      if (from > to) [from, to] = [to, from];
      return { choice, from, to, label: `${formatShortDate(from)} – ${formatDate(to)}` };
    }
    default: return wholeMonth(monthOf(today));
  }
}

// The stretch just before, of the same length: the month before a month, the year before a year. None for all time.
export function previousTimeframe(range) {
  if (range.choice === 'all') return null;
  if (range.month) {
    const month = addMonths(range.month, -1);
    return { choice: 'month', from: `${month}-01`, to: dateInMonth(month, 31), month, label: formatMonthShort(month) };
  }
  if (range.choice === 'year') {
    const year = String(Number(range.from.slice(0, 4)) - 1);
    return { choice: 'year', from: `${year}-01-01`, to: `${year}-12-31`, label: year };
  }
  const days = daysBetween(range.from, range.to) + 1;
  const label = range.choice === 'today' ? 'yesterday' : range.choice === 'week' ? 'last week' : `the ${days} days before`;
  return { choice: 'custom', from: addDays(range.from, -days), to: addDays(range.from, -1), label };
}

// How a time frame reads in a sentence, with its dates when the name alone doesn't say them.
export function timeframeText(range) {
  if (range.choice === 'all' || range.month || range.choice === 'year' || range.choice === 'custom') return range.label;
  if (range.choice === 'today') return `today, ${formatDate(range.from)}`;
  return `${range.label.toLowerCase()} (${formatShortDate(range.from)} – ${formatDate(range.to)})`;
}
