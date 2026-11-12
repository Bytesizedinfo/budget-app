import { balance, budgetLevel, budgetSummary, byNewest, categoryName, goalProgress, inMonth, safeToSpend, spendByCategory, totals } from '../calc.js';
import { barList } from '../charts.js';
import { addMonths, dateInMonth, dayOf, daysInMonth, formatMonth, formatMonthName, formatMonthShort, formatShortDate, monthOf, todayISO } from '../dates.js';
import { h, icon } from '../dom.js';
import { formatApprox } from '../money.js';
import { nextDate } from '../recurring.js';
import { transactionDialog, txRow } from '../tx.js';
import { budgetRow, card, cardLink, empty, meter, notice, segmented, signedAmount, viewHead } from '../ui.js';
import { limitDialog } from './budgets.js';

const RANGES = [['today', 'Today'], ['week', 'This week'], ['month', 'This month']];

export function renderDashboard(ctx) {
  const state = ctx.store.get();
  const month = ctx.ui.month;
  const today = todayISO();
  const transactions = inMonth(state.transactions, month);
  const now = totals(transactions);
  const previousMonth = addMonths(month, -1);
  const before = totals(inMonth(state.transactions, previousMonth));
  const budgets = budgetSummary(state, month);
  const safe = safeToSpend(state, month, today);
  const isCurrent = month === monthOf(today);

  return h('div', { class: 'view' },
    viewHead(ctx, 'Overview', { month: true }),
    h('div', { class: 'stack' },
      safe ? safeHero(ctx, safe, month) : hero(ctx, budgets, month, today),
      balanceCard(ctx, state, month, today),
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

// The one number this page leads with when there's an overall monthly limit: what's safe to spend.
function safeHero(ctx, safe, month) {
  const name = formatMonthName(month);
  const bar = meter((safe.spent + safe.reserved) / safe.limit, safe.level, 'meter-lg');
  const breakdown = h('p', { class: 'hero-sub' }, [
    `${ctx.money(safe.spent)} spent`,
    safe.reserved ? `${ctx.money(safe.reserved)} in bills still to come` : null,
    `${ctx.money(safe.limit)} limit`,
  ].filter(Boolean).join(' · '));

  if (safe.past) {
    const over = safe.left < 0;
    return card({ cls: 'hero' },
      h('p', { class: `hero-label${over ? ' over' : ''}` }, over ? [icon('alert', 'icon-sm'), `Over your limit in ${name}`] : `Under your limit in ${name}`),
      h('p', { class: 'hero-value' }, ctx.money(Math.abs(safe.left))),
      bar,
      breakdown);
  }
  if (safe.left < 0) {
    return card({ cls: 'hero' },
      h('p', { class: 'hero-label over' }, icon('alert', 'icon-sm'), safe.future ? `Bills go over your limit in ${name}` : `Over your limit for ${name}`),
      h('p', { class: 'hero-value' }, ctx.money(-safe.left)),
      bar,
      breakdown,
      notice('over', safe.future
        ? `Your bills for ${name} add up to more than your ${ctx.money(safe.limit)} limit.`
        : `Nothing more is safe to spend in ${name} without going further over your ${ctx.money(safe.limit)} limit.`));
  }
  if (safe.future) {
    return card({ cls: 'hero' },
      h('p', { class: 'hero-label' }, `Safe to spend in ${name}`),
      h('p', { class: 'hero-value' }, ctx.money(safe.left)),
      bar,
      breakdown);
  }

  // This month: switch between today, the rest of this week and the rest of the month.
  const label = h('p', { class: 'hero-label' });
  const value = h('p', { class: 'hero-value' });
  const show = (range) => {
    ctx.ui.safeRange = range;
    const amount = range === 'today' ? safe.todayLeft : range === 'week' ? safe.weekLeft : safe.left;
    const when = range === 'today' ? 'today' : range === 'week' ? 'for the rest of this week' : `for the rest of ${name}`;
    label.textContent = amount < 0 ? `Over ${range === 'today' ? 'today’s' : 'this week’s'} share by` : `Safe to spend ${when}`;
    value.textContent = ctx.money(Math.abs(amount));
  };
  const range = ctx.ui.safeRange ?? 'today';
  show(range);
  return card({ cls: 'hero' },
    h('div', { class: 'hero-top' }, label, segmented('safe-range', RANGES, range, show, 'segmented-sm')),
    value,
    h('p', { class: 'hero-sub' }, safe.daysLeft === 1
      ? `${ctx.money(safe.perDay)} for today, the last day of ${name}`
      : `About ${ctx.money(safe.perDay)} a day for the ${safe.daysLeft} days left in ${name}`),
    bar,
    breakdown,
    safe.level === 'warn'
      ? notice('warn', `You’re spending faster than your limit allows: about ${ctx.money(safe.perDay)} a day left, against ${ctx.money(safe.evenShare)} a day if spread evenly.`)
      : null);
}

// How much there is in total, and how much of it is set aside in savings goals.
function balanceCard(ctx, state, month, today) {
  const asOf = month < monthOf(today) ? dateInMonth(month, 31) : today;
  const b = balance(state, asOf);
  return card({ title: 'Total balance', sub: asOf === today ? 'Income minus spending, as of today' : `At the end of ${formatMonth(month)}`, cls: 'balance' },
    h('p', { class: `balance-value${b.total < 0 ? ' bad' : ''}` }, ctx.money(b.total)),
    h('div', { class: 'balance-parts' },
      h('div', {}, h('span', { class: 'balance-label' }, 'In savings goals'), h('span', { class: 'balance-amount' }, ctx.money(b.savings))),
      h('div', {}, h('span', { class: 'balance-label' }, 'Spending money'), h('span', { class: `balance-amount${b.spending < 0 ? ' bad' : ''}` }, ctx.money(b.spending)))));
}

// Without an overall limit, the page leads with how much is left in this month's category budgets.
function hero(ctx, budgets, month, today) {
  if (!budgets.totalBudget) {
    return card({ cls: 'hero' },
      h('p', { class: 'hero-label' }, 'No spending limit yet'),
      h('p', { class: 'hero-text' }, 'Set one amount for all your spending each month, bills included, and this is where you’ll see what’s safe to spend today and this week.'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => limitDialog(ctx) }, 'Set a monthly limit'),
        h('a', { class: 'btn btn-ghost', href: '#/budgets' }, 'Or budget by category')));
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
