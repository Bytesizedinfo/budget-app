// Adding, editing and deleting transactions, plus the row used to list them.

import { categoriesFor, categoryName, monthKey, safeToSpend } from './calc.js';
import { addMonths, daysInMonth, formatDay, formatMonthName, isValidDate, monthOf, todayISO } from './dates.js';
import { h, icon } from './dom.js';
import { centsToInput, parseAmount } from './money.js';
import { field, initialBadge, openDialog, segmented, signedAmount } from './ui.js';

// New entries default to today, or to a date inside the month being viewed.
function defaultDate(month) {
  const today = todayISO();
  if (month === monthOf(today)) return today;
  return month < monthOf(today) ? `${month}-${daysInMonth(month)}` : `${month}-01`;
}

export function transactionDialog(ctx, tx = null) {
  const state = ctx.store.get();
  const currency = ctx.currency();
  let kind = tx?.kind ?? 'expense';

  const category = h('select', { name: 'category', class: 'input' });
  const fillCategories = () => {
    const options = categoriesFor(state, kind, tx?.categoryId);
    const preferred = tx?.kind === kind ? tx.categoryId : ctx.ui.lastCategory[kind];
    category.replaceChildren(...options.map((c) => h('option', { value: c.id }, c.name)));
    if (options.some((c) => c.id === preferred)) category.value = preferred;
  };
  fillCategories();

  // Pay that lands at the end of a month can count in the next one (its date stays the day it arrived).
  const counts = h('select', { name: 'counts', class: 'input', value: tx?.month && tx.month !== monthOf(tx.date) ? 'next' : 'same' },
    h('option', { value: 'same' }, 'The month it came in'), h('option', { value: 'next' }, 'The next month'));
  const countsField = field('Counts in', counts, 'For pay that lands near the end of a month but is for the next one.');
  countsField.hidden = kind !== 'income';

  const content = h('div', { class: 'form-grid' },
    segmented('kind', [['expense', 'Expense'], ['income', 'Income']], kind, (value) => {
      kind = value;
      fillCategories();
      countsField.hidden = kind !== 'income';
    }),
    field('Amount', h('input', {
      name: 'amount',
      class: 'input input-amount',
      inputmode: 'decimal',
      autocomplete: 'off',
      placeholder: centsToInput(0, currency),
      value: tx ? centsToInput(tx.amount, currency) : '',
      autofocus: true,
    })),
    h('div', { class: 'form-row' },
      field('Category', category),
      field('Date', h('input', { name: 'date', type: 'date', class: 'input', value: tx?.date ?? defaultDate(ctx.ui.month) }))),
    countsField,
    field('Note', h('input', { name: 'note', class: 'input', maxLength: 120, placeholder: 'Optional', value: tx?.note ?? '' })),
    tx?.recurringId
      ? h('p', { class: 'field-hint' }, icon('repeat', 'icon-xs'), ' Added by a recurring item. Changes here only affect this entry.')
      : null);

  const dialog = openDialog({
    title: tx ? 'Edit transaction' : 'Add transaction',
    content,
    submitLabel: tx ? 'Save' : 'Add',
    extraActions: tx
      ? [h('button', { type: 'button', class: 'btn btn-ghost btn-danger', onclick: () => { dialog.close(); deleteTransaction(ctx, tx); } }, 'Delete')]
      : [],
    onSubmit(data) {
      const amount = parseAmount(data.get('amount'));
      if (!amount) throw new Error('Enter an amount greater than zero.');
      const date = data.get('date');
      if (!isValidDate(date)) throw new Error('Choose a valid date.');
      const categoryId = data.get('category');
      if (!categoryId) throw new Error('Choose a category. You can add categories on the Budgets page.');
      ctx.ui.lastCategory[kind] = categoryId;
      const record = { ...tx, kind, amount, date, categoryId, note: data.get('note').trim() };
      if (kind === 'income' && data.get('counts') === 'next') record.month = addMonths(monthOf(date), 1);
      else delete record.month;
      ctx.store.save('transactions', record);
      if (!tx) ctx.ui.month = monthOf(date); // Show the month the new entry landed in.
      ctx.toast(tx ? 'Transaction updated' : `${kind === 'income' ? 'Income' : 'Expense'} added${kind === 'expense' ? limitNote(ctx, date) : ''}`);
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
  const name = categoryName(ctx.store.get(), tx.categoryId);
  const counts = monthKey(tx) !== monthOf(tx.date) ? `counts in ${formatMonthName(monthKey(tx))}` : null;
  const meta = [tx.note ? name : null, showDate ? formatDay(tx.date) : null, counts].filter(Boolean).join(' · ');
  return h('button', { type: 'button', class: 'tx-row', onclick: () => transactionDialog(ctx, tx) },
    initialBadge(name),
    h('span', { class: 'tx-main' },
      h('span', { class: 'tx-title' }, tx.note || name),
      meta || tx.recurringId
        ? h('span', { class: 'tx-meta' }, tx.recurringId ? icon('repeat', 'icon-xs') : null, meta)
        : null),
    signedAmount(ctx, tx.kind, tx.amount));
}
