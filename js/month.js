// One picture of a month that Home, Budget, the category budgets, Insights and the Add form all read, so they
// can't disagree. For this month:
//   carried in        money (or a shortfall) brought in from before the month
//   + income          income that counts in the month and has arrived (income still expected is shown, not counted)
//   − set aside       put into set-asides so far, plus what will still move in automatically this month
//   − payments        recurring and planned payments paid from spending money, plus what's still to come
//   = spending budget (automatic), unless a fixed amount is chosen for the month
//   − spent           everything else spent from spending money
//   = left            spending money now, less everything still due this month
// The lines always add up: "left" is the figure the forecast gives for the end of the month, and "carried in"
// is whatever makes the rest match the spending money you really have.

import { balance, categoryBudgets, monthKey, paidFromPot, potEntries } from './calc.js';
import { addDays, dateInMonth, dayOf, dayOfWeek, daysBetween, daysInMonth, isValidDate, monthOf } from './dates.js';
import { incomeIn, monthPlan, simulate } from './forecast.js';

// ---------- Automatic or fixed ----------

// How a month's spending budget is set. `settings.budgets` ({ 'YYYY-MM': cents | 'auto' }) chooses for one
// month; otherwise `settings.budgetMode` does for every month ('fixed' uses `settings.spendingLimit`; anything
// else is automatic). scope: 'month' when the month has its own choice, 'every' when it follows the default.
export function budgetChoice(settings, month) {
  const own = settings.budgets?.[month];
  const limit = settings.spendingLimit > 0 ? settings.spendingLimit : null;
  if (Number.isSafeInteger(own) && own >= 0) return { mode: 'fixed', fixed: own, scope: 'month', limit };
  if (own === 'auto') return { mode: 'auto', fixed: null, scope: 'month', limit };
  if (settings.budgetMode === 'fixed' && limit) return { mode: 'fixed', fixed: limit, scope: 'every', limit };
  return { mode: 'auto', fixed: null, scope: 'every', limit };
}

// The settings that choose a spending budget: mode 'auto' or 'fixed' (with `amount` in cents), for one month
// only or for every month. A month's own choice is dropped when it says the same as the default.
export function budgetSettings(settings, month, { mode, amount = null, scope }) {
  const budgets = { ...(settings.budgets ?? {}) };
  delete budgets[month];
  if (scope === 'every') return mode === 'fixed' ? { budgets, budgetMode: 'fixed', spendingLimit: amount } : { budgets, budgetMode: 'auto' };
  const fallback = budgetChoice({ ...settings, budgets }, month);
  if (mode === 'fixed' && !(fallback.mode === 'fixed' && fallback.fixed === amount)) budgets[month] = amount;
  if (mode === 'auto' && fallback.mode !== 'auto') budgets[month] = 'auto';
  return { budgets };
}

// ---------- What has happened in a month ----------

// A recurring or planned payment that was confirmed (as opposed to everyday spending).
const isPayment = (t) => t.kind !== 'income' && !!t.recurringId;

// Spending from spending money on one day, leaving out payments and anything paid from a set-aside.
export function spentOn(state, date) {
  const fromPot = paidFromPot(state);
  return state.transactions.reduce((sum, t) => (t.date === date && t.kind !== 'income' && !fromPot(t) && !isPayment(t) ? sum + t.amount : sum), 0);
}

function actuals(state, month, asOf) {
  const fromPot = paidFromPot(state);
  const out = { received: 0, countsLater: 0, paid: 0, spent: 0, fromPots: 0, setAside: 0 };
  for (const t of state.transactions) {
    if (typeof t.date !== 'string' || t.date > asOf) continue;
    const key = monthKey(t);
    if (t.kind === 'income') {
      if (key === month) out.received += t.amount;
      else if (key > month && monthOf(t.date) === month) out.countsLater += t.amount; // Arrived now, counts later.
    } else if (key === month) {
      if (fromPot(t)) out.fromPots += t.amount;
      else if (isPayment(t)) out.paid += t.amount;
      else out.spent += t.amount;
    }
  }
  // Splits, money added or taken out by hand and automatic moves. Moves between set-asides cancel out, and
  // spending from a set-aside is reported separately.
  for (const goal of state.goals) {
    for (const e of potEntries(state, goal)) if (e.month === month && e.date <= asOf && e.kind !== 'paid') out.setAside += e.amount;
  }
  return out;
}

// What income still to come in the month would bring (shown, but not counted until it arrives).
function expectedIncome(state, month) {
  return incomeIn(state, month).open.reduce((sum, o) => sum + o.amount, 0);
}

// ---------- The planned column ----------

// What the month plan (expected income, planned or default splits, every payment in the month) makes of the
// same lines. Money already set aside for a payment pays it, so it's taken off the payments.
function plannedColumn(state, month, today, carriedIn, choice) {
  const plan = monthPlan(state, month, today);
  const income = plan.expected.amount;
  const setAside = plan.setAsides.total;
  const payments = plan.recurring.total + plan.planned.total - plan.covered;
  const auto = carriedIn + income - setAside - payments;
  const amount = choice.mode === 'fixed' ? choice.fixed : auto;
  const given = plan.categories.total;
  return { plan, carriedIn, income, setAside, payments, auto, amount, given, unbudgeted: amount - given };
}

// How much of a month's spending budget its category budgets take: each budget beyond the payments in that
// category (rent already counts as a payment, so only the rest of a Housing budget is spending).
function givenSoFar(state, month, plan) {
  const bills = new Map();
  for (const o of [...plan.recurring.items, ...plan.planned.items]) bills.set(o.rule.categoryId, (bills.get(o.rule.categoryId) ?? 0) + o.amount);
  const budgets = categoryBudgets(state, month);
  let given = 0;
  for (const c of state.categories) {
    const budget = budgets.get(c.id)?.budget ?? null;
    if (c.kind === 'expense' && !c.archived && budget !== null) given += Math.max(0, budget - (bills.get(c.id) ?? 0));
  }
  return given;
}

// ---------- The month picture ----------

// opts: { planned: count planned payments (default yes), wishes: count ticked wishlist items (default no) }.
// A past month is worked out as of its last day; a later month has the planned column only.
export function monthPicture(state, month, today, opts = {}) {
  const o = { planned: opts.planned !== false, wishes: opts.wishes === true };
  const current = monthOf(today);
  const choice = budgetChoice(state.settings, month);
  if (month > current) {
    // What this month is set to leave is what the later month starts from.
    const carriedIn = monthPicture(state, current, today, o).left;
    const planned = plannedColumn(state, month, today, carriedIn, choice);
    return { month, today, past: false, future: true, opts: o, carriedIn, planned, budget: { ...choice, auto: planned.auto, amount: planned.amount } };
  }
  const last = dateInMonth(month, 31);
  const past = month < current;
  const asOf = past ? last : today;
  const a = actuals(state, month, asOf);
  const spending = balance(state, asOf).spending;

  // What's still to come this month, from the forecast: money for payments and automatic set-asides, and the
  // payments themselves (less what's already held for them).
  let setAsideToCome = 0;
  let paymentsToCome = 0;
  let left = spending;
  let wishes = 0;
  let events = [];
  let toCome = [];
  if (!past) {
    const base = simulate(state, today, last, { planned: o.planned, wishes: false, income: false });
    for (const e of base.events) {
      if (e.type === 'fund' || e.type === 'auto') setAsideToCome += e.give;
      else if (e.type === 'bill') paymentsToCome -= e.amount;
    }
    left = base.end;
    events = base.events;
    toCome = base.events;
    if (o.wishes) {
      const withWishes = simulate(state, today, last, { planned: o.planned, wishes: true, income: false });
      wishes = base.end - withWishes.end; // What buying the ticked items would take (their own moves stop).
      left = withWishes.end;
      events = withWishes.events;
    }
  }

  const carriedIn = spending - (a.received - a.setAside - a.paid - a.spent);
  const auto = carriedIn + a.received - a.setAside - setAsideToCome - a.paid - paymentsToCome;
  const amount = choice.mode === 'fixed' ? choice.fixed : auto;
  let leftToSpend = left;
  let limitedBy = null;
  if (choice.mode === 'fixed') {
    const underBudget = choice.fixed - a.spent - wishes;
    leftToSpend = Math.min(underBudget, left);
    limitedBy = underBudget <= left ? 'budget' : 'money';
  }
  const daysLeft = past ? 0 : daysInMonth(month) - dayOf(today) + 1;
  const planned = plannedColumn(state, month, today, carriedIn, choice);
  const given = givenSoFar(state, month, planned.plan);
  return {
    month, today, past, future: false, opts: o,
    spending,
    carriedIn,
    income: { received: a.received, expected: past ? 0 : expectedIncome(state, month), countsLater: a.countsLater },
    setAside: { done: a.setAside, toCome: setAsideToCome, total: a.setAside + setAsideToCome },
    payments: { paid: a.paid, toCome: paymentsToCome, total: a.paid + paymentsToCome },
    spent: a.spent,
    fromPots: a.fromPots,
    spentToday: past ? 0 : spentOn(state, today),
    wishes,
    left,
    budget: { ...choice, auto, amount },
    leftToSpend,
    limitedBy,
    daysLeft,
    perDay: daysLeft ? Math.floor(Math.max(0, leftToSpend) / daysLeft) : 0,
    events, // Everything still to come this month, as counted in `left` (with ticked wishlist items if asked).
    toCome, // The same without wishlist items: what the set-aside and payment lines count.
    categories: { given, unbudgeted: amount - given },
    planned,
  };
}

// ---------- What you'd have left by a day ----------

export const PERIODS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']];

// The last day of a period: today, this week (to Sunday; weeks start on Monday), this month, or custom (the
// next `days` days, or up to `until` when that's a day from today on).
export function periodEnd(period, today, { days = 7, until = '' } = {}) {
  if (period === 'today') return today;
  if (period === 'week') return addDays(today, 6 - dayOfWeek(today));
  if (period === 'custom') {
    if (isValidDate(until) && until >= today) return until;
    return addDays(today, customDays(days) - 1);
  }
  return dateInMonth(monthOf(today), 31);
}

export const customDays = (days) => Math.max(1, Math.min(366, Math.round(Number(days) || 7)));

// Spending money now, less everything due from today to a day (payments, money for payments, automatic
// set-asides and, if asked, ticked wishlist items), and what that allows per day. Income still to come isn't
// counted until it arrives. Per day is what's left shared over the days, today included: today's spending
// has already come out, so it isn't added back.
export function leftBy(state, today, until, opts = {}) {
  const end = until < today ? today : until;
  const sim = simulate(state, today, end, { planned: opts.planned !== false, wishes: opts.wishes === true, income: false });
  const days = daysBetween(today, end) + 1;
  return { start: sim.start, due: sim.start - sim.end, left: sim.end, until: end, days, perDay: Math.floor(Math.max(0, sim.end) / days), events: sim.events };
}
