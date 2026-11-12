import { byNewest, categoryName, inRange, sortCategories, totals } from '../calc.js';
import { transactionsCsv } from '../csv.js';
import { formatDay, timeframe, timeframeText, todayISO } from '../dates.js';
import { download, h, icon } from '../dom.js';
import { transactionDialog, txRow } from '../tx.js';
import { card, empty, timeframePicker, viewHead } from '../ui.js';

export function renderTransactions(ctx) {
  const state = ctx.store.get();
  const filter = ctx.ui.txFilter;
  // The time frame is picked at the top and shared with the Overview (Today … All time, or custom dates).
  const range = timeframe(ctx.ui.timeframe.choice, todayISO(), ctx.ui.timeframe);
  const rangeTransactions = inRange(state.transactions, range);
  const summary = h('p', { class: 'list-summary' });
  const list = h('div', { class: 'tx-list' });

  const update = () => {
    const query = filter.q.trim().toLowerCase();
    const rows = rangeTransactions
      .filter((t) => filter.kind === 'all' || t.kind === filter.kind)
      .filter((t) => filter.category === 'all' || t.categoryId === filter.category)
      .filter((t) => !query || `${t.note ?? ''} ${categoryName(state, t.categoryId)}`.toLowerCase().includes(query))
      .sort(byNewest);
    const sum = totals(rows);
    summary.textContent = rows.length
      ? `${timeframeText(range)} · ${rows.length} ${rows.length === 1 ? 'transaction' : 'transactions'} · ${ctx.money(sum.income)} in · ${ctx.money(sum.expense)} out · net ${ctx.money(sum.net)}`
      : '';
    if (!rangeTransactions.length) {
      list.replaceChildren(empty(`No transactions in ${timeframeText(range)}.`,
        h('button', { type: 'button', class: 'btn', onclick: () => transactionDialog(ctx) }, icon('plus'), 'Add a transaction')));
      return;
    }
    if (!rows.length) {
      list.replaceChildren(empty('Nothing matches these filters.'));
      return;
    }
    const today = todayISO();
    const byDay = new Map();
    for (const t of rows) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
    list.replaceChildren(...[...byDay].map(([date, items]) => h('section', { class: 'day-group' },
      h('h3', { class: 'day-head' }, dayLabel(date, today)),
      items.map((t) => txRow(ctx, t)))));
  };

  const search = h('input', {
    id: 'tx-search',
    type: 'search',
    class: 'input',
    placeholder: 'Search notes and categories',
    'aria-label': 'Search transactions',
    value: filter.q,
    oninput: (event) => {
      filter.q = event.target.value;
      update();
    },
  });
  const kind = h('select', {
    id: 'tx-kind',
    class: 'input',
    'aria-label': 'Type',
    value: filter.kind,
    onchange: (event) => {
      filter.kind = event.target.value;
      update();
    },
  }, h('option', { value: 'all' }, 'All types'), h('option', { value: 'expense' }, 'Expenses'), h('option', { value: 'income' }, 'Income'));
  const groups = [['expense', 'Spending'], ['income', 'Income']].map(([k, label]) =>
    h('optgroup', { label }, sortCategories(state.categories.filter((c) => c.kind === k)).map((c) => h('option', { value: c.id }, c.name))));
  const category = h('select', {
    id: 'tx-category',
    class: 'input',
    'aria-label': 'Category',
    value: state.categories.some((c) => c.id === filter.category) ? filter.category : 'all',
    onchange: (event) => {
      filter.category = event.target.value;
      update();
    },
  }, h('option', { value: 'all' }, 'All categories'), groups);
  if (category.value === 'all') filter.category = 'all';

  update();
  return h('div', { class: 'view' },
    viewHead(ctx, 'Transactions', {
      actions: [
        timeframePicker(ctx),
        h('button', { type: 'button', class: 'btn', onclick: () => download(`budget-transactions-${todayISO()}.csv`, transactionsCsv(state, rangeTransactions), 'text/csv') }, icon('download'), 'Export CSV'),
      ],
    }),
    h('div', { class: 'filters' }, h('div', { class: 'search' }, icon('search'), search), kind, category),
    card({ cls: 'card-list' }, summary, list));
}

function dayLabel(date, today) {
  if (date === today) return 'Today';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date === todayISO(yesterday)) return 'Yesterday';
  return formatDay(date);
}
