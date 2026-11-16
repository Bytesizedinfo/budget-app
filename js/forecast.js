// What's coming: money held for payments, automatic set-asides, the forecast of spending money, what would
// be left this month, the month plan, and wishlist maths. Everything here reads the same list of payments and
// set-asides, so the home page, the timeline and the plan can't disagree.

import { balance, inMonth, potBalance, potEntries, totals } from './calc.js';
import { addDays, addMonths, dateInMonth, daysInMonth, isValidDate, monthOf } from './dates.js';
import { incomeMonths, isAuto, isBillFund, isClosed, isSnoozedOn, isWish, planChecks, plannedFor, scheduleDue, setAsideInMonth, validSchedule } from './pots.js';
import { occurrences, stepDates } from './recurring.js';

// ---------- Money set aside for a payment ----------
// A payment can have money set aside for it ahead of time (`fund` on the rule), kept in a hidden set-aside
// that names the payment in `billId`:
//   { type: 'date', daysBefore }           all of it, that many days before each payment
//   { type: 'rate', amount, every, unit }  an amount every N days, weeks or months, until there's enough
//   { type: 'until', date? }               spread monthly until the payment's date (or an earlier date)
// `since` is the day it was set up; nothing moves before then.

const FUND_UNITS = ['day', 'week', 'month'];

// The set-aside holding money for a payment, if it has one.
export const fundGoal = (state, rule) => state.goals.find((g) => g.billId === rule.id) ?? null;

export function fundOf(rule) {
  const f = rule.fund;
  if (!f || typeof f !== 'object' || rule.kind !== 'expense') return null;
  const since = isValidDate(f.since) ? f.since : null;
  if (f.type === 'date') return { type: 'date', daysBefore: Math.max(0, Math.round(Number(f.daysBefore) || 0)), since };
  if (f.type === 'rate' && f.amount > 0 && FUND_UNITS.includes(f.unit)) {
    return { type: 'rate', amount: f.amount, every: Math.max(1, Math.round(Number(f.every) || 1)), unit: f.unit, since };
  }
  if (f.type === 'until') return { type: 'until', date: isValidDate(f.date) ? f.date : null, since };
  return null;
}

// ---------- The forecast ----------

const HORIZON = 1500; // How many days ahead to look for the payment that money is being set aside for.
const ORDER = { fund: 0, income: 1, auto: 2, bill: 3, wish: 4 };

// Plays forward everything that is set to happen from today to a day, in date order, and tracks spending money:
//   bill    a payment still to confirm (overdue ones count today); what's set aside for it is used first
//   income  expected income still to confirm (left out with income: false)
//   fund    money moving into a payment's set-aside
//   auto    a set-aside funded automatically on its schedule
//   wish    a ticked wishlist item, bought today for what it still costs (with wishes: true)
// planned: false leaves planned payments out. Automatic moves never take spending money below zero.
// Each event gets `amount` (its effect on spending money) and `after` (spending money once it has happened).
export function simulate(state, today, until, opts = {}) {
  const { planned = true, wishes = false, income = true, bills = true } = opts;

  const funds = new Map(state.goals.filter(isBillFund).map((g) => [g.billId, g]));
  const idSets = new Map();
  const recorded = (goal, id) => {
    if (id in state.deleted) return true;
    let ids = idSets.get(goal.id);
    if (!ids) idSets.set(goal.id, (ids = new Set(goal.contributions.map((c) => c.id))));
    return ids.has(id);
  };
  const events = [];
  const far = addDays(until, HORIZON);

  for (const rule of state.recurring) {
    if (rule.planned && !planned) continue;
    const open = occurrences(state, rule, far).filter((o) => o.status === 'open');
    if (!open.length) continue;
    const dated = (type) => {
      for (const o of open) if (o.date <= until) events.push({ type, date: o.date < today ? today : o.date, at: o.date, rule, occ: o });
    };
    if (rule.kind === 'income') {
      if (income) dated('income');
      continue;
    }
    if (bills) dated('bill');
    const fund = fundOf(rule);
    const goal = funds.get(rule.id);
    if (!fund || !goal) continue;
    const since = fund.since ?? today;
    const add = (date, id, occ) => {
      if (date <= until && !recorded(goal, id)) events.push({ type: 'fund', date, id, rule, goal, fund, occ });
    };
    if (fund.type === 'date') {
      for (const o of open) {
        const date = addDays(o.date, -fund.daysBefore);
        add(date < since ? since : date, `auto_${goal.id}_${o.key}`, o);
      }
    } else {
      for (const date of stepDates(since, fund.type === 'rate' ? fund.every : 1, fund.type === 'rate' ? fund.unit : 'month')) {
        if (date > until) break;
        const next = open.find((o) => o.date >= date);
        if (!next) break; // Nothing left to save for.
        add(date, `auto_${goal.id}_${date}`, next);
      }
    }
  }

  for (const goal of state.goals) {
    if (!isAuto(goal)) continue;
    const s = validSchedule(goal);
    const start = isValidDate(goal.autoSince) ? goal.autoSince : s.since ?? today;
    const ticked = wishes && isWish(goal) && goal.wish.tick;
    for (const date of stepDates(start, s.type === 'rate' ? s.every : 1, s.type === 'rate' ? s.unit : 'month')) {
      if (date > until || (ticked && date > today)) break;
      const id = `auto_${goal.id}_${date}`;
      if (!recorded(goal, id) && !isSnoozedOn(goal, date)) events.push({ type: 'auto', date, id, goal });
    }
  }
  if (wishes) {
    for (const goal of state.goals) if (isWish(goal) && !isClosed(goal) && goal.wish.tick) events.push({ type: 'wish', date: today, goal });
  }
  const nameOf = (e) => e.rule?.name ?? e.goal.name;
  events.sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.type] - ORDER[b.type] || nameOf(a).localeCompare(nameOf(b)));

  const start = balance(state, today).spending;
  let spending = start;
  const pots = new Map(state.goals.map((g) => [g.id, potBalance(state, g)]));
  const put = new Map(); // set-aside id -> [{ month, amount }] moved in by this forecast
  const putIn = (goal, date, amount) => {
    pots.set(goal.id, (pots.get(goal.id) ?? 0) + amount);
    if (amount) put.set(goal.id, [...(put.get(goal.id) ?? []), { month: monthOf(date), amount }]);
  };
  const sumPut = (goal, test) => (put.get(goal.id) ?? []).filter(test).reduce((sum, x) => sum + x.amount, 0);
  const affordable = (want) => Math.min(want, Math.max(0, spending));
  let lowest = { amount: start, date: today };

  for (const e of events) {
    if (e.type === 'income') e.amount = e.occ.amount;
    else if (e.type === 'bill') {
      const fund = funds.get(e.rule.id);
      const held = fund ? Math.max(0, pots.get(fund.id) ?? 0) : 0;
      e.fromFund = Math.min(held, e.occ.amount);
      if (e.fromFund) pots.set(fund.id, held - e.fromFund);
      e.amount = -(e.occ.amount - e.fromFund);
    } else if (e.type === 'fund') {
      const missing = Math.max(0, e.occ.amount - Math.max(0, pots.get(e.goal.id) ?? 0));
      if (e.fund.type === 'date') e.want = missing;
      else if (e.fund.type === 'rate') e.want = Math.min(e.fund.amount, missing);
      else {
        const deadline = e.fund.date && e.fund.date >= e.date && e.fund.date <= e.occ.date ? e.fund.date : e.occ.date;
        let moves = 0;
        for (const date of stepDates(e.date, 1, 'month')) {
          if (date > deadline) break;
          moves += 1;
        }
        e.want = Math.ceil(missing / Math.max(1, moves));
      }
      e.give = affordable(e.want);
      e.amount = -e.give;
      putIn(e.goal, e.date, e.give);
    } else if (e.type === 'auto') {
      const s = validSchedule(e.goal);
      const month = monthOf(e.date);
      let want = s.amount;
      if (s.type === 'target') {
        const due = scheduleDue(state, e.goal, month, sumPut(e.goal, (x) => x.month < month));
        want = Math.max(0, due - setAsideInMonth(state, e.goal, month) - sumPut(e.goal, (x) => x.month === month));
      }
      if (e.goal.target > 0) want = Math.min(want, Math.max(0, e.goal.target - (pots.get(e.goal.id) ?? 0)));
      e.want = want;
      e.give = affordable(want);
      e.amount = -e.give;
      putIn(e.goal, e.date, e.give);
    } else {
      e.amount = -Math.max(0, (e.goal.target ?? 0) - Math.max(0, pots.get(e.goal.id) ?? 0));
    }
    spending += e.amount;
    e.after = spending;
    if (spending < lowest.amount) lowest = { amount: spending, date: e.date };
  }

  return { start, events, end: spending, lowest, pots };
}

// The automatic moves that are due by today and not recorded yet, as contributions with fixed ids, so two
// devices record the same ones. A move that can't be afforded is recorded as a smaller (or zero) amount with
// what was `short`, rather than left to pile up and fire later.
export function autoContributions(state, today) {
  const sim = simulate(state, today, today, { planned: true, wishes: false, income: false, bills: false });
  return sim.events
    .filter((e) => e.type === 'fund' || e.type === 'auto')
    .map((e) => ({ goalId: e.goal.id, contribution: { id: e.id, date: e.date, amount: e.give, auto: true, ...(e.want > e.give ? { short: e.want - e.give } : {}) } }));
}

// What would be left of spending money at the end of this month, once every payment still to confirm, every
// automatic set-aside and (optionally) the ticked wishlist items have come out. Income still to come isn't
// counted until it arrives.
export function leftThisMonth(state, today, opts = {}) {
  return simulate(state, today, dateInMonth(monthOf(today), 31), { planned: opts.planned !== false, wishes: opts.wishes === true, income: false });
}

// Spending money day by day over the next `days` days, with expected income included.
export function timeline(state, today, days = 60) {
  return simulate(state, today, addDays(today, days), { planned: true, wishes: false, income: true });
}

// ---------- The month plan ----------

// Expected income for a month: the figure typed for it, or else what came in last month.
export function expectedIncome(state, month, today) {
  const current = monthOf(today);
  const lastMonth = totals(inMonth(state.transactions, addMonths(current, -1))).income;
  const custom = state.settings.expected?.[month];
  const typical = incomeMonths(state, today);
  return {
    amount: Number.isSafeInteger(custom) && custom >= 0 ? custom : lastMonth,
    custom: Number.isSafeInteger(custom) && custom >= 0,
    lastMonth,
    average: typical?.average ?? 0,
    soFar: month === current ? totals(inMonth(state.transactions, month)).income : 0,
  };
}

// "If I budget this and that, how much is left?" for a month (this one or a later one):
//   expected income
//   − recurring payments due in the month        (paid or still to come; skipped ones left out)
//   − planned payments due in the month
//   + what was already set aside for them        (held for those payments when the month started)
//   − set-asides                                 (default splits applied to the expected income, automatic
//                                                 moves, and money going aside for payments)
//   − category budgets                           (only the part beyond the payments already counted in them)
//   = left unbudgeted
export function monthPlan(state, month, today) {
  const current = monthOf(today);
  const first = `${month}-01`;
  const last = dateInMonth(month, 31);
  const expected = expectedIncome(state, month, today);

  const due = [];
  for (const rule of state.recurring) {
    if (rule.kind !== 'expense') continue;
    for (const o of occurrences(state, rule, last)) if (o.status !== 'skipped' && monthOf(o.date) === month) due.push(o);
  }
  const sum = (list) => list.reduce((total, o) => total + o.amount, 0);
  const recurring = due.filter((o) => !o.rule.planned);
  const plannedPay = due.filter((o) => o.rule.planned);

  // Automatic moves in the month, by set-aside: those already recorded plus those still to come.
  const autoIn = new Map();
  const addAuto = (goalId, amount) => autoIn.set(goalId, (autoIn.get(goalId) ?? 0) + amount);
  for (const goal of state.goals) {
    for (const e of potEntries(state, goal)) if (e.auto && e.month === month) addAuto(goal.id, e.amount);
  }
  for (const e of simulate(state, today, last, { planned: true, income: false }).events) {
    if ((e.type === 'fund' || e.type === 'auto') && monthOf(e.date) === month) addAuto(e.goal.id, e.want);
  }
  const auto = [...autoIn.values()].reduce((total, amount) => total + amount, 0);

  // What's set aside for the month's payments: what was held for each when the month started (recorded for
  // this month, forecast for a later one) plus what goes aside for it during the month. Those payments are
  // paid from that money, so it's added back rather than counted twice.
  const dayBefore = addDays(first, -1);
  const ahead = month > current ? simulate(state, today, dayBefore, { planned: true, income: false }) : null;
  let covered = 0;
  const funded = new Map();
  for (const o of due) funded.set(o.rule.id, (funded.get(o.rule.id) ?? 0) + o.amount);
  for (const [ruleId, amount] of funded) {
    const goal = state.goals.find((g) => g.billId === ruleId);
    if (!goal) continue;
    const held = ahead ? ahead.pots.get(goal.id) ?? 0 : potBalance(state, goal, dayBefore);
    covered += Math.min(amount, Math.max(0, held) + (autoIn.get(goal.id) ?? 0));
  }

  const split = plannedFor(state, [{ id: '(plan)', kind: 'income', amount: expected.amount, categoryId: null, date: first, month }]).total;
  const setAsides = split + auto;

  const inCategory = new Map();
  for (const o of due) inCategory.set(o.rule.categoryId, (inCategory.get(o.rule.categoryId) ?? 0) + o.amount);
  const budgets = state.categories
    .filter((c) => c.kind === 'expense' && !c.archived && Number.isSafeInteger(c.monthlyBudget))
    .map((c) => ({ category: c, budget: c.monthlyBudget, bills: inCategory.get(c.id) ?? 0, extra: Math.max(0, c.monthlyBudget - (inCategory.get(c.id) ?? 0)) }));
  const categories = budgets.reduce((total, b) => total + b.extra, 0);

  const left = expected.amount - sum(recurring) - sum(plannedPay) + covered - setAsides - categories;
  return {
    month,
    expected,
    recurring: { total: sum(recurring), items: recurring },
    planned: { total: sum(plannedPay), items: plannedPay },
    covered,
    setAsides: { total: setAsides, split, auto },
    categories: { total: categories, items: budgets },
    left,
    perDay: Math.floor(Math.max(0, left) / daysInMonth(month)),
  };
}

// ---------- Wishlist ----------

// About how much a month goes into a set-aside: from its schedule if it has one, else from the default splits
// applied to recent income.
export function monthlyPace(state, goal, today) {
  const s = validSchedule(goal);
  if (s?.type === 'rate') return Math.round(s.unit === 'month' ? s.amount / s.every : (s.amount * (s.unit === 'week' ? 30.44 / 7 : 30.44)) / s.every);
  if (s?.type === 'target') return scheduleDue(state, goal, monthOf(today));
  return planChecks(state, today).goals.find((g) => g.goal.id === goal.id)?.perMonth ?? 0;
}

// A wishlist item's numbers: what's set aside, what it still costs, about when it would be ready at its pace
// ('now' when it's fully set aside), and what buying it today would leave of this month's spending money.
export function wishInfo(state, goal, today, opts = {}) {
  const price = goal.target > 0 ? goal.target : 0;
  const saved = Math.max(0, potBalance(state, goal));
  const remaining = Math.max(0, price - saved);
  const perMonth = monthlyPace(state, goal, today);
  let ready = null;
  if (!remaining) ready = 'now';
  else if (validSchedule(goal)?.type === 'target') ready = monthOf(goal.deadline);
  else if (perMonth > 0) ready = addMonths(monthOf(today), Math.ceil(remaining / perMonth));
  // Buying it today: as if it were the only ticked item, so its own future set-asides stop.
  const only = { ...state, goals: state.goals.map((g) => (isWish(g) ? { ...g, wish: { ...g.wish, tick: g.id === goal.id } } : g)) };
  const leaves = leftThisMonth(only, today, { ...opts, wishes: true }).end;
  return { price, saved, remaining, perMonth, ready, leaves };
}

// The total price of wishlist items that were dropped without buying them.
export function savedByNotBuying(state) {
  return state.goals.filter((g) => isWish(g) && g.wish.dropped && !g.wish.boughtTxId).reduce((sum, g) => sum + (g.target > 0 ? g.target : 0), 0);
}

// ---------- Calendar ----------

// Each day of a month: what came in and went out, its transactions, and the payments still to confirm on it.
export function calendarDays(state, month) {
  const last = dateInMonth(month, 31);
  const days = new Map();
  for (let date = `${month}-01`; date <= last; date = addDays(date, 1)) days.set(date, { date, income: 0, expense: 0, transactions: [], scheduled: [] });
  for (const t of state.transactions) {
    const day = days.get(t.date);
    if (!day) continue;
    day.transactions.push(t);
    day[t.kind === 'income' ? 'income' : 'expense'] += t.amount;
  }
  for (const rule of state.recurring) {
    for (const o of occurrences(state, rule, last)) if (o.status === 'open') days.get(o.date)?.scheduled.push(o);
  }
  return [...days.values()];
}

// Spending money expected at the end of a day from today on, with expected income counted.
export function projectedOn(state, today, date) {
  return simulate(state, today, date, { planned: true, wishes: false, income: true }).end;
}

// ---------- Category budgets ----------

// A monthly amount for each spending category from what was actually spent: the average of the last three
// full months, rounded up to a whole unit. Categories with no spending get none.
export function suggestBudgets(state, today) {
  const months = [1, 2, 3].map((n) => addMonths(monthOf(today), -n));
  const spent = new Map();
  for (const t of state.transactions) {
    if (t.kind !== 'income' && typeof t.date === 'string' && months.includes(monthOf(t.date))) spent.set(t.categoryId, (spent.get(t.categoryId) ?? 0) + t.amount);
  }
  const out = new Map();
  for (const c of state.categories) {
    const total = spent.get(c.id) ?? 0;
    if (c.kind === 'expense' && !c.archived && total > 0) out.set(c.id, Math.ceil(total / 3 / 100) * 100);
  }
  return out;
}

export { isBillFund };
