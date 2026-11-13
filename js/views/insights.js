// The Insights page: what the numbers say in plain words, then charts of income and spending.
// Everything follows the time frame picked at the top, except the spending pace, which is always this month.

import { categoryName, inRange, rangeSpan, spendByCategory, sumBy } from '../calc.js';
import { barList, columnChart, lineChart, segmentBar } from '../charts.js';
import { dateInMonth, formatDay, formatMonthName, formatShortDate, previousTimeframe, timeframe, timeframeText, todayISO } from '../dates.js';
import { h } from '../dom.js';
import { balanceSeries, facts, flowSeries, needsWants, pace, weekdaySpend } from '../insights.js';
import { formatCompact } from '../money.js';
import { planChecks } from '../pots.js';
import { card, empty, notice, pointList, tableToggle, timeframePicker, viewHead } from '../ui.js';

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });
// 1 January 2024 was a Monday.
const weekday = (day, width) => new Intl.DateTimeFormat(undefined, { weekday: width }).format(new Date(2024, 0, 1 + day));
// How the stretch before a time frame reads in a sentence: "October", "2025", "yesterday", "the 7 days before".
const previousText = (previous) => (previous.month ? formatMonthName(previous.month) : previous.label);

export function renderInsights(ctx) {
  const state = ctx.store.get();
  const today = todayISO();
  const range = timeframe(ctx.ui.timeframe.choice, today, ctx.ui.timeframe);
  const previous = previousTimeframe(range);
  const span = rangeSpan(range, state, today);
  const list = inRange(state.transactions, range);
  const f = facts(state, range, previous, today);
  const p = pace(state, today);
  const axis = (cents) => formatCompact(cents, ctx.currency());

  return h('div', { class: 'view' },
    viewHead(ctx, 'Insights', { actions: [timeframePicker(ctx)] }),
    h('div', { class: 'stack' },
      insightCard(ctx, state, f, p, range, previous, today),
      h('div', { class: 'grid-2' }, flowCard(ctx, list, span, range, axis), paceCard(ctx, p, axis)),
      h('div', { class: 'grid-2' }, useCard(ctx, f.use, range), sourceCard(ctx, state, list, range)),
      h('div', { class: 'grid-2' }, categoryCard(ctx, state, list, range, previous), weekdayCard(ctx, list, span, range, today, axis)),
      balanceCard(ctx, state, span, range, today, axis)));
}

// ---------- In plain words ----------

function insightCard(ctx, state, f, p, range, previous, today) {
  const money = ctx.money;
  const items = [];
  const u = f.use;
  if (u.income > 0) {
    const setAside = Math.max(0, u.setAside);
    const kept = u.income - u.spent - setAside;
    const share = (value) => percent.format(value / u.income);
    if (kept >= 0) {
      items.push({
        level: setAside / u.income >= 0.2 ? 'good' : 'info',
        text: `Of the ${money(u.income)} that came in, you spent ${share(u.spent)} (${money(u.spent)}), set aside ${share(setAside)} (${money(setAside)}) and kept ${share(kept)} (${money(kept)}).`,
      });
    } else items.push({ level: 'warn', text: `You spent and set aside ${money(-kept)} more than the ${money(u.income)} that came in.` });
  } else if (f.sums.expense > 0) items.push({ level: 'info', text: `Nothing came in during ${timeframeText(range)}, and you spent ${money(f.sums.expense)}.` });

  if (previous && f.previousExpense !== null && f.sums.expense !== f.previousExpense && (f.sums.expense || f.previousExpense)) {
    const diff = f.sums.expense - f.previousExpense;
    items.push({ level: diff > 0 ? 'warn' : 'good', text: `Overall you spent ${money(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than ${previousText(previous)}.` });
  }
  if (f.top) {
    const diff = f.top.previous === null ? 0 : f.top.value - f.top.previous;
    const change = diff > 0 ? `, up ${money(diff)} on ${previousText(previous)}` : diff < 0 ? `, down ${money(-diff)} on ${previousText(previous)}` : '';
    items.push({ level: 'info', text: `${categoryName(state, f.top.id)} is your biggest category: ${money(f.top.value)}, ${percent.format(f.top.value / f.sums.expense)} of your spending${change}.` });
  }
  if (f.rise && f.rise.id !== f.top?.id) {
    items.push({ level: 'info', text: `${categoryName(state, f.rise.id)} went up the most: ${money(f.rise.change)} more than ${previousText(previous)}.` });
  }
  if (f.biggest) {
    items.push({ level: 'info', text: `Your biggest single expense was ${money(f.biggest.amount)} on ${f.biggest.note || categoryName(state, f.biggest.categoryId)} (${formatShortDate(f.biggest.date)}).` });
  }
  if (f.daysElapsed > 1 && f.sums.expense > 0) {
    items.push({
      level: 'info',
      text: `You spent ${money(f.avgPerDay)} a day on average, with ${f.noSpendDays} no-spend ${f.noSpendDays === 1 ? 'day' : 'days'} out of ${f.daysElapsed}.`,
    });
  }
  // These two are about now, whatever the time frame.
  const month = formatMonthName(p.month);
  if (p.runOut === today) items.push({ level: 'warn', text: `This month: your spending money is used up${p.free < 0 ? ', and bills still to come need more than you have' : ''}.` });
  else if (p.runOut) items.push({ level: 'warn', text: `This month: at about ${money(p.perDay)} a day, your spending money runs out around ${formatShortDate(p.runOut)}.` });
  else if (p.perDay > 0) items.push({ level: 'good', text: `This month: at about ${money(p.perDay)} a day, your spending money lasts to the end of ${month}.` });

  const nw = needsWants(state, range);
  if (nw.sorted && nw.income > 0) {
    const share = (v) => percent.format(v / nw.income);
    const overN = nw.spent.needs > nw.target.needs;
    const overW = nw.spent.wants > nw.target.wants;
    items.push({
      level: overN || overW ? 'warn' : 'good',
      text: `Against your ${nw.ratio.needs}/${nw.ratio.wants}/${nw.ratio.savings} rule: needs took ${share(nw.spent.needs)} of your income, wants ${share(nw.spent.wants)}, and you set aside ${share(nw.setAside)}${overW ? `. Wants went ${money(nw.spent.wants - nw.target.wants)} over their share` : overN ? `. Needs went ${money(nw.spent.needs - nw.target.needs)} over their share` : ''}.`,
    });
  }
  const checks = planChecks(state, today);
  if (checks.buffer?.months != null) {
    items.push({
      level: checks.buffer.months >= 3 ? 'good' : 'info',
      text: `${checks.buffer.goal.name}, your safety buffer, covers about ${checks.buffer.months.toFixed(1)} months of your usual spending. A common guide is 3 to 6 months.`,
    });
  }
  for (const g of checks.goals) {
    if (g.status === 'behind') items.push({ level: 'warn', text: `${g.goal.name} is behind its target date: it needs about ${money(g.needed)} a month, and your default splits put in about ${money(g.perMonth)}.` });
    else if (g.status === 'no-plan' && g.needed) items.push({ level: 'warn', text: `${g.goal.name} has a target date but isn’t in any default split. It needs about ${money(g.needed)} a month.` });
    else if (g.status === 'overdue') items.push({ level: 'warn', text: `${g.goal.name} is past its target date with ${money(g.remaining)} to go.` });
  }
  return card({ title: 'In plain words', sub: timeframeText(range) },
    items.length ? pointList(items) : empty('Add some transactions and insights will appear here.'));
}

// ---------- Charts ----------

function flowCard(ctx, list, span, range, axis) {
  const { size, rows } = flowSeries(list, span);
  const title = 'Money in and out';
  if (!list.length || !rows.length) return card({ title, sub: timeframeText(range) }, empty('Nothing recorded in this time frame.'));
  const chart = columnChart({
    data: rows.map((r) => ({ label: r.label, longLabel: r.longLabel, values: [r.income, r.expense] })),
    series: [{ name: 'Income', cls: 's1' }, { name: 'Spending', cls: 's2' }],
    format: ctx.money,
    formatAxis: axis,
    label: `Income and spending by ${size}`,
    highlight: -1,
  });
  return card({ title, sub: `${timeframeText(range)} · by ${size}` },
    chart,
    tableToggle([size === 'day' ? 'Day' : size === 'week' ? 'Week' : 'Month', 'Income', 'Spending'],
      rows.filter((r) => r.income || r.expense).map((r) => [r.longLabel, ctx.money(r.income), ctx.money(r.expense)])));
}

function paceCard(ctx, p, axis) {
  const title = 'Spending pace this month';
  const month = formatMonthName(p.month);
  if (!p.affordable) return card({ title, sub: month }, empty('No spending, and no spending money, so far this month.'));
  const day = (i) => dateInMonth(p.month, i + 1);
  const chart = lineChart({
    points: p.even.map((_, i) => ({ label: String(i + 1), longLabel: formatDay(day(i)) })),
    series: [{ name: 'Spent so far', cls: 's2', values: p.cumulative }, { name: 'Even pace', cls: 'ref', values: p.even }],
    format: ctx.money,
    formatAxis: axis,
    label: `Spending so far in ${month} against an even pace`,
  });
  let verdict;
  if (p.runOut && p.free <= 0) verdict = notice('warn', 'Your spending money is used up for this month.');
  else if (p.runOut) verdict = notice('warn', `At about ${ctx.money(p.perDay)} a day, your spending money runs out around ${formatShortDate(p.runOut)}.`);
  else if (p.ahead > 0) verdict = h('p', { class: 'chart-note' }, `You’re ${ctx.money(p.ahead)} ahead of an even pace, but at this rate your spending money still lasts the month.`);
  else verdict = h('p', { class: 'chart-note' }, `You’re ${ctx.money(-p.ahead)} under an even pace.`);
  return card({ title, sub: `${month} · spending from your spending money` },
    chart,
    verdict,
    h('p', { class: 'chart-note muted' }, `The even pace spreads what ${month} can afford (${ctx.money(p.affordable)}: what you’ve spent plus the spending money you have) over the whole month.`),
    tableToggle(['Day', 'Spent so far', 'Even pace'], p.cumulative.map((value, i) => [formatDay(day(i)), ctx.money(value), ctx.money(p.even[i])])));
}

function useCard(ctx, use, range) {
  const title = 'Where your income went';
  if (!(use.income > 0)) return card({ title, sub: timeframeText(range) }, empty(`No income in ${timeframeText(range)}.`));
  const setAside = Math.max(0, use.setAside);
  const kept = use.income - use.spent - setAside;
  const over = kept < 0;
  const parts = [
    { name: 'Spent', value: use.spent, cls: 's2' },
    { name: 'Set aside', value: setAside, cls: 's3' },
    { name: 'Kept', value: Math.max(0, kept), cls: 's1' },
  ];
  const line = (name, value) => h('div', {}, h('dt', {}, name), h('dd', {}, ctx.money(value)));
  return card({ title, sub: `${timeframeText(range)} · ${ctx.money(use.income)} came in` },
    segmentBar({ parts, format: ctx.money, label: 'How the income was used', of: over ? 'what went out' : 'income' }),
    h('dl', { class: 'totals use-totals' }, line('Spent', use.spent), line('Set aside', setAside), line(over ? 'Short by' : 'Kept', Math.abs(kept))),
    over ? notice('warn', `You spent and set aside ${ctx.money(-kept)} more than came in.`) : null,
    use.setAside < 0 ? h('p', { class: 'chart-note muted' }, `${ctx.money(-use.setAside)} came back out of your set-asides in this time frame.`) : null,
    use.fromPots > 0 ? h('p', { class: 'chart-note muted' }, `Plus ${ctx.money(use.fromPots)} spent from set-asides: money you had put aside earlier.`) : null);
}

function sourceCard(ctx, state, list, range) {
  const rows = [...sumBy(list, 'income')].map(([id, value]) => ({ label: categoryName(state, id), value })).sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  return card({ title: 'Income by source', sub: total ? `${ctx.money(total)} · ${timeframeText(range)}` : timeframeText(range) },
    rows.length ? barList(rows, { format: ctx.money, total, cls: 's1', of: 'income' }) : empty('No income in this time frame.'));
}

function categoryCard(ctx, state, list, range, previous) {
  const before = previous ? spendByCategory(inRange(state.transactions, previous)) : null;
  const rows = [...spendByCategory(list)]
    .map(([id, value]) => ({ label: categoryName(state, id), value, ...(before ? { previous: before.get(id) ?? 0 } : {}) }))
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  // A long tail folds into one row rather than a crowd of tiny bars.
  const shown = rows.length > 9
    ? [...rows.slice(0, 8), { label: `${rows.length - 8} more categories`, value: rows.slice(8).reduce((sum, r) => sum + r.value, 0) }]
    : rows;
  const previousLabel = previous ? (previous.month || previous.choice === 'year' ? `in ${previousText(previous)}` : previousText(previous)) : undefined;
  return card({ title: 'Spending by category', sub: total ? `${ctx.money(total)} · ${timeframeText(range)}` : timeframeText(range) },
    rows.length ? barList(shown, { format: ctx.money, total, previousLabel, cls: 's2' }) : empty('Nothing spent in this time frame.'),
    rows.length && before
      ? tableToggle(['Category', 'Now', previousText(previous), 'Change'], rows.map((r) => {
        const diff = r.value - r.previous;
        return [r.label, ctx.money(r.value), ctx.money(r.previous), diff ? `${diff > 0 ? '↑' : '↓'} ${ctx.money(Math.abs(diff))}` : '–'];
      }))
      : null);
}

function weekdayCard(ctx, list, span, range, today, axis) {
  const title = 'Spending by day of the week';
  const rows = weekdaySpend(list, span, today);
  const top = rows.reduce((max, r) => (r.average > max.average ? r : max), rows[0]);
  if (!top.average) return card({ title, sub: timeframeText(range) }, empty('Nothing spent in this time frame.'));
  const chart = columnChart({
    data: rows.map((r) => ({ label: weekday(r.day, 'short'), longLabel: `${weekday(r.day, 'long')}s`, values: [r.average] })),
    series: [{ name: 'Average spent', cls: 's2' }],
    format: ctx.money,
    formatAxis: axis,
    label: 'Average spending for each day of the week',
    highlight: top.day,
  });
  return card({ title, sub: `Average for each day · ${timeframeText(range)}` },
    chart,
    h('p', { class: 'chart-note' }, `${weekday(top.day, 'long')}s are your biggest spending day: ${ctx.money(top.average)} on average.`),
    tableToggle(['Day', 'Average', 'Total', 'Days counted'], rows.map((r) => [weekday(r.day, 'long'), ctx.money(r.average), ctx.money(r.total), String(r.count)])));
}

function balanceCard(ctx, state, span, range, today, axis) {
  const title = 'Balance over time';
  const rows = state.transactions.length ? balanceSeries(state, span, today) : [];
  if (!rows.length) return card({ title, sub: timeframeText(range) }, empty('Nothing to show for this time frame yet.'));
  const chart = lineChart({
    points: rows.map((r) => ({ label: r.label, longLabel: r.from === r.to ? formatDay(r.to) : `${r.longLabel} (to ${formatShortDate(r.to)})` })),
    series: [{ name: 'Total balance', cls: 's1', values: rows.map((r) => r.total) }, { name: 'Set aside', cls: 's3', values: rows.map((r) => r.savings) }],
    format: ctx.money,
    formatAxis: axis,
    label: 'Total balance and set-aside money over time',
  });
  return card({ title, sub: `${timeframeText(range)}, up to today · the gap between the lines is your spending money` },
    chart,
    tableToggle(['Up to', 'Total balance', 'Set aside', 'Spending money'], rows.map((r) => [formatShortDate(r.to), ctx.money(r.total), ctx.money(r.savings), ctx.money(r.spending)])));
}
