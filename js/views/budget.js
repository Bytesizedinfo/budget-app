// The Budget page: the month plan ("from my expected income, after payments, set-asides and category budgets,
// what's left?"), category budgets, and set-asides.

import { categoryName, inMonth, potEntries, sumBy, totals } from '../calc.js';
import { segmentBar } from '../charts.js';
import { addMonths, formatMonth, formatMonthName, formatShortDate, monthOf, todayISO } from '../dates.js';
import { h, icon } from '../dom.js';
import { monthPlan } from '../forecast.js';
import { centsToInput, parseAmount } from '../money.js';
import { setAsideIn } from '../pots.js';
import { card, notice, openDialog, remember, remembered, segmented, timeframePicker, viewHead } from '../ui.js';
import { amountsDialog, categoriesSection } from './budgets.js';
import { setAsidesSection } from './plan.js';

const SECTIONS = [['plan', 'Month plan'], ['categories', 'Categories'], ['setasides', 'Set-asides']];

export function renderBudget(ctx) {
  ctx.ui.budgetTab ??= remembered('budget-tab', 'plan');
  const tab = SECTIONS.some(([id]) => id === ctx.ui.budgetTab) ? ctx.ui.budgetTab : 'plan';
  const body = tab === 'categories' ? categoriesSection(ctx) : tab === 'setasides' ? setAsidesSection(ctx) : planSection(ctx);
  return h('div', { class: 'view' },
    viewHead(ctx, 'Budget', { actions: [timeframePicker(ctx)] }),
    segmented('budget-tab', SECTIONS, tab, (next) => {
      ctx.ui.budgetTab = next;
      remember('budget-tab', next);
      ctx.refresh();
    }, 'section-tabs'),
    body);
}

// ---------- Month plan ----------

function planSection(ctx) {
  const state = ctx.store.get();
  const today = todayISO();
  const current = monthOf(today);
  const month = ctx.ui.planMonth === addMonths(current, 1) ? ctx.ui.planMonth : current;
  const plan = monthPlan(state, month, today);
  const name = formatMonthName(month);

  const line = (label, amount, sub, onOpen, cls = '') => h('button', { type: 'button', class: `plan-line ${cls}`.trim(), onclick: onOpen },
    h('span', { class: 'plan-label' }, label, sub ? h('span', { class: 'plan-sub' }, sub) : null),
    h('span', { class: 'plan-amount' }, amount));
  const minus = (cents) => (cents ? `− ${ctx.money(cents)}` : ctx.money(0));

  const parts = [
    { name: 'Recurring payments', value: plan.recurring.total, cls: 's2' },
    { name: 'Planned payments', value: plan.planned.total, cls: 's4' },
    { name: 'Set-asides', value: plan.setAsides.total - plan.covered, cls: 's3' },
    { name: 'Category budgets', value: plan.categories.total, cls: 's5' },
    { name: 'Left unbudgeted', value: Math.max(0, plan.left), cls: 's1' },
  ];
  const over = plan.left < 0;

  return h('div', { class: 'stack' },
    h('div', { class: 'section-tools' },
      h('p', { class: 'view-intro' }, 'Your plan for a month: start from the income you expect, take off what’s already promised, and see what’s left to spend freely. Tap any line to see what’s in it.'),
      segmented('plan-month', [[current, `This month (${formatMonthName(current)})`], [addMonths(current, 1), `Next month (${formatMonthName(addMonths(current, 1))})`]], month, (next) => {
        ctx.ui.planMonth = next;
        ctx.refresh();
      }, 'segmented-sm')),
    card({ title: `Your plan for ${formatMonth(month)}`, cls: 'month-plan' },
      h('div', { class: 'plan-lines' },
        line('Expected income', ctx.money(plan.expected.amount),
          `${plan.expected.custom ? 'Your figure' : 'What came in last month'}${month === current ? ` · ${ctx.money(plan.expected.soFar)} has come in so far` : ''}`,
          () => expectedDialog(ctx, month, plan), 'plan-income'),
        line('Recurring payments', minus(plan.recurring.total), `${plan.recurring.items.length} in ${name}`, () => paymentsSheet(ctx, plan, false)),
        line('Planned payments', minus(plan.planned.total), `${plan.planned.items.length} in ${name}`, () => paymentsSheet(ctx, plan, true)),
        plan.covered ? line('Already set aside for those', `+ ${ctx.money(plan.covered)}`, 'Paid from money put aside for them', () => setAsideSheet(ctx, state, plan)) : null,
        line('Set-asides', minus(plan.setAsides.total), plan.setAsides.auto ? `${ctx.money(plan.setAsides.split)} from your default splits · ${ctx.money(plan.setAsides.auto)} moved automatically` : 'From your default splits', () => setAsideSheet(ctx, state, plan)),
        line('Category budgets', minus(plan.categories.total), plan.categories.items.length ? 'Beyond the payments already counted in them' : 'None set yet', () => amountsDialog(ctx, month)),
        h('div', { class: `plan-line plan-total${over ? ' bad' : ''}` },
          h('span', { class: 'plan-label' }, over ? 'Over-planned by' : 'Left unbudgeted', h('span', { class: 'plan-sub' }, over ? 'Your plan needs more than the income you expect' : `About ${ctx.money(plan.perDay)} a day to spend freely`)),
          h('span', { class: 'plan-amount' }, ctx.money(Math.abs(plan.left))))),
      plan.expected.amount > 0
        ? segmentBar({ parts: parts.filter((p) => p.value > 0), format: ctx.money, label: `Where the ${ctx.money(plan.expected.amount)} expected in ${name} goes`, of: over ? 'what’s planned' : 'expected income' })
        : null,
      over ? notice('over', `${name}’s plan is ${ctx.money(-plan.left)} more than you expect to come in. Lower a category amount or a set-aside, or move a planned payment.`) : null,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => expectedDialog(ctx, month, plan) }, icon('edit', 'icon-sm'), 'Expected income'),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => amountsDialog(ctx, month) }, icon('edit', 'icon-sm'), 'Category amounts'),
        h('a', { class: 'btn btn-sm', href: '#/upcoming' }, 'Payments and wishlist'))),
    month === current ? actualCard(ctx, state, plan, today) : null);
}

// What has actually happened this month, against the plan.
function actualCard(ctx, state, plan, today) {
  const list = inMonth(state.transactions, plan.month);
  const sums = totals(list);
  const spent = sumBy(list, 'expense');
  const budgeted = plan.categories.items.reduce((sum, b) => sum + (spent.get(b.category.id) ?? 0), 0);
  const inBudgets = new Set(plan.categories.items.map((b) => b.category.id));
  const elsewhere = [...spent].filter(([id]) => !inBudgets.has(id)).reduce((sum, [, v]) => sum + v, 0);
  const setAside = setAsideIn(state, { month: plan.month }).total;
  const row = (label, actual, planned) => h('div', {}, h('dt', {}, label), h('dd', {}, ctx.money(actual)), planned !== null ? h('span', { class: 'plan-sub' }, `of ${ctx.money(planned)} planned`) : null);
  return card({ title: `${formatMonthName(plan.month)} so far`, sub: `Up to ${formatShortDate(today)}` },
    h('dl', { class: 'totals' },
      row('Came in', sums.income, plan.expected.amount),
      row('Spent in budgeted categories', budgeted, plan.categories.items.reduce((sum, b) => sum + b.budget, 0)),
      row('Spent elsewhere', elsewhere, null),
      row('Set aside', Math.max(0, setAside), plan.setAsides.total)));
}

// Expected income for a month: what came in last month unless you type your own figure.
function expectedDialog(ctx, month, plan) {
  const currency = ctx.currency();
  const e = plan.expected;
  const input = h('input', { name: 'expected', class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', autofocus: true, value: centsToInput(e.amount, currency) });
  const use = (cents) => () => {
    input.value = centsToInput(cents, currency);
  };
  const dialog = openDialog({
    title: `Expected income: ${formatMonth(month)}`,
    content: h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'How much you expect to come in'), input,
        h('span', { class: 'field-hint' }, 'It starts as what came in last month. Your own figure is kept for this month only.')),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: use(e.lastMonth) }, `Last month · ${ctx.money(e.lastMonth)}`),
        e.average ? h('button', { type: 'button', class: 'btn btn-sm', onclick: use(e.average) }, `Recent average · ${ctx.money(e.average)}`) : null)),
    extraActions: e.custom
      ? [h('button', {
        type: 'button',
        class: 'btn btn-ghost',
        onclick: () => {
          const next = { ...(ctx.store.get().settings.expected ?? {}) };
          delete next[month];
          ctx.store.setSettings({ expected: next });
          dialog.close();
          ctx.toast('Back to last month’s income');
        },
      }, 'Use last month’s')]
      : [],
    onSubmit(data) {
      const text = String(data.get('expected') ?? '').trim();
      const cents = text === '0' ? 0 : parseAmount(text);
      if (cents === null) throw new Error('Enter an amount, like 800 or 800.00.');
      ctx.store.setSettings({ expected: { ...(ctx.store.get().settings.expected ?? {}), [month]: cents } });
      ctx.toast(`Expecting ${ctx.money(cents)} in ${formatMonthName(month)}`);
    },
  });
}

// ---------- Breakdowns ----------

function sheet(title, ...content) {
  openDialog({ title, content: h('div', { class: 'bd' }, ...content), submitLabel: 'Done' });
}

function paymentsSheet(ctx, plan, planned) {
  const state = ctx.store.get();
  const items = planned ? plan.planned.items : plan.recurring.items;
  const total = planned ? plan.planned.total : plan.recurring.total;
  const status = { paid: 'paid', open: 'to come' };
  sheet(`${planned ? 'Planned' : 'Recurring'} payments in ${formatMonthName(plan.month)}`,
    h('p', { class: 'bd-sum' }, `Every ${planned ? 'planned' : 'recurring'} payment due in ${formatMonth(plan.month)}, paid or still to come (skipped ones are left out): `, h('b', {}, ctx.money(total))),
    items.length
      ? h('ul', { class: 'bd-list' }, items.sort((a, b) => a.date.localeCompare(b.date)).map((o) => h('li', {},
        h('span', { class: 'bd-date' }, formatShortDate(o.date)),
        h('span', { class: 'bd-name' }, o.rule.name, h('span', { class: 'bd-cat' }, `${categoryName(state, o.rule.categoryId)} · ${status[o.status] ?? o.status}`)),
        h('span', { class: 'amount' }, ctx.money(o.amount)))))
      : h('p', { class: 'bd-note' }, 'None.'),
    h('p', { class: 'bd-note' }, 'Add or change them on the Upcoming page.'));
}

function setAsideSheet(ctx, state, plan) {
  const auto = [];
  for (const goal of state.goals) {
    const sum = potEntries(state, goal).filter((e) => e.auto && e.month === plan.month).reduce((s, e) => s + e.amount, 0);
    if (sum) auto.push([goal.billId ? `${goal.name} (for the payment)` : goal.name, sum, 'moved so far']);
  }
  sheet(`Set-asides in ${formatMonthName(plan.month)}`,
    h('p', { class: 'bd-sum' }, 'Your default splits applied to the expected income: ', h('b', {}, ctx.money(plan.setAsides.split))),
    h('p', { class: 'bd-sum' }, 'Moved automatically (on a schedule, or for a payment), recorded and still to come: ', h('b', {}, ctx.money(plan.setAsides.auto))),
    auto.length ? h('ul', { class: 'bd-cats' }, auto.map(([n, v, note]) => h('li', {}, h('span', {}, `${n} · ${note}`), h('span', { class: 'amount' }, ctx.money(v))))) : null,
    plan.covered ? h('p', { class: 'bd-note' }, `${ctx.money(plan.covered)} of this pays for payments counted above, so it’s added back rather than counted twice.`) : null,
    h('p', { class: 'bd-note' }, 'Change the default splits and schedules under Set-asides.'));
}
