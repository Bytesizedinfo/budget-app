import { categoryName, inMonth, spendByCategory, totals, trend } from '../calc.js';
import { barList, columnChart } from '../charts.js';
import { addMonths, formatMonth, formatMonthName, formatMonthShort } from '../dates.js';
import { h } from '../dom.js';
import { formatCompact } from '../money.js';
import { card, empty, viewHead } from '../ui.js';

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });

export function renderReports(ctx) {
  const state = ctx.store.get();
  const month = ctx.ui.month;
  const months = trend(state, month, 12);
  const active = months.filter((m) => m.income || m.expense);
  const average = (key) => (active.length ? Math.round(active.reduce((sum, m) => sum + m[key], 0) / active.length) : 0);
  const now = totals(inMonth(state.transactions, month));

  return h('div', { class: 'view' },
    viewHead(ctx, 'Reports', { month: true }),
    h('div', { class: 'stack' },
      h('div', { class: 'kpis kpis-stack' },
        tile('Average monthly spending', ctx.money(average('expense')), active.length ? `Over ${active.length} ${active.length === 1 ? 'month' : 'months'} with activity` : 'No activity yet'),
        tile('Average monthly income', ctx.money(average('income')), active.length ? 'Same period' : ''),
        tile(`Net in ${formatMonthName(month)}`, ctx.money(now.net), savedNote(now))),
      trendCard(ctx, months),
      categoryCard(ctx, state, month)));
}

function savedNote({ income, net }) {
  if (!income) return 'No income recorded this month';
  if (net < 0) return 'More went out than came in';
  return `${percent.format(net / income)} of income saved`;
}

function tile(label, value, note) {
  return h('div', { class: 'card stat' }, h('p', { class: 'stat-label' }, label), h('p', { class: 'stat-value' }, value), note ? h('p', { class: 'delta' }, note) : null);
}

function trendCard(ctx, months) {
  const first = months[0].month;
  const last = months[months.length - 1].month;
  const chart = columnChart({
    data: months.map((m) => ({ label: formatMonthShort(m.month), longLabel: formatMonth(m.month), values: [m.income, m.expense] })),
    series: [{ name: 'Income', cls: 's1' }, { name: 'Spending', cls: 's2' }],
    format: ctx.money,
    formatAxis: (cents) => formatCompact(cents, ctx.currency()),
    label: 'Income and spending by month',
  });
  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Month'), h('th', { class: 'num' }, 'Income'), h('th', { class: 'num' }, 'Spending'), h('th', { class: 'num' }, 'Net'))),
    h('tbody', {}, [...months].reverse().map((m) => h('tr', {},
      h('td', {}, formatMonth(m.month)),
      h('td', { class: 'num' }, ctx.money(m.income)),
      h('td', { class: 'num' }, ctx.money(m.expense)),
      h('td', { class: 'num' }, ctx.money(m.income - m.expense)))))));
  return card({ title: 'Income and spending', sub: `${formatMonth(first)} to ${formatMonth(last)}` },
    chart,
    h('details', { class: 'table-toggle' }, h('summary', {}, 'Show as a table'), table));
}

function categoryCard(ctx, state, month) {
  const previousMonth = addMonths(month, -1);
  const current = spendByCategory(inMonth(state.transactions, month));
  const previous = spendByCategory(inMonth(state.transactions, previousMonth));
  const ids = new Set([...current.keys(), ...previous.keys()]);
  const rows = [...ids]
    .map((id) => ({ label: categoryName(state, id), value: current.get(id) ?? 0, previous: previous.get(id) ?? 0 }))
    .sort((a, b) => b.value - a.value || b.previous - a.previous);
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const lastName = formatMonthShort(previousMonth);

  if (!rows.length) return card({ title: 'Spending by category' }, empty(`Nothing spent in ${formatMonth(month)} or the month before.`));

  return card({ title: 'Spending by category', sub: `${formatMonth(month)} · ${ctx.money(total)} in total` },
    total ? barList(rows.filter((r) => r.value > 0), { format: ctx.money, total, previousLabel: `in ${lastName}` }) : empty(`Nothing spent in ${formatMonth(month)}.`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table table-spaced' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Category'),
        h('th', { class: 'num' }, formatMonthShort(month)),
        h('th', { class: 'num' }, lastName),
        h('th', { class: 'num' }, 'Change'))),
      h('tbody', {}, rows.map((r) => {
        const diff = r.value - r.previous;
        return h('tr', {},
          h('td', {}, r.label),
          h('td', { class: 'num' }, ctx.money(r.value)),
          h('td', { class: 'num' }, ctx.money(r.previous)),
          h('td', { class: `num ${diff > 0 ? 'bad' : diff < 0 ? 'good' : ''}` }, diff ? `${diff > 0 ? '↑' : '↓'} ${ctx.money(Math.abs(diff))}` : '–'));
      })))));
}
