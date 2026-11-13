// Adding, editing and deleting transactions, plus the row used to list them.

import { categoriesFor, categoryName, monthKey, potBalance, safeToSpend, splitOf, splitTotal } from './calc.js';
import { addMonths, formatDay, formatMonthName, isValidDate, monthOf, todayISO } from './dates.js';
import { h, icon } from './dom.js';
import { centsToInput, parseAmount } from './money.js';
import { sortedGoals } from './pots.js';
import { splitDialog } from './split.js';
import { field, initialBadge, openDialog, segmented, signedAmount } from './ui.js';

export function transactionDialog(ctx, tx = null) {
  const state = ctx.store.get();
  const currency = ctx.currency();
  const pots = sortedGoals(state);
  let kind = tx?.kind ?? 'expense';

  const category = h('select', { name: 'category', class: 'input' });
  const fillCategories = () => {
    const options = categoriesFor(state, kind, tx?.categoryId);
    const preferred = tx?.kind === kind ? tx.categoryId : ctx.ui.lastCategory[kind];
    category.replaceChildren(...options.map((c) => h('option', { value: c.id }, c.name)));
    if (options.some((c) => c.id === preferred)) category.value = preferred;
  };
  fillCategories();

  const amountInput = h('input', {
    name: 'amount',
    class: 'input input-amount',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: centsToInput(0, currency),
    value: tx ? centsToInput(tx.amount, currency) : '',
    autofocus: true,
  });

  // Pay that lands at the end of a month can count in the next one (its date stays the day it arrived).
  const counts = h('select', { name: 'counts', class: 'input', value: tx?.month && tx.month !== monthOf(tx.date) ? 'next' : 'same' },
    h('option', { value: 'same' }, 'The month it came in'), h('option', { value: 'next' }, 'The next month'));
  const countsField = field('Counts in', counts, 'For pay that lands near the end of a month but is for the next one.');

  // An expense can be paid from a set-aside instead of spending money. What's available in each one
  // includes this entry's own amount when it's already being paid from there.
  const available = (goal) => potBalance(state, goal) + (tx && tx.kind !== 'income' && tx.potId === goal.id ? tx.amount : 0);
  const paidFrom = h('select', { name: 'pot', class: 'input', value: pots.some((g) => g.id === tx?.potId) ? tx.potId : '' },
    h('option', { value: '' }, 'Spending money'),
    pots.map((g) => h('option', { value: g.id }, `${g.name} (${ctx.money(Math.max(0, available(g)))} in it)`)));
  const paidHint = h('span', { class: 'field-hint' });
  const paidField = h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Paid from'), paidFrom, paidHint);
  let chosen = !!tx; // An existing entry keeps its choice; so does anything picked by hand.
  // A set-aside meant for this category is pre-selected when it has enough in it.
  const preset = () => {
    if (chosen || kind !== 'expense') return;
    const amount = parseAmount(amountInput.value) ?? 0;
    const linked = pots.find((g) => g.categoryId === category.value && available(g) > 0 && available(g) >= amount);
    paidFrom.value = linked ? linked.id : '';
    paidHint.textContent = linked ? `Pre-set, because ${linked.name} is for ${categoryName(state, category.value)}.` : '';
  };
  paidFrom.addEventListener('change', () => {
    chosen = true;
    paidHint.textContent = '';
  });
  amountInput.addEventListener('input', preset);
  category.addEventListener('change', preset);

  const showKind = () => {
    countsField.hidden = kind !== 'income';
    paidField.hidden = kind !== 'expense' || !pots.length;
  };
  showKind();
  preset();

  const content = h('div', { class: 'form-grid' },
    segmented('kind', [['expense', 'Expense'], ['income', 'Income']], kind, (value) => {
      kind = value;
      fillCategories();
      showKind();
      preset();
    }),
    field('Amount', amountInput),
    h('div', { class: 'form-row' },
      field('Category', category),
      field('Date', h('input', { name: 'date', type: 'date', class: 'input', value: tx?.date ?? todayISO() }))),
    countsField,
    paidField,
    field('Note', h('input', { name: 'note', class: 'input', maxLength: 120, placeholder: 'Optional', value: tx?.note ?? '' })),
    tx?.recurringId
      ? h('p', { class: 'field-hint' }, icon('repeat', 'icon-xs'), ' Added by a recurring item. Changes here only affect this entry.')
      : null,
    tx?.kind === 'income' && splitTotal(state, tx) > 0
      ? h('p', { class: 'field-hint' }, `${ctx.money(splitTotal(state, tx))} of this is set aside; the rest is kept for spending.`)
      : null);

  const extraActions = [];
  if (tx) extraActions.push(h('button', { type: 'button', class: 'btn btn-ghost btn-danger', onclick: () => { dialog.close(); deleteTransaction(ctx, tx); } }, 'Delete'));
  if (tx?.kind === 'income' && pots.length) {
    extraActions.push(h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { dialog.close(); splitDialog(ctx, tx); } }, splitOf(tx) ? 'Change split' : 'Split'));
  }

  const dialog = openDialog({
    title: tx ? 'Edit transaction' : 'Add transaction',
    content,
    submitLabel: tx ? 'Save' : 'Add',
    extraActions,
    onSubmit(data) {
      const amount = parseAmount(data.get('amount'));
      if (!amount) throw new Error('Enter an amount greater than zero.');
      const date = data.get('date');
      if (!isValidDate(date)) throw new Error('Choose a valid date.');
      const categoryId = data.get('category');
      if (!categoryId) throw new Error('Choose a category. You can add categories on the Budgets page.');
      const record = { ...tx, kind, amount, date, categoryId, note: data.get('note').trim() };
      let pot = null;
      if (kind === 'income') {
        delete record.potId;
        if (data.get('counts') === 'next') record.month = addMonths(monthOf(date), 1);
        else delete record.month;
        const aside = tx ? splitTotal(state, tx) : 0;
        if (aside > amount) throw new Error(`${ctx.money(aside)} of this income is set aside. Enter at least that much, or lower the split first (Change split).`);
      } else {
        delete record.month;
        delete record.split;
        pot = pots.find((g) => g.id === data.get('pot')) ?? null;
        if (pot && amount > available(pot)) {
          throw new Error(`Only ${ctx.money(Math.max(0, available(pot)))} is in ${pot.name}. Lower the amount, move money in first, or pay from spending money.`);
        }
        if (pot) record.potId = pot.id;
        else delete record.potId;
      }
      ctx.ui.lastCategory[kind] = categoryId;
      const saved = ctx.store.save('transactions', record);
      if (tx) ctx.toast('Transaction updated');
      else if (kind === 'income') ctx.toast('Income added');
      else ctx.toast(pot ? `Expense added · paid from ${pot.name}` : `Expense added${limitNote(ctx, date)}`);
      // New income: ask where it should go, once this dialog has closed.
      if (!tx && kind === 'income' && pots.length) setTimeout(() => splitDialog(ctx, saved), 0);
    },
  });
}

// After a new expense this month, say where that leaves the monthly limit.
function limitNote(ctx, date) {
  const today = todayISO();
  if (monthOf(date) !== monthOf(today)) return '';
  const safe = safeToSpend(ctx.store.get(), monthOf(today), today);
  if (!safe) return '';
  if (safe.left < 0) return ` · ${ctx.money(-safe.left)} over your monthly limit`;
  if (safe.todayLeft < 0) return ` · ${ctx.money(-safe.todayLeft)} over today’s share`;
  return ` · ${ctx.money(safe.todayLeft)} left to spend today`;
}

export function deleteTransaction(ctx, tx) {
  ctx.store.remove('transactions', tx.id);
  // Undo saves a copy under a new id, because the deleted id stays deleted on every device.
  ctx.toast('Transaction deleted', { label: 'Undo', run: () => ctx.store.save('transactions', { ...tx, id: undefined }) });
}

export function txRow(ctx, tx, { showDate = false } = {}) {
  const state = ctx.store.get();
  const name = categoryName(state, tx.categoryId);
  const counts = monthKey(tx) !== monthOf(tx.date) ? `counts in ${formatMonthName(monthKey(tx))}` : null;
  const pot = tx.kind !== 'income' && tx.potId ? state.goals.find((g) => g.id === tx.potId) : null;
  const aside = splitTotal(state, tx);
  const meta = [
    tx.note ? name : null,
    showDate ? formatDay(tx.date) : null,
    counts,
    pot ? `from ${pot.name}` : null,
    aside ? `${ctx.money(aside)} set aside` : null,
  ].filter(Boolean).join(' · ');
  return h('button', { type: 'button', class: 'tx-row', onclick: () => transactionDialog(ctx, tx) },
    initialBadge(name),
    h('span', { class: 'tx-main' },
      h('span', { class: 'tx-title' }, tx.note || name),
      meta || tx.recurringId
        ? h('span', { class: 'tx-meta' }, tx.recurringId ? icon('repeat', 'icon-xs') : null, meta)
        : null),
    signedAmount(ctx, tx.kind, tx.amount));
}
