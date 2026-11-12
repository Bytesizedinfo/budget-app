import { addMonths, monthOf, monthRange } from './dates.js';

export const byNewest = (a, b) => String(b.date).localeCompare(String(a.date)) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0);

export function inMonth(transactions, month) {
  return transactions.filter((t) => typeof t.date === 'string' && t.date.startsWith(month));
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

export function trend(state, endMonth, count = 12) {
  const months = monthRange(addMonths(endMonth, 1 - count), endMonth);
  const sums = new Map(months.map((month) => [month, { month, income: 0, expense: 0 }]));
  for (const t of state.transactions) {
    const row = sums.get(String(t.date).slice(0, 7));
    if (row) row[t.kind === 'income' ? 'income' : 'expense'] += t.amount;
  }
  return [...sums.values()];
}

export function goalProgress(goal, today) {
  const saved = goal.contributions.reduce((sum, c) => sum + c.amount, 0);
  const remaining = Math.max(0, goal.target - saved);
  const progress = { saved, remaining, ratio: goal.target > 0 ? saved / goal.target : 0, done: remaining === 0, perMonth: null, overdue: false };
  if (goal.deadline && remaining > 0) {
    if (goal.deadline < today) progress.overdue = true;
    else progress.perMonth = Math.ceil(remaining / monthRange(monthOf(today), monthOf(goal.deadline)).length);
  }
  return progress;
}
