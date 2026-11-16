// Moving money: between spending categories' budgets, set-asides and unbudgeted money, and sharing out a
// category's budget and history when it's deleted.
//   Category <-> category: this month's two budgets change. No money moves.
//   Category or unbudgeted -> set-aside: the money really leaves spending money, and the category's budget drops.
//   Set-aside -> category or unbudgeted: the money comes back to spending money, and the category's budget rises.
//   Set-aside -> set-aside: money moves between the two.

import { balance, categoryBudgets, inMonth, potBalance, spendByCategory } from './calc.js';
import { monthOf, todayISO } from './dates.js';
import { h } from './dom.js';
import { centsToInput, parseAmount } from './money.js';
import { budgetOrder, isWish, sortedGoals } from './pots.js';
import { isSavings } from './savings.js';
import { confirmDialog, field, openDialog } from './ui.js';

// What's left of each spending category's budget this month: Map(categoryId -> { budget, spent, left }).
export function categoryLeft(state, month) {
  const spent = spendByCategory(inMonth(state.transactions, month));
  const out = new Map();
  for (const [id, b] of categoryBudgets(state, month)) {
    const used = spent.get(id) ?? 0;
    out.set(id, { budget: b.budget, spent: used, left: b.budget === null ? null : b.budget - used });
  }
  return out;
}

// Everywhere money can move from or to, with what's available in each:
//   free: spending money that isn't earmarked for a category this month.
//   cat:<id>: what's left of a category's budget this month.   pot:<id>: what's in a set-aside.
export function moveSources(state, today) {
  const month = monthOf(today);
  const left = categoryLeft(state, month);
  const cats = budgetOrder(state).map((category) => {
    const l = left.get(category.id);
    return { key: `cat:${category.id}`, kind: 'cat', category, label: category.name, available: Math.max(0, l.left ?? 0), budgeted: l.budget !== null };
  });
  const earmarked = cats.reduce((sum, c) => sum + c.available, 0);
  const pots = sortedGoals(state).map((goal) => ({
    key: `pot:${goal.id}`, kind: 'pot', goal, label: goal.name, available: Math.max(0, potBalance(state, goal)), savings: isSavings(goal), wish: isWish(goal),
  }));
  return [{ key: 'free', kind: 'free', label: 'Unbudgeted', available: Math.max(0, balance(state, today).spending - earmarked) }, ...cats, ...pots];
}

// The changes (for store.batch) that move an amount from one place to another. Throws with a plain message
// when the move can't be made.
export function moveChanges(state, { from, to, amount, date }) {
  if (from === to) throw new Error('Choose two different places.');
  if (!(amount > 0)) throw new Error('Enter an amount greater than zero.');
  const sources = moveSources(state, date);
  const a = sources.find((s) => s.key === from);
  const b = sources.find((s) => s.key === to);
  if (!a || !b) throw new Error('Choose where the money comes from and where it goes.');
  if (amount > a.available) throw new Error(`There isn’t that much left in ${a.label}.`);
  const month = monthOf(date);
  const adjusted = (category, delta) => ({ ...category, adjust: { ...(category.adjust ?? {}), [month]: (category.adjust?.[month] ?? 0) + delta } });
  const changes = { save: {}, contributions: [] };
  const categories = [];
  if (a.kind === 'cat') categories.push(adjusted(a.category, -amount));
  if (b.kind === 'cat') categories.push(adjusted(b.category, amount));
  if (categories.length) changes.save.categories = categories;
  const between = a.kind === 'pot' && b.kind === 'pot';
  if (a.kind === 'pot') changes.contributions.push({ goalId: a.goal.id, contribution: { amount: -amount, date, ...(between ? { move: b.goal.id } : {}) } });
  if (b.kind === 'pot') changes.contributions.push({ goalId: b.goal.id, contribution: { amount, date, ...(between ? { move: a.goal.id } : {}) } });
  return changes;
}

// The changes that delete a category and put its things elsewhere:
//   shares: Map(categoryId -> cents) of this month's unspent budget given to other categories.
//   usual: Map(categoryId -> cents) of its usual monthly amount added to other categories.
//   target: the category (same kind) that takes its transactions, payments, linked set-asides and the amounts
//           income gave it. Needed when anything uses the category.
// Every category's "left this month" ends up as it was, plus its share.
export function deleteCategoryChanges(state, category, { shares = new Map(), usual = new Map(), target = null, month }) {
  const repoint = (id) => (id === category.id ? target : id);
  const moveKey = (map) => {
    if (!map || typeof map !== 'object' || !(category.id in map)) return map;
    const { [category.id]: cents, ...rest } = map;
    if (target && cents > 0) rest[target] = (rest[target] ?? 0) + cents;
    return rest;
  };
  const uses = (r) => r.categoryId === category.id || (r.cats && category.id in r.cats) || (r.planSplit?.cats && category.id in r.planSplit.cats);
  const used = state.transactions.some(uses) || state.recurring.some(uses) || state.goals.some((g) => g.categoryId === category.id);
  if (used && !state.categories.some((c) => c.id === target && c.kind === category.kind && c.id !== category.id)) {
    throw new Error('Choose the category its transactions move to.');
  }
  const transactions = state.transactions.filter(uses).map((t) => ({ ...t, categoryId: repoint(t.categoryId), ...(t.cats ? { cats: moveKey(t.cats) } : {}) }));
  const recurring = state.recurring.filter(uses).map((r) => ({ ...r, categoryId: repoint(r.categoryId), ...(r.planSplit ? { planSplit: { ...r.planSplit, cats: moveKey(r.planSplit.cats) } } : {}) }));
  const goals = state.goals.filter((g) => g.categoryId === category.id).map((g) => ({ ...g, categoryId: target }));

  // Work out the budget changes on a copy with everything moved, so "left this month" comes out right
  // whichever way the budgets were set (given from income, or the usual amounts).
  const touched = new Set([...shares.keys(), ...usual.keys(), ...(target && category.kind === 'expense' ? [target] : [])]);
  const before = categoryLeft(state, month);
  const swap = (list, changed) => list.map((r) => changed.find((c) => c.id === r.id) ?? r);
  const moved = {
    ...state,
    transactions: swap(state.transactions, transactions),
    categories: state.categories.filter((c) => c.id !== category.id).map((c) => (usual.get(c.id) > 0 ? { ...c, monthlyBudget: (c.monthlyBudget ?? 0) + usual.get(c.id) } : c)),
  };
  const after = categoryLeft(moved, month);
  const categories = [];
  for (const id of touched) {
    const c = moved.categories.find((x) => x.id === id);
    if (!c || c.kind !== 'expense') continue;
    const share = shares.get(id) ?? 0;
    const was = before.get(id)?.left ?? null;
    const now = after.get(id)?.left ?? null;
    const delta = was === null || now === null ? share : was + share - now;
    categories.push(delta ? { ...c, adjust: { ...(c.adjust ?? {}), [month]: (c.adjust?.[month] ?? 0) + delta } } : c);
  }
  const save = {};
  if (categories.length) save.categories = categories;
  if (transactions.length) save.transactions = transactions;
  if (recurring.length) save.recurring = recurring;
  if (goals.length) save.goals = goals;
  return { save, remove: { categories: [category.id] } };
}

// ---------- The Move money box ----------

export function moveMoneyDialog(ctx, { from = 'free', to = '', amount = null } = {}) {
  const today = todayISO();
  const state = ctx.store.get();
  const sources = moveSources(state, today);
  const byKey = new Map(sources.map((s) => [s.key, s]));
  const options = (allowEmpty) => {
    const option = (s) => h('option', { value: s.key }, `${s.label} (${ctx.money(s.available)}${s.kind === 'cat' ? (s.budgeted ? ' left' : ', no budget') : s.kind === 'pot' ? ' in it' : ''})`);
    const group = (label, list) => (list.length ? h('optgroup', { label }, list.map(option)) : null);
    const pots = sources.filter((s) => s.kind === 'pot');
    return [
      allowEmpty ? h('option', { value: '' }, 'Choose…') : null,
      option(byKey.get('free')),
      group('Spending categories (this month)', sources.filter((s) => s.kind === 'cat')),
      group('Savings', pots.filter((s) => s.savings)),
      group('Goals and wishlist', pots.filter((s) => !s.savings)),
    ];
  };
  const fromSelect = h('select', { name: 'from', class: 'input', value: byKey.has(from) ? from : 'free' }, options(false));
  const toSelect = h('select', { name: 'to', class: 'input', value: byKey.has(to) ? to : '' }, options(true));
  const amountInput = h('input', { name: 'amount', class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', autofocus: true, placeholder: centsToInput(0, ctx.currency()), value: amount > 0 ? centsToInput(amount, ctx.currency()) : '' });
  const effect = h('div', { class: 'move-effect', 'aria-live': 'polite' });
  const update = () => {
    const a = byKey.get(fromSelect.value);
    const b = byKey.get(toSelect.value);
    const cents = parseAmount(amountInput.value) ?? 0;
    const line = (s, delta) => h('p', {}, h('span', {}, s.label), h('span', { class: s.available + delta < 0 ? 'bad' : '' }, `${ctx.money(s.available)} → ${ctx.money(s.available + delta)}`));
    const real = a && b && (a.kind === 'pot' || b.kind === 'pot');
    effect.replaceChildren(
      a ? line(a, -cents) : null,
      b && b !== a ? line(b, cents) : null,
      a && b && a !== b ? h('p', { class: 'field-hint' }, real
        ? (a.kind === 'pot' && b.kind === 'pot' ? 'Money moves between the two set-asides.' : a.kind === 'pot' ? 'This money comes back into your spending money.' : 'This money leaves your spending money and is set aside.')
        : 'Only this month’s budgets change. No money moves.') : null);
  };
  for (const el of [fromSelect, toSelect]) el.addEventListener('change', update);
  amountInput.addEventListener('input', update);
  update();
  openDialog({
    title: 'Move money',
    submitLabel: 'Move',
    content: h('div', { class: 'form-grid' },
      field('From', fromSelect),
      field('To', toSelect),
      field('Amount', amountInput),
      effect,
      h('p', { class: 'field-hint' }, 'Moves between categories apply to this month only.')),
    async onSubmit() {
      const cents = parseAmount(amountInput.value);
      if (!cents) throw new Error('Enter an amount greater than zero.');
      if (!toSelect.value) throw new Error('Choose where the money goes.');
      const now = ctx.store.get();
      const changes = moveChanges(now, { from: fromSelect.value, to: toSelect.value, amount: cents, date: today });
      const a = byKey.get(fromSelect.value);
      const b = byKey.get(toSelect.value);
      if (a.kind === 'pot' && a.savings && !(b.kind === 'pot' && b.savings) && !(await confirmDip(ctx, a.goal, cents))) return false;
      ctx.store.batch(changes);
      ctx.toast(`Moved ${ctx.money(cents)} from ${a.label} to ${b.label}`);
      return true;
    },
  });
}

// Asks before money leaves savings. Resolves to true to go ahead.
export function confirmDip(ctx, goal, amount) {
  const left = Math.max(0, potBalance(ctx.store.get(), goal) - amount);
  return confirmDialog({
    title: `Take ${ctx.money(amount)} out of your savings?`,
    message: `${goal.name} is savings. Taking ${ctx.money(amount)} out leaves ${ctx.money(left)} in it. It will be listed under “Taken out of savings”.`,
    confirm: 'Take it out',
    danger: false,
  });
}
