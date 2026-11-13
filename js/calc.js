import { addMonths, dayOf, dayOfWeek, daysInMonth, monthOf, monthRange, monthsCovered } from './dates.js';
import { occurrenceId, occurrenceIn } from './recurring.js';

export const byNewest = (a, b) => String(b.date).localeCompare(String(a.date)) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0);

// The month an entry counts in. Pay can be marked for another month, e.g. paid on 26 Oct for November:
// it counts in November's income, while its date (and the balance) stay on the day the money arrived.
export const monthKey = (t) => (/^\d{4}-\d{2}$/.test(t.month ?? '') ? t.month : String(t.date).slice(0, 7));

export function inMonth(transactions, month) {
  return transactions.filter((t) => typeof t.date === 'string' && monthKey(t) === month);
}

// Entries in a time frame (see timeframe() in dates.js). A whole month goes by the month each entry counts in;
// any other range by the date it happened.
export function inRange(transactions, range) {
  if (range.month) return inMonth(transactions, range.month);
  return transactions.filter((t) => typeof t.date === 'string' && t.date >= range.from && t.date <= range.to);
}

export function totals(transactions) {
  let income = 0;
  let expense = 0;
  for (const t of transactions) {
    if (t.kind === 'income') income += t.amount;
    else expense += t.amount;
  }
  return { income, expense, net: income - expense };
}

export function sumBy(transactions, kind) {
  const sums = new Map();
  for (const t of transactions) if (t.kind === kind) sums.set(t.categoryId, (sums.get(t.categoryId) ?? 0) + t.amount);
  return sums;
}

export const spendByCategory = (transactions) => sumBy(transactions, 'expense');

// "Other…" categories sort last; everything else alphabetically.
export function sortCategories(list) {
  const isOther = (c) => (c.name.startsWith('Other') ? 1 : 0);
  return [...list].sort((a, b) => isOther(a) - isOther(b) || a.name.localeCompare(b.name));
}

export function categoriesFor(state, kind, includeId) {
  return sortCategories(state.categories.filter((c) => c.kind === kind && (!c.archived || c.id === includeId)));
}

export function categoryName(state, id) {
  return state.categories.find((c) => c.id === id)?.name ?? 'Uncategorised';
}

export function budgetLevel(spent, budget) {
  if (spent > budget) return 'over';
  if (budget > 0 && spent / budget >= 0.8) return 'warn';
  return 'ok';
}

// The actual first and last day of a time frame. "All time" runs from the first recorded entry to today.
export function rangeSpan(range, state, today) {
  if (range.choice !== 'all') return { from: range.from, to: range.to };
  const first = state.transactions.reduce((min, t) => (typeof t.date === 'string' && t.date < min ? t.date : min), today);
  return { from: first, to: today };
}

// How many months a time frame covers (see monthsCovered), for comparing monthly amounts with any stretch.
export function rangeMonths(range, state, today) {
  if (range.month) return 1;
  const span = rangeSpan(range, state, today);
  return monthsCovered(span.from, span.to);
}

// period: a month ("2026-11") or a time frame. scale: how many months it covers, so each monthly budget is
// compared with spending over the same stretch (S$300 a month is S$450 over a month and a half).
export function budgetSummary(state, period, scale = 1) {
  const spent = spendByCategory(typeof period === 'string' ? inMonth(state.transactions, period) : inRange(state.transactions, period));
  const rows = sortCategories(state.categories.filter((c) => c.kind === 'expense' && (!c.archived || spent.has(c.id)))).map((category) => ({
    category,
    spent: spent.get(category.id) ?? 0,
    budget: Number.isSafeInteger(category.monthlyBudget) ? Math.round(category.monthlyBudget * scale) : null,
  }));
  const shown = new Set(rows.map((r) => r.category.id));
  let totalBudget = 0;
  let budgetedSpent = 0;
  let unbudgeted = 0;
  for (const row of rows) {
    if (row.budget === null) unbudgeted += row.spent;
    else {
      totalBudget += row.budget;
      budgetedSpent += row.spent;
    }
  }
  for (const [id, amount] of spent) if (!shown.has(id)) unbudgeted += amount;
  return { rows, totalBudget, budgetedSpent, unbudgeted };
}

// "Safe to spend" against one overall monthly limit, worked out the way Spend & Save does:
// what's left after this month's spending and the bills still to come, spread evenly
// over the days that remain. Returns null when no limit is set.
export function safeToSpend(state, month, today) {
  const limit = state.settings.spendingLimit;
  if (!(limit > 0)) return null;
  const current = monthOf(today);
  const monthTransactions = inMonth(state.transactions, month);
  // Spending paid from a set-aside was planned for, so it doesn't count against the limit.
  const fromPot = paidFromPot(state);
  const fromPots = monthTransactions.filter(fromPot).reduce((sum, t) => sum + t.amount, 0);
  const spent = totals(monthTransactions).expense - fromPots;
  const ids = new Set(monthTransactions.map((t) => t.id));
  const upcoming = month < current ? [] : state.recurring
    .filter((rule) => rule.kind === 'expense')
    .map((rule) => ({ rule, date: occurrenceIn(rule, month), id: occurrenceId(rule.id, month) }))
    .filter(({ date, id }) => date && (month > current || date > today) && !ids.has(id) && !(id in state.deleted))
    .sort((a, b) => a.date.localeCompare(b.date));
  const reserved = upcoming.reduce((sum, u) => sum + u.rule.amount, 0);
  const left = limit - spent - reserved;
  const result = {
    limit, spent, fromPots, reserved, upcoming, left, level: left < 0 ? 'over' : 'ok', past: month < current, future: month > current,
    daysLeft: null, spentToday: 0, perDay: null, todayLeft: null, weekLeft: null, evenShare: null,
  };
  if (month !== current) return result;

  const daysLeft = daysInMonth(month) - dayOf(today) + 1;
  const spentToday = totals(monthTransactions.filter((t) => t.date === today && !fromPot(t))).expense;
  const pool = Math.max(0, left + spentToday); // What today and the rest of the month share, before today's spending.
  const perDay = Math.floor(pool / daysLeft);
  const weekDaysLeft = Math.min(7 - dayOfWeek(today), daysLeft); // Monday–Sunday, cut off at month end.
  // The pace to compare against leaves bills out, so a big bill early on doesn't read as overspending.
  const bills = monthTransactions.filter((t) => t.kind === 'expense' && t.recurringId).reduce((sum, t) => sum + t.amount, 0) + reserved;
  const evenShare = Math.max(0, limit - bills) / daysInMonth(month);
  return {
    ...result,
    daysLeft,
    spentToday,
    perDay,
    todayLeft: perDay - spentToday,
    weekLeft: Math.floor((pool * weekDaysLeft) / daysLeft) - spentToday,
    evenShare: Math.floor(evenShare),
    level: left < 0 ? 'over' : perDay < evenShare * 0.75 ? 'warn' : 'ok',
  };
}

// ---------- Set-asides (savings goals and pots) ----------
// A set-aside's money moves in three ways: amounts added or taken out by hand (its contributions), income
// split into it (kept on the income entry as `split`), and expenses paid from it (`potId` on the expense).
// Splits and payments live on the transaction itself, so editing or deleting it can't leave the two out of step.

// The split of an income entry as { setAsideId: cents }, or null if it has none.
export const splitOf = (t) => (t.kind === 'income' && t.split !== null && typeof t.split === 'object' ? t.split : null);

// Tells whether an expense was paid from a set-aside that still exists.
export function paidFromPot(state) {
  const pots = new Set(state.goals.map((g) => g.id));
  return (t) => t.kind !== 'income' && pots.has(t.potId);
}

// How much of an income entry is set aside (into set-asides that still exist).
export function splitTotal(state, t) {
  const split = splitOf(t);
  if (!split) return 0;
  return state.goals.reduce((sum, g) => sum + (split[g.id] > 0 ? split[g.id] : 0), 0);
}

// Every movement in or out of one set-aside. kind: 'manual' (added or taken out by hand), 'move' (to or from
// another set-aside), 'split' (from an income entry) or 'paid' (an expense paid from it).
export function potEntries(state, goal) {
  const entries = goal.contributions.map((c) => ({ id: c.id, date: c.date, amount: c.amount, month: monthKey(c), kind: c.move ? 'move' : 'manual', move: c.move ?? null }));
  for (const t of state.transactions) {
    if (typeof t.date !== 'string') continue;
    const share = splitOf(t)?.[goal.id];
    if (share > 0) entries.push({ id: t.id, date: t.date, amount: share, month: monthKey(t), kind: 'split', tx: t });
    else if (t.kind !== 'income' && t.potId === goal.id) entries.push({ id: t.id, date: t.date, amount: -t.amount, month: monthKey(t), kind: 'paid', tx: t });
  }
  return entries;
}

// What's in a set-aside now, or (with asOf) at the end of a given day.
export function potBalance(state, goal, asOf = null) {
  let sum = 0;
  for (const e of potEntries(state, goal)) if (!asOf || e.date <= asOf) sum += e.amount;
  return sum;
}

// How much there is in total up to a date: everything recorded as income minus everything
// spent, and how much of that is set aside.
export function balance(state, asOf) {
  const { net } = totals(state.transactions.filter((t) => typeof t.date === 'string' && t.date <= asOf));
  // An overdrawn set-aside counts as empty: the shortfall has come out of spending money.
  const savings = state.goals.reduce((sum, g) => sum + Math.max(0, potBalance(state, g, asOf)), 0);
  return { total: net, savings, spending: net - savings };
}

export function trend(state, endMonth, count = 12) {
  const months = monthRange(addMonths(endMonth, 1 - count), endMonth);
  const sums = new Map(months.map((month) => [month, { month, income: 0, expense: 0 }]));
  for (const t of state.transactions) {
    const row = sums.get(monthKey(t));
    if (row) row[t.kind === 'income' ? 'income' : 'expense'] += t.amount;
  }
  return [...sums.values()];
}

export function goalProgress(state, goal, today) {
  const saved = potBalance(state, goal);
  // Without a target, a goal is just a pot that tracks what's been put aside.
  if (!(goal.target > 0)) return { saved, remaining: null, ratio: null, done: false, perMonth: null, overdue: false, open: true };
  const remaining = Math.max(0, goal.target - saved);
  const progress = { saved, remaining, ratio: goal.target > 0 ? saved / goal.target : 0, done: remaining === 0, perMonth: null, overdue: false };
  if (goal.deadline && remaining > 0) {
    if (goal.deadline < today) progress.overdue = true;
    else progress.perMonth = Math.ceil(remaining / monthRange(monthOf(today), monthOf(goal.deadline)).length);
  }
  return progress;
}

// What can be spent each day for the rest of this month, from the money actually there: spending money
// (everything in minus everything out, less what's in savings goals) minus bills still to come this month,
// shared over the days left. Today's spending is added back first, so it only lowers today's share.
export function spendPerDay(state, today) {
  const month = monthOf(today);
  const daysLeft = daysInMonth(month) - dayOf(today) + 1;
  const { spending } = balance(state, today);
  const dated = state.transactions.filter((t) => typeof t.date === 'string' && t.date.startsWith(month));
  const ids = new Set(dated.map((t) => t.id));
  const upcoming = state.recurring
    .filter((rule) => rule.kind === 'expense')
    .map((rule) => ({ rule, date: occurrenceIn(rule, month), id: occurrenceId(rule.id, month) }))
    .filter(({ date, id }) => date && date > today && !ids.has(id) && !(id in state.deleted))
    .sort((a, b) => a.date.localeCompare(b.date));
  const reserved = upcoming.reduce((sum, u) => sum + u.rule.amount, 0);
  // Spending paid from a set-aside didn't come out of spending money, so it isn't added back.
  const fromPot = paidFromPot(state);
  const spentToday = totals(dated.filter((t) => t.date === today && !fromPot(t))).expense;
  const free = spending - reserved;
  const pool = Math.max(0, free + spentToday);
  const perDay = Math.floor(pool / daysLeft);
  return { spending, reserved, upcoming, free, daysLeft, spentToday, perDay, todayLeft: perDay - spentToday };
}
