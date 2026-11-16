// Payments that are planned ahead: recurring ones (rent, subscriptions, salary) and one-off planned ones.
// Nothing is recorded automatically. Each occurrence waits to be confirmed on its date: marking it paid saves a
// transaction under the occurrence's fixed id, and skipping it leaves a tombstone under that id. Because the id
// is fixed, two devices can never record the same occurrence twice, and a skipped one stays skipped.

import { addDays, addMonths, dateInMonth, dayOf, monthOf } from './dates.js';

export const occurrenceId = (ruleId, key) => `r_${ruleId}_${key}`;

// After a pause (or a change of schedule), occurrences restart from the day the rule was resumed.
const activeFrom = (rule) => (rule.resumeDate && rule.resumeDate > rule.startDate ? rule.resumeDate : rule.startDate);

export const UNITS = ['day', 'week', 'month', 'year'];

// How a payment repeats: { type: 'once' }, { type: 'twice', days: [d1, d2] } (two days of each month; 31 means
// the last day) or { type: 'every', every: N, unit }. A rule saved before repeats existed is monthly.
export function repeatOf(rule) {
  const r = rule.repeat;
  if (r === 'once') return { type: 'once' };
  if (r && Array.isArray(r.twice) && r.twice.length === 2) {
    const days = r.twice.map((d) => Math.min(31, Math.max(1, Math.round(Number(d) || 1)))).sort((a, b) => a - b);
    return { type: 'twice', days };
  }
  if (r && UNITS.includes(r.unit)) return { type: 'every', every: Math.max(1, Math.round(Number(r.every) || 1)), unit: r.unit };
  return { type: 'every', every: 1, unit: 'month' };
}

// Dates every N days, weeks, months or years from a start date, without end. A day a month doesn't have
// (the 31st, or 29 February) becomes that month's last day.
export function* stepDates(start, every, unit) {
  if (unit === 'day' || unit === 'week') {
    const step = every * (unit === 'week' ? 7 : 1);
    for (let date = start; ; date = addDays(date, step)) yield date;
  }
  const months = unit === 'year' ? 12 * every : every;
  for (let month = monthOf(start); ; month = addMonths(month, months)) yield dateInMonth(month, dayOf(start));
}

// Where the schedule alone puts each occurrence, from the first date on, without end (except "once").
// The key names the occurrence: the month for monthly rules (as before repeats existed), the year for yearly
// ones, the date for daily and weekly ones.
function* schedule(rule) {
  const start = rule.startDate;
  const rep = repeatOf(rule);
  if (rep.type === 'once') {
    yield { key: 'once', due: start };
    return;
  }
  if (rep.type === 'twice') {
    for (let month = monthOf(start); ; month = addMonths(month, 1)) {
      const dates = [...new Set(rep.days.map((d) => dateInMonth(month, d)))];
      for (const [i, due] of dates.entries()) if (due >= start) yield { key: `${month}_${i + 1}`, due };
    }
  }
  for (const due of stepDates(start, rep.every, rep.unit)) {
    yield { key: rep.unit === 'month' ? monthOf(due) : rep.unit === 'year' ? due.slice(0, 4) : due, due };
  }
}

// The schedule's dates up to a day, leaving out anything before the rule started (or was resumed), after its
// last date, or while it's paused. Takes no account of what has been paid or skipped.
function* scheduled(rule, to) {
  if (rule.paused || !rule.startDate) return;
  const from = activeFrom(rule);
  for (const o of schedule(rule)) {
    if (o.due > to || (rule.endDate && o.due > rule.endDate)) return;
    if (o.due >= from) yield o;
  }
}

// The date this rule's schedule puts an occurrence in the given month, or null.
export function occurrenceIn(rule, month) {
  for (const o of scheduled(rule, dateInMonth(month, 31))) if (monthOf(o.due) === month) return o.due;
  return null;
}

// The next date after today on the rule's schedule, or null if there is none.
export function nextDate(rule, today) {
  for (const o of scheduled(rule, '9999-12-31')) if (o.due > today) return o.due;
  return null;
}

// The ids of every transaction, remembered for a list until it changes length.
const idCache = new WeakMap();
function transactionIds(state) {
  let entry = idCache.get(state.transactions);
  if (!entry || entry.length !== state.transactions.length) {
    entry = { length: state.transactions.length, ids: new Set(state.transactions.map((t) => t.id)) };
    idCache.set(state.transactions, entry);
  }
  return entry.ids;
}

// How many of a rule's occurrences have been settled (paid or skipped).
export function settledCount(state, rule) {
  const prefix = `r_${rule.id}_`;
  let paid = 0;
  let skipped = 0;
  for (const id of transactionIds(state)) if (id.startsWith(prefix)) paid += 1;
  for (const id of Object.keys(state.deleted)) if (id.startsWith(prefix)) skipped += 1;
  return { paid, skipped };
}

// Every occurrence of a payment in schedule order, with what has happened to it:
//   status: 'paid' (its transaction exists), 'skipped' (it was skipped or deleted) or 'open' (waiting, or to come).
//   due: where the schedule put it.   date: where it is now, after any postponing.
//   amount: the payment's amount, or this occurrence's own (`amounts` on the rule), while it's open.
// Open occurrences stop at the rule's last date, after "ends after N times" is used up, and while it's paused.
// Stops at the first one the schedule puts after `to`.
function* walk(state, rule, to) {
  if (!rule.startDate) return;
  const ids = transactionIds(state);
  const from = activeFrom(rule);
  let allowed = Infinity;
  if (rule.endAfter > 0) {
    const { paid, skipped } = settledCount(state, rule);
    allowed = rule.endAfter - paid - skipped;
  }
  for (const o of schedule(rule)) {
    if (o.due > to || (rule.endDate && o.due > rule.endDate)) return;
    const id = occurrenceId(rule.id, o.key);
    const status = ids.has(id) ? 'paid' : id in state.deleted ? 'skipped' : 'open';
    if (status === 'open') {
      if (allowed <= 0) return;
      if (o.due < from || rule.paused) continue;
      allowed -= 1;
    }
    const moved = rule.moved?.[o.key];
    const own = rule.amounts?.[o.key];
    yield {
      rule, key: o.key, id, due: o.due, status,
      date: status === 'open' && typeof moved === 'string' ? moved : o.due,
      amount: status === 'open' && Number.isSafeInteger(own) && own > 0 ? own : rule.amount,
    };
  }
}

// A payment's occurrences that fall on or before a day.
export function occurrences(state, rule, to) {
  const out = [];
  for (const o of walk(state, rule, to)) if (o.date <= to) out.push(o);
  return out;
}

// The first occurrence still open after a day (looking up to about ten years ahead), or null.
export function nextOpen(state, rule, after) {
  for (const o of walk(state, rule, addDays(after, 3700))) if (o.status === 'open' && o.date > after) return o;
  return null;
}

const byDate = (a, b) => a.date.localeCompare(b.date) || a.rule.name.localeCompare(b.rule.name);

// Every open occurrence of every payment up to a day (and from a day, if given), soonest first.
export function openOccurrences(state, to, from = null) {
  const out = [];
  for (const rule of state.recurring) {
    for (const o of occurrences(state, rule, to)) if (o.status === 'open' && (!from || o.date >= from)) out.push(o);
  }
  return out.sort(byDate);
}

// Occurrences whose date has come and that are waiting to be confirmed, oldest first.
export function dueList(state, today) {
  return openOccurrences(state, today);
}

// The transaction that marking an occurrence paid records.
export function occurrenceTransaction(o, extra = {}) {
  const { rule } = o;
  return { id: o.id, date: o.date, kind: rule.kind, amount: o.amount ?? rule.amount, categoryId: rule.categoryId, note: rule.name, recurringId: rule.id, ...extra };
}

// Everything waiting to be confirmed, as the transactions that confirming each one would record.
export function dueOccurrences(state, today) {
  return dueList(state, today).map((o) => occurrenceTransaction(o));
}

// The occurrences still open between two dates (inclusive), soonest first. Looks at most `limit` months
// ahead, so an open-ended time frame stays small.
export function occurrencesBetween(state, from, to, limit = 24) {
  if (from > to) return [];
  const cap = dateInMonth(addMonths(monthOf(from), limit), 31);
  return openOccurrences(state, cap < to ? cap : to, from);
}

// How a payment repeats, in words: "Monthly on the 5th" is left to the caller; this gives the rhythm.
export function repeatWords(rule) {
  const rep = repeatOf(rule);
  if (rep.type === 'once') return 'Once';
  if (rep.type === 'twice') return 'Twice a month';
  const { every, unit } = rep;
  if (every === 1) return { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[unit];
  return `Every ${every} ${unit}s`;
}
