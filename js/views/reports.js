import { categoryName, inRange, rangeSpan, spendByCategory, totals, trend } from '../calc.js';
import { barList, columnChart } from '../charts.js';
import { formatMonth, formatMonthShort, monthOf, monthsCovered, previousTimeframe, timeframe, timeframeText, todayISO } from '../dates.js';
import { h } from '../dom.js';
import { formatCompact } from '../money.js';
import { card, empty, timeframePicker, viewHead } from '../ui.js';

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });

export function renderReports(ctx) {
  const state = ctx.store.get();
  const today = todayISO();
  const range = timeframe(ctx.ui.timeframe.choice, today, ctx.ui.timeframe);
  const previous = previousTimeframe(range);
  const span = rangeSpan(range, state, today);
  // The 12-month chart ends at the time frame's last month.
  const months = trend(state, monthOf(span.to), 12);
  const now = totals(inRange(state.transactions, range));
  // Monthly averages only make sense over more than a month; they count the part of the time frame so far.
  const upTo = span.to < today ? span.to : today;
  const covered = range.month ? 1 : monthsCovered(span.from, upTo);
  const average = covered > 1.05;
  const perMonth = (value) => (average ? Math.round(value / covered) : value);
  const note = average ? `Over ${Number(covered.toFixed(1))} months · ${timeframeText(range)}` : `Total for ${timeframeText(range)}`;

  return h('div', { class: 'view' },
    viewHead(ctx, 'Reports', { actions: [timeframePicker(ctx)] }),
    h('div', { class: 'stack' },
      h('div', { class: 'kpis kpis-stack' },
        tile(average ? 'Average monthly spending' : 'Spending', ctx.money(perMonth(now.expense)), note),
        tile(average ? 'Average monthly income' : 'Income', ctx.money(perMonth(now.income)), 'Same period'),
        tile('Net', ctx.money(now.net), savedNote(now))),
      trendCard(ctx, months),
      categoryCard(ctx, state, range, previous)));
}

function savedNote({ income, net }) {
  if (!income) return 'No income in this time frame';
  if (net < 0) return 'More went out than came in';
  return `${percent.format(net / income)} of income left after spending`;
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

function categoryCard(ctx, state, range, previous) {
  const current = spendByCategory(inRange(state.transactions, range));
  const before = previous ? spendByCategory(inRange(state.transactions, previous)) : new Map();
  const ids = new Set([...current.keys(), ...before.keys()]);
  const rows = [...ids]
    .map((id) => ({ label: categoryName(state, id), value: current.get(id) ?? 0, previous: before.get(id) ?? 0 }))
    .sort((a, b) => b.value - a.value || b.previous - a.previous);
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const nowName = range.month ? formatMonthShort(range.month) : 'This time frame';
  const beforeName = previous ? (previous.month ? formatMonthShort(previous.month) : `${previous.label.charAt(0).toUpperCase()}${previous.label.slice(1)}`) : null;
  const previousLabel = previous ? (previous.month || previous.choice === 'year' ? `in ${previous.label}` : previous.label) : undefined;

  if (!rows.length) return card({ title: 'Spending by category' }, empty(`Nothing spent in ${timeframeText(range)}${previous ? ' or the stretch before' : ''}.`));

  return card({ title: 'Spending by category', sub: `${timeframeText(range)} · ${ctx.money(total)} in total` },
    total
      ? barList(rows.filter((r) => r.value > 0).map((r) => (previous ? r : { label: r.label, value: r.value })), { format: ctx.money, total, previousLabel, cls: 's2' })
      : empty(`Nothing spent in ${timeframeText(range)}.`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table table-spaced' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Category'),
        h('th', { class: 'num' }, nowName),
        previous ? h('th', { class: 'num' }, beforeName) : null,
        previous ? h('th', { class: 'num' }, 'Change') : null)),
      h('tbody', {}, rows.map((r) => {
        const diff = r.value - r.previous;
        return h('tr', {},
          h('td', {}, r.label),
          h('td', { class: 'num' }, ctx.money(r.value)),
          previous ? h('td', { class: 'num' }, ctx.money(r.previous)) : null,
          previous ? h('td', { class: `num ${diff > 0 ? 'bad' : diff < 0 ? 'good' : ''}` }, diff ? `${diff > 0 ? '↑' : '↓'} ${ctx.money(Math.abs(diff))}` : '–') : null);
      })))));
}
