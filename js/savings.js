// Savings: the set-asides marked as savings (money that isn't meant to be spent), how much is in them, what
// went in and came out over a time frame, the savings rate, and how they've grown.

import { inRange, potBalance, potEntries, totals } from './calc.js';
import { timeBuckets } from './insights.js';
import { isBillFund, isWish, sortedGoals } from './pots.js';

// Wishlist items and money held for payments are for spending, so they can't be savings.
export const isSavings = (goal) => goal.savings === true && !isBillFund(goal) && !isWish(goal);

export const savingsGoals = (state) => sortedGoals(state).filter(isSavings);

// How much is in savings at the end of a day (now, without a day).
export function savingsTotal(state, asOf = null) {
  return savingsGoals(state).reduce((sum, g) => sum + Math.max(0, potBalance(state, g, asOf)), 0);
}

// What went into and came out of savings in a time frame. Money moved between two savings pots is neither.
//   taken: every entry that took money out (withdrawals, moves to elsewhere, expenses paid from savings),
//          newest first, each with its set-aside.
// A whole month goes by the month each entry counts in, like income does.
export function savingsFlow(state, range) {
  const goals = savingsGoals(state);
  const ids = new Set(goals.map((g) => g.id));
  const inside = (e) => (range.month ? e.month === range.month : e.date >= range.from && e.date <= range.to);
  let into = 0;
  let out = 0;
  const taken = [];
  const byGoal = new Map();
  for (const goal of goals) {
    const mine = { in: 0, out: 0 };
    for (const e of potEntries(state, goal)) {
      if (!inside(e) || !e.amount) continue;
      const within = e.kind === 'move' && ids.has(e.move);
      if (e.amount > 0) {
        mine.in += e.amount;
        if (!within) into += e.amount;
      } else {
        mine.out -= e.amount;
        if (!within) {
          out -= e.amount;
          taken.push({ ...e, goal });
        }
      }
    }
    byGoal.set(goal.id, mine);
  }
  taken.sort((a, b) => b.date.localeCompare(a.date));
  return { in: into, out, net: into - out, taken, byGoal };
}

// The share of a time frame's income that was saved (net of anything taken back out), or null with no income.
export function savingsRate(state, range) {
  const income = totals(inRange(state.transactions, range)).income;
  return income > 0 ? savingsFlow(state, range).net / income : null;
}

// Total savings at the end of each bucket of a stretch (days, weeks or months), up to today.
export function savingsSeries(state, span, today) {
  const to = span.to < today ? span.to : today;
  if (span.from > to) return [];
  return timeBuckets({ from: span.from, to }).buckets.map((b) => ({ ...b, total: savingsTotal(state, b.to) }));
}
