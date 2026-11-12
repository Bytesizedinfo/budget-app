import { balance, budgetLevel, budgetSummary, byNewest, categoryName, goalProgress, inRange, monthKey, safeToSpend, spendByCategory, spendPerDay, sumBy, totals } from '../calc.js';
import { barList } from '../charts.js';
import { dayOf, daysInMonth, formatMonth, formatMonthName, formatShortDate, monthOf, previousTimeframe, timeframe, timeframeText, todayISO } from '../dates.js';
import { h, icon } from '../dom.js';
import { formatApprox } from '../money.js';
import { nextDate } from '../recurring.js';
import { transactionDialog, txRow } from '../tx.js';
import { budgetRow, card, cardLink, empty, meter, notice, openDialog, segmented, signedAmount, timeframePicker, viewHead } from '../ui.js';
import { limitDialog } from './budgets.js';

const RANGES = [['today', 'Today'], ['week', 'This week'], ['month', 'This month']];

export function renderDashboard(ctx) {
  const state = ctx.store.get();
  const today = todayISO();
  // Safe to spend, spend per day and budgets are always about the rest of this month. Everything else follows
  // the time frame picked at the top (shared with Transactions).
  const month = monthOf(today);
  const range = timeframe(ctx.ui.timeframe.choice, today, ctx.ui.timeframe);
  const previous = previousTimeframe(range);
  const transactions = inRange(state.transactions, range);
  const now = totals(transactions);
  const before = previous ? totals(inRange(state.transactions, previous)) : null;
  const budgets = budgetSummary(state, month);
  const safe = safeToSpend(state, month, today);
  const daily = spendPerDay(state, today);

  return h('div', { class: 'view' },
    viewHead(ctx, 'Overview', { actions: [timeframePicker(ctx)] }),
    h('div', { class: 'stack' },
      h('div', { class: 'hero-row' },
        safe ? safeHero(ctx, safe, month) : hero(ctx, budgets, month, today),
        perDayCard(ctx, daily, safe, month)),
      balanceCard(ctx, state, today),
      h('p', { class: 'range-note' }, icon('info', 'icon-sm'), `Income, spending and the lists below: ${timeframeText(range)}. Tap any number to see how it’s worked out.`),
      h('div', { class: 'kpis' },
        stat(ctx, 'Income', now.income, before?.income, previous, true, () => flowSheet(ctx, 'income', transactions, range)),
        stat(ctx, 'Spent', now.expense, before?.expense, previous, false, () => flowSheet(ctx, 'expense', transactions, range)),
        stat(ctx, 'Net', now.net, before?.net, previous, true, () => netSheet(ctx, transactions, range, now))),
      h('div', { class: 'grid-2' },
        budgetsCard(ctx, budgets),
        spendingCard(ctx, transactions, range)),
      h('div', { class: 'grid-2' },
        recentCard(ctx, transactions, range),
        h('div', { class: 'stack' },
          upcomingCard(ctx, state, today),
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

// What you can spend each day for the rest of the month, from the money you actually have.
function perDayCard(ctx, d, safe, month) {
  const name = formatMonthName(month);
  const overToday = d.todayLeft < 0;
  return card({ cls: 'perday' },
    h('p', { class: 'perday-label' }, 'You can spend per day'),
    h('p', { class: `perday-value${d.free < 0 ? ' bad' : ''}` }, ctx.money(d.perDay), h('span', { class: 'perday-unit' }, ' a day')),
    h('p', { class: 'hero-sub' }, d.daysLeft === 1
      ? `Today is the last day of ${name}.`
      : `For the ${d.daysLeft} days left in ${name}, from the ${ctx.money(d.spending)} spending money you have${d.reserved ? `, after ${ctx.money(d.reserved)} of bills still to come` : ''}.`),
    h('div', { class: 'perday-today' },
      h('span', {}, `Today: ${ctx.money(d.spentToday)} spent`),
      h('span', { class: overToday ? 'bad' : 'good' }, overToday ? `${ctx.money(-d.todayLeft)} over today’s share` : `${ctx.money(d.todayLeft)} left today`)),
    d.free < 0 ? notice('over', `Bills still to come this month are ${ctx.money(-d.free)} more than your spending money.`) : null,
    safe && !safe.past && !safe.future && safe.left < 0
      ? h('p', { class: 'perday-note' }, `Separately, you’re ${ctx.money(-safe.left)} over your ${ctx.money(safe.limit)} monthly limit.`)
      : null,
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm perday-how', onclick: () => perDaySheet(ctx, d, month) }, 'How is this worked out?'));
}

// How much there is in total, and how much of it is set aside in savings goals. Always as of today.
function balanceCard(ctx, state, today) {
  const b = balance(state, today);
  const open = (what) => () => balanceSheet(ctx, state, today, what);
  return card({ title: 'Total balance', sub: 'Income minus spending, as of today', cls: 'balance' },
    h('button', { type: 'button', class: `balance-value tap${b.total < 0 ? ' bad' : ''}`, onclick: open('total'), 'aria-label': `Total balance ${ctx.money(b.total)}: how it’s worked out` }, ctx.money(b.total)),
    h('div', { class: 'balance-parts' },
      h('button', { type: 'button', class: 'tap', onclick: open('savings') }, h('span', { class: 'balance-label' }, 'In savings goals'), h('span', { class: 'balance-amount' }, ctx.money(b.savings))),
      h('button', { type: 'button', class: 'tap', onclick: open('spending') }, h('span', { class: 'balance-label' }, 'Spending money'), h('span', { class: `balance-amount${b.spending < 0 ? ' bad' : ''}` }, ctx.money(b.spending)))));
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

function stat(ctx, label, value, previous, previousRange, upIsGood, onOpen) {
  let delta = null;
  if (previousRange && (previous || value)) {
    const diff = value - previous;
    delta = diff === 0
      ? h('p', { class: 'delta' }, `Same as ${previousRange.label}`)
      : h('p', { class: `delta ${diff > 0 === upIsGood ? 'good' : 'bad'}` },
        `${diff > 0 ? '↑' : '↓'} ${formatApprox(Math.abs(diff), ctx.currency())} vs ${previousRange.label}`);
  }
  return h('button', { type: 'button', class: 'card stat stat-btn', onclick: onOpen, 'aria-label': `${label} ${ctx.money(value)}: how it’s worked out` },
    h('p', { class: 'stat-label' }, h('span', {}, label), h('span', { class: 'how' }, 'How?')),
    h('p', { class: 'stat-value' }, ctx.money(value)),
    delta);
}

function budgetsCard(ctx, budgets) {
  const ratio = (r) => (r.budget > 0 ? r.spent / r.budget : r.spent > 0 ? Infinity : 0);
  const rows = budgets.rows.filter((r) => r.budget !== null).sort((a, b) => ratio(b) - ratio(a));
  return card({ title: 'Budgets', sub: rows.length ? 'This month, closest to the limit first' : null, action: cardLink(rows.length ? 'All budgets' : 'Set budgets', '#/budgets') },
    rows.length
      ? h('div', { class: 'budget-list' }, rows.slice(0, 5).map((row) => budgetRow(ctx, row)))
      : empty('No category budgets yet.'),
    budgets.unbudgeted ? h('p', { class: 'card-foot' }, `Plus ${ctx.money(budgets.unbudgeted)} in categories without a budget`) : null);
}

function spendingCard(ctx, transactions, range) {
  const state = ctx.store.get();
  const rows = [...spendByCategory(transactions)]
    .map(([id, value]) => ({ label: categoryName(state, id), value }))
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  // Long tails fold into one row rather than a crowd of tiny bars.
  const shown = rows.length > 6
    ? [...rows.slice(0, 5), { label: `${rows.length - 5} more categories`, value: rows.slice(5).reduce((sum, r) => sum + r.value, 0) }]
    : rows;
  return card({ title: 'Spending by category', sub: total ? `${ctx.money(total)} · ${timeframeText(range)}` : null, action: cardLink('Reports', '#/reports') },
    rows.length ? barList(shown, { format: ctx.money, total }) : empty('Nothing spent in this time frame.'));
}

function recentCard(ctx, transactions, range) {
  const recent = [...transactions].sort(byNewest).slice(0, 6);
  return card({ title: 'Recent transactions', sub: timeframeText(range), action: cardLink(`All ${transactions.length}`, '#/transactions'), cls: 'card-list' },
    recent.length
      ? h('div', { class: 'tx-list' }, recent.map((t) => txRow(ctx, t, { showDate: true })))
      : empty('No transactions in this time frame.', h('button', { type: 'button', class: 'btn', onclick: () => transactionDialog(ctx) }, icon('plus'), 'Add a transaction')));
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

// ---------- "How this is worked out" sheets ----------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function sheet(title, ...content) {
  openDialog({ title, content: h('div', { class: 'bd' }, ...content), submitLabel: 'Done' });
}
function sumLine(...parts) {
  return h('p', { class: 'bd-sum' }, parts);
}
// Every entry, grouped by month with that month's totals. byCounts: group by the month each entry counts in
// (used when looking at whole months); otherwise by the month it happened.
function entryList(ctx, state, list, byCounts) {
  if (!list.length) return empty('Nothing here.');
  const groups = new Map();
  for (const t of [...list].sort(byNewest)) {
    const key = byCounts ? monthKey(t) : String(t.date).slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return h('div', { class: 'bd-groups' }, [...groups].map(([key, items]) => {
    const s = totals(items);
    return h('section', { class: 'bd-group' },
      h('h3', { class: 'bd-head' }, h('span', {}, formatMonth(key)),
        h('span', {}, [s.income ? `${ctx.money(s.income)} in` : null, s.expense ? `${ctx.money(s.expense)} out` : null].filter(Boolean).join(' · '))),
      h('ul', { class: 'bd-list' }, items.map((t) => {
        const name = categoryName(state, t.categoryId);
        const counts = monthKey(t) !== String(t.date).slice(0, 7) ? `received ${formatShortDate(t.date)}, counts in ${formatMonthName(monthKey(t))}` : null;
        return h('li', {},
          h('span', { class: 'bd-date' }, formatShortDate(t.date)),
          h('span', { class: 'bd-name' }, t.note || name, t.note || counts ? h('span', { class: 'bd-cat' }, [t.note ? name : null, counts].filter(Boolean).join(' · ')) : null),
          signedAmount(ctx, t.kind, t.amount));
      })));
  }));
}
function byCategory(ctx, state, list, kind) {
  const rows = [...sumBy(list, kind)].map(([id, v]) => [categoryName(state, id), v]).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return null;
  return h('ul', { class: 'bd-cats' }, rows.map(([name, v]) => h('li', {}, h('span', {}, name), h('span', { class: 'amount' }, ctx.money(v)))));
}

function flowSheet(ctx, kind, transactions, range) {
  const state = ctx.store.get();
  const list = transactions.filter((t) => t.kind === kind);
  const total = list.reduce((s, t) => s + t.amount, 0);
  const what = kind === 'income' ? 'Income' : 'Spent';
  const n = list.length;
  const noun = kind === 'income' ? (n === 1 ? 'income entry' : 'income entries') : (n === 1 ? 'expense' : 'expenses');
  const lead = n === 0 ? `There are no ${noun} in ${timeframeText(range)}.` : `${what} = ${n === 1 ? `the one ${noun}` : `all ${n} ${noun}`} in ${timeframeText(range)} added up = `;
  const movedIn = range.month && list.some((t) => monthKey(t) !== String(t.date).slice(0, 7));
  sheet(`${what}: how it’s worked out`,
    sumLine(lead, n ? h('b', {}, ctx.money(total)) : null),
    movedIn ? h('p', { class: 'bd-note' }, 'Pay marked for this month counts here, even though it arrived at the end of the month before.') : null,
    byCategory(ctx, state, list, kind),
    entryList(ctx, state, list, !!range.month));
}

function netSheet(ctx, transactions, range, now) {
  const state = ctx.store.get();
  sheet('Net: how it’s worked out',
    sumLine('Net = income ', h('b', {}, ctx.money(now.income)), ' − spent ', h('b', {}, ctx.money(now.expense)), ' = ', h('b', {}, ctx.money(now.net))),
    h('p', { class: 'bd-note' }, `For ${timeframeText(range)}. Money moved into savings goals isn’t spending, so it isn’t taken off here.`),
    entryList(ctx, state, transactions, !!range.month));
}

function balanceSheet(ctx, state, today, what) {
  const b = balance(state, today);
  const upToToday = state.transactions.filter((t) => typeof t.date === 'string' && t.date <= today);
  const all = totals(upToToday);
  const ins = upToToday.filter((t) => t.kind === 'income').length;
  const outs = upToToday.length - ins;
  if (what === 'total') {
    sheet('Total balance: how it’s worked out',
      sumLine('Everything that came in up to today ', h('b', {}, ctx.money(all.income)), ` (${plural(ins, 'entry', 'entries')}) − everything spent `, h('b', {}, ctx.money(all.expense)), ` (${plural(outs, 'entry', 'entries')}) = `, h('b', {}, ctx.money(b.total))),
      h('p', { class: 'bd-note' }, 'Every transaction you’ve recorded up to today, newest first. Money in savings goals is still part of this total.'),
      entryList(ctx, state, upToToday, false));
    return;
  }
  const goals = state.goals.map((g) => ({ g, items: g.contributions.filter((c) => c.date <= today).sort((a, b) => b.date.localeCompare(a.date)) }))
    .map((x) => ({ ...x, saved: x.items.reduce((s, c) => s + c.amount, 0) }));
  const goalsList = h('div', { class: 'bd-groups' }, goals.map(({ g, items, saved }) => h('section', { class: 'bd-group' },
    h('h3', { class: 'bd-head' }, h('span', {}, g.name), h('span', {}, ctx.money(saved))),
    items.length
      ? h('ul', { class: 'bd-list' }, items.map((c) => h('li', {}, h('span', { class: 'bd-date' }, formatShortDate(c.date)), h('span', { class: 'bd-name' }, c.amount < 0 ? 'Taken out' : 'Put in'), h('span', { class: `amount${c.amount > 0 ? ' income' : ''}` }, ctx.money(c.amount, { sign: true })))))
      : h('p', { class: 'bd-note' }, 'Nothing put in yet.'))));
  if (what === 'savings') {
    sheet('In savings goals: how it’s worked out',
      sumLine('Everything put into your savings goals, minus anything taken out = ', h('b', {}, ctx.money(b.savings))),
      goalsList);
    return;
  }
  sheet('Spending money: how it’s worked out',
    sumLine('Total balance ', h('b', {}, ctx.money(b.total)), ' − in savings goals ', h('b', {}, ctx.money(b.savings)), ' = ', h('b', {}, ctx.money(b.spending))),
    h('p', { class: 'bd-note' }, 'It’s the part of your money that isn’t set aside in a goal. Tap Total balance for every transaction behind it.'),
    goalsList);
}

function perDaySheet(ctx, d, month) {
  const state = ctx.store.get();
  sheet('Spend per day: how it’s worked out',
    sumLine('Spending money ', h('b', {}, ctx.money(d.spending)),
      d.reserved ? [' − bills still to come ', h('b', {}, ctx.money(d.reserved))] : null,
      d.spentToday ? [' + what you spent today ', h('b', {}, ctx.money(d.spentToday))] : null,
      ` = ${ctx.money(Math.max(0, d.free + d.spentToday))}, shared over the ${plural(d.daysLeft, 'day', 'days')} left in ${formatMonthName(month)} = `, h('b', {}, `${ctx.money(d.perDay)} a day`)),
    h('p', { class: 'bd-note' }, `Today’s share is ${ctx.money(d.perDay)}; you’ve spent ${ctx.money(d.spentToday)} today, so ${d.todayLeft < 0 ? `you’re ${ctx.money(-d.todayLeft)} over it` : `${ctx.money(d.todayLeft)} is left`}. Spending today is added back first so it only lowers today’s share, not every day’s.`),
    d.upcoming.length
      ? h('ul', { class: 'bd-cats' }, d.upcoming.map((u) => h('li', {}, h('span', {}, `${u.rule.name} · ${formatShortDate(u.date)}`), h('span', { class: 'amount' }, ctx.money(u.rule.amount)))))
      : h('p', { class: 'bd-note' }, `No bills still to come in ${formatMonthName(month)}.`),
    h('p', { class: 'bd-note' }, 'Spending money is everything that came in, minus everything spent, minus what’s in your savings goals. Tap it on the Overview to see every entry.'),
    h('p', { class: 'bd-note' }, plural(state.transactions.length, 'transaction is', 'transactions are') + ' recorded in total.'));
}
