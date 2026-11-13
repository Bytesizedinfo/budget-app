import { balance, budgetSummary, goalProgress, inMonth, inRange, monthKey, potBalance, potEntries, rangeMonths, safeToSpend, spendPerDay, splitTotal, totals, trend } from '../js/calc.js';
import { addMonths, dateInMonth, daysInMonth, isValidDate, monthRange, monthsCovered, previousTimeframe, timeframe } from '../js/dates.js';
import { balanceSeries, facts, flowSeries, incomeUse, pace, timeBuckets, weekdaySpend } from '../js/insights.js';
import { importSpendSave } from '../js/import-spendsave.js';
import { mergeStates } from '../js/merge.js';
import { centsToInput, formatMoney, parseAmount } from '../js/money.js';
import { bufferCheck, defaultSplit, planChecks, planSplit, plannedFor, setAsideIn, setAsideInMonth, sortedGoals, sourcesOf, suggestSplit, toSplit, tryPay } from '../js/pots.js';
import { dueOccurrences, nextDate, occurrenceId, occurrenceIn, occurrencesBetween } from '../js/recurring.js';
import { createStore, emptyState, parseState, seedState, serialize } from '../js/store.js';
import { createSync, decodeBase64, encodeBase64 } from '../js/sync.js';
import { fakeGitHub } from './fake-github.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const assert = {
  equal(actual, expected, message = '') {
    if (actual !== expected) throw new Error(`${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
  deepEqual(actual, expected, message = '') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${message} expected ${b}, got ${a}`);
  },
  ok(value, message = 'expected a truthy value') {
    if (!value) throw new Error(message);
  },
  async rejects(promise, kind) {
    try {
      await promise;
    } catch (err) {
      if (kind && err.kind !== kind) throw new Error(`expected error kind "${kind}", got "${err.kind}": ${err.message}`);
      return;
    }
    throw new Error('expected the promise to reject');
  },
};

const tx = (id, date, amount, extra = {}) => ({ id, date, amount, kind: 'expense', categoryId: 'c_food', note: '', updatedAt: 1, ...extra });
// A set-aside's progress when nothing but its own contributions is involved.
const progress = (goal, today) => goalProgress(emptyState(), goal, today);

// ---------- money ----------

test('parseAmount reads plain, thousands and comma-decimal input', () => {
  assert.equal(parseAmount('12'), 1200);
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('12.50'), 1250);
  assert.equal(parseAmount('.99'), 99);
  assert.equal(parseAmount('1,234.56'), 123456);
  assert.equal(parseAmount('12,5'), 1250);
  assert.equal(parseAmount('S$ 40'), 4000);
  assert.equal(parseAmount('0.1'), 10);
});

test('parseAmount rejects unreadable input', () => {
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('1.2.3'), null);
  assert.equal(parseAmount('1.234'), null);
});

test('formatMoney uses each currency’s decimals and a true minus sign', () => {
  assert.ok(formatMoney(1250, 'USD').includes('12.50'), formatMoney(1250, 'USD'));
  assert.ok(!formatMoney(125000, 'JPY').includes('.'), formatMoney(125000, 'JPY'));
  assert.ok(formatMoney(-500, 'USD').startsWith('−'));
  assert.ok(formatMoney(500, 'USD', { sign: true }).startsWith('+'));
  assert.ok(!formatMoney(0, 'USD', { sign: true }).startsWith('+'));
});

test('dollar currencies other than USD show which dollar', () => {
  assert.ok(formatMoney(3600, 'SGD').includes('S$36.00'), formatMoney(3600, 'SGD'));
  assert.ok(formatMoney(-150000, 'AUD').includes('A$1,500.00'), formatMoney(-150000, 'AUD'));
  assert.ok(!formatMoney(100, 'USD').includes('US'), formatMoney(100, 'USD'));
});

test('centsToInput round-trips through parseAmount', () => {
  for (const cents of [0, 5, 99, 100, 1250, 123456]) assert.equal(parseAmount(centsToInput(cents, 'SGD')), cents);
  assert.equal(centsToInput(125000, 'JPY'), '1250');
});

// ---------- dates ----------

test('daysInMonth handles leap years', () => {
  assert.equal(daysInMonth('2024-02'), 29);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2026-12'), 31);
});

test('dateInMonth clamps day 31 to the end of short months', () => {
  assert.equal(dateInMonth('2026-02', 31), '2026-02-28');
  assert.equal(dateInMonth('2028-02', 30), '2028-02-29');
  assert.equal(dateInMonth('2026-04', 31), '2026-04-30');
  assert.equal(dateInMonth('2026-05', 1), '2026-05-01');
});

test('addMonths and monthRange cross year boundaries', () => {
  assert.equal(addMonths('2026-11', 3), '2027-02');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.deepEqual(monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(monthRange('2027-01', '2026-12'), []);
});

test('isValidDate rejects impossible dates', () => {
  assert.ok(isValidDate('2024-02-29'));
  assert.ok(!isValidDate('2026-02-29'));
  assert.ok(!isValidDate('2026-13-01'));
  assert.ok(!isValidDate('12/11/2026'));
});

// ---------- calculations ----------

test('totals splits income and spending', () => {
  const t = totals([tx('a', '2026-11-01', 1000), tx('b', '2026-11-02', 5000, { kind: 'income' }), tx('c', '2026-11-03', 250)]);
  assert.deepEqual(t, { income: 5000, expense: 1250, net: 3750 });
});

test('budgetSummary separates budgeted, over-budget and unbudgeted spending', () => {
  const state = seedState('SGD');
  state.categories = state.categories.map((c) => (c.id === 'c_food' ? { ...c, monthlyBudget: 10000 } : c));
  state.transactions = [
    tx('a', '2026-11-01', 8000),
    tx('b', '2026-11-05', 4000),
    tx('c', '2026-11-05', 3000, { categoryId: 'c_fun' }),
    tx('d', '2026-11-07', 900, { categoryId: 'gone' }),
    tx('e', '2026-10-30', 99999),
  ];
  const s = budgetSummary(state, '2026-11');
  assert.equal(s.totalBudget, 10000);
  assert.equal(s.budgetedSpent, 12000);
  assert.equal(s.unbudgeted, 3900);
  assert.equal(s.rows.find((r) => r.category.id === 'c_food').spent, 12000);
});

test('trend covers twelve months ending at the chosen month', () => {
  const state = emptyState();
  state.transactions = [tx('a', '2026-11-01', 100), tx('b', '2025-12-31', 200), tx('c', '2025-11-30', 400)];
  const rows = trend(state, '2026-11');
  assert.equal(rows.length, 12);
  assert.equal(rows[0].month, '2025-12');
  assert.equal(rows[0].expense, 200);
  assert.equal(rows[11].expense, 100);
});

test('goalProgress works out the monthly amount needed', () => {
  const goal = { target: 120000, deadline: '2027-04-30', contributions: [{ id: 'x', amount: 20000 }] };
  const p = progress(goal, '2026-11-12');
  assert.equal(p.saved, 20000);
  assert.equal(p.remaining, 100000);
  assert.equal(p.perMonth, Math.ceil(100000 / 6));
  assert.ok(progress({ ...goal, deadline: '2026-10-01' }, '2026-11-12').overdue);
  assert.ok(progress({ ...goal, contributions: [{ id: 'y', amount: 130000 }] }, '2026-11-12').done);
});

// ---------- recurring ----------

const rule = (extra = {}) => ({ id: 'rent', name: 'Rent', kind: 'expense', amount: 200000, categoryId: 'c_housing', startDate: '2026-08-31', endDate: null, paused: false, updatedAt: 1, ...extra });

test('recurring catches up on missed months with clamped dates', () => {
  const state = { ...emptyState(), recurring: [rule()] };
  const due = dueOccurrences(state, '2026-11-12');
  assert.deepEqual(due.map((t) => t.date), ['2026-08-31', '2026-09-30', '2026-10-31']);
  assert.equal(due[0].id, occurrenceId('rent', '2026-08'));
  assert.equal(due[0].note, 'Rent');
});

test('recurring is idempotent once occurrences exist', () => {
  const state = { ...emptyState(), recurring: [rule()] };
  state.transactions = dueOccurrences(state, '2026-11-12');
  assert.equal(dueOccurrences(state, '2026-11-12').length, 0);
});

test('recurring skips paused rules, deleted occurrences and dates past the end', () => {
  assert.equal(dueOccurrences({ ...emptyState(), recurring: [rule({ paused: true })] }, '2026-11-12').length, 0);
  const deleted = { [occurrenceId('rent', '2026-09')]: 5 };
  assert.deepEqual(dueOccurrences({ ...emptyState(), deleted, recurring: [rule()] }, '2026-11-12').map((t) => t.date), ['2026-08-31', '2026-10-31']);
  assert.deepEqual(dueOccurrences({ ...emptyState(), recurring: [rule({ endDate: '2026-09-30' })] }, '2026-11-12').map((t) => t.date), ['2026-08-31', '2026-09-30']);
});

test('recurring restarts from the resume date after a pause', () => {
  const due = dueOccurrences({ ...emptyState(), recurring: [rule({ startDate: '2026-06-01', resumeDate: '2026-10-15' })] }, '2026-12-02');
  assert.deepEqual(due.map((t) => t.date), ['2026-11-01', '2026-12-01']);
});

test('nextDate finds the next upcoming occurrence', () => {
  assert.equal(nextDate(rule(), '2026-11-12'), '2026-11-30');
  assert.equal(nextDate(rule(), '2026-11-30'), '2026-12-31');
  assert.equal(nextDate(rule({ startDate: '2027-01-15' }), '2026-11-12'), '2027-01-15');
  assert.equal(nextDate(rule({ endDate: '2026-11-01' }), '2026-11-12'), null);
  assert.equal(nextDate(rule({ paused: true }), '2026-11-12'), null);
});

test('occurrenceIn respects start, pause, resume and end dates', () => {
  assert.equal(occurrenceIn(rule(), '2027-02'), '2027-02-28');
  assert.equal(occurrenceIn(rule(), '2026-07'), null, 'before it starts');
  assert.equal(occurrenceIn(rule({ paused: true }), '2026-11'), null);
  assert.equal(occurrenceIn(rule({ endDate: '2026-10-31' }), '2026-11'), null);
  assert.equal(occurrenceIn(rule({ resumeDate: '2026-11-15' }), '2026-10'), null);
  assert.equal(occurrenceIn(rule({ resumeDate: '2026-11-15' }), '2026-11'), '2026-11-30');
});

// ---------- safe to spend & balance ----------

const limitState = (transactions) => {
  const state = seedState('SGD');
  state.settings.spendingLimit = 20000;
  state.transactions = transactions;
  state.recurring = [
    rule({ id: 'phone', amount: 3000, startDate: '2026-11-20', categoryId: 'c_utilities' }),
    rule({ id: 'gym', amount: 2000, startDate: '2026-09-05' }),
    rule({ id: 'pay', kind: 'income', amount: 80000, startDate: '2026-11-25' }),
  ];
  return state;
};

test('safe to spend: bills still to come are set aside, the rest spread over the days left', () => {
  const s = safeToSpend(limitState([
    tx('a', '2026-11-03', 5000), tx('b', '2026-11-12', 1000), tx('i', '2026-11-05', 80000, { kind: 'income' }), tx('old', '2026-10-30', 9999),
  ]), '2026-11', '2026-11-12');
  assert.equal(s.spent, 6000);
  assert.equal(s.reserved, 3000, 'only the phone bill is still to come; income is never set aside');
  assert.equal(s.left, 11000);
  assert.equal(s.daysLeft, 19);
  assert.equal(s.perDay, Math.floor(12000 / 19));
  assert.equal(s.todayLeft, Math.floor(12000 / 19) - 1000);
  assert.equal(s.weekLeft, Math.floor((12000 * 4) / 19) - 1000, 'Thursday to Sunday');
  assert.equal(s.level, 'ok');
});

test('safe to spend: past and future months, deleted bills, and no limit', () => {
  const state = limitState([tx('old', '2026-10-30', 9999)]);
  const past = safeToSpend(state, '2026-10', '2026-11-12');
  assert.ok(past.past);
  assert.deepEqual([past.reserved, past.left, past.perDay], [0, 10001, null]);
  const future = safeToSpend(state, '2026-12', '2026-11-12');
  assert.ok(future.future);
  assert.deepEqual([future.reserved, future.left], [5000, 15000]);
  state.deleted = { [occurrenceId('phone', '2026-11')]: 1 };
  assert.equal(safeToSpend(state, '2026-11', '2026-11-12').reserved, 0, 'a deleted bill is not set aside');
  state.settings.spendingLimit = null;
  assert.equal(safeToSpend(state, '2026-11', '2026-11-12'), null);
});

test('safe to spend: warns when spending runs ahead, flags going over, ignores big bills', () => {
  assert.equal(safeToSpend(limitState([tx('a', '2026-11-03', 10000), tx('b', '2026-11-12', 1000)]), '2026-11', '2026-11-12').level, 'warn');
  const over = safeToSpend(limitState([tx('a', '2026-11-03', 18000)]), '2026-11', '2026-11-12');
  assert.deepEqual([over.left, over.level], [-1000, 'over']);
  const bill = safeToSpend(limitState([tx('r_rent', '2026-11-01', 12000, { recurringId: 'rent' })]), '2026-11', '2026-11-12');
  assert.equal(bill.level, 'ok', 'a large bill early in the month is not overspending');
});

test('balance: income minus spending, split into savings goals and spending money', () => {
  const state = seedState('SGD');
  state.transactions = [tx('i', '2026-09-01', 100000, { kind: 'income' }), tx('a', '2026-10-02', 25000), tx('later', '2026-12-01', 5000)];
  state.goals = [{ id: 'g', name: 'Trip', target: null, updatedAt: 1, contributions: [{ id: 'c1', date: '2026-09-01', amount: 40000 }, { id: 'c2', date: '2026-11-20', amount: 10000 }] }];
  assert.deepEqual(balance(state, '2026-11-12'), { total: 75000, savings: 40000, spending: 35000 });
  assert.deepEqual(balance(state, '2026-09-30'), { total: 100000, savings: 40000, spending: 60000 });
});

// ---------- store & merge ----------

test('store stamps edits and leaves tombstones on delete', () => {
  const store = createStore(seedState('SGD'));
  const saved = store.save('transactions', tx(undefined, '2026-11-01', 500));
  assert.ok(saved.id && saved.updatedAt > 1);
  store.remove('transactions', saved.id);
  assert.equal(store.get().transactions.length, 0);
  assert.ok(store.get().deleted[saved.id] > 0);
});

test('serialize and parseState round-trip', () => {
  const state = seedState('EUR');
  state.transactions = [tx('b', '2026-11-02', 1), tx('a', '2026-11-01', 2, { note: 'Café "quote" ✓' })];
  const back = parseState(serialize(state));
  assert.equal(back.settings.currency, 'EUR');
  assert.deepEqual(back.transactions.map((t) => t.id), ['a', 'b']);
  assert.equal(back.transactions[0].note, 'Café "quote" ✓');
});

test('parseState rejects files that are not budgets', () => {
  let threw = false;
  try {
    parseState('not json');
  } catch {
    threw = true;
  }
  assert.ok(threw);
});

test('merge: the newest edit of a record wins', () => {
  const a = { ...emptyState(), transactions: [tx('t', '2026-11-01', 100, { updatedAt: 5 })] };
  const b = { ...emptyState(), transactions: [tx('t', '2026-11-01', 999, { updatedAt: 9 })] };
  assert.equal(mergeStates(a, b).transactions[0].amount, 999);
  assert.equal(mergeStates(b, a).transactions[0].amount, 999);
});

test('merge: a delete on either side wins over an edit', () => {
  const a = { ...emptyState(), transactions: [tx('t', '2026-11-01', 100, { updatedAt: 50 })] };
  const b = { ...emptyState(), deleted: { t: 10 } };
  assert.equal(mergeStates(a, b).transactions.length, 0);
  assert.equal(mergeStates(b, a).transactions.length, 0);
});

test('merge: records added on both sides are all kept', () => {
  const a = { ...emptyState(), transactions: [tx('x', '2026-11-01', 1)] };
  const b = { ...emptyState(), transactions: [tx('y', '2026-11-02', 2)] };
  assert.deepEqual(mergeStates(a, b).transactions.map((t) => t.id).sort(), ['x', 'y']);
});

test('merge: goal contributions from both devices are combined', () => {
  const goal = (updatedAt, name, contributions) => ({ id: 'g', name, target: 1000, updatedAt, contributions });
  const a = { ...emptyState(), goals: [goal(5, 'Trip', [{ id: 'c1', amount: 100, updatedAt: 5 }, { id: 'c3', amount: 1, updatedAt: 2 }])] };
  const b = { ...emptyState(), goals: [goal(7, 'Japan trip', [{ id: 'c2', amount: 200, updatedAt: 7 }])], deleted: { c3: 6 } };
  const merged = mergeStates(a, b).goals[0];
  assert.equal(merged.name, 'Japan trip');
  assert.deepEqual(merged.contributions.map((c) => c.id).sort(), ['c1', 'c2']);
});

test('goals without a target are open-ended pots', () => {
  const p = progress({ target: null, contributions: [{ id: 'a', amount: 5000 }, { id: 'b', amount: -1000 }] }, '2026-11-12');
  assert.ok(p.open);
  assert.equal(p.saved, 4000);
  assert.ok(!p.done);
});

test('parseState rejects JSON that is not a budget', () => {
  let threw = false;
  try {
    parseState('{"app":"something-else"}');
  } catch {
    threw = true;
  }
  assert.ok(threw);
});

// ---------- Spend & Save import (synthetic sample data) ----------

const spendSaveBackup = () => ({
  app: 'spend-save',
  v: 1,
  exported: '2026-10-01T00:00:00.000Z',
  settings: {
    symbol: 'RM',
    labels: [{ id: 'food', name: 'Food & drinks' }, { id: 'shopping', name: 'Shopping' }, { id: 'pets', name: 'Pet supplies' }],
    incomeCats: [{ id: 'salary', name: 'Salary' }, { id: 'tutoring', name: 'Tutoring' }],
    saveCats: [
      { id: 'holiday', name: 'Holiday', start: 50, target: 0 },
      { id: 'laptop', name: 'New laptop', start: 0, target: 1200, date: '2027-06-30', goal: true },
      { id: 'rainy', name: 'Rainy day', start: 0, target: 0 },
    ],
  },
  months: {
    'm-2026-08': { tx: [{ id: 'a1', t: 'in', amt: 1000, cat: 'salary', d: '2026-08-28', note: '', save: { holiday: 150, laptop: 100 }, spend: 750 }] },
    'm-2026-09': {
      tx: [
        { id: 'b1', t: 'out', amt: 12.5, label: 'food', d: '2026-09-02', note: 'Lunch', from: 'spend' },
        { id: 'b2', t: 'out', amt: 4.2, label: '', d: '2026-09-03', note: 'food', from: 'spend' },
        { id: 'b3', t: 'out', amt: 30, label: 'pets', d: '2026-09-04', note: 'Cat food', from: 'spend' },
        { id: 'b4', t: 'in', amt: 80, d: '2026-09-05', note: '', save: {}, spend: 80 },
        { id: 'b5', t: 'out', amt: 60, label: 'other', d: '2026-09-06', note: 'Flight deposit', from: 'holiday' },
        { id: 'b6', t: 'out', amt: 0, label: 'food', d: '2026-09-07', note: 'zero' },
      ],
    },
  },
});

test('import: transactions, categories and currency come across', () => {
  const { state, summary } = importSpendSave(spendSaveBackup(), seedState('SGD'));
  const byId = Object.fromEntries(state.transactions.map((t) => [t.id, t]));
  assert.equal(state.transactions.length, 6);
  assert.equal(summary.skipped, 1);
  assert.equal(state.settings.currency, 'MYR');
  assert.equal(byId['ss-b1'].amount, 1250);
  assert.equal(byId['ss-b1'].categoryId, 'c_food');
  assert.equal(state.categories.find((c) => c.id === 'c_food').name, 'Food & drinks');
  assert.equal(byId['ss-b2'].categoryId, 'c_food', 'uncategorised expense noted "food"');
  assert.equal(byId['ss-b3'].categoryId, 'ss-expense-pets');
  assert.equal(byId['ss-b4'].categoryId, 'c_other_income', 'income without a category');
  assert.equal(byId['ss-b5'].categoryId, 'c_other');
  assert.equal(byId['ss-a1'].kind, 'income');
});

test('import: savings pots become goals with their history', () => {
  const { state, summary } = importSpendSave(spendSaveBackup(), seedState('SGD'));
  const holiday = state.goals.find((g) => g.name === 'Holiday');
  const laptop = state.goals.find((g) => g.name === 'New laptop');
  assert.equal(holiday.target, null);
  assert.equal(progress(holiday, '2026-11-12').saved, 5000 + 15000 - 6000);
  assert.equal(laptop.target, 120000);
  assert.equal(laptop.deadline, '2027-06-30');
  assert.equal(progress(laptop, '2026-11-12').saved, 10000);
  assert.deepEqual(summary.emptyPots, ['Rainy day']);
});

test('import: unused starter categories are archived, used and matching ones kept', () => {
  const { state } = importSpendSave(spendSaveBackup(), seedState('SGD'));
  const archived = state.categories.filter((c) => c.archived).map((c) => c.id).sort();
  assert.deepEqual(archived, ['c_fun', 'c_groceries', 'c_health', 'c_housing', 'c_transport', 'c_utilities']);
});

test('import: running it again adds nothing and keeps later edits and deletions', () => {
  const store = createStore(seedState('SGD'));
  store.replace(importSpendSave(spendSaveBackup(), store.get()).state, 'local');
  const lunch = store.get().transactions.find((t) => t.id === 'ss-b1');
  store.save('transactions', { ...lunch, note: 'Lunch with Sam' });
  store.remove('transactions', 'ss-b3');
  const counts = [store.get().transactions.length, store.get().categories.length, store.get().goals.length];
  const again = importSpendSave(spendSaveBackup(), store.get()).state;
  assert.deepEqual([again.transactions.length, again.categories.length, again.goals.length], counts);
  assert.equal(again.transactions.find((t) => t.id === 'ss-b1').note, 'Lunch with Sam');
  assert.ok(!again.transactions.some((t) => t.id === 'ss-b3'));
  assert.equal(progress(again.goals.find((g) => g.name === 'Holiday'), '2026-11-12').saved, 14000);
});

test('import: monthly bills become recurring items from their next due date', () => {
  const backup = spendSaveBackup();
  backup.settings.subs = [
    { id: 's1', name: 'Phone plan', amount: 28, cycle: 'monthly', day: 15, next: '2026-11-15', label: 'shopping', active: true, from: 'spend' },
    { id: 's2', name: 'Domain', amount: 20, cycle: 'yearly', next: '2027-03-01', label: 'shopping', active: true },
    { id: 's3', name: 'Old gym', amount: 50, cycle: 'monthly', next: '2026-12-02', label: 'unknown', active: false },
  ];
  const store = createStore(seedState('SGD'));
  const first = importSpendSave(backup, store.get());
  store.replace(first.state, 'local');
  const phone = store.get().recurring.find((r) => r.id === 'ss-sub-s1');
  assert.deepEqual([phone.name, phone.kind, phone.amount, phone.startDate, phone.categoryId, phone.paused], ['Phone plan', 'expense', 2800, '2026-11-15', 'c_shopping', false]);
  const gym = store.get().recurring.find((r) => r.id === 'ss-sub-s3');
  assert.ok(gym.paused, 'inactive bills come in paused');
  assert.equal(gym.categoryId, 'c_other');
  assert.deepEqual(first.summary.unsupportedRecurring, ['Domain']);
  assert.equal(importSpendSave(backup, store.get()).state.recurring.length, 2, 're-import adds no duplicates');
});

test('import: moves shift money between pots, without double-counting linked ones', () => {
  const backup = spendSaveBackup();
  backup.months['m-2026-09'].tx.push(
    { id: 'm1', t: 'move', amt: 25, from: 'holiday', to: 'laptop', d: '2026-09-10', note: '' },
    { id: 'm2', t: 'move', amt: 40, from: 'spend', to: 'holiday', d: '2026-09-11', note: '', via: 'a1' },
    { id: 'm3', t: 'transfer', amt: 5, d: '2026-09-12' },
  );
  const { state, summary } = importSpendSave(backup, seedState('SGD'));
  const saved = (name) => progress(state.goals.find((g) => g.name === name), '2026-11-12').saved;
  assert.equal(saved('Holiday'), 14000 - 2500);
  assert.equal(saved('New laptop'), 10000 + 2500);
  assert.equal(state.transactions.length, 6, 'moves are not income or spending');
  assert.equal(summary.moves, 2);
  assert.equal(summary.skipped, 2, 'the zero amount and the unknown entry type');
});

test('import: the overall budget becomes the monthly spending limit unless one is set', () => {
  const backup = spendSaveBackup();
  backup.settings.budget = { amt: 200, per: 'month' };
  assert.equal(importSpendSave(backup, seedState('SGD')).state.settings.spendingLimit, 20000);
  const withLimit = seedState('SGD');
  withLimit.settings.spendingLimit = 50000;
  assert.equal(importSpendSave(backup, withLimit).state.settings.spendingLimit, 50000);
  backup.settings.budget = { amt: 50, per: 'week' };
  assert.equal(importSpendSave(backup, seedState('SGD')).state.settings.spendingLimit, Math.round((5000 * 52) / 12));
});

test('import: an existing goal with the same name is reused, not duplicated', () => {
  const state = seedState('SGD');
  state.goals = [{ id: 'mine', name: 'holiday', target: 300000, deadline: null, updatedAt: 99, contributions: [{ id: 'x', date: '2026-07-01', amount: 2000, updatedAt: 99 }] }];
  const goal = importSpendSave(spendSaveBackup(), state).state.goals.find((g) => g.id === 'mine');
  assert.equal(goal.target, 300000, 'keeps its own target');
  assert.equal(progress(goal, '2026-11-12').saved, 2000 + 14000);
});

// ---------- sync (against a fake GitHub) ----------

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}

const noTimers = { setTimeout: () => 0, clearTimeout: () => {} };
const CONFIG = { owner: 'me', repo: 'budget-data', path: 'budget.json', token: 'good' };

function setup(server, storage = memoryStorage(), isOnline = () => true) {
  const store = createStore();
  const sync = createSync({ store, storage, fetchImpl: server.fetch, timers: noTimers, online: isOnline });
  return { store, sync, storage };
}

test('base64 helpers survive non-ASCII text', () => {
  const text = 'Café ☕ – 東京 🍣';
  assert.equal(decodeBase64(encodeBase64(text)), text);
});

test('sync: connecting creates the budget file when it is missing', async () => {
  const server = fakeGitHub();
  const { store, sync } = setup(server);
  await sync.connect(CONFIG);
  assert.ok(server.file, 'file was created');
  assert.equal(server.state().categories.length, store.get().categories.length);
  assert.ok(store.get().categories.length > 5);
  assert.equal(sync.status.state, 'synced');
});

test('sync: connecting refuses a public repository', async () => {
  const { sync } = setup(fakeGitHub({ isPrivate: false }));
  await assert.rejects(sync.connect(CONFIG), 'public');
  assert.ok(!sync.configured);
});

test('sync: connecting with a bad token reports an auth error', async () => {
  const { sync } = setup(fakeGitHub());
  await assert.rejects(sync.connect({ ...CONFIG, token: 'wrong' }), 'auth');
});

test('sync: a local edit is pushed to GitHub', async () => {
  const server = fakeGitHub();
  const { store, sync } = setup(server);
  await sync.connect(CONFIG);
  store.save('transactions', tx('t1', '2026-11-01', 450));
  assert.ok(sync.dirty);
  await sync.syncNow();
  assert.ok(!sync.dirty);
  assert.deepEqual(server.state().transactions.map((t) => t.id), ['t1']);
});

test('sync: changes from another device are pulled in', async () => {
  const server = fakeGitHub();
  const { store, sync } = setup(server);
  await sync.connect(CONFIG);
  server.edit((s) => s.transactions.push(tx('remote', '2026-11-03', 700)));
  await sync.syncNow();
  assert.deepEqual(store.get().transactions.map((t) => t.id), ['remote']);
});

test('sync: a conflicting save is merged, keeping both devices’ edits', async () => {
  const server = fakeGitHub();
  const { store, sync } = setup(server);
  await sync.connect(CONFIG);
  server.edit((s) => s.transactions.push(tx('phone', '2026-11-03', 700)));
  store.save('transactions', tx('laptop', '2026-11-04', 300));
  await sync.syncNow();
  assert.equal(sync.status.state, 'synced');
  assert.deepEqual(server.state().transactions.map((t) => t.id).sort(), ['laptop', 'phone']);
  assert.deepEqual(store.get().transactions.map((t) => t.id).sort(), ['laptop', 'phone']);
});

test('sync: offline edits are kept and pushed after reconnecting', async () => {
  const server = fakeGitHub();
  const { store, sync, storage } = setup(server);
  await sync.connect(CONFIG);
  server.offline = true;
  store.save('transactions', tx('offline', '2026-11-05', 120));
  await sync.syncNow();
  assert.equal(sync.status.state, 'offline');
  assert.ok(JSON.parse(storage.getItem('budget:cache')).dirty, 'pending flag saved on device');
  server.offline = false;
  await sync.syncNow();
  assert.equal(sync.status.state, 'synced');
  assert.deepEqual(server.state().transactions.map((t) => t.id), ['offline']);
});

test('sync: unsynced edits survive a reload and push on the next start', async () => {
  const server = fakeGitHub();
  const first = setup(server);
  await first.sync.connect(CONFIG);
  server.offline = true;
  first.store.save('transactions', tx('pending', '2026-11-06', 80));
  await first.sync.syncNow();
  server.offline = false;
  const second = setup(server, first.storage);
  assert.ok(second.sync.configured);
  await second.sync.start();
  assert.deepEqual(second.store.get().transactions.map((t) => t.id), ['pending']);
  assert.deepEqual(server.state().transactions.map((t) => t.id), ['pending']);
});

test('sync: an expired token asks for a new one, then resumes', async () => {
  const server = fakeGitHub();
  const { store, sync } = setup(server);
  await sync.connect(CONFIG);
  server.token = 'rotated';
  store.save('transactions', tx('t', '2026-11-07', 10));
  await sync.syncNow();
  assert.equal(sync.status.state, 'auth');
  await sync.updateToken('rotated');
  assert.equal(sync.status.state, 'synced');
  assert.deepEqual(server.state().transactions.map((t) => t.id), ['t']);
});

test('sync: no requests are made while the browser reports offline', async () => {
  const server = fakeGitHub();
  let isOnline = true;
  const { sync } = setup(server, memoryStorage(), () => isOnline);
  await sync.connect(CONFIG);
  const before = server.gets;
  isOnline = false;
  await sync.syncNow();
  assert.equal(sync.status.state, 'offline');
  assert.equal(server.gets, before);
});

test('sync: a budget file deleted on GitHub is recreated', async () => {
  const server = fakeGitHub();
  const { store, sync } = setup(server);
  await sync.connect(CONFIG);
  store.save('transactions', tx('keep', '2026-11-08', 10));
  await sync.syncNow();
  server.file = null;
  server.sha = null;
  await sync.syncNow();
  assert.deepEqual(server.state().transactions.map((t) => t.id), ['keep']);
});


// ---------- time frames, pay counted in the month it's for, spend per day ----------

test('pay marked for the next month counts in that month, while the balance keeps its real date', () => {
  const pay = tx('p', '2026-10-26', 80000, { kind: 'income', month: '2026-11' });
  const list = [pay, tx('a', '2026-11-03', 1000), tx('b', '2026-10-27', 500)];
  assert.equal(monthKey(pay), '2026-11');
  assert.equal(monthKey(list[1]), '2026-11');
  assert.deepEqual(totals(inMonth(list, '2026-11')), { income: 80000, expense: 1000, net: 79000 });
  assert.deepEqual(totals(inMonth(list, '2026-10')), { income: 0, expense: 500, net: -500 });
  const state = seedState('SGD');
  state.transactions = list;
  const rows = trend(state, '2026-11', 2);
  assert.deepEqual(rows.map((r) => [r.month, r.income]), [['2026-10', 0], ['2026-11', 80000]]);
  assert.equal(balance(state, '2026-10-31').total, 79500, 'the money was there from 26 Oct');
});

test('timeframes: quick picks and custom dates', () => {
  const today = '2026-11-12'; // a Thursday
  assert.deepEqual([timeframe('today', today).from, timeframe('today', today).to], [today, today]);
  assert.deepEqual([timeframe('week', today).from, timeframe('week', today).to], ['2026-11-09', '2026-11-15']);
  assert.deepEqual([timeframe('last7', today).from, timeframe('last7', today).to], ['2026-11-06', today]);
  assert.deepEqual([timeframe('last30', today).from, timeframe('last30', today).to], ['2026-10-14', today]);
  assert.deepEqual([timeframe('month', today).month, timeframe('month', today).to], ['2026-11', '2026-11-30']);
  assert.equal(timeframe('lastmonth', today).month, '2026-10');
  assert.deepEqual([timeframe('year', today).from, timeframe('year', today).to], ['2026-01-01', '2026-12-31']);
  assert.equal(timeframe('all', today).from, '0000-01-01');
  const custom = timeframe('custom', today, { from: '2026-11-25', to: '2026-10-26' });
  assert.deepEqual([custom.from, custom.to, custom.month], ['2026-10-26', '2026-11-25', undefined], 'reversed dates are swapped');
  assert.equal(timeframe('custom', today, {}).from, '2026-10-14', 'no dates yet: the last 30 days');
});

test('inRange: whole months use the month an entry counts in, other ranges the date', () => {
  const pay = tx('p', '2026-10-26', 80000, { kind: 'income', month: '2026-11' });
  const list = [pay, tx('a', '2026-11-03', 1000)];
  assert.equal(inRange(list, timeframe('month', '2026-11-12')).length, 2);
  assert.equal(inRange(list, timeframe('lastmonth', '2026-11-12')).length, 0);
  assert.equal(inRange(list, timeframe('custom', '2026-11-12', { from: '2026-10-26', to: '2026-10-31' })).length, 1, 'by date');
  assert.equal(inRange(list, timeframe('last30', '2026-11-12')).length, 2);
  assert.equal(inRange(list, timeframe('all', '2026-11-12')).length, 2);
});

test('previousTimeframe: the stretch just before, of the same length', () => {
  const today = '2026-11-12';
  assert.equal(previousTimeframe(timeframe('month', today)).month, '2026-10');
  assert.equal(previousTimeframe(timeframe('lastmonth', today)).month, '2026-09');
  const p7 = previousTimeframe(timeframe('last7', today));
  assert.deepEqual([p7.from, p7.to], ['2026-10-30', '2026-11-05']);
  assert.equal(previousTimeframe(timeframe('year', today)).from, '2025-01-01');
  assert.equal(previousTimeframe(timeframe('today', today)).from, '2026-11-11');
  assert.equal(previousTimeframe(timeframe('all', today)), null);
});

test('spend per day comes from the money you have, less bills still to come', () => {
  const state = seedState('SGD');
  state.transactions = [tx('i', '2026-11-01', 100000, { kind: 'income' }), tx('a', '2026-11-12', 2000), tx('old', '2026-11-02', 3000)];
  state.goals = [{ id: 'g', name: 'Trip', target: null, updatedAt: 1, contributions: [{ id: 'c', date: '2026-11-01', amount: 40000 }] }];
  state.recurring = [rule({ id: 'phone', amount: 3000, startDate: '2026-11-20' }), rule({ id: 'gym', amount: 2000, startDate: '2026-11-05' })];
  const d = spendPerDay(state, '2026-11-12');
  assert.equal(d.spending, 100000 - 2000 - 3000 - 40000);
  assert.equal(d.reserved, 3000, 'only the phone bill is still to come this month');
  assert.equal(d.daysLeft, 19);
  assert.equal(d.spentToday, 2000);
  assert.equal(d.perDay, Math.floor((55000 - 3000 + 2000) / 19));
  assert.equal(d.todayLeft, d.perDay - 2000);
  state.transactions.push(tx('big', '2026-11-11', 60000));
  const short = spendPerDay(state, '2026-11-12');
  assert.ok(short.free < 0 && short.perDay === 0, 'nothing left after bills');
});

test('import: pay meant for the next month counts there, and an earlier import gets fixed', () => {
  const backup = spendSaveBackup();
  backup.months['m-2026-08'].tx[0].for = '2026-09';
  const { state } = importSpendSave(backup, seedState('SGD'));
  assert.equal(state.transactions.find((t) => t.id === 'ss-a1').month, '2026-09');
  // An import from before this change has no month; importing again marks it, unless it was edited since.
  const old = { ...state, transactions: state.transactions.map((t) => (t.id === 'ss-a1' ? (({ month, ...rest }) => rest)(t) : t)) };
  const fixed = importSpendSave(backup, old);
  assert.equal(fixed.state.transactions.find((t) => t.id === 'ss-a1').month, '2026-09');
  assert.equal(fixed.summary.countsIn, 1);
  const edited = { ...old, transactions: old.transactions.map((t) => (t.id === 'ss-a1' ? { ...t, amount: 99, updatedAt: Date.now() } : t)) };
  assert.equal(importSpendSave(backup, edited).state.transactions.find((t) => t.id === 'ss-a1').month, undefined, 'an edited entry is left alone');
});


// ---------- set-asides, default splits, planning and insights ----------

const pot = (id, extra = {}) => ({ id, name: id, target: null, deadline: null, updatedAt: 1, contributions: [], ...extra });
const potState = () => {
  const state = seedState('SGD');
  state.goals = [pot('save', { contributions: [{ id: 'c1', date: '2026-10-01', amount: 30000 }] }), pot('trip'), pot('pods', { target: 34900, deadline: '2027-02-28' })];
  state.transactions = [
    tx('pay', '2026-11-01', 100000, { kind: 'income', categoryId: 'c_salary', split: { save: 20000, trip: 10000 } }),
    tx('food', '2026-11-05', 4000),
    tx('ticket', '2026-11-06', 6000, { potId: 'trip' }),
  ];
  return state;
};

test('set-aside balances: money added by hand, income splits and expenses paid from it', () => {
  const state = potState();
  const [save, trip] = state.goals;
  assert.equal(potBalance(state, save), 50000);
  assert.equal(potBalance(state, trip), 4000);
  assert.equal(potBalance(state, save, '2026-10-31'), 30000, 'before the pay arrived');
  assert.deepEqual(potEntries(state, trip).map((e) => [e.kind, e.amount]), [['split', 10000], ['paid', -6000]]);
  // total = 100000 - 4000 - 6000; set aside = 50000 + 4000.
  assert.deepEqual(balance(state, '2026-11-12'), { total: 90000, savings: 54000, spending: 36000 });
  assert.equal(goalProgress(state, save, '2026-11-12').saved, 50000);
  assert.equal(splitTotal(state, state.transactions[0]), 30000);
});

test('set-asides: paying from one leaves spending money and the limit alone; an overdrawn one counts as empty', () => {
  const state = potState();
  const before = balance(state, '2026-11-12').spending;
  state.transactions.push(tx('more', '2026-11-12', 3000, { potId: 'trip' }));
  assert.equal(balance(state, '2026-11-12').spending, before, 'paid from the set-aside');
  assert.equal(spendPerDay(state, '2026-11-12').spentToday, 0, 'not counted as today’s spending');
  state.settings.spendingLimit = 50000;
  const safe = safeToSpend(state, '2026-11', '2026-11-12');
  assert.equal(safe.spent, 4000);
  assert.equal(safe.fromPots, 9000);
  state.transactions.push(tx('over', '2026-11-12', 5000, { potId: 'trip' })); // 4000 - 3000 - 5000 = -4000
  assert.equal(potBalance(state, state.goals[1]), -4000);
  assert.equal(balance(state, '2026-11-12').savings, 50000, 'the overdrawn set-aside adds nothing');
  // Deleting a set-aside puts its money back into spending money, and its expenses count as ordinary spending.
  state.goals = state.goals.filter((g) => g.id !== 'trip');
  assert.equal(splitTotal(state, state.transactions[0]), 20000);
  assert.equal(safeToSpend(state, '2026-11', '2026-11-12').fromPots, 0);
});

test('default splits: the general default, a category with its own split, and one that keeps it all', () => {
  const state = potState();
  state.goals[0].plan = { type: 'percent', value: 20 };
  state.goals[1].plan = { type: 'fixed', value: 10000 };
  const cat = (id, split) => { state.categories = state.categories.map((c) => (c.id === id ? { ...c, split } : c)); };
  assert.equal(defaultSplit(state, 'c_salary').source, 'general');
  assert.deepEqual([...defaultSplit(state, 'c_salary').rules.keys()], ['save', 'trip']);
  cat('c_other_income', 'keep');
  assert.deepEqual([defaultSplit(state, 'c_other_income').source, defaultSplit(state, 'c_other_income').rules.size], ['keep', 0]);
  cat('c_salary', { save: { type: 'percent', value: 50 }, gone: { type: 'fixed', value: 500 }, trip: { type: 'fixed', value: 0 } });
  const own = defaultSplit(state, 'c_salary');
  assert.equal(own.source, 'own');
  assert.deepEqual([...own.rules], [['save', { type: 'percent', value: 50 }]], 'a deleted set-aside and an empty rule are ignored');
  assert.deepEqual(sourcesOf(state, state.goals[0]).map((s) => [s.categoryId, s.rule.value]), [[null, 20], ['c_salary', 50]]);
  assert.deepEqual(suggestSplit(state, tx('x', '2026-12-01', 50000, { kind: 'income', categoryId: 'c_other_income' })), {});
  assert.deepEqual(suggestSplit(state, tx('y', '2026-12-01', 50000, { kind: 'income', categoryId: 'c_salary' })), { save: 25000 });
});

test('split suggestions: percentages, fixed amounts a month, the target cap and priority order', () => {
  const state = potState();
  state.transactions = [];
  state.goals[0].plan = { type: 'percent', value: 20 }; // save
  state.goals[1].plan = { type: 'fixed', value: 10000 }; // trip: 100 a month
  state.goals[2].plan = { type: 'fixed', value: 50000 }; // pods: target 349
  const pay = tx('p1', '2026-11-01', 100000, { kind: 'income', categoryId: 'c_salary' });
  assert.deepEqual(suggestSplit(state, pay), { save: 20000, trip: 10000, pods: 34900 }, 'pods stops at its target');
  // The first pay is split; a second income in the same month only tops the fixed amount up.
  state.transactions = [{ ...pay, split: { save: 20000, trip: 4000 } }];
  const second = tx('p2', '2026-11-20', 20000, { kind: 'income', categoryId: 'c_salary' });
  assert.deepEqual(suggestSplit(state, second), { save: 4000, trip: 6000, pods: 10000 }, 'trip gets the missing 60, pods what is left');
  assert.equal(planSplit(state, second).short, 34900 - 10000);
  // Re-opening the first pay's split doesn't count its own share as "already set aside".
  assert.equal(planSplit(state, state.transactions[0]).rows[1].want, 10000);
  // Pay that counts in the next month fills that month's fixed amount.
  const forDec = tx('p3', '2026-11-28', 100000, { kind: 'income', categoryId: 'c_salary', month: '2026-12' });
  assert.equal(suggestSplit(state, forDec).trip, 10000);
  // Priority order decides who is filled first when the income is small.
  state.goals[2].order = 0;
  assert.deepEqual(sortedGoals(state).map((g) => g.id), ['pods', 'save', 'trip']);
  assert.deepEqual(suggestSplit(state, tx('p4', '2026-12-05', 30000, { kind: 'income', categoryId: 'c_salary' })), { pods: 30000 });
});

test('try a pay amount: the split, bills still to come and what is left per day', () => {
  const state = potState();
  state.goals[0].plan = { type: 'percent', value: 20 };
  state.recurring = [rule({ id: 'phone', amount: 3000, startDate: '2026-11-20' })];
  const base = spendPerDay(state, '2026-11-12');
  const t = tryPay(state, { amount: 50000, categoryId: 'c_salary' }, '2026-11-12');
  assert.equal(t.setAside, 10000);
  assert.equal(t.keep, 40000);
  assert.equal(t.bills, 3000);
  assert.equal(t.free, base.free + 40000);
  assert.equal(t.perDay, Math.floor((base.free + 40000 + base.spentToday) / 19));
});

test('planned vs set aside for a time frame', () => {
  const state = potState();
  state.goals[0].plan = { type: 'percent', value: 10 };
  state.goals[1].plan = { type: 'fixed', value: 10000 };
  state.transactions.push(tx('side', '2026-11-15', 20000, { kind: 'income', categoryId: 'c_other_income' }));
  state.goals[0].contributions.push({ id: 'c2', date: '2026-11-10', amount: 5000 }, { id: 'c3', date: '2026-11-11', amount: -2000 }, { id: 'm1', date: '2026-11-12', amount: 7000, move: 'trip' });
  const nov = timeframe('month', '2026-11-12');
  const planned = plannedFor(state, inRange(state.transactions, nov));
  assert.deepEqual([...planned.byGoal], [['save', 12000], ['trip', 10000], ['pods', 0]], 'trip is topped up once a month');
  assert.equal(planned.income, 120000);
  const actual = setAsideIn(state, nov);
  assert.deepEqual([...actual.byGoal], [['save', 23000], ['trip', 10000], ['pods', 0]], 'moves and spending are left out');
  assert.equal(setAsideIn(state, timeframe('custom', '2026-11-12', { from: '2026-10-01', to: '2026-10-31' })).total, 30000);
});

test('plan checks: share of income, goal timelines and the safety buffer', () => {
  const state = potState();
  state.goals[0].plan = { type: 'percent', value: 20 };
  state.goals[0].buffer = true;
  state.goals[2].plan = { type: 'fixed', value: 6000 };
  state.transactions.push(tx('oct', '2026-10-10', 25000), tx('sep', '2026-09-10', 15000));
  const checks = planChecks(state, '2026-11-12');
  assert.equal(checks.share, 26000 / 100000);
  const pods = checks.goals[0];
  assert.deepEqual([pods.perMonth, pods.remaining, pods.status], [2000, 34900, 'behind']);
  assert.equal(pods.needed, Math.ceil(34900 / 4));
  assert.equal(checks.buffer.usual, 20000, 'the average of the full months with spending');
  assert.equal(checks.buffer.months, 50000 / 20000);
  assert.equal(bufferCheck({ ...state, goals: state.goals.map((g) => ({ ...g, buffer: false })) }, '2026-11-12'), null);
});

test('income waits to be split only from the day splitting was first used', () => {
  const state = potState();
  state.transactions.push(tx('late', '2026-11-20', 5000, { kind: 'income' }), tx('early', '2026-10-02', 5000, { kind: 'income' }), tx('kept', '2026-11-21', 100, { kind: 'income', split: 'kept' }));
  assert.deepEqual(toSplit(state), [], 'not before splitting has been used');
  state.settings.splitSince = '2026-11-01';
  assert.deepEqual(toSplit(state).map((t) => t.id), ['late']);
  assert.deepEqual(toSplit({ ...state, goals: [] }), []);
});

test('merge and store: splits travel with the income entry, and a move is one change', () => {
  const base = potState();
  const mine = { ...base, transactions: base.transactions.map((t) => (t.id === 'pay' ? { ...t, split: { save: 50000 }, updatedAt: 5 } : t)) };
  const theirs = { ...base, transactions: [...base.transactions, tx('new', '2026-11-09', 100, { potId: 'trip', updatedAt: 3 })] };
  const merged = mergeStates(mine, theirs);
  assert.deepEqual(merged.transactions.find((t) => t.id === 'pay').split, { save: 50000 });
  assert.equal(potBalance(merged, merged.goals[0]), 80000);
  assert.equal(merged.transactions.find((t) => t.id === 'new').potId, 'trip');
  const store = createStore(base);
  store.moveBetween('save', 'trip', { amount: 2500, date: '2026-11-12' });
  const after = store.get();
  assert.deepEqual([potBalance(after, after.goals[0]), potBalance(after, after.goals[1])], [47500, 6500]);
  assert.deepEqual(after.goals[1].contributions.map((c) => [c.amount, c.move]), [[2500, 'save']]);
  assert.equal(balance(after, '2026-11-12').savings, balance(base, '2026-11-12').savings, 'a move changes no totals');
  store.addContribution('trip', { amount: 100, date: '2026-10-28', month: '2026-11' });
  assert.equal(setAsideInMonth(store.get(), store.get().goals[1], '2026-11'), 10100);
});

test('budgets scale to the time frame', () => {
  assert.equal(monthsCovered('2026-11-01', '2026-11-30'), 1);
  assert.equal(monthsCovered('2026-01-01', '2026-12-31'), 12);
  assert.equal(monthsCovered('2026-11-01', '2026-11-15'), 0.5);
  assert.equal(monthsCovered('2026-10-17', '2026-11-15'), 15 / 31 + 0.5);
  const state = seedState('SGD');
  state.categories = state.categories.map((c) => (c.id === 'c_food' ? { ...c, monthlyBudget: 30000 } : c));
  state.transactions = [tx('a', '2026-10-20', 5000), tx('b', '2026-11-10', 7000), tx('first', '2026-09-16', 100)];
  const range = timeframe('custom', '2026-11-12', { from: '2026-10-17', to: '2026-11-15' });
  const food = budgetSummary(state, range, rangeMonths(range, state, '2026-11-12')).rows.find((r) => r.category.id === 'c_food');
  assert.deepEqual([food.spent, food.budget], [12000, Math.round(30000 * (15 / 31 + 0.5))]);
  assert.equal(rangeMonths(timeframe('month', '2026-11-12'), state, '2026-11-12'), 1);
  assert.equal(rangeMonths(timeframe('all', '2026-11-12'), state, '2026-11-12'), 0.5 + 1 + 12 / 30, 'from the first entry to today');
});

test('recurring: entries still to come between two dates', () => {
  const state = {
    ...emptyState(),
    recurring: [rule({ id: 'rent', startDate: '2026-01-31' }), rule({ id: 'gym', name: 'Gym', startDate: '2026-11-05', endDate: '2027-01-31' })],
    transactions: [{ id: occurrenceId('rent', '2026-12') }],
    deleted: { [occurrenceId('gym', '2026-12')]: 1 },
  };
  const list = occurrencesBetween(state, '2026-11-13', '2027-02-28');
  assert.deepEqual(list.map((o) => [o.rule.id, o.date]), [['rent', '2026-11-30'], ['gym', '2027-01-05'], ['rent', '2027-01-31'], ['rent', '2027-02-28']]);
  assert.equal(occurrencesBetween(state, '2026-11-13', '9999-12-31', 2).length, 3, 'open-ended ranges stop after the limit');
});

test('time buckets: days, then weeks, then months', () => {
  const day = timeBuckets({ from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual([day.size, day.buckets.length, day.buckets[29].from], ['day', 30, '2026-11-30']);
  const week = timeBuckets({ from: '2026-10-01', to: '2026-11-12' }); // 1 Oct 2026 is a Thursday
  assert.equal(week.size, 'week');
  assert.deepEqual([week.buckets[0].from, week.buckets[0].to, week.buckets[1].from], ['2026-10-01', '2026-10-04', '2026-10-05']);
  assert.equal(week.buckets.at(-1).to, '2026-11-12');
  const month = timeBuckets({ from: '2026-01-15', to: '2026-12-31' });
  assert.deepEqual([month.size, month.buckets.length, month.buckets[0].from, month.buckets[0].month], ['month', 12, '2026-01-15', '2026-01']);
});

test('money in and out per bucket, with early pay placed in the month it counts in', () => {
  const nov = timeframe('month', '2026-11-12');
  const list = [tx('p', '2026-10-26', 80000, { kind: 'income', month: '2026-11' }), tx('a', '2026-11-03', 1000), tx('b', '2026-11-03', 500), tx('c', '2026-11-30', 700)];
  const { rows } = flowSeries(inRange(list, nov), { from: nov.from, to: nov.to });
  assert.deepEqual([rows[0].income, rows[2].expense, rows[29].expense], [80000, 1500, 700]);
  const year = flowSeries(list, { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual([year.size, year.rows[9].income, year.rows[10].income, year.rows[10].expense], ['month', 0, 80000, 2200]);
});

test('spending pace: day by day against an even pace, and when the money runs out', () => {
  const state = seedState('SGD');
  state.transactions = [tx('i', '2026-11-01', 60000, { kind: 'income' }), tx('a', '2026-11-02', 10000), tx('b', '2026-11-10', 14000), tx('bill', '2026-11-05', 6000, { recurringId: 'r' })];
  const p = pace(state, '2026-11-10');
  assert.deepEqual([p.cumulative[0], p.cumulative[1], p.cumulative[4], p.cumulative[9]], [0, 10000, 16000, 30000]);
  assert.equal(p.affordable, 60000);
  assert.deepEqual([p.even[9], p.even[29]], [20000, 60000]);
  assert.equal(p.ahead, 10000, 'ahead of an even pace');
  assert.equal(p.perDay, 2400, 'bills are left out of the day-to-day pace');
  assert.equal(p.runOut, '2026-11-22', '30000 left at 2400 a day lasts 12 more days');
  state.transactions.push(tx('i2', '2026-11-10', 100000, { kind: 'income' }));
  assert.equal(pace(state, '2026-11-10').runOut, null, 'lasts the month');
});

test('where income went, spending by weekday and the balance over time', () => {
  const state = potState();
  const nov = timeframe('month', '2026-11-12');
  assert.deepEqual(incomeUse(state, nov), { income: 100000, spent: 4000, fromPots: 6000, setAside: 30000, kept: 66000 });
  const days = weekdaySpend(state.transactions, { from: '2026-11-02', to: '2026-11-30' }, '2026-11-12'); // 2 Nov is a Monday
  assert.deepEqual([days[0].count, days[3].count, days[4].count], [2, 2, 1]);
  assert.deepEqual([days[3].total, days[3].average, days[4].total], [4000, 2000, 6000]);
  const series = balanceSeries(state, { from: '2026-10-30', to: '2026-11-30' }, '2026-11-06');
  assert.deepEqual([series.length, series[0].total, series[0].savings, series.at(-1).total, series.at(-1).savings], [8, 0, 30000, 90000, 54000]);
});

test('import: income was split in Spend & Save already, and money set aside for next month counts there', () => {
  const backup = spendSaveBackup();
  backup.months['m-2026-08'].tx[0].for = '2026-09';
  const { state } = importSpendSave(backup, seedState('SGD'));
  assert.equal(state.transactions.find((t) => t.id === 'ss-a1').split, 'kept', 'not asked about again');
  const holiday = state.goals.find((g) => g.name === 'Holiday');
  // 150 set aside from pay meant for September, less the 60 flight deposit paid out of it in September.
  assert.equal(setAsideInMonth(state, holiday, '2026-09'), 15000 - 6000, 'set aside from pay meant for September');
  assert.equal(setAsideInMonth(state, holiday, '2026-08'), 5000, 'only the starting amount counts in August');
  state.settings.splitSince = '2026-01-01';
  assert.deepEqual(toSplit(state).map((t) => t.id), []);
});

test('insight facts: top category, biggest expense, daily average and no-spend days', () => {
  const state = seedState('SGD');
  state.transactions = [tx('i', '2026-11-01', 50000, { kind: 'income' }), tx('a', '2026-11-03', 3000), tx('b', '2026-11-03', 9000, { categoryId: 'c_fun' }), tx('c', '2026-11-08', 2000, { categoryId: 'c_fun' }), tx('old', '2026-10-20', 4000, { categoryId: 'c_fun' })];
  const nov = timeframe('month', '2026-11-12');
  const f = facts(state, nov, previousTimeframe(nov), '2026-11-12');
  assert.deepEqual([f.top.id, f.top.value, f.top.previous], ['c_fun', 11000, 4000]);
  assert.deepEqual([f.rise.id, f.rise.change], ['c_fun', 7000]);
  assert.equal(f.biggest.id, 'b');
  assert.deepEqual([f.daysElapsed, f.avgPerDay, f.noSpendDays], [12, Math.round(14000 / 12), 10]);
  assert.equal(f.previousExpense, 4000);
});

// ---------- runner ----------

const list = document.getElementById('results');
let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  const item = document.createElement('li');
  try {
    await fn();
    passed += 1;
    item.className = 'pass';
    item.textContent = `PASS ${name}`;
  } catch (err) {
    failed += 1;
    item.className = 'fail';
    item.textContent = `FAIL ${name}`;
    const detail = document.createElement('pre');
    detail.textContent = err.stack || String(err);
    item.append(detail);
  }
  list.append(item);
}
document.getElementById('summary').textContent = `${passed} passed, ${failed} failed`;
document.title = `${failed ? 'FAIL' : 'PASS'} ${passed}/${tests.length}`;
