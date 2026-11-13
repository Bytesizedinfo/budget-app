// Planning maths for set-asides: the default split for each kind of income, what one income entry should be
// split into, what a pay amount would leave, and how the plan compares with what was actually set aside.

import { byNewest, monthKey, potBalance, potEntries, spendPerDay, splitOf, trend } from './calc.js';
import { addDays, addMonths, monthOf, monthRange } from './dates.js';

// Set-asides in priority order: the order chosen on the Plan page, then the order they were made in.
export function sortedGoals(state) {
  return state.goals
    .map((goal, index) => ({ goal, key: Number.isFinite(goal.order) ? goal.order : 1e6 + index }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.goal);
}

// A rule is { type: 'fixed', value: cents a month } or { type: 'percent', value: percent of the income }.
export function validRule(rule) {
  if (!rule || !(rule.value > 0)) return null;
  if (rule.type === 'percent') return { type: 'percent', value: Math.min(100, rule.value) };
  return rule.type === 'fixed' ? { type: 'fixed', value: rule.value } : null;
}

// The default split for one kind of income. An income category can keep everything ('keep'), have its own
// rules, or follow the general default, which is made of each set-aside's own `plan`.
// Returns { source: 'general' | 'own' | 'keep', rules: Map(setAsideId -> rule) }.
export function defaultSplit(state, categoryId) {
  const own = state.categories.find((c) => c.id === categoryId && c.kind === 'income')?.split;
  const rules = new Map();
  if (own === 'keep') return { source: 'keep', rules };
  const custom = own !== null && typeof own === 'object';
  for (const goal of state.goals) {
    const rule = validRule(custom ? own[goal.id] : goal.plan);
    if (rule) rules.set(goal.id, rule);
  }
  return { source: custom ? 'own' : 'general', rules };
}

// Where a set-aside's money comes from by default: [{ categoryId (null for all income), rule }].
export function sourcesOf(state, goal) {
  const sources = [];
  const general = validRule(goal.plan);
  if (general) sources.push({ categoryId: null, rule: general });
  for (const c of state.categories) {
    if (c.kind !== 'income' || c.archived || c.split === null || typeof c.split !== 'object') continue;
    const rule = validRule(c.split[goal.id]);
    if (rule) sources.push({ categoryId: c.id, rule });
  }
  return sources;
}

// What has gone into a set-aside that counts in a month: added by hand (less anything taken back out) or
// split from income. Moves between set-asides and spending from it are left out.
export function setAsideInMonth(state, goal, month, exceptId = null) {
  let sum = 0;
  for (const e of potEntries(state, goal)) {
    if (e.month === month && e.id !== exceptId && (e.kind === 'split' || e.kind === 'manual')) sum += e.amount;
  }
  return Math.max(0, sum);
}

// What the default split asks of one income entry, set-aside by set-aside in priority order.
//   want: what the default asks for. A fixed amount is per month, so only what's still missing this month
//         is asked for; nothing is asked beyond a target.
//   give: what fits once the set-asides above it have taken theirs.
export function planSplit(state, income) {
  const month = monthKey(income);
  const { source, rules } = defaultSplit(state, income.categoryId);
  const own = splitOf(income) ?? {};
  let left = income.amount;
  const rows = [];
  for (const goal of sortedGoals(state)) {
    const rule = rules.get(goal.id) ?? null;
    let want = 0;
    let already = 0;
    if (rule?.type === 'percent') want = Math.round((income.amount * rule.value) / 100);
    else if (rule) {
      already = setAsideInMonth(state, goal, month, income.id);
      want = Math.max(0, rule.value - already);
    }
    let toTarget = null;
    if (goal.target > 0) {
      toTarget = Math.max(0, goal.target - (potBalance(state, goal) - (own[goal.id] > 0 ? own[goal.id] : 0)));
      want = Math.min(want, toTarget);
    }
    const give = Math.min(want, left);
    left -= give;
    rows.push({ goal, rule, want, give, already, toTarget });
  }
  return { source, rows, setAside: income.amount - left, keep: left, short: rows.reduce((sum, r) => sum + r.want - r.give, 0) };
}

export function suggestSplit(state, income) {
  const split = {};
  for (const row of planSplit(state, income).rows) if (row.give > 0) split[row.goal.id] = row.give;
  return split;
}

// "Try a pay amount": how an income of this size and kind would be split today, and what that leaves to spend.
export function tryPay(state, { amount, categoryId }, today) {
  const plan = planSplit(state, { id: '(try)', kind: 'income', amount, categoryId, date: today });
  const d = spendPerDay(state, today);
  const free = d.free + plan.keep; // Spending money after bills still to come, with what this pay leaves.
  return { ...plan, amount, bills: d.reserved, daysLeft: d.daysLeft, free, perDay: Math.floor(Math.max(0, free + d.spentToday) / d.daysLeft) };
}

// What today's default splits would set aside from a list of income entries, replayed in date order from a
// clean slate: { byGoal: Map(setAsideId -> cents), total, income }.
export function plannedFor(state, transactions) {
  const goals = sortedGoals(state);
  const byGoal = new Map(goals.map((g) => [g.id, 0]));
  const monthly = new Map(); // "setAsideId month" -> planned so far, for fixed amounts a month
  let total = 0;
  let income = 0;
  const incomes = transactions.filter((t) => t.kind === 'income' && typeof t.date === 'string').sort((a, b) => a.date.localeCompare(b.date));
  for (const t of incomes) {
    income += t.amount;
    const { rules } = defaultSplit(state, t.categoryId);
    let left = t.amount;
    for (const goal of goals) {
      const rule = rules.get(goal.id);
      if (!rule) continue;
      const key = `${goal.id} ${monthKey(t)}`;
      const sofar = monthly.get(key) ?? 0;
      const want = rule.type === 'percent' ? Math.round((t.amount * rule.value) / 100) : Math.max(0, rule.value - sofar);
      const give = Math.min(want, left);
      left -= give;
      monthly.set(key, sofar + give);
      byGoal.set(goal.id, byGoal.get(goal.id) + give);
      total += give;
    }
  }
  return { byGoal, total, income };
}

// Money actually put into each set-aside in a time frame: added by hand (less anything taken back out) or
// split from income. A whole month goes by the month each entry counts in, like income does.
export function setAsideIn(state, range) {
  const inside = (e) => (range.month ? e.month === range.month : e.date >= range.from && e.date <= range.to);
  const byGoal = new Map();
  let total = 0;
  for (const goal of state.goals) {
    let sum = 0;
    for (const e of potEntries(state, goal)) if (inside(e) && (e.kind === 'split' || e.kind === 'manual')) sum += e.amount;
    byGoal.set(goal.id, sum);
    total += sum;
  }
  return { byGoal, total };
}

// How long the safety buffer would last at the usual monthly spending: the average of the last three full
// months that had any spending, or this month so far when there are none yet.
export function bufferCheck(state, today) {
  const goal = state.goals.find((g) => g.buffer);
  if (!goal) return null;
  const month = monthOf(today);
  let active = trend(state, addMonths(month, -1), 3).filter((m) => m.expense > 0);
  if (!active.length) active = trend(state, month, 1).filter((m) => m.expense > 0);
  const usual = active.length ? Math.round(active.reduce((sum, m) => sum + m.expense, 0) / active.length) : null;
  const saved = Math.max(0, potBalance(state, goal));
  return { goal, saved, usual, months: usual ? saved / usual : null };
}

// Checks on the plan, based on the income of the last 90 days:
//   share: the part of that income today's default splits would set aside.
//   goals: for each set-aside with a target, about how much a month the plan puts in, when it would be
//          reached, and how that compares with its target date.
export function planChecks(state, today) {
  const since = addDays(today, -90);
  const recent = state.transactions.filter((t) => t.kind === 'income' && typeof t.date === 'string' && t.date > since && t.date <= today);
  const planned = plannedFor(state, recent);
  const goals = sortedGoals(state).filter((g) => g.target > 0).map((goal) => {
    const saved = potBalance(state, goal);
    const remaining = Math.max(0, goal.target - saved);
    const perMonth = Math.round((planned.byGoal.get(goal.id) ?? 0) / 3);
    const monthsToGo = remaining === 0 ? 0 : perMonth > 0 ? Math.ceil(remaining / perMonth) : null;
    const reach = monthsToGo === null ? null : addMonths(monthOf(today), monthsToGo);
    const dated = goal.deadline && remaining > 0;
    const needed = dated && goal.deadline >= today ? Math.ceil(remaining / monthRange(monthOf(today), monthOf(goal.deadline)).length) : null;
    let status = 'open';
    if (remaining === 0) status = 'reached';
    else if (dated && goal.deadline < today) status = 'overdue';
    else if (monthsToGo === null) status = 'no-plan';
    else if (dated) status = reach <= monthOf(goal.deadline) ? 'on-track' : 'behind';
    return { goal, saved, remaining, perMonth, reach, needed, status };
  });
  return {
    share: planned.income > 0 ? planned.total / planned.income : null,
    plannedPerMonth: Math.round(planned.total / 3),
    incomePerMonth: Math.round(planned.income / 3),
    goals,
    buffer: bufferCheck(state, today),
  };
}

// Typical monthly income over the last six months that had any, for the "try a pay amount" shortcuts.
export function incomeMonths(state, today) {
  const months = trend(state, monthOf(today), 6).filter((m) => m.income > 0);
  if (!months.length) return null;
  return {
    average: Math.round(months.reduce((sum, m) => sum + m.income, 0) / months.length),
    lowest: Math.min(...months.map((m) => m.income)),
    count: months.length,
  };
}

// Income that hasn't been split yet (for example, added by a recurring item), counted from the day
// splitting was first used so older income isn't brought up.
export function toSplit(state) {
  const since = state.settings.splitSince;
  if (!since || !state.goals.length) return [];
  return state.transactions.filter((t) => t.kind === 'income' && !t.split && typeof t.date === 'string' && t.date >= since).sort(byNewest);
}
