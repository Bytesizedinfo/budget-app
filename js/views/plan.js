// The Plan page: set-asides (savings goals and pots), the default split for each kind of income,
// "try a pay amount", planned against actually set aside, and checks on the plan.

import { balance, categoriesFor, categoryName, goalProgress, inRange, potBalance, potEntries, sortCategories } from '../calc.js';
import { barList } from '../charts.js';
import { formatDate, formatMonth, formatShortDate, isValidDate, timeframe, timeframeText, todayISO } from '../dates.js';
import { h, icon } from '../dom.js';
import { centsToInput, parseAmount } from '../money.js';
import { needsWants } from '../insights.js';
import { defaultSplit, incomeMonths, planChecks, plannedFor, ratioOf, setAsideIn, sortedGoals, sourcesOf, tryPay, validSchedule } from '../pots.js';
import { defaultSplitDialog, markSplitUsed, ratioDialog, ratioText, ruleText, scheduleFields, scheduleText, splitWords, toSplitCard } from '../split.js';
import { newId } from '../store.js';
import { card, checkbox, confirmDialog, empty, field, meter, notice, openDialog, pointList, timeframePicker, viewHead } from '../ui.js';

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });

export function renderPlan(ctx) {
  const state = ctx.store.get();
  const today = todayISO();
  const range = timeframe(ctx.ui.timeframe.choice, today, ctx.ui.timeframe);
  const goals = sortedGoals(state);
  const newButton = h('button', { type: 'button', class: 'btn', onclick: () => goalDialog(ctx) }, icon('plus'), 'New set-aside');
  const intro = h('p', { class: 'view-intro' }, 'Decide where your income goes. Each time money comes in, you’re asked how much to set aside and how much to keep, starting from the default splits below.');

  if (!goals.length) {
    return h('div', { class: 'view' },
      viewHead(ctx, 'Plan', { actions: [newButton] }),
      intro,
      card({}, empty('A set-aside is money kept apart from your spending money: a savings pot, a goal with a target, or money for one kind of spending. Add one to start splitting your income.',
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => goalDialog(ctx) }, icon('plus'), 'New set-aside'))));
  }

  const actual = setAsideIn(state, range);
  return h('div', { class: 'view' },
    viewHead(ctx, 'Plan', { actions: [timeframePicker(ctx), newButton] }),
    intro,
    h('div', { class: 'stack' },
      toSplitCard(ctx),
      h('div', { class: 'grid-2' }, totalCard(ctx, state, goals, today), defaultsCard(ctx, state)),
      h('div', { class: 'goal-grid' }, goals.map((goal, index) => goalCard(ctx, state, goal, index, goals, today, range, actual))),
      h('div', { class: 'grid-2' }, tryCard(ctx, state, today), plannedCard(ctx, state, goals, range, actual)),
      h('div', { class: 'grid-2' }, checksCard(ctx, state, today), ratioCard(ctx, state, range))));
}

// How much is set aside in total, and where it sits.
function totalCard(ctx, state, goals, today) {
  const b = balance(state, today);
  const rows = goals.map((goal) => ({ label: goal.name, value: Math.max(0, potBalance(state, goal, today)) })).filter((r) => r.value > 0).sort((a, b2) => b2.value - a.value);
  return card({ title: 'Set aside', sub: 'Where your set-aside money sits, as of today', cls: 'plan-total' },
    h('p', { class: 'plan-total-value' }, ctx.money(b.savings)),
    h('p', { class: 'hero-sub' }, `${ctx.money(b.spending)} spending money · ${ctx.money(b.total)} in total`),
    rows.length ? barList(rows, { format: ctx.money, total: b.savings, cls: 's3', of: 'what’s set aside' }) : empty('Nothing set aside yet.'));
}

// One row for all income, and one for each kind of income.
function defaultsCard(ctx, state) {
  const row = (id, label, words) => h('button', { type: 'button', class: 'row-btn default-row', dataset: { split: id }, onclick: () => defaultSplitDialog(ctx, id === 'all' ? null : id) },
    h('span', { class: 'budget-top' }, h('span', { class: 'budget-name' }, label), h('span', { class: 'default-edit' }, icon('edit', 'icon-sm'), 'Edit')),
    h('span', { class: 'default-words' }, words));
  const categories = sortCategories(state.categories.filter((c) => c.kind === 'income' && !c.archived));
  const ratio = ratioOf(state);
  return card({ title: 'Default split for each kind of income', sub: 'What’s filled in when income comes in. You can still change it every time. Presets: Save for my goals (each on its schedule) and the 50/30/20 rule.', cls: 'card-list' },
    h('div', { class: 'row-list' },
      row('all', 'All income', splitWords(ctx, state, null)),
      categories.map((c) => row(c.id, c.name, defaultSplit(state, c.id).inherited ? 'Same as all income' : splitWords(ctx, state, c.id))),
      h('button', { type: 'button', class: 'row-btn default-row', dataset: { split: 'ratio' }, onclick: () => ratioDialog(ctx) },
        h('span', { class: 'budget-top' }, h('span', { class: 'budget-name' }, `The ${ratioText(ratio)} rule`), h('span', { class: 'default-edit' }, icon('edit', 'icon-sm'), 'Change')),
        h('span', { class: 'default-words' }, `${Number(ratio.needs.toFixed(1))}% needs · ${Number(ratio.wants.toFixed(1))}% wants · ${Number(ratio.savings.toFixed(1))}% savings`))));
}

function goalCard(ctx, state, goal, index, goals, today, range, actual) {
  const p = goalProgress(state, goal, today);
  let note;
  if (p.open) note = h('p', { class: 'goal-note' }, 'No target. Just tracking what you’ve put aside.');
  else if (p.done) note = h('p', { class: 'goal-note good' }, icon('check', 'icon-sm'), 'Target reached');
  else if (p.overdue) note = h('p', { class: 'goal-note' }, `The target date has passed · ${ctx.money(p.remaining)} to go`);
  else note = h('p', { class: 'goal-note' }, `${ctx.money(p.remaining)} to go`);

  const sources = sourcesOf(state, goal);
  const from = (s) => (s.categoryId ? categoryName(state, s.categoryId) : 'all income');
  const sourceText = sources.length
    ? sources.map((s) => {
      if (s.via === 'rest') return `what’s left of the savings share of ${from(s)}`;
      if (s.via === 'ratio') return `its schedule, from the savings share of ${from(s)}`;
      return `${ruleText(ctx, s.rule)} ${s.rule.type === 'percent' ? 'of' : 'from'} ${from(s)}`;
    }).join(' · ')
    : 'Not in any default split';
  const schedule = scheduleText(ctx, state, goal);
  // With a target date but no schedule yet, offer one that gets there on time.
  const suggest = p.perMonth && !validSchedule(goal)
    ? h('p', { class: 'goal-suggest' },
      h('span', {}, `${ctx.money(p.perMonth)} a month gets you to ${ctx.money(goal.target)} by ${formatDate(goal.deadline)}.`),
      h('button', {
        type: 'button',
        class: 'btn btn-sm',
        onclick: () => {
          ctx.store.save('goals', { ...goal, schedule: { type: 'target', within: null }, plan: { type: 'schedule' } });
          markSplitUsed(ctx);
          ctx.toast(`${goal.name} is on a schedule, and in the split for all income`);
        },
      }, 'Use this'))
    : null;

  const inside = (e) => (range.month ? e.month === range.month : e.date >= range.from && e.date <= range.to);
  const spentFrom = potEntries(state, goal).filter((e) => e.kind === 'paid' && inside(e)).reduce((sum, e) => sum - e.amount, 0);
  const put = actual.byGoal.get(goal.id) ?? 0;
  const move = (dir) => () => reorder(ctx, goals, index, dir);

  return card({
    title: goal.name,
    sub: goal.deadline ? `Target date ${formatDate(goal.deadline)}` : p.open ? 'Savings pot' : 'No target date',
    action: h('div', { class: 'goal-tools' },
      h('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': `Move ${goal.name} up the order`, disabled: index === 0, onclick: move(-1) }, icon('chevronUp')),
      h('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': `Move ${goal.name} down the order`, disabled: index === goals.length - 1, onclick: move(1) }, icon('chevronDown')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${goal.name}`, onclick: () => goalDialog(ctx, goal) }, icon('edit'))),
    cls: 'goal-card',
  },
    goal.buffer || goal.categoryId
      ? h('p', { class: 'goal-tags' },
        goal.buffer ? h('span', { class: 'badge' }, 'Safety buffer') : null,
        goal.categoryId && state.categories.some((c) => c.id === goal.categoryId) ? h('span', { class: 'badge' }, `For ${categoryName(state, goal.categoryId)}`) : null)
      : null,
    h('p', { class: 'goal-amount' }, h('span', { class: `goal-saved${p.saved < 0 ? ' bad' : ''}` }, ctx.money(p.saved)), p.open ? ' set aside' : ` of ${ctx.money(goal.target)}`),
    p.open ? null : meter(p.ratio),
    note,
    p.saved < 0 ? notice('warn', `More has been paid from ${goal.name} than was in it. The ${ctx.money(-p.saved)} came out of your spending money.`) : null,
    h('p', { class: 'goal-source' }, h('span', { class: 'goal-source-label' }, 'Schedule: '), schedule ?? 'None'),
    h('p', { class: 'goal-source' }, h('span', { class: 'goal-source-label' }, 'From income: '), sourceText),
    suggest,
    h('p', { class: 'goal-range' }, `${timeframeText(range)}: ${ctx.money(put)} put in${spentFrom ? ` · ${ctx.money(spentFrom)} spent from it` : ''}`),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => contributionDialog(ctx, goal, 1) }, icon('plus'), 'Add money'),
      p.saved > 0 ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => contributionDialog(ctx, goal, -1) }, 'Withdraw') : null,
      p.saved > 0 ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => moveDialog(ctx, goal) }, icon('swap', 'icon-sm'), 'Move') : null));
}

// The order decides which set-asides are filled first when an income is too small for the whole split.
function reorder(ctx, goals, index, dir) {
  const next = [...goals];
  const [moved] = next.splice(index, 1);
  next.splice(index + dir, 0, moved);
  ctx.store.saveMany('goals', next.map((g, i) => ({ ...g, order: i })));
}

// ---------- Try a pay amount ----------

function tryCard(ctx, state, today) {
  const currency = ctx.currency();
  const categories = categoriesFor(state, 'income');
  const typical = incomeMonths(state, today);
  const saved = ctx.ui.tryPay ?? {};
  const amount = h('input', { id: 'try-amount', class: 'input', inputmode: 'decimal', autocomplete: 'off', placeholder: centsToInput(0, currency), 'aria-label': 'Pay amount to try', value: saved.amount ?? '' });
  const kind = h('select', { id: 'try-kind', class: 'input', 'aria-label': 'Kind of income', value: categories.some((c) => c.id === saved.categoryId) ? saved.categoryId : categories[0]?.id },
    categories.map((c) => h('option', { value: c.id }, c.name)));
  const out = h('div', { class: 'try-out', 'aria-live': 'polite' });

  const update = () => {
    ctx.ui.tryPay = { amount: amount.value, categoryId: kind.value };
    const cents = parseAmount(amount.value);
    if (!cents) {
      out.replaceChildren(h('p', { class: 'field-hint' }, 'Type an amount to see how it would be split and what it would leave you to spend.'));
      return;
    }
    const t = tryPay(ctx.store.get(), { amount: cents, categoryId: kind.value }, today);
    const rows = t.rows.filter((r) => r.want > 0);
    out.replaceChildren(
      h('ul', { class: 'bd-cats try-rows' },
        rows.map((r) => h('li', {},
          h('span', {}, r.goal.name, r.give < r.want ? h('span', { class: 'bd-cat' }, ` (${ctx.money(r.want - r.give)} short)`) : null),
          h('span', { class: 'amount' }, ctx.money(r.give)))),
        h('li', { class: 'try-keep' }, h('span', {}, 'Kept for spending'), h('span', { class: 'amount' }, ctx.money(t.keep)))),
      h('p', { class: 'try-result' },
        `With the money you have now, that leaves ${ctx.money(Math.max(0, t.free))} to spend${t.bills ? ` after ${ctx.money(t.bills)} of bills still to come` : ''}: about `,
        h('b', {}, `${ctx.money(t.perDay)} a day`), ` for the ${t.daysLeft} ${t.daysLeft === 1 ? 'day' : 'days'} left this month.`),
      t.short > 0 ? notice('warn', `Your default split asks for ${ctx.money(t.short)} more than this covers, so set-asides lower in your order get less.`) : null,
      t.free < 0 ? notice('over', `Even with this, bills still to come are ${ctx.money(-t.free)} more than your spending money.`) : null);
  };
  const use = (cents) => () => {
    amount.value = centsToInput(cents, currency);
    update();
  };
  amount.addEventListener('input', update);
  kind.addEventListener('change', update);
  update();

  return card({ title: 'Try a pay amount', sub: 'See how an income would be split before it arrives' },
    h('div', { class: 'try-form' }, amount, kind),
    typical
      ? h('div', { class: 'btn-row try-quick' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: use(typical.average) }, `Average month · ${ctx.money(typical.average)}`),
        typical.count > 1 ? h('button', { type: 'button', class: 'btn btn-sm', onclick: use(typical.lowest) }, `Lowest month · ${ctx.money(typical.lowest)}`) : null)
      : null,
    out);
}

// ---------- Planned against actually set aside ----------

function plannedCard(ctx, state, goals, range, actual) {
  const incomes = inRange(state.transactions, range).filter((t) => t.kind === 'income');
  const planned = plannedFor(state, incomes);
  const diffCell = (value) => h('td', { class: `num ${value < 0 ? 'bad' : value > 0 ? 'good' : ''}` }, value ? ctx.money(value, { sign: true }) : '–');
  return card({ title: 'Planned and actually set aside', sub: `${timeframeText(range)} · ${ctx.money(planned.income)} income` },
    h('div', { class: 'table-wrap' }, h('table', { class: 'table plan-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Set-aside'), h('th', { class: 'num' }, 'Planned'), h('th', { class: 'num' }, 'Set aside'), h('th', { class: 'num' }, 'Difference'))),
      h('tbody', {}, goals.map((g) => {
        const want = planned.byGoal.get(g.id) ?? 0;
        const got = actual.byGoal.get(g.id) ?? 0;
        return h('tr', {}, h('td', {}, g.name), h('td', { class: 'num' }, ctx.money(want)), h('td', { class: 'num' }, ctx.money(got)), diffCell(got - want));
      })),
      h('tfoot', {}, h('tr', {}, h('td', {}, 'Total'), h('td', { class: 'num' }, ctx.money(planned.total)), h('td', { class: 'num' }, ctx.money(actual.total)), diffCell(actual.total - planned.total))))),
    h('p', { class: 'card-foot' }, 'Planned is what today’s default splits would set aside from the income in this time frame. Set aside is what you put in (less anything taken back out).'));
}

// ---------- Checks ----------

function checksCard(ctx, state, today) {
  const c = planChecks(state, today);
  const items = [];
  if (c.share === null) items.push({ level: 'info', text: 'No income in the last 90 days, so there’s nothing to check your default splits against yet.' });
  else if (c.share === 0) items.push({ level: 'info', text: 'Your default splits don’t set anything aside yet. A common guide is to set aside 20% or more of your income.' });
  else {
    items.push({
      level: c.share >= 0.2 ? 'good' : 'info',
      text: `Your default splits set aside about ${percent.format(c.share)} of your income: about ${ctx.money(c.plannedPerMonth)} a month, going by the last 90 days. A common guide is 20% or more.`,
    });
  }
  for (const g of c.goals) {
    const { goal } = g;
    const by = goal.deadline ? formatDate(goal.deadline) : null;
    const around = g.reach ? formatMonth(g.reach) : null;
    if (g.status === 'reached') items.push({ level: 'good', text: `${goal.name}: target reached.` });
    else if (g.status === 'overdue') items.push({ level: 'warn', text: `${goal.name}: its target date (${by}) has passed with ${ctx.money(g.remaining)} to go.` });
    else if (g.status === 'no-plan') {
      items.push({
        level: by ? 'warn' : 'info',
        text: validSchedule(goal)
          ? `${goal.name} has a schedule, but no default split uses it. Edit a default split and choose "On its schedule", or pick the Save for my goals preset.`
          : `${goal.name} isn’t in any default split${g.needed ? `. It needs about ${ctx.money(g.needed)} a month to reach ${ctx.money(goal.target)} by ${by}` : ''}.`,
      });
    } else if (g.status === 'on-track') items.push({ level: 'good', text: `${goal.name} is on track: at about ${ctx.money(g.perMonth)} a month it gets there around ${around}, in time for ${by}.` });
    else if (g.status === 'behind') items.push({ level: 'warn', text: `${goal.name} is behind: at about ${ctx.money(g.perMonth)} a month it gets there around ${around}, after ${by}. It needs about ${ctx.money(g.needed)} a month.` });
    else items.push({ level: 'info', text: `${goal.name}: at about ${ctx.money(g.perMonth)} a month it reaches ${ctx.money(goal.target)} around ${around}.` });
  }
  if (!c.buffer) items.push({ level: 'info', text: 'Mark one set-aside as your safety buffer (edit it and tick the box) to see how many months of spending it would cover.' });
  else if (c.buffer.months === null) items.push({ level: 'info', text: `${c.buffer.goal.name} is your safety buffer. Once you’ve recorded some spending, this shows how many months it covers.` });
  else {
    items.push({
      level: c.buffer.months >= 3 ? 'good' : 'info',
      text: `${c.buffer.goal.name}, your safety buffer, covers about ${c.buffer.months.toFixed(1)} months of your usual spending (${ctx.money(c.buffer.usual)} a month). A common guide is 3 to 6 months.`,
    });
  }
  return card({ title: 'Checks on your plan' }, pointList(items));
}

// How spending divides into needs and wants against the 50/30/20 rule, for the time frame.
function ratioCard(ctx, state, range) {
  const n = needsWants(state, range);
  const title = `Needs, wants and savings · ${ratioText(n.ratio)}`;
  if (!n.sorted) {
    return card({ title, sub: timeframeText(range) },
      h('p', { class: 'card-text' }, 'Mark each spending category as a need (bills, transport, groceries) or a want (shopping, fun) on the Budgets page, and this compares what you spent on each with the rule.'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/budgets' }, 'Sort my categories'), h('button', { type: 'button', class: 'btn', onclick: () => ratioDialog(ctx) }, 'Change the ratio')));
  }
  if (!(n.income > 0)) return card({ title, sub: timeframeText(range) }, empty(`No income in ${timeframeText(range)} to compare with.`));
  const row = (label, spent, target) => {
    const over = spent > target;
    return h('div', { class: 'budget-row' },
      h('span', { class: 'budget-top' }, h('span', { class: 'budget-name' }, label), h('span', { class: `budget-left${over ? ' over' : ''}` }, over ? `${ctx.money(spent - target)} over` : `${ctx.money(target - spent)} left`)),
      meter(target > 0 ? spent / target : spent > 0 ? 1 : 0, over ? 'over' : 'ok'),
      h('span', { class: 'budget-sub' }, h('span', {}, `${ctx.money(spent)} of ${ctx.money(target)} (${percent.format(target / n.income)} of income)`)));
  };
  return card({ title, sub: `${timeframeText(range)} · ${ctx.money(n.income)} came in` },
    h('div', { class: 'budget-list' },
      row('Needs', n.spent.needs, n.target.needs),
      row('Wants', n.spent.wants, n.target.wants),
      h('div', { class: 'budget-row' },
        h('span', { class: 'budget-top' }, h('span', { class: 'budget-name' }, 'Savings'), h('span', { class: `budget-left${n.setAside < n.target.savings ? ' muted' : ''}` }, n.setAside >= n.target.savings ? [icon('check', 'icon-sm'), 'Met'] : `${ctx.money(n.target.savings - n.setAside)} short`)),
        meter(n.target.savings > 0 ? n.setAside / n.target.savings : n.setAside > 0 ? 1 : 0, 'ok'),
        h('span', { class: 'budget-sub' }, h('span', {}, `${ctx.money(n.setAside)} set aside of ${ctx.money(n.target.savings)} (${percent.format(n.target.savings / n.income)} of income)`)))),
    n.spent.unsorted ? h('p', { class: 'card-foot' }, `Plus ${ctx.money(n.spent.unsorted)} in categories not yet marked as a need or a want.`) : null,
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => ratioDialog(ctx) }, 'Change the ratio'), h('a', { class: 'btn btn-sm', href: '#/budgets' }, 'Sort categories')));
}

// ---------- Dialogs ----------

function contributionDialog(ctx, goal, sign) {
  const state = ctx.store.get();
  const saved = potBalance(state, goal);
  const spending = balance(state, todayISO()).spending;
  openDialog({
    title: sign > 0 ? `Add to ${goal.name}` : `Withdraw from ${goal.name}`,
    submitLabel: sign > 0 ? 'Add' : 'Withdraw',
    content: h('div', { class: 'form-grid' },
      field('Amount', h('input', { name: 'amount', class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', autofocus: true, placeholder: centsToInput(0, ctx.currency()) }),
        sign < 0 ? `${ctx.money(saved)} set aside so far. It goes back to your spending money.` : `Comes out of your spending money (${ctx.money(spending)} now).`),
      field('Date', h('input', { name: 'date', type: 'date', class: 'input', value: todayISO() }))),
    onSubmit(data) {
      const amount = parseAmount(data.get('amount'));
      if (!amount) throw new Error('Enter an amount greater than zero.');
      if (sign < 0 && amount > saved) throw new Error(`You can withdraw up to ${ctx.money(saved)}.`);
      const date = data.get('date');
      if (!isValidDate(date)) throw new Error('Choose a valid date.');
      ctx.store.addContribution(goal.id, { amount: sign * amount, date });
      ctx.toast(sign > 0 ? `Added ${ctx.money(amount)} to ${goal.name}` : `Withdrew ${ctx.money(amount)}`);
    },
  });
}

// Moves money from one set-aside to another, or back to spending money.
function moveDialog(ctx, goal) {
  const state = ctx.store.get();
  const saved = potBalance(state, goal);
  const others = sortedGoals(state).filter((g) => g.id !== goal.id);
  openDialog({
    title: `Move money from ${goal.name}`,
    submitLabel: 'Move',
    content: h('div', { class: 'form-grid' },
      field('Amount', h('input', { name: 'amount', class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', autofocus: true, placeholder: centsToInput(0, ctx.currency()) }), `${ctx.money(saved)} in ${goal.name}`),
      field('To', h('select', { name: 'to', class: 'input' }, others.map((g) => h('option', { value: g.id }, g.name)), h('option', { value: '' }, 'Spending money'))),
      field('Date', h('input', { name: 'date', type: 'date', class: 'input', value: todayISO() }))),
    onSubmit(data) {
      const amount = parseAmount(data.get('amount'));
      if (!amount) throw new Error('Enter an amount greater than zero.');
      if (amount > saved) throw new Error(`You can move up to ${ctx.money(saved)}.`);
      const date = data.get('date');
      if (!isValidDate(date)) throw new Error('Choose a valid date.');
      const to = others.find((g) => g.id === data.get('to'));
      if (to) ctx.store.moveBetween(goal.id, to.id, { amount, date });
      else ctx.store.addContribution(goal.id, { amount: -amount, date });
      ctx.toast(`Moved ${ctx.money(amount)} to ${to ? to.name : 'spending money'}`);
    },
  });
}

function goalDialog(ctx, goal = null) {
  const state = ctx.store.get();
  const currency = ctx.currency();
  const nameOf = (id) => state.goals.find((g) => g.id === id)?.name ?? 'a deleted set-aside';
  const history = goal ? potEntries(state, goal).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const label = (e) => {
    if (e.kind === 'split') return `From ${e.tx.note || categoryName(state, e.tx.categoryId)}`;
    if (e.kind === 'paid') return `Paid: ${e.tx.note || categoryName(state, e.tx.categoryId)}`;
    if (e.kind === 'move') return e.amount > 0 ? `Moved from ${nameOf(e.move)}` : `Moved to ${nameOf(e.move)}`;
    return e.amount > 0 ? 'Put in' : 'Taken out';
  };
  const categories = categoriesFor(state, 'expense', goal?.categoryId);
  const today = todayISO();
  const sched = scheduleFields(ctx, goal, today);
  const content = h('div', { class: 'form-grid' },
    field('Name', h('input', { name: 'name', class: 'input', maxLength: 60, autocomplete: 'off', autofocus: !goal, value: goal?.name ?? '', placeholder: 'e.g. Emergency fund' })),
    h('div', { class: 'form-row' },
      field('Target amount', h('input', { name: 'target', class: 'input', inputmode: 'decimal', autocomplete: 'off', placeholder: 'No target', value: goal?.target > 0 ? centsToInput(goal.target, currency) : '' }), 'Optional'),
      field('Target date', h('input', { name: 'deadline', type: 'date', class: 'input', value: goal?.deadline ?? '' }), 'Optional')),
    goal ? null : field('Already set aside', h('input', { name: 'saved', class: 'input', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Optional' })),
    sched.el,
    field('For spending on', h('select', { name: 'category', class: 'input', value: categories.some((c) => c.id === goal?.categoryId) ? goal.categoryId : '' },
      h('option', { value: '' }, 'Nothing in particular'), categories.map((c) => h('option', { value: c.id }, c.name))),
    'Optional. Expenses in this category are then pre-set to be paid from this set-aside.'),
    checkbox('buffer', 'This is my safety buffer (emergency money)', !!goal?.buffer),
    history.length
      ? h('div', { class: 'history' },
        h('p', { class: 'field-label' }, 'History'),
        h('ul', { class: 'history-list' }, history.map((e) => h('li', {},
          h('span', {}, `${formatShortDate(e.date)} · ${label(e)}`),
          h('span', { class: `amount${e.amount > 0 ? ' income' : ''}` }, ctx.money(e.amount, { sign: true })),
          e.kind === 'manual'
            ? h('button', {
              type: 'button',
              class: 'icon-btn icon-btn-sm',
              'aria-label': `Remove ${ctx.money(e.amount)} on ${formatDate(e.date)}`,
              onclick: (event) => {
                ctx.store.removeContribution(goal.id, e.id);
                event.currentTarget.closest('li').remove();
              },
            }, icon('trash'))
            : h('span', { class: 'history-gap' })))),
        h('p', { class: 'field-hint' }, 'Money split from income or paid for an expense is changed on that transaction. To undo a move, move it back.'))
      : null);

  const dialog = openDialog({
    title: goal ? 'Edit set-aside' : 'New set-aside',
    content,
    extraActions: goal ? [h('button', { type: 'button', class: 'btn btn-ghost btn-danger', onclick: () => { dialog.close(); deleteGoal(ctx, goal); } }, 'Delete')] : [],
    onSubmit(data) {
      const name = String(data.get('name')).trim();
      if (!name) throw new Error('Give it a name.');
      const targetText = String(data.get('target') ?? '').trim();
      const target = targetText ? parseAmount(targetText) : null;
      if (targetText && !target) throw new Error('Enter a target amount greater than zero, or leave it empty.');
      const picked = data.get('deadline') || null;
      if (picked && !isValidDate(picked)) throw new Error('Choose a valid target date, or leave it empty.');
      const { schedule, deadline } = sched.read(data, { target, deadline: picked });
      const savedText = String(data.get('saved') ?? '').trim();
      const saved = savedText ? parseAmount(savedText) : 0;
      if (saved === null) throw new Error('Enter the amount already set aside as a number.');
      const buffer = data.get('buffer') === 'on';
      // Read the latest copy so contributions removed in this dialog stay removed.
      const latest = ctx.store.get();
      const current = goal ? latest.goals.find((g) => g.id === goal.id) ?? goal : null;
      const contributions = current?.contributions ?? (saved ? [{ id: newId(), date: todayISO(), amount: saved, updatedAt: Date.now() }] : []);
      const record = { ...current, name, target, deadline, schedule, categoryId: data.get('category') || null, buffer, contributions };
      // A new schedule joins the split for all income unless the set-aside already has its own rule there.
      if (schedule && !current?.plan) record.plan = { type: 'schedule' };
      if (!schedule && current?.plan?.type === 'schedule') record.plan = null;
      // Only one set-aside can be the safety buffer.
      const others = buffer ? latest.goals.filter((g) => g.buffer && g.id !== goal?.id).map((g) => ({ ...g, buffer: false })) : [];
      ctx.store.saveMany('goals', [record, ...others]);
      if (schedule) markSplitUsed(ctx);
      ctx.toast(goal ? 'Set-aside saved' : 'Set-aside created');
    },
  });
}

async function deleteGoal(ctx, goal) {
  const saved = Math.max(0, potBalance(ctx.store.get(), goal));
  const message = `Delete ${goal.name} and its history?${saved ? ` The ${ctx.money(saved)} in it goes back to your spending money.` : ''} This can't be undone.`;
  if (await confirmDialog({ title: 'Delete set-aside?', message })) {
    ctx.store.remove('goals', goal.id);
    ctx.toast('Set-aside deleted');
  }
}
