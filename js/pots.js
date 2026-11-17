// Planning maths for set-asides: saving schedules, the default split for each kind of income (including the
// 50/30/20 preset), what one income entry should be split into, what a pay amount would leave, and how the
// plan compares with what was actually set aside.

import { byNewest, givenToCategories, monthKey, potBalance, potEntries, spendPerDay, splitOf, trend } from './calc.js';
import { addDays, addMonths, dateInMonth, dayOf, daysInMonth, isValidDate, monthOf, monthRange } from './dates.js';

// A set-aside can also be a wishlist item (`wish` on the goal: its target is the price) or the money held for
// one payment (`billId`: the payment it belongs to). Money for payments is managed from the payment itself,
// and a wish that has been bought or dropped is finished, so neither is offered when income is split.
export const isBillFund = (goal) => typeof goal.billId === 'string';
export const isWish = (goal) => goal.wish !== null && typeof goal.wish === 'object';
// A wish is closed once it has been bought or dropped from the list.
export const isClosed = (goal) => isWish(goal) && (!!goal.wish.boughtTxId || !!goal.wish.dropped);

// Set-asides that income can be split into, in priority order: the order chosen on the Budget page, then the
// order they were made in.
export function sortedGoals(state) {
  return state.goals
    .map((goal, index) => ({ goal, key: Number.isFinite(goal.order) ? goal.order : 1e6 + index }))
    .filter((x) => !isBillFund(x.goal) && !isClosed(x.goal))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.goal);
}

// A set-aside can be snoozed for one month (`snoozed: { month, until? }` on the goal): nothing is asked of
// income for it and nothing moves into it automatically that month. Resuming part-way through the month sets
// `until` to that day, so the automatic moves that were skipped aren't made up afterwards.
export const isSnoozed = (goal, month) => goal.snoozed?.month === month && !goal.snoozed.until;
export const isSnoozedOn = (goal, date) => goal.snoozed?.month === monthOf(date) && (!goal.snoozed.until || date <= goal.snoozed.until);

// A set-aside funded automatically: its schedule's amount moves out of spending money by itself.
export const isAuto = (goal) => goal.auto === true && !isBillFund(goal) && !isClosed(goal) && validSchedule(goal) !== null;

// ---------- Saving schedules ----------
// A set-aside can have a saving schedule (`schedule` on the goal):
//   { type: 'rate', amount, every, unit, since }  an amount every N days, weeks or months, from `since`
//   { type: 'target', within? }                   reach the target by the goal's target date; `within`
//                                                 ({ n, unit }) records that the date was picked as a length of time.

export const UNITS = ['day', 'week', 'month'];

export function validSchedule(goal) {
  const s = goal?.schedule;
  if (!s || typeof s !== 'object') return null;
  if (s.type === 'rate') {
    const every = Math.max(1, Math.round(Number(s.every) || 1));
    if (!(s.amount > 0) || !UNITS.includes(s.unit)) return null;
    return { type: 'rate', amount: s.amount, every, unit: s.unit, since: isValidDate(s.since) ? s.since : null };
  }
  if (s.type === 'target' && goal.target > 0 && isValidDate(goal.deadline)) {
    const within = s.within && s.within.n > 0 && UNITS.includes(s.within.unit) ? { n: Math.round(s.within.n), unit: s.within.unit } : null;
    return { type: 'target', within };
  }
  return null;
}

// The date a length of time from a day: 3 months from 13 Nov is 13 Feb (or the end of a shorter month).
export function dateAfter(from, n, unit) {
  if (unit === 'day') return addDays(from, n);
  if (unit === 'week') return addDays(from, 7 * n);
  return dateInMonth(addMonths(monthOf(from), n), dayOf(from));
}

// What a rate schedule comes to in one month. Daily and weekly amounts count the days of that month (from the
// day the schedule started, in its first month); "every 3 months" is spread evenly over the months.
export function rateInMonth(schedule, month) {
  const { amount, every, unit, since } = schedule;
  if (since && monthOf(since) > month) return 0;
  if (unit === 'month') return Math.round(amount / every);
  const perDay = amount / (unit === 'week' ? 7 * every : every);
  const first = since && monthOf(since) === month ? dayOf(since) : 1;
  return Math.round(perDay * (daysInMonth(month) - first + 1));
}

// What a set-aside's schedule asks for in a month. For a target, that's what was still missing at the start of
// the month, shared over the months left to its date (all of it once the date has passed), so putting money in
// during the month doesn't change the month's amount.
// extraBefore: money a forecast expects to have gone in before the month, on top of what's recorded.
export function scheduleDue(state, goal, month, extraBefore = 0) {
  const s = validSchedule(goal);
  if (!s || isSnoozed(goal, month)) return 0;
  if (s.type === 'rate') return rateInMonth(s, month);
  const before = extraBefore + potEntries(state, goal).filter((e) => e.month < month).reduce((sum, e) => sum + e.amount, 0);
  const remaining = Math.max(0, goal.target - before);
  if (!remaining) return 0;
  const last = monthOf(goal.deadline);
  return month > last ? remaining : Math.ceil(remaining / monthRange(month, last).length);
}

// ---------- The 50/30/20 ratio ----------
// One ratio for the whole budget (settings.ratio): the share of income for needs, wants and savings, and which
// set-aside gets whatever is left of the savings part once the goals' schedules have had theirs ('keep': none).

export function ratioOf(state) {
  const r = state.settings.ratio ?? {};
  const ok = (n) => Number.isFinite(n) && n >= 0 && n <= 100;
  const parts = ok(r.needs) && ok(r.wants) && ok(r.savings) && Math.abs(r.needs + r.wants + r.savings - 100) < 0.01
    ? { needs: r.needs, wants: r.wants, savings: r.savings }
    : { needs: 50, wants: 30, savings: 20 };
  const goals = sortedGoals(state);
  let restId = null;
  if (r.restId !== 'keep') restId = goals.find((g) => g.id === r.restId)?.id ?? (goals.find((g) => g.buffer) ?? goals.find((g) => !(g.target > 0)))?.id ?? null;
  return { ...parts, restId };
}

// ---------- Default splits ----------

// A rule is { type: 'fixed', value: cents a month }, { type: 'percent', value: percent of the income } or
// { type: 'schedule' } (what's due on the set-aside's saving schedule).
export function validRule(rule) {
  if (!rule) return null;
  if (rule.type === 'schedule') return { type: 'schedule' };
  if (!(rule.value > 0)) return null;
  if (rule.type === 'percent') return { type: 'percent', value: Math.min(100, rule.value) };
  return rule.type === 'fixed' ? { type: 'fixed', value: rule.value } : null;
}

// Every set-aside that has a saving schedule, on its schedule: the "Save for my goals" preset.
export function scheduleRules(state) {
  return new Map(state.goals.filter((g) => validSchedule(g)).map((g) => [g.id, { type: 'schedule' }]));
}

// The default split for one kind of income (categoryId null: all income).
// An income category can keep everything ('keep'), use the 50/30/20 ratio ('ratio'), have its own rules, or
// follow all income. All income is either the ratio (settings.allIncome === 'ratio') or each set-aside's `plan`.
// Returns { source: 'general' | 'own' | 'ratio' | 'keep', inherited, rules: Map(setAsideId -> rule), ratio }.
export function defaultSplit(state, categoryId) {
  const category = categoryId ? state.categories.find((c) => c.id === categoryId && c.kind === 'income') : null;
  const own = category?.split;
  const custom = own !== null && typeof own === 'object';
  const inherited = !!category && !custom && own !== 'keep' && own !== 'ratio';
  if (own === 'keep') return { source: 'keep', inherited: false, rules: new Map(), ratio: null };
  if (own === 'ratio' || ((!category || inherited) && state.settings.allIncome === 'ratio')) {
    return { source: 'ratio', inherited, rules: scheduleRules(state), ratio: ratioOf(state) };
  }
  const rules = new Map();
  for (const goal of state.goals) {
    const rule = validRule(custom ? own[goal.id] : goal.plan);
    // A schedule rule only counts while the set-aside has a schedule.
    if (rule && (rule.type !== 'schedule' || validSchedule(goal))) rules.set(goal.id, rule);
  }
  return { source: custom ? 'own' : 'general', inherited, rules, ratio: null };
}

// Where a set-aside's money comes from by default: [{ categoryId (null for all income), rule, via }], where via
// is 'ratio' (its schedule, from the savings part of a 50/30/20 split) or 'rest' (what's left of that part).
export function sourcesOf(state, goal) {
  const sources = [];
  const add = (categoryId, split) => {
    if (split.source === 'ratio') {
      if (split.rules.has(goal.id)) sources.push({ categoryId, rule: { type: 'schedule' }, via: 'ratio' });
      if (split.ratio.restId === goal.id) sources.push({ categoryId, rule: null, via: 'rest' });
    } else if (split.rules.has(goal.id)) sources.push({ categoryId, rule: split.rules.get(goal.id), via: null });
  };
  add(null, defaultSplit(state, null));
  for (const c of state.categories) {
    if (c.kind !== 'income' || c.archived) continue;
    const split = defaultSplit(state, c.id);
    if (!split.inherited && split.source !== 'keep') add(c.id, split);
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

// What a split asks of one income entry, set-aside by set-aside in priority order.
//   want: what the split asks for. A fixed amount a month, or what's due on a schedule, only asks for what's
//         still missing this month (alreadyIn); nothing is asked beyond a target.
//   give: what fits once the set-asides above have taken theirs. With the 50/30/20 ratio, everything comes out
//         of the savings part, and what's left of it goes to the ratio's chosen set-aside (`rest` on its row).
// Spending categories in the order income fills them: needs first, then ones not sorted yet, then wants.
export function budgetOrder(state) {
  const rank = (c) => (c.need === true ? 0 : c.need === false ? 2 : 1);
  return state.categories.filter((c) => c.kind === 'expense' && !c.archived).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// What an income entry gives to spending categories after its set-asides: each category's usual monthly
// amount, less what income already gave it this month, for as long as the money lasts.
// extra: more to count as already given (income planned earlier in the same month).
function allocateCats(state, income, available, extra = null) {
  const given = givenToCategories(state, monthKey(income), income.id);
  let left = available;
  const cats = budgetOrder(state).map((category) => {
    const usual = Number.isSafeInteger(category.monthlyBudget) ? category.monthlyBudget : 0;
    const already = (given.get(category.id) ?? 0) + (extra?.get(category.id) ?? 0);
    const want = Math.max(0, usual - already);
    const give = Math.min(want, left);
    left -= give;
    return { category, usual, already, want, give };
  });
  return { cats, budgeted: available - left, unbudgeted: left };
}

// The split planned ahead for an income that comes from a recurring or planned payment (`planSplit` on the
// rule: { goals: { setAsideId: cents }, cats: { categoryId: cents } }), applied to the amount that arrived.
// A smaller amount is filled from the top: set-asides in priority order, then categories. Null if none.
export function plannedSplit(state, income) {
  const plan = state.recurring.find((r) => r.id === income.recurringId && r.kind === 'income')?.planSplit;
  if (!plan || typeof plan !== 'object') return null;
  const own = splitOf(income) ?? {};
  let left = income.amount;
  const rows = sortedGoals(state).map((goal) => {
    let want = plan.goals?.[goal.id] > 0 ? plan.goals[goal.id] : 0;
    let toTarget = null;
    if (goal.target > 0) {
      toTarget = Math.max(0, goal.target - (potBalance(state, goal) - (own[goal.id] > 0 ? own[goal.id] : 0)));
      want = Math.min(want, toTarget);
    }
    const give = Math.min(want, left);
    left -= give;
    return { goal, rule: null, want, give, already: 0, toTarget, rest: 0, snoozed: false };
  });
  const keep = left;
  const cats = budgetOrder(state).map((category) => {
    const want = plan.cats?.[category.id] > 0 ? plan.cats[category.id] : 0;
    const give = Math.min(want, left);
    left -= give;
    return { category, usual: Number.isSafeInteger(category.monthlyBudget) ? category.monthlyBudget : 0, already: 0, want, give };
  });
  const short = rows.reduce((sum, r) => sum + r.want - r.give, 0) + cats.reduce((sum, r) => sum + r.want - r.give, 0);
  return { rows, setAside: income.amount - keep, keep, short, cats, budgeted: keep - left, unbudgeted: left, source: 'planned', inherited: false, ratio: null };
}

function allocate(state, income, split, alreadyIn, own = {}) {
  const month = monthKey(income);
  let left = income.amount;
  let pool = split.source === 'ratio' ? Math.round((income.amount * split.ratio.savings) / 100) : Infinity;
  const rows = [];
  for (const goal of sortedGoals(state)) {
    const rule = split.rules.get(goal.id) ?? null;
    const snoozed = isSnoozed(goal, month);
    let want = 0;
    let already = 0;
    if (snoozed) want = 0;
    else if (rule?.type === 'percent') want = Math.round((income.amount * rule.value) / 100);
    else if (rule) {
      already = alreadyIn(goal, month);
      want = Math.max(0, (rule.type === 'schedule' ? scheduleDue(state, goal, month) : rule.value) - already);
    }
    let toTarget = null;
    if (goal.target > 0) {
      toTarget = Math.max(0, goal.target - (potBalance(state, goal) - (own[goal.id] > 0 ? own[goal.id] : 0)));
      want = Math.min(want, toTarget);
    }
    const give = Math.min(want, left, pool);
    left -= give;
    pool -= give;
    rows.push({ goal, rule, want, give, already, toTarget, rest: 0, snoozed });
  }
  if (split.source === 'ratio' && pool > 0 && left > 0) {
    const row = rows.find((r) => r.goal.id === split.ratio.restId);
    if (row && !row.snoozed) {
      let extra = Math.min(pool, left);
      if (row.toTarget !== null) extra = Math.min(extra, Math.max(0, row.toTarget - row.give));
      row.give += extra;
      row.want += extra;
      row.rest = extra;
      left -= extra;
    }
  }
  return { rows, setAside: income.amount - left, keep: left, short: rows.reduce((sum, r) => sum + r.want - r.give, 0) };
}

// What a split asks of one income entry: its set-asides (rows), then its spending categories (cats).
//   keep: what isn't set aside.   budgeted: the part of that given to categories.   unbudgeted: the rest.
// Without a split given, the income's planned split is used if it has one, else its default split.
// running: { goals: Map, cats: Map } of amounts to count as already put in this month (income planned
// earlier in the same month), for working out a whole month's plan.
export function planSplit(state, income, split = null, running = null) {
  if (!split) {
    const planned = plannedSplit(state, income);
    if (planned) return planned;
    split = defaultSplit(state, income.categoryId);
  }
  const own = splitOf(income) ?? {};
  const already = (goal, month) => setAsideInMonth(state, goal, month, income.id) + (running?.goals.get(goal.id) ?? 0);
  const result = allocate(state, income, split, already, own);
  return { ...result, ...allocateCats(state, income, result.keep, running?.cats), source: split.source, inherited: split.inherited, ratio: split.ratio };
}

// The presets offered when splitting: the income's default, each goal on its schedule, and the 50/30/20 ratio.
export function presetSplit(state, preset, categoryId) {
  if (preset === 'goals') return { source: 'own', inherited: false, rules: scheduleRules(state), ratio: null };
  if (preset === 'ratio') return { source: 'ratio', inherited: false, rules: scheduleRules(state), ratio: ratioOf(state) };
  return defaultSplit(state, categoryId);
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
  return { ...plan, amount, bills: d.reserved, daysLeft: d.daysLeft, free, perDay: Math.floor(Math.max(0, free) / d.daysLeft) };
}

// What today's default splits would set aside from a list of income entries, replayed in date order from a
// clean slate: { byGoal: Map(setAsideId -> cents), total, income }.
export function plannedFor(state, transactions) {
  const byGoal = new Map(sortedGoals(state).map((g) => [g.id, 0]));
  const monthly = new Map(); // "setAsideId month" -> planned so far, for amounts a month and schedules
  let total = 0;
  let income = 0;
  const incomes = transactions.filter((t) => t.kind === 'income' && typeof t.date === 'string').sort((a, b) => a.date.localeCompare(b.date));
  for (const t of incomes) {
    income += t.amount;
    const result = allocate(state, t, defaultSplit(state, t.categoryId), (goal, month) => monthly.get(`${goal.id} ${month}`) ?? 0);
    for (const row of result.rows) {
      if (!row.give) continue;
      const key = `${row.goal.id} ${monthKey(t)}`;
      monthly.set(key, (monthly.get(key) ?? 0) + row.give);
      byGoal.set(row.goal.id, byGoal.get(row.goal.id) + row.give);
      total += row.give;
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
  if (!since) return [];
  return state.transactions.filter((t) => t.kind === 'income' && !t.split && typeof t.date === 'string' && t.date >= since).sort(byNewest);
}
