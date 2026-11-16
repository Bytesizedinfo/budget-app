// Savings: the set-asides marked as savings, in one place. The same section is a page of its own, the
// fourth section of the Budget page, and (in short) a card on Home.

import { categoryName, potBalance, rangeSpan } from '../calc.js';
import { lineChart } from '../charts.js';
import { formatDay, formatShortDate, previousTimeframe, timeframe, timeframeText, todayISO } from '../dates.js';
import { h, icon } from '../dom.js';
import { formatApprox, formatCompact } from '../money.js';
import { moveMoneyDialog } from '../move.js';
import { isBillFund, isWish, sourcesOf } from '../pots.js';
import { isSavings, savingsFlow, savingsGoals, savingsRate, savingsSeries, savingsTotal } from '../savings.js';
import { ruleText } from '../split.js';
import { card, cardLink, checkbox, empty, openDialog, tableToggle, timeframePicker, viewHead } from '../ui.js';
import { contributionDialog, goalDialog } from './plan.js';

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });

export function renderSavings(ctx) {
  return h('div', { class: 'view' }, viewHead(ctx, 'Savings', { actions: [timeframePicker(ctx)] }), savingsSection(ctx));
}

export function savingsSection(ctx) {
  const state = ctx.store.get();
  const today = todayISO();
  const range = timeframe(ctx.ui.timeframe.choice, today, ctx.ui.timeframe);
  const goals = savingsGoals(state);
  const choose = h('button', { type: 'button', class: 'btn', onclick: () => chooseSavingsDialog(ctx) }, icon('check'), 'Choose my savings');
  const tools = h('div', { class: 'section-tools' },
    h('p', { class: 'view-intro' }, 'Money you don’t plan to spend. Mark any set-aside as savings and it’s counted here; the app asks before anything is taken out.'),
    h('div', { class: 'btn-row' }, choose, h('button', { type: 'button', class: 'btn', onclick: () => goalDialog(ctx, null, { savings: true }) }, icon('plus'), 'New savings pot')));
  if (!goals.length) {
    return h('div', { class: 'stack' }, tools,
      card({}, empty('Nothing is marked as savings yet. Choose which of your set-asides are savings, or add a new savings pot.',
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => chooseSavingsDialog(ctx) }, 'Choose my savings'))));
  }
  const flow = savingsFlow(state, range);
  const previous = previousTimeframe(range);
  const before = previous ? savingsFlow(state, previous).net : null;
  return h('div', { class: 'stack' },
    tools,
    totalCard(ctx, state, range, flow, previous, before),
    growthCard(ctx, state, range, today),
    h('div', { class: 'goal-grid' }, goals.map((goal) => potCard(ctx, state, goal, range, flow))),
    takenCard(ctx, state, range, flow));
}

function rateText(rate) {
  if (rate === null) return 'No income in this time frame';
  return `${percent.format(rate)} of income saved${rate >= 0.2 ? '' : ' (a common guide is 20% or more)'}`;
}

function totalCard(ctx, state, range, flow, previous, before) {
  let delta = null;
  if (previous && before !== null && (before || flow.net)) {
    const diff = flow.net - before;
    delta = diff === 0 ? `Same as ${previous.label}` : `${diff > 0 ? '↑' : '↓'} ${formatApprox(Math.abs(diff), ctx.currency())} vs ${previous.label}`;
  }
  const stat = (label, value, note, cls = '') => h('div', {}, h('dt', {}, label), h('dd', { class: cls }, value), note ? h('span', { class: 'plan-sub' }, note) : null);
  return card({ title: 'In savings', sub: 'As of today', cls: 'savings-total' },
    h('p', { class: 'plan-total-value' }, ctx.money(savingsTotal(state))),
    h('p', { class: 'range-note' }, icon('info', 'icon-sm'), `Below: ${timeframeText(range)}.`),
    h('dl', { class: 'totals' },
      stat('Put in', ctx.money(flow.in)),
      stat('Taken out', ctx.money(flow.out), null, flow.out ? 'over' : ''),
      stat('Net saved', ctx.money(flow.net, { sign: true }), delta, flow.net < 0 ? 'over' : ''),
      stat('Savings rate', savingsRate(state, range) === null ? '–' : percent.format(savingsRate(state, range)), rateText(savingsRate(state, range)))));
}

function growthCard(ctx, state, range, today) {
  const rows = savingsSeries(state, rangeSpan(range, state, today), today);
  if (!rows.length) return card({ title: 'Growth', sub: timeframeText(range) }, empty('Nothing to show for this time frame yet.'));
  const chart = lineChart({
    points: rows.map((r) => ({ label: r.label, longLabel: r.from === r.to ? formatDay(r.to) : `${r.longLabel} (to ${formatShortDate(r.to)})` })),
    series: [{ name: 'Savings', cls: 's3', values: rows.map((r) => r.total) }],
    format: ctx.money,
    formatAxis: (cents) => formatCompact(cents, ctx.currency()),
    label: 'Total savings over time',
  });
  return card({ title: 'Growth', sub: `Total savings · ${timeframeText(range)}, up to today` },
    chart,
    tableToggle(['Up to', 'Savings'], rows.map((r) => [formatShortDate(r.to), ctx.money(r.total)])));
}

function potCard(ctx, state, goal, range, flow) {
  const saved = potBalance(state, goal);
  const mine = flow.byGoal.get(goal.id) ?? { in: 0, out: 0 };
  const sources = sourcesOf(state, goal);
  const from = (s) => (s.categoryId ? categoryName(state, s.categoryId) : 'all income');
  const sourceText = sources.length
    ? sources.map((s) => (s.via === 'rest' ? `what’s left of the savings share of ${from(s)}` : s.via === 'ratio' ? `its schedule, from ${from(s)}` : `${ruleText(ctx, s.rule)} ${s.rule.type === 'percent' ? 'of' : 'from'} ${from(s)}`)).join(' · ')
    : 'Not in any default split';
  return card({
    title: goal.name,
    sub: goal.buffer ? 'Safety buffer' : 'Savings',
    action: h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${goal.name}`, onclick: () => goalDialog(ctx, goal) }, icon('edit')),
    cls: 'goal-card savings-pot',
  },
    h('p', { class: 'goal-amount' }, h('span', { class: 'goal-saved' }, ctx.money(saved))),
    h('p', { class: 'goal-range' }, `${timeframeText(range)}: ${ctx.money(mine.in)} in${mine.out ? ` · ${ctx.money(mine.out)} out` : ''}`),
    h('p', { class: 'goal-source' }, h('span', { class: 'goal-source-label' }, 'From income: '), sourceText),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => contributionDialog(ctx, goal, 1) }, icon('plus'), 'Add money'),
      saved > 0 ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => contributionDialog(ctx, goal, -1) }, 'Withdraw') : null,
      saved > 0 ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => moveMoneyDialog(ctx, { from: `pot:${goal.id}` }) }, icon('swap', 'icon-sm'), 'Move') : null));
}

function takenCard(ctx, state, range, flow) {
  const nameOf = (id) => state.goals.find((g) => g.id === id)?.name ?? 'a deleted set-aside';
  const label = (e) => {
    if (e.kind === 'paid') return `Paid: ${e.tx.note || categoryName(state, e.tx.categoryId)}`;
    if (e.kind === 'move') return `Moved to ${nameOf(e.move)}`;
    return 'Withdrawn to spending money';
  };
  return card({ title: 'Taken out of savings', sub: `${timeframeText(range)} · ${ctx.money(flow.out)}`, cls: 'savings-taken' },
    flow.taken.length
      ? h('ul', { class: 'bd-list' }, flow.taken.map((e) => h('li', {},
        h('span', { class: 'bd-date' }, formatShortDate(e.date)),
        h('span', { class: 'bd-name' }, label(e), h('span', { class: 'bd-cat' }, `from ${e.goal.name}`)),
        h('span', { class: 'amount' }, ctx.money(e.amount, { sign: true })))))
      : empty('Nothing taken out in this time frame.'));
}

// Tick which set-asides are savings, all in one place.
export function chooseSavingsDialog(ctx) {
  const state = ctx.store.get();
  const goals = state.goals.filter((g) => !isBillFund(g) && !isWish(g));
  openDialog({
    title: 'Choose my savings',
    content: h('div', { class: 'form-grid' },
      h('p', { class: 'field-hint' }, 'Tick the set-asides that are savings: money you don’t plan to spend. Goals you’re saving up to buy (a trip, a gadget) are better left unticked. Wishlist items can’t be savings.'),
      goals.length
        ? h('div', { class: 'choose-list' }, goals.map((g) => checkbox(`sav-${g.id}`, `${g.name} · ${ctx.money(Math.max(0, potBalance(state, g)))}`, isSavings(g))))
        : h('p', { class: 'field-hint' }, 'You have no set-asides yet. Add a savings pot first.')),
    onSubmit(data) {
      const latest = ctx.store.get();
      const changed = goals.map((g) => latest.goals.find((x) => x.id === g.id) ?? g)
        .filter((g) => isSavings(g) !== (data.get(`sav-${g.id}`) === 'on'))
        .map((g) => ({ ...g, savings: data.get(`sav-${g.id}`) === 'on' }));
      if (changed.length) ctx.store.saveMany('goals', changed);
      ctx.toast(changed.length ? 'Savings updated' : 'No changes');
    },
  });
}

// The short version for Home.
export function savingsHomeCard(ctx, state, range) {
  const goals = savingsGoals(state);
  if (!goals.length) {
    return card({ title: 'Savings', action: cardLink('Savings', '#/savings') },
      h('p', { class: 'card-text' }, 'Mark a set-aside as savings to see here how much you’ve saved and whether it’s growing.'));
  }
  const flow = savingsFlow(state, range);
  const rate = savingsRate(state, range);
  return card({ title: 'Savings', sub: 'As of today', action: cardLink('Savings', '#/savings'), cls: 'savings-home' },
    h('p', { class: 'plan-total-value' }, ctx.money(savingsTotal(state))),
    h('p', { class: 'hero-sub' }, `${ctx.money(flow.net, { sign: true })} ${flow.net < 0 ? 'net' : 'saved'} · ${timeframeText(range)}${rate === null ? '' : ` · ${percent.format(rate)} of income`}`),
    flow.out ? h('p', { class: 'perday-note' }, `${ctx.money(flow.out)} taken out in that time.`) : null);
}
