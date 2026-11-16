// The Activity page: transactions as a list (with the time frame, search and filters) or as a month calendar
// showing what came in and went out each day, and the payments still to come.

import { categoryName } from '../calc.js';
import { addMonths, dayOfWeek, formatDay, formatMonth, monthOf, todayISO } from '../dates.js';
import { h, icon } from '../dom.js';
import { occurrenceActions, occurrenceDialog } from '../due.js';
import { calendarDays, projectedOn } from '../forecast.js';
import { quickAdd } from '../keypad.js';
import { txRow } from '../tx.js';
import { card, initialBadge, remember, remembered, segmented, signedAmount, timeframePicker, viewHead } from '../ui.js';
import { transactionList } from './transactions.js';

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i)));

export function renderActivity(ctx) {
  ctx.ui.activityView ??= remembered('budget-activity', 'list');
  const view = ctx.ui.activityView === 'calendar' ? 'calendar' : 'list';
  const pick = segmented('activity-view', [['list', 'List'], ['calendar', 'Calendar']], view, (next) => {
    ctx.ui.activityView = next;
    remember('budget-activity', next);
    ctx.refresh();
  }, 'section-tabs');
  if (view === 'calendar') {
    return h('div', { class: 'view' }, viewHead(ctx, 'Activity'), pick, calendar(ctx));
  }
  const { actions, body } = transactionList(ctx);
  return h('div', { class: 'view' }, viewHead(ctx, 'Activity', { actions: [timeframePicker(ctx), ...actions] }), pick, body);
}

function calendar(ctx) {
  const state = ctx.store.get();
  const today = todayISO();
  const month = /^\d{4}-\d{2}$/.test(ctx.ui.calMonth ?? '') ? ctx.ui.calMonth : monthOf(today);
  const days = calendarDays(state, month);
  const selected = days.find((d) => d.date === ctx.ui.calDay) ?? days.find((d) => d.date === today) ?? days[0];
  const go = (next) => () => {
    ctx.ui.calMonth = next;
    ctx.ui.calDay = null;
    ctx.refresh();
  };
  const select = (date) => () => {
    ctx.ui.calDay = date;
    ctx.refresh();
  };
  const income = days.reduce((sum, d) => sum + d.income, 0);
  const expense = days.reduce((sum, d) => sum + d.expense, 0);
  const lead = Array.from({ length: dayOfWeek(days[0].date) }, () => h('span', { class: 'cal-blank', 'aria-hidden': 'true' }));
  const compact = (cents) => {
    const units = Math.abs(cents) / 100;
    return units >= 1000 ? `${(units / 1000).toFixed(units >= 10000 ? 0 : 1)}k` : units >= 100 ? units.toFixed(0) : units.toFixed(units % 1 ? 2 : 0);
  };

  const grid = h('div', { class: 'cal-grid', role: 'grid', 'aria-label': formatMonth(month) },
    WEEKDAYS.map((d) => h('span', { class: 'cal-wd', 'aria-hidden': 'true' }, d)),
    lead,
    days.map((d) => {
      const label = [formatDay(d.date), d.income ? `${ctx.money(d.income)} in` : null, d.expense ? `${ctx.money(d.expense)} out` : null, d.scheduled.length ? `${d.scheduled.length} to come` : null].filter(Boolean).join(', ');
      return h('button', {
        type: 'button',
        class: `cal-day${d.date === today ? ' today' : ''}${d.date === selected.date ? ' selected' : ''}${d.date > today ? ' future' : ''}`,
        'aria-label': label,
        'aria-pressed': String(d.date === selected.date),
        dataset: { date: d.date },
        onclick: select(d.date),
      },
      h('span', { class: 'cal-num' }, String(Number(d.date.slice(8)))),
      d.income ? h('span', { class: 'cal-in' }, `+${compact(d.income)}`) : null,
      d.expense ? h('span', { class: 'cal-out' }, compact(d.expense)) : null,
      d.scheduled.length ? h('span', { class: 'cal-dot', 'aria-hidden': 'true' }) : null);
    }));

  return h('div', { class: 'stack' },
    card({ cls: 'calendar' },
      h('div', { class: 'cal-head' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous month', onclick: go(addMonths(month, -1)) }, icon('chevronLeft')),
        h('button', { type: 'button', class: 'cal-title', title: 'Back to this month', onclick: go(monthOf(today)) }, formatMonth(month)),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next month', onclick: go(addMonths(month, 1)) }, icon('chevronRight'))),
      h('dl', { class: 'cal-totals' },
        h('div', {}, h('dt', {}, 'In'), h('dd', { class: 'good' }, ctx.money(income))),
        h('div', {}, h('dt', {}, 'Out'), h('dd', {}, ctx.money(expense))),
        h('div', {}, h('dt', {}, 'Net'), h('dd', {}, ctx.money(income - expense)))),
      grid,
      h('p', { class: 'cal-key' }, h('span', { class: 'cal-dot', 'aria-hidden': 'true' }), ' a payment or income still to come')),
    dayCard(ctx, state, selected, today));
}

// One day: its transactions, the payments still to come on it, and (for a future day) the spending money
// expected at its end.
function dayCard(ctx, state, day, today) {
  const add = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => quickAdd(ctx, { date: day.date }) }, icon('plus', 'icon-sm'), 'Add');
  return card({ title: formatDay(day.date), sub: day.date > today ? `Spending money expected at the end of the day: ${ctx.money(projectedOn(state, today, day.date))}` : null, action: add, cls: 'card-list day-card' },
    day.transactions.length
      ? h('div', { class: 'tx-list' }, day.transactions.map((t) => txRow(ctx, t)))
      : !day.scheduled.length ? h('p', { class: 'empty' }, 'Nothing on this day.') : null,
    day.scheduled.length
      ? h('div', { class: 'day-scheduled' },
        h('p', { class: 'field-label' }, day.date > today ? 'Still to come' : 'Waiting to be confirmed'),
        day.scheduled.map((o) => h('div', { class: 'due-row' },
          initialBadge(o.rule.name),
          h('span', { class: 'due-main' }, h('span', { class: 'due-name' }, o.rule.name), h('span', { class: 'due-meta' }, categoryName(state, o.rule.categoryId))),
          signedAmount(ctx, o.rule.kind, o.amount),
          o.date <= today
            ? occurrenceActions(ctx, o)
            : h('button', { type: 'button', class: 'btn btn-sm', onclick: () => occurrenceDialog(ctx, o) }, 'Change this one'))))
      : null);
}
