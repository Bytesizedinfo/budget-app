import { addMonths, dayOf, dayOfWeek, daysInMonth, monthOf, monthRange } from './dates.js';
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

export function budgetSummary(state, month) {
  const spent = spendByCategory(inMonth(state.transactions, month));
  const rows = sortCategories(state.categories.filter((c) => c.kind === 'expense' && (!c.archived || spent.has(c.id)))).map((category) => ({
    category,
    spent: spent.get(category.id) ?? 0,
    budget: Number.isSafeInteger(category.monthlyBudget) ? category.monthlyBudget : null,
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
  const spent = totals(monthTransactions).expense;
  const ids = new Set(monthTransactions.map((t) => t.id));
  const upcoming = month < current ? [] : state.recurring
    .filter((rule) => rule.kind === 'expense')
    .map((rule) => ({ rule, date: occurrenceIn(rule, month), id: occurrenceId(rule.id, month) }))
    .filter(({ date, id }) => date && (month > current || date > today) && !ids.has(id) && !(id in state.deleted))
    .sort((a, b) => a.date.localeCompare(b.date));
  const reserved = upcoming.reduce((sum, u) => sum + u.rule.amount, 0);
  const left = limit - spent - reserved;
  const result = {
    limit, spent, reserved, upcoming, left, level: left < 0 ? 'over' : 'ok', past: month < current, future: month > current,
    daysLeft: null, spentToday: 0, perDay: null, todayLeft: null, weekLeft: null, evenShare: null,
  };
  if (month !== current) return result;

  const daysLeft = daysInMonth(month) - dayOf(today) + 1;
  const spentToday = totals(monthTransactions.filter((t) => t.date === today)).expense;
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

// How much there is in total up to a date: everything recorded as income minus everything
// spent, and how much of that has been put into savings goals.
export function balance(state, asOf) {
  const { net } = totals(state.transactions.filter((t) => typeof t.date === 'string' && t.date <= asOf));
  const savings = state.goals.reduce((sum, g) => sum + g.contributions.filter((c) => c.date <= asOf).reduce((s, c) => s + c.amount, 0), 0);
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

export function goalProgress(goal, today) {
  const saved = goal.contributions.reduce((sum, c) => sum + c.amount, 0);
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
  const spentToday = totals(dated.filter((t) => t.date === today)).expense;
  const free = spending - reserved;
  const pool = Math.max(0, free + spentToday);
  const perDay = Math.floor(pool / daysLeft);
  return { spending, reserved, upcoming, free, daysLeft, spentToday, perDay, todayLeft: perDay - spentToday };
}
