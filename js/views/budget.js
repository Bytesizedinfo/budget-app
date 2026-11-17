// The Budget page: the month plan (carried in, income, set-asides and payments make the spending budget; what's
// spent and left so far), category budgets, set-asides and savings.

import { categoryName, potEntries } from '../calc.js';
import { addMonths, formatMonth, formatMonthName, formatShortDate, monthOf, todayISO } from '../dates.js';
import { h, icon } from '../dom.js';
import { centsToInput, parseAmount } from '../money.js';
import { monthPicture } from '../month.js';
import { card, notice, openDialog, remember, remembered, segmented, timeframePicker, viewHead } from '../ui.js';
import { amountsDialog, budgetModeText, categoriesSection, spendingBudgetDialog } from './budgets.js';
import { setAsidesSection } from './plan.js';
import { savingsSection } from './savings.js';

const SECTIONS = [['plan', 'Month plan'], ['categories', 'Categories'], ['setasides', 'Set-asides'], ['savings', 'Savings']];

export function renderBudget(ctx) {
  ctx.ui.budgetTab ??= remembered('budget-tab', 'plan');
  const tab = SECTIONS.some(([id]) => id === ctx.ui.budgetTab) ? ctx.ui.budgetTab : 'plan';
  const sections = { categories: categoriesSection, setasides: setAsidesSection, savings: savingsSection, plan: planSection };
  const body = sections[tab](ctx);
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
// The month picture (month.js) as a table: what was planned, and what has happened so far. Home reads the
// same picture, so "Left" here is the figure Home shows for the month.

function planSection(ctx) {
  const state = ctx.store.get();
  const today = todayISO();
  const current = monthOf(today);
  const month = ctx.ui.planMonth === addMonths(current, 1) ? ctx.ui.planMonth : current;
  const pic = monthPicture(state, month, today, ctx.ui.left);
  const p = pic.planned;
  const { plan } = p;
  const name = formatMonthName(month);
  const future = pic.future;
  const b = pic.budget;
  const fixed = b.mode === 'fixed';
  const dash = '–';

  // One line of the table: its name (with a note under it), the planned figure and the figure so far. A line
  // that opens its breakdown is a button, and the whole row can be tapped.
  const row = (line, label, sub, planned, sofar, { onOpen = null, cls = '' } = {}) => h('tr', { class: `${cls}${onOpen ? ' plan-click' : ''}`.trim(), dataset: { line }, onclick: onOpen },
    h('th', { scope: 'row' },
      onOpen ? h('button', { type: 'button', class: 'plan-open' }, label) : h('span', { class: 'plan-name' }, label),
      sub ? h('span', { class: 'plan-sub' }, sub) : null),
    h('td', { class: `num plan-planned${planned < 0 ? ' bad' : ''}` }, planned === null ? h('span', { class: 'plan-none' }, dash) : ctx.money(planned)),
    future ? null : h('td', { class: `num plan-sofar${sofar < 0 ? ' bad' : ''}` }, sofar === null ? h('span', { class: 'plan-none' }, dash) : ctx.money(sofar)));
  const both = (done, toCome, doneWord) => `${ctx.money(done)} ${doneWord}${toCome ? ` · ${ctx.money(toCome)} still to come` : ''}`;
  const source = { custom: 'Your figure', planned: 'From your planned income', last: 'What came in last month' }[plan.expected.source];
  const payments = plan.recurring.items.length + plan.planned.items.length;
  const counted = [pic.opts.planned ? null : 'planned payments left out', pic.opts.wishes ? 'ticked wishlist items included' : null].filter(Boolean);

  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'table month-table' },
    h('thead', {}, h('tr', {}, h('th', {}, h('span', { class: 'sr-only' }, 'Line')), h('th', { class: 'num' }, 'Planned'), future ? null : h('th', { class: 'num' }, 'So far'))),
    h('tbody', {},
      row('carried', 'Carried in', future ? `What ${formatMonthName(current)} is set to leave` : `From before ${name}`, p.carriedIn, future ? null : pic.carriedIn),
      row('income', '+ Income', `Planned: ${source}${!future && pic.income.expected ? ` · ${ctx.money(pic.income.expected)} still expected` : ''}`, plan.expected.amount, future ? null : pic.income.received,
        { onOpen: () => expectedDialog(ctx, month, plan), cls: 'plan-income' }),
      row('setaside', '− Set aside', future ? (plan.expected.source === 'planned' ? 'Splitting your planned income' : 'Your default splits') : both(pic.setAside.done, pic.setAside.toCome, 'done'),
        p.setAside, future ? null : pic.setAside.total, { onOpen: () => setAsideSheet(ctx, state, pic) }),
      row('payments', '− Recurring and planned payments', future ? `${payments} in ${name}` : both(pic.payments.paid, pic.payments.toCome, 'paid'),
        p.payments, future ? null : pic.payments.total, { onOpen: () => paymentsSheet(ctx, state, pic) }),
      row('budget', fixed ? '= What your income allows' : '= Spending budget', fixed ? null : 'Automatic', p.auto, future ? null : b.auto, { cls: 'plan-total-row' }),
      fixed ? row('fixed', 'Spending budget (fixed)', b.scope === 'month' ? `For ${name} only` : 'Every month', b.fixed, future ? null : b.fixed, { cls: 'plan-total-row' }) : null,
      future ? null : row('spent', '− Spent', pic.fromPots ? `Plus ${ctx.money(pic.fromPots)} paid from set-asides, not counted` : 'Everyday spending from your spending money', null, pic.spent),
      future || !pic.wishes ? null : row('wishes', '− Ticked wishlist items', 'If you bought them today', null, pic.wishes),
      future ? null : row('left', '= Left', pic.limitedBy === 'budget' ? 'What your budget still allows' : `About ${ctx.money(pic.perDay)} a day for the ${pic.daysLeft} ${pic.daysLeft === 1 ? 'day' : 'days'} left`, null, pic.leftToSpend, { cls: 'plan-total-row plan-left' }),
      h('tr', { class: 'plan-group' }, h('th', { colspan: future ? 2 : 3, scope: 'rowgroup' }, 'Your spending budget, by category')),
      row('given', 'Given to categories', 'Category budgets, beyond the payments already in them', p.given, future ? null : pic.categories.given, { onOpen: () => amountsDialog(ctx, month) }),
      row('unbudgeted', 'Unbudgeted', 'Free for anything', p.unbudgeted, future ? null : pic.categories.unbudgeted))));

  return h('div', { class: 'stack' },
    h('div', { class: 'section-tools' },
      h('p', { class: 'view-intro' }, 'Your month in one table: what you planned, and what has happened so far. The spending budget is what your income leaves once set-asides and payments are taken off. Tap a line to see what’s in it.'),
      segmented('plan-month', [[current, `This month (${formatMonthName(current)})`], [addMonths(current, 1), `Next month (${formatMonthName(addMonths(current, 1))})`]], month, (next) => {
        ctx.ui.planMonth = next;
        ctx.refresh();
      }, 'segmented-sm plan-months')),
    card({ title: `Your plan for ${formatMonth(month)}`, cls: 'month-plan' },
      h('div', { class: 'budget-mode' },
        h('span', { class: 'budget-mode-text' }, h('span', { class: 'field-label' }, 'Spending budget'), h('b', {}, `${budgetModeText(b, month)} · ${ctx.money(b.amount)}`)),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => spendingBudgetDialog(ctx, month) }, icon('edit', 'icon-sm'), 'Change')),
      table,
      counted.length ? h('p', { class: 'field-hint' }, `Counted as on Home: ${counted.join(', ')}.`) : null,
      !future && pic.left < 0 ? notice('over', `What’s still to come this month is ${ctx.money(-pic.left)} more than your spending money.`) : null,
      p.unbudgeted < 0 ? notice('over', `As planned, ${name}’s category budgets add up to ${ctx.money(-p.unbudgeted)} more than its spending budget. Lower a category amount or a set-aside, or move a planned payment.`) : null,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => expectedDialog(ctx, month, plan) }, icon('edit', 'icon-sm'), 'Expected income'),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => amountsDialog(ctx, month) }, icon('edit', 'icon-sm'), 'Category amounts'),
        h('a', { class: 'btn btn-sm', href: '#/upcoming' }, 'Payments and wishlist'))));
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
        h('span', { class: 'field-hint' }, 'It starts as your planned and recurring income for the month, or what came in last month if none is planned. Your own figure is kept for this month only.')),
      h('div', { class: 'btn-row' },
        e.planned !== null ? h('button', { type: 'button', class: 'btn btn-sm', onclick: use(e.planned) }, `Planned income · ${ctx.money(e.planned)}`) : null,
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
          ctx.toast('Your own figure removed');
        },
      }, 'Remove my figure')]
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

function amountList(ctx, rows) {
  return h('ul', { class: 'bd-cats' }, rows.map(([label, cents]) => h('li', {}, h('span', {}, label), h('span', { class: 'amount' }, ctx.money(cents)))));
}

function paymentsSheet(ctx, state, pic) {
  const { plan } = pic.planned;
  const items = [...plan.recurring.items, ...plan.planned.items].sort((a, b) => a.date.localeCompare(b.date));
  const total = plan.recurring.total + plan.planned.total;
  const status = { paid: 'paid', open: 'to come' };
  sheet(`Payments in ${formatMonthName(pic.month)}`,
    h('p', { class: 'bd-sum' }, `Planned: every recurring and planned payment due in ${formatMonth(pic.month)}, paid or still to come (skipped ones are left out): `, h('b', {}, ctx.money(total))),
    plan.covered ? h('p', { class: 'bd-note' }, `${ctx.money(plan.covered)} of that is paid from money set aside for it, which is counted under Set aside instead.`) : null,
    pic.future ? null : h('p', { class: 'bd-sum' }, 'So far: ', h('b', {}, ctx.money(pic.payments.paid)), ' paid from your spending money',
      pic.payments.toCome ? [', and ', h('b', {}, ctx.money(pic.payments.toCome)), ' still to come (less what’s held for them)'] : null, '.'),
    pic.fromPots ? h('p', { class: 'bd-note' }, `${ctx.money(pic.fromPots)} was paid from set-asides this month, so it isn’t counted here.`) : null,
    items.length
      ? h('ul', { class: 'bd-list' }, items.map((o) => h('li', {},
        h('span', { class: 'bd-date' }, formatShortDate(o.date)),
        h('span', { class: 'bd-name' }, o.rule.name, h('span', { class: 'bd-cat' }, `${categoryName(state, o.rule.categoryId)} · ${o.rule.planned ? 'planned' : 'recurring'} · ${status[o.status] ?? o.status}`)),
        h('span', { class: 'amount' }, ctx.money(o.amount)))))
      : h('p', { class: 'bd-note' }, 'None.'),
    h('p', { class: 'bd-note' }, 'Add or change them on the Upcoming page.'));
}

function setAsideSheet(ctx, state, pic) {
  const { plan } = pic.planned;
  const nameOf = (goal) => (goal.billId ? `${goal.name} (for the payment)` : goal.name);
  const done = [];
  if (!pic.future) {
    for (const goal of state.goals) {
      const sum = potEntries(state, goal).filter((e) => e.month === pic.month && e.date <= pic.today && e.kind !== 'paid').reduce((s, e) => s + e.amount, 0);
      if (sum) done.push([nameOf(goal), sum]);
    }
  }
  const toCome = new Map();
  for (const e of pic.toCome ?? []) if ((e.type === 'fund' || e.type === 'auto') && e.give) toCome.set(e.goal, (toCome.get(e.goal) ?? 0) + e.give);
  sheet(`Set aside in ${formatMonthName(pic.month)}`,
    h('p', { class: 'bd-sum' }, plan.expected.source === 'planned' ? 'Planned: splitting your income (done and planned) ' : 'Planned: your default splits applied to the expected income ', h('b', {}, ctx.money(plan.setAsides.split)),
      plan.setAsides.auto ? [', and moved automatically (on a schedule, or for a payment) ', h('b', {}, ctx.money(plan.setAsides.auto))] : null, '.'),
    pic.future ? null : [
      h('p', { class: 'bd-sum' }, 'So far: ', h('b', {}, ctx.money(pic.setAside.done)), '. Splits from income, money put in or taken out by hand and automatic moves. Moves between set-asides cancel out.'),
      done.length ? amountList(ctx, done) : null,
      toCome.size ? [h('p', { class: 'bd-sum' }, 'Still to come this month: ', h('b', {}, ctx.money(pic.setAside.toCome))), amountList(ctx, [...toCome].map(([goal, cents]) => [nameOf(goal), cents]))] : null,
    ],
    h('p', { class: 'bd-note' }, 'Change the default splits and schedules under Set-asides.'));
}
