import { balance, budgetLevel, budgetSummary, byNewest, categoryName, goalProgress, inRange, monthKey, paidFromPot, potEntries, spendByCategory, sumBy, totals } from '../calc.js';
import { barList } from '../charts.js';
import { formatMonth, formatMonthName, formatShortDate, isValidDate, monthOf, previousTimeframe, timeframe, timeframeText, todayISO } from '../dates.js';
import { h, icon } from '../dom.js';
import { formatApprox } from '../money.js';
import { dueCard } from '../due.js';
import { timeline } from '../forecast.js';
import { pace } from '../insights.js';
import { customDays, leftBy, monthPicture, PERIODS, periodEnd } from '../month.js';
import { isWish, sortedGoals } from '../pots.js';
import { toSplitCard } from '../split.js';
import { transactionDialog, txRow } from '../tx.js';
import { budgetRow, card, cardLink, checkbox, empty, meter, notice, openDialog, remember, segmented, signedAmount, timeframePicker, viewHead } from '../ui.js';
import { eventRow } from './upcoming.js';
import { savingsHomeCard } from './savings.js';

// The sections of the home page that can be reordered or hidden (To confirm and To split always lead).
// A layout saved while "Safe to spend" was a section of its own still works: unknown ids are left out.
const SECTIONS = [
  ['left', 'What you’d have left'],
  ['balance', 'Total balance'],
  ['savings', 'Savings'],
  ['stats', 'Income, spent and net'],
  ['budgets', 'Budgets'],
  ['spending', 'Spending by category'],
  ['recent', 'Recent transactions'],
  ['coming', 'Coming up this week'],
  ['setasides', 'Set aside'],
];
const WIDE = new Set(['stats']); // This one spans the page; the rest sit two to a row on a wide screen.

// The order and visibility chosen for the home page (settings.home), with any new sections added at the end.
export function homeLayout(state) {
  const saved = state.settings.home ?? {};
  const known = SECTIONS.map(([id]) => id);
  const order = Array.isArray(saved.order) ? saved.order.filter((id, i, all) => known.includes(id) && all.indexOf(id) === i) : [];
  for (const id of known) if (!order.includes(id)) order.push(id);
  return { order, hidden: new Set(Array.isArray(saved.hidden) ? saved.hidden : []) };
}

export function renderDashboard(ctx) {
  const state = ctx.store.get();
  const today = todayISO();
  // What you'd have left picks its own period, and budgets are about this month. Everything else follows the
  // time frame picked at the top (shared with every other page).
  const month = monthOf(today);
  const range = timeframe(ctx.ui.timeframe.choice, today, ctx.ui.timeframe);
  const previous = previousTimeframe(range);
  const transactions = inRange(state.transactions, range);
  const now = totals(transactions);
  const before = previous ? totals(inRange(state.transactions, previous)) : null;
  const budgets = budgetSummary(state, month);

  const build = {
    left: () => leftCard(ctx, state, today),
    balance: () => balanceCard(ctx, state, today),
    savings: () => savingsHomeCard(ctx, state, range),
    stats: () => h('div', { class: 'stack home-stats' },
      h('p', { class: 'range-note' }, icon('info', 'icon-sm'), `Income, spending, categories and recent transactions: ${timeframeText(range)}. Tap any number to see how it’s worked out.`),
      h('div', { class: 'kpis' },
        stat(ctx, 'Income', now.income, before?.income, previous, true, () => flowSheet(ctx, 'income', transactions, range)),
        stat(ctx, 'Spent', now.expense, before?.expense, previous, false, () => flowSheet(ctx, 'expense', transactions, range)),
        stat(ctx, 'Net', now.net, before?.net, previous, true, () => netSheet(ctx, transactions, range, now)))),
    budgets: () => budgetsCard(ctx, budgets),
    spending: () => spendingCard(ctx, transactions, range),
    recent: () => recentCard(ctx, transactions, range),
    coming: () => comingUpCard(ctx, state, today),
    setasides: () => goalsCard(ctx, state, today),
  };
  const layout = homeLayout(state);
  const cells = layout.order.filter((id) => !layout.hidden.has(id)).map((id) => {
    const el = build[id]();
    if (!el) return null;
    el.dataset.home = id;
    if (WIDE.has(id)) el.classList.add('home-wide');
    return el;
  });

  return h('div', { class: 'view' },
    viewHead(ctx, 'Home', { actions: [timeframePicker(ctx)] }),
    h('div', { class: 'stack' },
      dueCard(ctx),
      toSplitCard(ctx),
      h('div', { class: 'home-grid' }, cells),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm home-customise', onclick: () => homeDialog(ctx) }, icon('settings', 'icon-sm'), 'Customise this page')));
}

// Choose which sections the home page shows, and in what order. Saved with the budget, so every device matches.
function homeDialog(ctx) {
  const layout = homeLayout(ctx.store.get());
  let order = [...layout.order];
  const shown = new Map(order.map((id) => [id, !layout.hidden.has(id)]));
  const names = new Map(SECTIONS);
  const list = h('ul', { class: 'home-order' });
  const draw = () => {
    list.replaceChildren(...order.map((id, i) => {
      const box = checkbox(`show-${id}`, names.get(id), shown.get(id));
      box.querySelector('input').addEventListener('change', (event) => shown.set(id, event.target.checked));
      const move = (dir) => () => {
        const next = [...order];
        next.splice(i, 1);
        next.splice(i + dir, 0, id);
        order = next;
        draw();
        list.querySelector(`[data-move="${id}${dir}"]`)?.focus();
      };
      return h('li', { dataset: { section: id } },
        box,
        h('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': `Move ${names.get(id)} up`, dataset: { move: `${id}-1` }, disabled: i === 0, onclick: move(-1) }, icon('chevronUp')),
        h('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': `Move ${names.get(id)} down`, dataset: { move: `${id}1` }, disabled: i === order.length - 1, onclick: move(1) }, icon('chevronDown')));
    }));
  };
  draw();
  const dialog = openDialog({
    title: 'Customise the home page',
    content: h('div', { class: 'form-grid' },
      h('p', { class: 'field-hint' }, 'Untick a section to hide it, and use the arrows to change the order. “To confirm” and “To split” always stay at the top when there’s something in them.'),
      list),
    extraActions: [h('button', {
      type: 'button',
      class: 'btn btn-ghost',
      onclick: () => {
        ctx.store.setSettings({ home: null });
        dialog.close();
        ctx.toast('Home page reset');
      },
    }, 'Reset')],
    onSubmit() {
      ctx.store.setSettings({ home: { order, hidden: order.filter((id) => !shown.get(id)) } });
      ctx.toast('Home page saved');
    },
  });
}

// The card Home leads with: what you'd have left by the end of a period you pick (today, this week, this
// month, or a number of days or a date), what that allows per day, and how this month's spending compares with
// its spending budget. Everything comes from the month picture (month.js), so Budget shows the same figures.
// The switches add planned payments and ticked wishlist items; the choices are remembered on this device.
function leftCard(ctx, state, today) {
  const opts = ctx.ui.left;
  const month = monthOf(today);
  const name = formatMonthName(month);
  const period = PERIODS.some(([id]) => id === opts.period) ? opts.period : 'month';
  const pic = monthPicture(state, month, today, opts);
  const lb = leftBy(state, today, periodEnd(period, today, opts), opts);
  const b = pic.budget;
  const fixed = b.mode === 'fixed';
  // With a fixed budget, what's left can't be more than the budget allows either.
  const shown = period === 'month' ? pic.leftToSpend : fixed ? Math.min(lb.left, b.fixed - pic.spent - pic.wishes) : lb.left;
  const perDay = Math.floor(Math.max(0, shown) / lb.days);
  const when = { today: 'today', week: 'this week', month: name }[period] ?? null;
  const set = (patch) => {
    ctx.ui.left = { ...ctx.ui.left, ...patch };
    remember('budget-left', ctx.ui.left);
    ctx.refresh();
  };

  const periods = segmented('left-period', PERIODS, period, (next) => set({ period: next }), 'segmented-sm left-periods');
  for (const input of periods.querySelectorAll('input')) input.dataset.period = input.value;
  const custom = period === 'custom' ? h('div', { class: 'left-custom' },
    h('label', { class: 'left-custom-part' }, 'Next',
      h('input', { id: 'left-days', type: 'number', class: 'input input-num', min: 1, max: 366, inputmode: 'numeric', 'aria-label': 'Number of days', value: String(lb.days), dataset: { period: 'days' }, onchange: (event) => set({ days: customDays(event.target.value), until: '' }) }),
      'days'),
    h('label', { class: 'left-custom-part' }, 'or until',
      h('input', { id: 'left-until', type: 'date', class: 'input', min: today, 'aria-label': 'Until', value: lb.until, dataset: { period: 'until' }, onchange: (event) => { if (isValidDate(event.target.value)) set({ until: event.target.value }); } }))) : null;

  const label = period === 'custom'
    ? `What you’d have left in ${lb.days === 1 ? '1 day' : `${lb.days} days`} (to ${formatShortDate(lb.until)})`
    : `What you’d have left by the end of ${when}`;
  let perDayText;
  if (lb.days === 1) perDayText = period === 'month' ? ' for today, the last day of the month' : ' for today';
  else perDayText = ` a day for the ${lb.days} days${period === 'month' ? ` left in ${name}` : ''}`;

  const ticked = state.goals.filter((g) => isWish(g) && g.wish.tick && !g.wish.boughtTxId && !g.wish.dropped);
  const toggle = (key, text, hint) => h('label', { class: 'switch' },
    h('input', { type: 'checkbox', role: 'switch', checked: !!opts[key], dataset: { left: key }, onchange: (event) => set({ [key]: event.target.checked }) }),
    h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
    h('span', {}, text, hint ? h('span', { class: 'switch-hint' }, hint) : null));

  const ratio = b.amount > 0 ? pic.spent / b.amount : pic.spent > 0 ? 1 : 0;
  const budgetLine = fixed
    ? `${ctx.money(pic.spent)} spent of your ${ctx.money(b.fixed)} budget · your income would allow ${ctx.money(b.auto)}`
    : `${ctx.money(pic.spent)} spent of ${ctx.money(b.amount)} spending budget`;

  return card({ cls: 'perday left-card' },
    periods,
    custom,
    h('p', { class: 'perday-label' }, label),
    h('p', { class: `perday-value${shown < 0 ? ' bad' : ''}` }, ctx.money(shown)),
    h('p', { class: 'perday-perday' }, h('b', {}, ctx.money(perDay)), perDayText),
    period === 'month' ? null : h('p', { class: 'perday-month' }, `To make it last to the end of the month: ${ctx.money(pic.perDay)} a day`),
    h('p', { class: 'hero-sub' }, lb.due
      ? `From the ${ctx.money(lb.start)} spending money you have, after ${ctx.money(lb.due)} still to come out in that time.`
      : `From the ${ctx.money(lb.start)} spending money you have. Nothing more is set to come out in that time.`),
    h('div', { class: 'left-budget' },
      meter(ratio, budgetLevel(pic.spent, Math.max(0, b.amount))),
      h('a', { class: 'left-budget-text', href: '#/budget' }, budgetLine)),
    h('div', { class: 'switches' },
      toggle('planned', 'Planned payments'),
      toggle('wishes', 'Wishlist', ticked.length ? `${ticked.length} ticked` : 'none ticked')),
    h('p', { class: 'perday-today' }, `Today: ${ctx.money(pic.spentToday)} spent`),
    leftMessage(ctx, pic, lb, period, when, pace(state, today, opts, pic)),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm perday-how', onclick: () => leftSheet(ctx, pic, lb, label, shown, perDay) }, 'How is this worked out?'));
}

// At most one message, the most important first: what's still to come is more than you have; you're over a
// fixed budget; at this pace the money runs out before the month ends.
function leftMessage(ctx, pic, lb, period, when, p) {
  const name = formatMonthName(pic.month);
  if (lb.left < 0) {
    const by = period === 'custom' ? `in the next ${lb.days === 1 ? 'day' : `${lb.days} days`}` : period === 'month' ? 'this month' : when;
    return notice('over', `What’s still to come ${by} is ${ctx.money(-lb.left)} more than your spending money.`);
  }
  if (pic.left < 0) return notice('over', `What’s still to come this month is ${ctx.money(-pic.left)} more than your spending money.`);
  if (pic.budget.mode === 'fixed' && pic.spent + pic.wishes > pic.budget.fixed) {
    return notice('over', `You’re ${ctx.money(pic.spent + pic.wishes - pic.budget.fixed)} over your ${ctx.money(pic.budget.fixed)} budget for ${name}.`);
  }
  if (p.runOut && pic.leftToSpend > 0) {
    return notice('warn', `At this month’s pace (about ${ctx.money(p.perDay)} a day), ${p.limitedBy === 'budget' ? 'your budget' : 'your spending money'} runs out around ${formatShortDate(p.runOut)}.`);
  }
  return null;
}

// How much there is in total, and how much of it is set aside. Always as of today.
function balanceCard(ctx, state, today) {
  const b = balance(state, today);
  const open = (what) => () => balanceSheet(ctx, state, today, what);
  return card({ title: 'Total balance', sub: 'Income minus spending, as of today', cls: 'balance' },
    h('button', { type: 'button', class: `balance-value tap${b.total < 0 ? ' bad' : ''}`, onclick: open('total'), 'aria-label': `Total balance ${ctx.money(b.total)}: how it’s worked out` }, ctx.money(b.total)),
    h('div', { class: 'balance-parts' },
      h('button', { type: 'button', class: 'tap', onclick: open('savings') }, h('span', { class: 'balance-label' }, 'Set aside'), h('span', { class: 'balance-amount' }, ctx.money(b.savings))),
      h('button', { type: 'button', class: 'tap', onclick: open('spending') }, h('span', { class: 'balance-label' }, 'Spending money'), h('span', { class: `balance-amount${b.spending < 0 ? ' bad' : ''}` }, ctx.money(b.spending)))));
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
  return card({ title: 'Spending by category', sub: total ? `${ctx.money(total)} · ${timeframeText(range)}` : null, action: cardLink('Insights', '#/insights') },
    rows.length ? barList(shown, { format: ctx.money, total, cls: 's2' }) : empty('Nothing spent in this time frame.'));
}

function recentCard(ctx, transactions, range) {
  const recent = [...transactions].sort(byNewest).slice(0, 6);
  return card({ title: 'Recent transactions', sub: timeframeText(range), action: cardLink(`All ${transactions.length}`, '#/activity'), cls: 'card-list' },
    recent.length
      ? h('div', { class: 'tx-list' }, recent.map((t) => txRow(ctx, t, { showDate: true })))
      : empty('No transactions in this time frame.', h('button', { type: 'button', class: 'btn', onclick: () => transactionDialog(ctx) }, icon('plus'), 'Add a transaction')));
}

// The next seven days: payments, expected income and automatic set-asides, with what each leaves.
function comingUpCard(ctx, state, today) {
  const events = timeline(state, today, 7).events.filter((e) => e.amount !== 0 && e.date > today);
  if (!events.length) return null;
  return card({ title: 'Coming up this week', sub: 'And the spending money left after each', action: cardLink('Upcoming', '#/upcoming') },
    h('ul', { class: 'tl tl-compact' }, events.slice(0, 6).map((e) => eventRow(ctx, e, today, { edit: true }))));
}

function goalsCard(ctx, state, today) {
  const goals = sortedGoals(state);
  return card({ title: 'Set aside', action: cardLink(goals.length ? 'Budget' : 'Add a set-aside', '#/plan') },
    goals.length
      ? h('div', { class: 'budget-list' }, goals.map((goal) => {
        const p = goalProgress(state, goal, today);
        if (p.open) {
          return h('div', { class: 'budget-row' },
            h('span', { class: 'budget-top' }, h('span', { class: 'budget-name' }, goal.name), h('span', { class: 'budget-left' }, `${ctx.money(p.saved)} set aside`)));
        }
        return h('div', { class: 'budget-row' },
          h('span', { class: 'budget-top' },
            h('span', { class: 'budget-name' }, goal.name),
            h('span', { class: 'budget-left' }, p.done ? [icon('check', 'icon-sm'), 'Reached'] : `${Math.floor(p.ratio * 100)}%`)),
          meter(p.ratio),
          h('span', { class: 'budget-sub' }, `${ctx.money(p.saved)} of ${ctx.money(goal.target)}`));
      }))
      : empty('Saving up for something, or keeping money apart for bills? Add a set-aside and split your income into it.'));
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
  const fromPots = list.filter(paidFromPot(state)).reduce((s, t) => s + t.amount, 0);
  sheet(`${what}: how it’s worked out`,
    sumLine(lead, n ? h('b', {}, ctx.money(total)) : null),
    movedIn ? h('p', { class: 'bd-note' }, 'Pay marked for this month counts here, even though it arrived at the end of the month before.') : null,
    fromPots ? h('p', { class: 'bd-note' }, `${ctx.money(fromPots)} of this was paid from set-asides, so it didn’t come out of your spending money.`) : null,
    byCategory(ctx, state, list, kind),
    entryList(ctx, state, list, !!range.month));
}

function netSheet(ctx, transactions, range, now) {
  const state = ctx.store.get();
  sheet('Net: how it’s worked out',
    sumLine('Net = income ', h('b', {}, ctx.money(now.income)), ' − spent ', h('b', {}, ctx.money(now.expense)), ' = ', h('b', {}, ctx.money(now.net))),
    h('p', { class: 'bd-note' }, `For ${timeframeText(range)}. Money you set aside isn’t spending, so it isn’t taken off here.`),
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
      h('p', { class: 'bd-note' }, 'Every transaction you’ve recorded up to today, newest first. Money you’ve set aside is still part of this total.'),
      entryList(ctx, state, upToToday, false));
    return;
  }
  const nameOf = (id) => state.goals.find((g) => g.id === id)?.name ?? 'a deleted set-aside';
  const label = (e) => {
    if (e.kind === 'split') return `From ${e.tx.note || categoryName(state, e.tx.categoryId)}`;
    if (e.kind === 'paid') return `Paid: ${e.tx.note || categoryName(state, e.tx.categoryId)}`;
    if (e.kind === 'move') return e.amount > 0 ? `Moved from ${nameOf(e.move)}` : `Moved to ${nameOf(e.move)}`;
    return e.amount > 0 ? 'Put in' : 'Taken out';
  };
  const goals = sortedGoals(state).map((g) => ({ g, items: potEntries(state, g).filter((e) => e.date <= today).sort((a, b) => b.date.localeCompare(a.date)) }))
    .map((x) => ({ ...x, saved: x.items.reduce((s, e) => s + e.amount, 0) }));
  const goalsList = h('div', { class: 'bd-groups' }, goals.map(({ g, items, saved }) => h('section', { class: 'bd-group' },
    h('h3', { class: 'bd-head' }, h('span', {}, g.name), h('span', {}, ctx.money(saved))),
    items.length
      ? h('ul', { class: 'bd-list' }, items.map((e) => h('li', {}, h('span', { class: 'bd-date' }, formatShortDate(e.date)), h('span', { class: 'bd-name' }, label(e)), h('span', { class: `amount${e.amount > 0 ? ' income' : ''}` }, ctx.money(e.amount, { sign: true })))))
      : h('p', { class: 'bd-note' }, 'Nothing put in yet.'))));
  if (what === 'savings') {
    sheet('Set aside: how it’s worked out',
      sumLine('Everything put into your set-asides (by hand or split from income), minus anything taken out or paid from them = ', h('b', {}, ctx.money(b.savings))),
      goalsList);
    return;
  }
  sheet('Spending money: how it’s worked out',
    sumLine('Total balance ', h('b', {}, ctx.money(b.total)), ' − set aside ', h('b', {}, ctx.money(b.savings)), ' = ', h('b', {}, ctx.money(b.spending))),
    h('p', { class: 'bd-note' }, 'It’s the part of your money that isn’t set aside. Tap Total balance for every transaction behind it.'),
    goalsList);
}

// The month picture line by line, then the chosen period: what's still to come in it and what's left per day.
function leftSheet(ctx, pic, lb, label, shown, perDay) {
  const today = todayISO();
  const name = formatMonthName(pic.month);
  const b = pic.budget;
  const what = [pic.opts.planned ? 'planned payments' : null, pic.opts.wishes ? 'ticked wishlist items' : null].filter(Boolean);
  const line = (text, cents, sub, cls = '') => h('li', { class: cls },
    h('span', { class: 'bd-name' }, text, sub ? h('span', { class: 'bd-cat' }, sub) : null),
    h('span', { class: 'amount' }, ctx.money(cents)));
  const parts = (done, toCome, doneWord) => (toCome ? `${ctx.money(done)} ${doneWord}, ${ctx.money(toCome)} still to come` : null);
  const events = lb.events.filter((e) => e.amount !== 0 || e.type === 'bill');
  sheet('What you’d have left: how it’s worked out',
    h('h3', { class: 'bd-head' }, h('span', {}, `${name} so far`)),
    h('ul', { class: 'bd-lines' },
      line('Carried in', pic.carriedIn, pic.income.countsLater ? `From before ${name}, and ${ctx.money(pic.income.countsLater)} that came in now but counts next month` : `From before ${name}`),
      line(`+ Income that counts in ${name}`, pic.income.received, pic.income.expected ? `${ctx.money(pic.income.expected)} more is expected, and counted once it arrives` : null),
      line('− Set aside', pic.setAside.total, parts(pic.setAside.done, pic.setAside.toCome, 'done')),
      line('− Recurring and planned payments', pic.payments.total, parts(pic.payments.paid, pic.payments.toCome, 'paid')),
      line('= Spending budget', b.auto, isFixed(b) ? 'What your income allows' : 'Worked out from the lines above', 'bd-total'),
      isFixed(b) ? line('Your fixed budget', b.fixed, b.scope === 'month' ? `For ${name} only` : 'Every month') : null,
      line('− Spent so far', pic.spent, pic.fromPots ? `Plus ${ctx.money(pic.fromPots)} paid from set-asides, which isn’t counted` : null),
      pic.wishes ? line('− Ticked wishlist items', pic.wishes, 'If you bought them today') : null,
      line('= Left', pic.leftToSpend, isFixed(b) ? (pic.limitedBy === 'budget' ? 'What your budget still allows' : 'What your money still allows, which is less than your budget') : `About ${ctx.money(pic.perDay)} a day for the ${plural(pic.daysLeft, 'day', 'days')} left`, 'bd-total')),
    h('p', { class: 'bd-note' }, `Left is always your real money: the ${ctx.money(pic.spending)} spending money you have, less everything still due this month.`),
    h('h3', { class: 'bd-head' }, h('span', {}, label)),
    sumLine('Spending money ', h('b', {}, ctx.money(lb.start)),
      lb.due ? [' − still to come out by ', formatShortDate(lb.until), ' ', h('b', {}, ctx.money(lb.due))] : null,
      ' = ', h('b', {}, ctx.money(lb.left))),
    shown !== lb.left ? h('p', { class: 'bd-note' }, `Your budget allows less: ${ctx.money(shown)}.`) : null,
    sumLine(`Shared over the ${plural(lb.days, 'day', 'days')}, today included = `, h('b', {}, `${ctx.money(perDay)} a day`)),
    h('p', { class: 'bd-note' }, 'Today’s spending has already come out, so it isn’t added back.'),
    events.length
      ? h('ul', { class: 'tl' }, events.map((e) => eventRow(ctx, e, today)))
      : h('p', { class: 'bd-note' }, 'Nothing more is set to come out in that time.'),
    h('p', { class: 'bd-note' }, `Counted: payments still to confirm, money moving into set-asides automatically${what.length ? `, and ${what.join(' and ')}` : ''}. Income still to come isn’t counted until it arrives. Payments are paid from money already set aside for them first.`));
}

const isFixed = (budget) => budget.mode === 'fixed';
