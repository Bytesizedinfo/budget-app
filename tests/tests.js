import { budgetSummary, goalProgress, totals, trend } from '../js/calc.js';
import { addMonths, dateInMonth, daysInMonth, isValidDate, monthRange } from '../js/dates.js';
import { importSpendSave } from '../js/import-spendsave.js';
import { mergeStates } from '../js/merge.js';
import { centsToInput, formatMoney, parseAmount } from '../js/money.js';
import { dueOccurrences, nextDate, occurrenceId } from '../js/recurring.js';
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
  const p = goalProgress(goal, '2026-11-12');
  assert.equal(p.saved, 20000);
  assert.equal(p.remaining, 100000);
  assert.equal(p.perMonth, Math.ceil(100000 / 6));
  assert.ok(goalProgress({ ...goal, deadline: '2026-10-01' }, '2026-11-12').overdue);
  assert.ok(goalProgress({ ...goal, contributions: [{ id: 'y', amount: 130000 }] }, '2026-11-12').done);
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
  const p = goalProgress({ target: null, contributions: [{ id: 'a', amount: 5000 }, { id: 'b', amount: -1000 }] }, '2026-11-12');
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
  assert.equal(goalProgress(holiday, '2026-11-12').saved, 5000 + 15000 - 6000);
  assert.equal(laptop.target, 120000);
  assert.equal(laptop.deadline, '2027-06-30');
  assert.equal(goalProgress(laptop, '2026-11-12').saved, 10000);
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
  assert.equal(goalProgress(again.goals.find((g) => g.name === 'Holiday'), '2026-11-12').saved, 14000);
});

test('import: an existing goal with the same name is reused, not duplicated', () => {
  const state = seedState('SGD');
  state.goals = [{ id: 'mine', name: 'holiday', target: 300000, deadline: null, updatedAt: 99, contributions: [{ id: 'x', date: '2026-07-01', amount: 2000, updatedAt: 99 }] }];
  const goal = importSpendSave(spendSaveBackup(), state).state.goals.find((g) => g.id === 'mine');
  assert.equal(goal.target, 300000, 'keeps its own target');
  assert.equal(goalProgress(goal, '2026-11-12').saved, 2000 + 14000);
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
