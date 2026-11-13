// The maths behind the Insights page: time buckets for charts, this month's spending pace, where income
// went, spending by weekday, the balance over time, and the facts the plain-English insights are built from.

import { balance, inRange, monthKey, paidFromPot, rangeSpan, spendByCategory, spendPerDay, totals } from './calc.js';
import { addDays, dateInMonth, dayOf, dayOfWeek, daysBetween, daysInMonth, formatDay, formatMonth, formatMonthShort, formatShortDate, monthOf, monthRange } from './dates.js';
import { setAsideIn } from './pots.js';

// Splits a stretch of days into chart buckets: days for up to a month, weeks (Monday to Sunday) for up to
// about six months, months beyond that. Each bucket: { from, to, label, longLabel, month? }.
export function timeBuckets(span) {
  const days = daysBetween(span.from, span.to) + 1;
  const buckets = [];
  if (days <= 0) return { size: 'day', buckets };
  if (days <= 31) {
    for (let d = span.from; d <= span.to; d = addDays(d, 1)) buckets.push({ from: d, to: d, label: String(dayOf(d)), longLabel: formatDay(d) });
    return { size: 'day', buckets };
  }
  if (days <= 183) {
    for (let from = span.from; from <= span.to;) {
      const sunday = addDays(from, 6 - dayOfWeek(from));
      const to = sunday < span.to ? sunday : span.to;
      buckets.push({ from, to, label: formatShortDate(from), longLabel: from === to ? formatDay(from) : `${formatShortDate(from)} – ${formatShortDate(to)}` });
      from = addDays(to, 1);
    }
    return { size: 'week', buckets };
  }
  for (const month of monthRange(monthOf(span.from), monthOf(span.to))) {
    const first = `${month}-01`;
    const last = dateInMonth(month, 31);
    buckets.push({ from: first < span.from ? span.from : first, to: last > span.to ? span.to : last, label: formatMonthShort(month), longLabel: formatMonth(month), month });
  }
  return { size: 'month', buckets };
}

// Income and spending per bucket for the entries of a time frame. Monthly buckets go by the month an entry
// counts in; an entry outside every bucket (pay that counts in this month but arrived just before it)
// goes in the nearest one.
export function flowSeries(transactions, span) {
  const { size, buckets } = timeBuckets(span);
  const rows = buckets.map((b) => ({ ...b, income: 0, expense: 0 }));
  if (!rows.length) return { size, rows };
  for (const t of transactions) {
    if (typeof t.date !== 'string') continue;
    let index;
    if (size === 'month') {
      const key = monthKey(t);
      index = rows.findIndex((r) => r.month === key);
      if (index < 0) index = key < rows[0].month ? 0 : rows.length - 1;
    } else {
      index = rows.findIndex((r) => t.date <= r.to);
      if (index < 0) index = rows.length - 1;
    }
    rows[index][t.kind === 'income' ? 'income' : 'expense'] += t.amount;
  }
  return { size, rows };
}

// This month's spending from spending money, day by day, against an even pace for what the month can
// afford (what's been spent plus the spending money still there).
//   cumulative: spent by the end of each day so far.   even: the even pace for every day of the month.
//   runOut: about when spending money runs out at the day-to-day pace so far (bills left out, since they
//           come in lumps), or null when it lasts the month.
export function pace(state, today) {
  const month = monthOf(today);
  const days = daysInMonth(month);
  const dayNumber = dayOf(today);
  const d = spendPerDay(state, today);
  const fromPot = paidFromPot(state);
  const own = state.transactions.filter((t) => t.kind !== 'income' && typeof t.date === 'string' && t.date.startsWith(month) && t.date <= today && !fromPot(t));
  const byDay = new Array(dayNumber).fill(0);
  for (const t of own) byDay[dayOf(t.date) - 1] += t.amount;
  const cumulative = [];
  byDay.reduce((sum, value, i) => (cumulative[i] = sum + value), 0);
  const spent = cumulative[dayNumber - 1] ?? 0;
  const affordable = spent + Math.max(0, d.spending);
  const even = Array.from({ length: days }, (_, i) => Math.round((affordable * (i + 1)) / days));
  const everyday = own.filter((t) => !t.recurringId).reduce((sum, t) => sum + t.amount, 0);
  const perDay = everyday / dayNumber;
  const lastDay = dateInMonth(month, 31);
  let runOut = null;
  if (d.free <= 0) runOut = spent > 0 || d.reserved > 0 ? today : null;
  else if (perDay > 0) {
    const date = addDays(today, Math.floor(d.free / perDay));
    if (date < lastDay) runOut = date;
  }
  return { month, days, dayNumber, cumulative, even, spent, affordable, perDay: Math.round(perDay), free: d.free, runOut, ahead: spent - even[dayNumber - 1] };
}

// Where the income of a time frame went: spent from spending money, set aside (net of anything taken back
// out), and kept. `kept` is negative when more went out than came in. Spending paid from set-asides is
// reported separately, because that money was set aside earlier.
export function incomeUse(state, range) {
  const list = inRange(state.transactions, range);
  const sums = totals(list);
  const fromPot = paidFromPot(state);
  const fromPots = list.filter(fromPot).reduce((sum, t) => sum + t.amount, 0);
  const spent = sums.expense - fromPots;
  const setAside = setAsideIn(state, range).total;
  return { income: sums.income, spent, fromPots, setAside, kept: sums.income - spent - setAside };
}

// Average spending for each day of the week (Monday first) over the days of a stretch that have happened.
export function weekdaySpend(transactions, span, today) {
  const to = span.to < today ? span.to : today;
  const rows = Array.from({ length: 7 }, (_, day) => ({ day, total: 0, count: 0, average: 0 }));
  if (span.from > to) return rows;
  const whole = Math.floor((daysBetween(span.from, to) + 1) / 7);
  for (const row of rows) row.count = whole;
  for (let d = addDays(span.from, whole * 7); d <= to; d = addDays(d, 1)) rows[dayOfWeek(d)].count += 1;
  for (const t of transactions) {
    if (t.kind !== 'income' && typeof t.date === 'string' && t.date >= span.from && t.date <= to) rows[dayOfWeek(t.date)].total += t.amount;
  }
  for (const row of rows) row.average = row.count ? Math.round(row.total / row.count) : 0;
  return rows;
}

// Total balance and set-aside money at the end of each bucket of a stretch, up to today.
export function balanceSeries(state, span, today) {
  const to = span.to < today ? span.to : today;
  if (span.from > to) return [];
  return timeBuckets({ from: span.from, to }).buckets.map((b) => ({ ...b, ...balance(state, b.to) }));
}

// The numbers the plain-English insights are written from, for a time frame and the stretch before it.
export function facts(state, range, previous, today) {
  const span = rangeSpan(range, state, today);
  const list = inRange(state.transactions, range);
  const expenses = list.filter((t) => t.kind !== 'income');
  const sums = totals(list);
  const byCategory = [...spendByCategory(list)].sort((a, b) => b[1] - a[1]);
  const before = previous ? spendByCategory(inRange(state.transactions, previous)) : null;
  const top = byCategory.length ? { id: byCategory[0][0], value: byCategory[0][1], previous: before ? before.get(byCategory[0][0]) ?? 0 : null } : null;
  let rise = null;
  if (before) {
    for (const [id, value] of byCategory) {
      const change = value - (before.get(id) ?? 0);
      if (change > 0 && (!rise || change > rise.change)) rise = { id, value, previous: before.get(id) ?? 0, change };
    }
  }
  const biggest = expenses.reduce((max, t) => (!max || t.amount > max.amount ? t : max), null);
  const to = span.to < today ? span.to : today;
  const daysElapsed = span.from <= to ? daysBetween(span.from, to) + 1 : 0;
  const spendDays = new Set(expenses.filter((t) => t.date >= span.from && t.date <= to).map((t) => t.date));
  return {
    span,
    sums,
    use: incomeUse(state, range),
    top,
    rise,
    biggest,
    daysElapsed,
    avgPerDay: daysElapsed ? Math.round(sums.expense / daysElapsed) : 0,
    noSpendDays: Math.max(0, daysElapsed - spendDays.size),
    previousExpense: previous ? totals(inRange(state.transactions, previous)).expense : null,
  };
}
