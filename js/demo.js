// Sample data for ?demo, so the app can be tried without connecting GitHub. Never saved.

import { addMonths, dateInMonth, daysInMonth, monthOf, monthRange } from './dates.js';
import { fractionDigits, guessCurrency } from './money.js';
import { seedState } from './store.js';

// Seeded random numbers, so the demo looks the same on every visit.
function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoState(today) {
  const guessed = guessCurrency();
  const state = seedState(fractionDigits(guessed) === 2 ? guessed : 'USD');
  const random = seededRandom(7);
  const amount = (min, max) => Math.round((min + random() * (max - min)) * 100);
  const pick = (list) => list[Math.floor(random() * list.length)];

  state.settings.spendingLimit = 420000;
  // Splitting has been in use since late last month, so the latest pay is waiting to be split.
  state.settings.splitSince = dateInMonth(addMonths(monthOf(today), -1), 20);
  const budgets = { c_food: 450, c_groceries: 450, c_transport: 180, c_housing: 2200, c_utilities: 250, c_shopping: 300, c_health: 150, c_fun: 200 };
  const needs = { c_food: false, c_groceries: true, c_transport: true, c_housing: true, c_utilities: true, c_shopping: false, c_health: true, c_fun: false };
  state.categories = state.categories.map((c) => ({ ...c, monthlyBudget: budgets[c.id] ? budgets[c.id] * 100 : c.monthlyBudget, need: c.id in needs ? needs[c.id] : c.need ?? null }));

  const first = addMonths(monthOf(today), -6);
  const start = (day) => dateInMonth(first, day);
  const rule = (id, name, kind, cents, categoryId, day) => ({ id, name, kind, amount: cents, categoryId, startDate: start(day), endDate: null, paused: false, updatedAt: 1 });
  state.recurring = [
    rule('demo-rent', 'Rent', 'expense', 210000, 'c_housing', 1),
    rule('demo-salary', 'Salary', 'income', 520000, 'c_salary', 25),
    rule('demo-gym', 'Gym membership', 'expense', 8900, 'c_health', 5),
    rule('demo-phone', 'Phone plan', 'expense', 3800, 'c_utilities', 12),
    rule('demo-stream', 'Streaming', 'expense', 1598, 'c_fun', 18),
  ];

  const transactions = [];
  const add = (date, categoryId, cents, note, kind = 'expense') =>
    transactions.push({ id: `demo-${transactions.length}`, date, kind, amount: cents, categoryId, note, updatedAt: 1 });
  for (const month of monthRange(first, monthOf(today))) {
    for (let day = 1; day <= daysInMonth(month); day += 1) {
      const date = dateInMonth(month, day);
      if (date > today) break;
      if (random() < 0.55) add(date, 'c_food', amount(4, 26), pick(['Lunch', 'Coffee', 'Dinner out', 'Food court', 'Brunch', 'Bubble tea', 'Takeaway']));
      if (random() < 0.2) add(date, 'c_groceries', amount(35, 115), pick(['Supermarket', 'Groceries', 'Market run']));
      if (random() < 0.4) add(date, 'c_transport', amount(2, 16), pick(['Train', 'Bus', 'Taxi']));
      if (random() < 0.07) add(date, 'c_shopping', amount(20, 140), pick(['New shoes', 'Books', 'Homeware', 'Gift for Sam']));
      if (random() < 0.06) add(date, 'c_fun', amount(12, 60), pick(['Cinema', 'Concert tickets', 'Bowling']));
      if (random() < 0.03) add(date, 'c_health', amount(15, 70), pick(['Pharmacy', 'Clinic visit']));
      if (day === 8) add(date, 'c_utilities', amount(70, 130), 'Electricity & water');
      if (random() < 0.02) add(date, 'c_other_income', amount(40, 300), pick(['Sold old bike', 'Cashback', 'Freelance job']), 'income');
    }
  }
  state.transactions = transactions;

  const monthly = (prefix, cents, day) =>
    monthRange(first, addMonths(monthOf(today), -1)).map((month, i) => ({ id: `${prefix}-${i}`, date: dateInMonth(month, day), amount: cents, updatedAt: 1 }));
  state.goals = [
    {
      id: 'demo-goal-emergency', name: 'Emergency fund', target: 1500000, deadline: null, updatedAt: 1,
      plan: { type: 'percent', value: 10 }, buffer: true,
      contributions: [{ id: 'demo-ef-start', date: start(1), amount: 450000, updatedAt: 1 }, ...monthly('demo-ef', 50000, 26)],
    },
    {
      id: 'demo-goal-trip', name: 'Trip to Japan', target: 400000, deadline: dateInMonth(addMonths(monthOf(today), 5), 15), updatedAt: 1,
      plan: { type: 'schedule' }, schedule: { type: 'target', within: null },
      contributions: monthly('demo-trip', 25000, 27),
    },
    {
      id: 'demo-goal-gifts', name: 'Gifts', target: null, deadline: null, updatedAt: 1, categoryId: 'c_shopping',
      contributions: monthly('demo-gifts', 6000, 27),
    },
  ];
  // Presents are paid from the Gifts set-aside rather than from spending money.
  state.transactions = state.transactions.map((t) => (t.note === 'Gift for Sam' && t.amount <= 6000 ? { ...t, potId: 'demo-goal-gifts' } : t));
  return state;
}
