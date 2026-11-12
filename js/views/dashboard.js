import { budgetLevel, budgetSummary, byNewest, categoryName, goalProgress, inMonth, spendByCategory, totals } from '../calc.js';
import { barList } from '../charts.js';
import { addMonths, dayOf, daysInMonth, formatMonthName, formatMonthShort, formatShortDate, monthOf, todayISO } from '../dates.js';
import { h, icon } from '../dom.js';
import { formatApprox } from '../money.js';
import { nextDate } from '../recurring.js';
import { transactionDialog, txRow } from '../tx.js';
import { budgetRow, card, cardLink, empty, meter, signedAmount, viewHead } from '../ui.js';

export function renderDashboard(ctx) {
  const state = ctx.store.get();
  const month = ctx.ui.month;
  const today = todayISO();
  const transactions = inMonth(state.transactions, month);
  const now = totals(transactions);
  const previousMonth = addMonths(month, -1);
  const before = totals(inMonth(state.transactions, previousMonth));
  const budgets = budgetSummary(state, month);
  const isCurrent = month === monthOf(today);

  return h('div', { class: 'view' },
    viewHead(ctx, 'Overview', { month: true }),
    h('div', { class: 'stack' },
      hero(ctx, budgets, month, today),
      h('div', { class: 'kpis' },
        stat(ctx, 'Income', now.income, before.income, previousMonth, true),
        stat(ctx, 'Spent', now.expense, before.expense, previousMonth, false),
        stat(ctx, 'Net', now.net, before.net, previousMonth, true)),
      h('div', { class: 'grid-2' },
        budgetsCard(ctx, budgets),
        spendingCard(ctx, transactions, month)),
      h('div', { class: 'grid-2' },
        recentCard(ctx, transactions),
        h('div', { class: 'stack' },
          isCurrent ? upcomingCard(ctx, state, today) : null,
          goalsCard(ctx, state, today)))));
}

// The one number this page leads with: how much is left in this month's budgets.
function hero(ctx, budgets, month, today) {
  if (!budgets.totalBudget) {
    return card({ cls: 'hero' },
      h('p', { class: 'hero-label' }, 'No monthly budgets yet'),
      h('p', { class: 'hero-text' }, 'Give your spending categories a monthly limit and this is where you’ll see how much is left to spend.'),
      h('a', { class: 'btn btn-primary', href: '#/budgets' }, 'Set budgets'));
  }
  const { totalBudget, budgetedSpent } = budgets;
  const left = totalBudget - budgetedSpent;
  const level = budgetLevel(budgetedSpent, totalBudget);
  const name = formatMonthName(month);
  const daysLeft = month === monthOf(today) ? daysInMonth(month) - dayOf(today) + 1 : 0;
  const details = [`${ctx.money(budgetedSpent)} spent of ${ctx.money(totalBudget)} budgeted`];
  if (daysLeft && left > 0) details.push(`about ${ctx.money(Math.floor(left / daysLeft))} a day for the next ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`);
  return card({ cls: 'hero' },
    h('p', { class: 'hero-label' }, left < 0 ? [icon('alert', 'icon-sm'), `Over budget in ${name}`] : `Left to spend in ${name}`),
    h('p', { class: 'hero-value' }, ctx.money(Math.abs(left))),
    meter(budgetedSpent / totalBudget, level, 'meter-lg'),
    h('p', { class: 'hero-sub' }, details.join(' · ')));
}

function stat(ctx, label, value, previous, previousMonth, upIsGood) {
  const diff = value - previous;
  let delta = null;
  if (previous || value) {
    delta = diff === 0
      ? h('p', { class: 'delta' }, `Same as ${formatMonthShort(previousMonth)}`)
      : h('p', { class: `delta ${diff > 0 === upIsGood ? 'good' : 'bad'}` },
        `${diff > 0 ? '↑' : '↓'} ${formatApprox(Math.abs(diff), ctx.currency())} vs ${formatMonthShort(previousMonth)}`);
  }
  return h('div', { class: 'card stat' }, h('p', { class: 'stat-label' }, label), h('p', { class: 'stat-value' }, ctx.money(value)), delta);
}

function budgetsCard(ctx, budgets) {
  const ratio = (r) => (r.budget > 0 ? r.spent / r.budget : r.spent > 0 ? Infinity : 0);
  const rows = budgets.rows.filter((r) => r.budget !== null).sort((a, b) => ratio(b) - ratio(a));
  return card({ title: 'Budgets', sub: rows.length ? 'Closest to the limit first' : null, action: cardLink(rows.length ? 'All budgets' : 'Set budgets', '#/budgets') },
    rows.length
      ? h('div', { class: 'budget-list' }, rows.slice(0, 5).map((row) => budgetRow(ctx, row)))
      : empty('No category budgets yet.'),
    budgets.unbudgeted ? h('p', { class: 'card-foot' }, `Plus ${ctx.money(budgets.unbudgeted)} in categories without a budget`) : null);
}

function spendingCard(ctx, transactions, month) {
  const state = ctx.store.get();
  const rows = [...spendByCategory(transactions)]
    .map(([id, value]) => ({ label: categoryName(state, id), value }))
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  // Long tails fold into one row rather than a crowd of tiny bars.
  const shown = rows.length > 6
    ? [...rows.slice(0, 5), { label: `${rows.length - 5} more categories`, value: rows.slice(5).reduce((sum, r) => sum + r.value, 0) }]
    : rows;
  return card({ title: 'Spending by category', sub: total ? `${ctx.money(total)} in ${formatMonthName(month)}` : null, action: cardLink('Reports', '#/reports') },
    rows.length ? barList(shown, { format: ctx.money, total }) : empty('Nothing spent this month yet.'));
}

function recentCard(ctx, transactions) {
  const recent = [...transactions].sort(byNewest).slice(0, 6);
  return card({ title: 'Recent transactions', action: cardLink('All', '#/transactions'), cls: 'card-list' },
    recent.length
      ? h('div', { class: 'tx-list' }, recent.map((t) => txRow(ctx, t, { showDate: true })))
      : empty('No transactions this month.', h('button', { type: 'button', class: 'btn', onclick: () => transactionDialog(ctx) }, icon('plus'), 'Add a transaction')));
}

function upcomingCard(ctx, state, today) {
  const month = monthOf(today);
  const upcoming = state.recurring
    .map((rule) => ({ rule, date: nextDate(rule, today) }))
    .filter((u) => u.date && monthOf(u.date) === month)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!upcoming.length) return null;
  return card({ title: 'Coming up this month', action: cardLink('Recurring', '#/recurring') },
    h('ul', { class: 'upcoming' }, upcoming.map(({ rule, date }) => h('li', {},
      h('span', { class: 'upcoming-date' }, formatShortDate(date)),
      h('span', { class: 'upcoming-name' }, rule.name),
      signedAmount(ctx, rule.kind, rule.amount)))));
}

function goalsCard(ctx, state, today) {
  return card({ title: 'Savings goals', action: cardLink(state.goals.length ? 'All goals' : 'Add a goal', '#/goals') },
    state.goals.length
      ? h('div', { class: 'budget-list' }, state.goals.map((goal) => {
        const p = goalProgress(goal, today);
        if (p.open) {
          return h('div', { class: 'budget-row' },
            h('span', { class: 'budget-top' }, h('span', { class: 'budget-name' }, goal.name), h('span', { class: 'budget-left' }, `${ctx.money(p.saved)} saved`)));
        }
        return h('div', { class: 'budget-row' },
          h('span', { class: 'budget-top' },
            h('span', { class: 'budget-name' }, goal.name),
            h('span', { class: 'budget-left' }, p.done ? [icon('check', 'icon-sm'), 'Reached'] : `${Math.floor(p.ratio * 100)}%`)),
          meter(p.ratio),
          h('span', { class: 'budget-sub' }, `${ctx.money(p.saved)} of ${ctx.money(goal.target)}`));
      }))
      : empty('Saving up for something? Set a goal and track it here.'));
}
