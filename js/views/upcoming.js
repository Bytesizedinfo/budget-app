// The Upcoming page: what's waiting to be confirmed, the next 60 days, recurring and planned payments, and
// the wishlist.

import { byNewest, categoriesFor, categoryName, inRange, potBalance, rangeSpan, totals } from '../calc.js';
import { addDays, daysBetween, formatDate, formatMonth, formatMonthName, formatShortDate, isValidDate, monthOf, timeframe, timeframeText, todayISO } from '../dates.js';
import { h, icon } from '../dom.js';
import { dueCard, occurrenceDialog, paidDialog } from '../due.js';
import { fundGoal, fundOf, savedByNotBuying, timeline, wishInfo } from '../forecast.js';
import { centsToInput, parseAmount } from '../money.js';
import { isClosed, isSnoozed, isWish, sortedGoals } from '../pots.js';
import { nextOpen, occurrences, occurrencesBetween, repeatOf, repeatWords, settledCount } from '../recurring.js';
import { markSplitUsed, scheduleFields, scheduleText, splitDialog } from '../split.js';
import { txRow } from '../tx.js';
import { card, checkbox, confirmDialog, empty, field, initialBadge, meter, notice, openDialog, segmented, signedAmount, timeframePicker, viewHead } from '../ui.js';
import { contributionDialog, snoozeControl } from './plan.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function renderUpcoming(ctx) {
  const state = ctx.store.get();
  const today = todayISO();
  const range = timeframe(ctx.ui.timeframe.choice, today, ctx.ui.timeframe);
  const recurring = state.recurring.filter((r) => !r.planned);
  const planned = state.recurring.filter((r) => r.planned);
  return h('div', { class: 'view' },
    viewHead(ctx, 'Upcoming', { actions: [timeframePicker(ctx)] }),
    h('p', { class: 'view-intro' }, 'Payments and income you expect, and things you want. Nothing is recorded by itself: each one waits here until you confirm it on its day.'),
    h('div', { class: 'stack' },
      dueCard(ctx),
      timelineCard(ctx, state, today),
      rulesCard(ctx, state, recurring, today, false),
      rulesCard(ctx, state, planned, today, true),
      wishlist(ctx, state, today),
      rangeCard(ctx, state, range, today)));
}

// ---------- The next 60 days ----------

function eventLabel(e) {
  if (e.type === 'fund') return `Set aside for ${e.rule.name}`;
  if (e.type === 'auto') return `Set aside for ${e.goal.name}`;
  return e.rule.name;
}

// edit: a payment or income can be tapped to change just that one (its amount this time, or its date).
export function eventRow(ctx, e, today, { edit = false } = {}) {
  const dated = e.type === 'bill' || e.type === 'income';
  const note = [
    e.type === 'bill' && e.fromFund ? `${ctx.money(e.fromFund)} from its set-aside` : e.type === 'income' ? 'expected' : null,
    e.at && e.at < today ? 'waiting to be confirmed' : null,
    dated && e.occ.amount !== e.rule.amount ? `usually ${ctx.money(e.rule.amount)}` : null,
  ].filter(Boolean).join(' · ');
  const name = edit && dated
    ? h('button', { type: 'button', class: 'link-btn tl-edit', 'aria-label': `Change ${e.rule.name} on ${formatShortDate(e.date)}`, onclick: () => occurrenceDialog(ctx, e.occ) }, eventLabel(e))
    : eventLabel(e);
  return h('li', { class: 'tl-row' },
    h('span', { class: 'tl-date' }, e.date === today ? 'Today' : formatShortDate(e.date)),
    h('span', { class: 'tl-name' }, name, note ? h('span', { class: 'tl-note' }, note) : null),
    h('span', { class: `amount${e.amount > 0 ? ' income' : ''}` }, ctx.money(e.amount, { sign: true })),
    h('span', { class: `tl-after${e.after < 0 ? ' bad' : ''}` }, ctx.money(e.after)));
}

function timelineCard(ctx, state, today) {
  const line = timeline(state, today, 60);
  const rows = line.events.filter((e) => e.amount !== 0 || e.type === 'bill');
  if (!rows.length) {
    return card({ title: 'The next 60 days' }, empty('Nothing is scheduled. Add a recurring or planned payment below and it will show here, with what it leaves you.'));
  }
  const list = (items) => h('ul', { class: 'tl' }, items.map((e) => eventRow(ctx, e, today, { edit: true })));
  return card({ title: 'The next 60 days', sub: `Starting from the ${ctx.money(line.start)} spending money you have now` },
    line.lowest.amount < 0
      ? notice('over', `Your spending money would run out on ${formatDate(line.lowest.date)}: ${ctx.money(-line.lowest.amount)} short at its lowest.`)
      : h('p', { class: 'tl-lowest' }, 'Lowest point: ', h('b', {}, ctx.money(line.lowest.amount)), line.lowest.date === today && line.lowest.amount === line.start ? ' (today)' : ` on ${formatDate(line.lowest.date)}`),
    h('div', { class: 'tl-head', 'aria-hidden': 'true' }, h('span', {}, 'Date'), h('span', {}, ''), h('span', {}, 'Amount'), h('span', {}, 'Left after')),
    list(rows.slice(0, 10)),
    rows.length > 10 ? h('details', { class: 'table-toggle' }, h('summary', {}, `Show ${rows.length - 10} more`), list(rows.slice(10))) : null,
    h('p', { class: 'card-foot' }, 'Tap a payment to change just that one. Expected income is counted here on its date. Automatic set-asides stop at zero rather than taking spending money below it.'));
}

// ---------- Recurring and planned payments ----------

// About what a repeating payment comes to in a month.
function perMonth(rule) {
  const rep = repeatOf(rule);
  if (rep.type === 'once') return 0;
  if (rep.type === 'twice') return rule.amount * 2;
  const times = { day: 30.44, week: 30.44 / 7, month: 1, year: 1 / 12 }[rep.unit] / rep.every;
  return Math.round(rule.amount * times);
}

function rulesCard(ctx, state, rules, today, planned) {
  const rows = rules
    .map((rule) => ({ rule, due: occurrences(state, rule, today).filter((o) => o.status === 'open'), next: nextOpen(state, rule, today) }))
    .sort((a, b) => (a.due[0]?.date ?? a.next?.date ?? '9999').localeCompare(b.due[0]?.date ?? b.next?.date ?? '9999') || a.rule.name.localeCompare(b.rule.name));
  const live = rows.filter((r) => r.next || r.due.length);
  const out = live.filter((r) => r.rule.kind === 'expense').reduce((sum, r) => sum + perMonth(r.rule), 0);
  const into = live.filter((r) => r.rule.kind === 'income').reduce((sum, r) => sum + perMonth(r.rule), 0);
  const add = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => ruleDialog(ctx, null, planned) }, icon('plus', 'icon-sm'), planned ? 'New planned payment/income' : 'New recurring payment');
  return card({
    title: planned ? 'Planned payments/income' : 'Recurring payments',
    sub: planned
      ? 'Payments you plan to make and income you expect: once on a date, or repeating for a while'
      : rows.length ? `About ${ctx.money(out)} going out and ${ctx.money(into)} coming in each month` : 'Bills, subscriptions and regular income',
    action: add,
    cls: `card-list rules-card ${planned ? 'planned-card' : 'recurring-card'}`,
  },
    rows.length
      ? h('div', { class: 'tx-list' }, rows.map((r) => ruleRow(ctx, state, r, today)))
      : empty(planned ? 'Nothing planned. Add a payment you know is coming, like a birthday dinner, or income you expect, like next month’s pay.' : 'Add rent, subscriptions, salary and other regular amounts once, and they’ll be waiting for you each time.'));
}

function ruleRow(ctx, state, { rule, due, next }, today) {
  let when;
  if (rule.paused) when = h('span', { class: 'badge' }, 'Paused');
  else if (due.length) when = h('span', { class: 'badge badge-due' }, due.length > 1 ? `${due.length} to confirm` : 'To confirm');
  else if (next) when = `Next ${formatShortDate(next.date)}`;
  else when = h('span', { class: 'badge' }, repeatOf(rule).type === 'once' ? 'Done' : 'Ended');
  const fund = rule.kind === 'expense' && fundOf(rule) ? fundGoal(state, rule) : null;
  const parts = [repeatWords(rule), categoryName(state, rule.categoryId)];
  if (rule.endAfter > 0) parts.push(`${settledCount(state, rule).paid} of ${rule.endAfter} paid`);
  const coming = due[0] ?? next;
  if (coming && coming.amount !== rule.amount) parts.push(`${ctx.money(coming.amount)} this time`);
  if (rule.kind === 'income' && rule.planSplit) parts.push('split planned');
  if (fund) parts.push(`${ctx.money(Math.max(0, potBalance(state, fund)))} of ${ctx.money(coming?.amount ?? rule.amount)} set aside`);
  return h('button', { type: 'button', class: 'tx-row', dataset: { rule: rule.id }, onclick: () => ruleDialog(ctx, rule, !!rule.planned) },
    initialBadge(rule.name),
    h('span', { class: 'tx-main' },
      h('span', { class: 'tx-title' }, rule.name),
      h('span', { class: 'tx-meta' }, when, ` · ${parts.join(' · ')}`)),
    signedAmount(ctx, rule.kind, rule.amount));
}

const REPEATS = [
  ['once', 'Once'], ['day', 'Daily'], ['week', 'Weekly'], ['2week', 'Every 2 weeks'], ['4week', 'Every 4 weeks'], ['twice', 'Twice a month'],
  ['month', 'Monthly'], ['3month', 'Every 3 months'], ['6month', 'Every 6 months'], ['year', 'Yearly'], ['custom', 'Custom…'],
];
const PRESET = { day: [1, 'day'], week: [1, 'week'], '2week': [2, 'week'], '4week': [4, 'week'], month: [1, 'month'], '3month': [3, 'month'], '6month': [6, 'month'], year: [1, 'year'] };

function repeatChoice(rule, planned) {
  if (!rule) return planned ? 'once' : 'month';
  const rep = repeatOf(rule);
  if (rep.type !== 'every') return rep.type;
  return Object.keys(PRESET).find((key) => PRESET[key][0] === rep.every && PRESET[key][1] === rep.unit) ?? 'custom';
}

// The form for a recurring or planned payment (or income).
export function ruleDialog(ctx, rule = null, planned = false) {
  const state = ctx.store.get();
  const currency = ctx.currency();
  const today = todayISO();
  let kind = rule?.kind ?? 'expense';
  const rep = rule ? repeatOf(rule) : null;
  const oldFund = rule ? fundOf(rule) : null;

  const category = h('select', { name: 'category', class: 'input' });
  const fillCategories = () => {
    const options = categoriesFor(state, kind, rule?.categoryId);
    category.replaceChildren(...options.map((c) => h('option', { value: c.id }, c.name)));
    if (rule?.kind === kind) category.value = rule.categoryId;
  };
  fillCategories();

  const num = (name, value, label) => h('input', { name, class: 'input input-num', inputmode: 'numeric', autocomplete: 'off', 'aria-label': label, value: String(value) });
  const unitSelect = (name, value, units, label) => h('select', { name, class: 'input', 'aria-label': label, value },
    units.map((u) => h('option', { value: u }, `${u}s`)));
  const dayOptions = (value) => [...Array.from({ length: 30 }, (_, i) => h('option', { value: String(i + 1) }, String(i + 1))), h('option', { value: '31' }, 'Last day')].map((o) => {
    o.selected = o.value === String(value);
    return o;
  });

  const repeat = h('select', { name: 'repeat', class: 'input', value: repeatChoice(rule, planned) },
    REPEATS.filter(([value]) => planned || value !== 'once').map(([value, label]) => h('option', { value }, label)));
  const customRow = h('div', { class: 'inline-row' }, h('span', { class: 'muted' }, 'Every'), num('every', rep?.type === 'every' ? rep.every : 2, 'Every how many'),
    unitSelect('unit', rep?.type === 'every' ? rep.unit : 'week', ['day', 'week', 'month', 'year'], 'Days, weeks, months or years'));
  const twiceRow = h('div', { class: 'inline-row' }, h('span', { class: 'muted' }, 'On day'),
    h('select', { name: 'day1', class: 'input', 'aria-label': 'First day of the month' }, dayOptions(rep?.type === 'twice' ? rep.days[0] : 1)),
    h('span', { class: 'muted' }, 'and'),
    h('select', { name: 'day2', class: 'input', 'aria-label': 'Second day of the month' }, dayOptions(rep?.type === 'twice' ? rep.days[1] : 15)));

  const start = h('input', { name: 'start', type: 'date', class: 'input', value: rule?.startDate ?? today });
  const startLabel = h('span', { class: 'field-label' });
  const startHint = h('span', { class: 'field-hint' });

  const ends = h('select', { name: 'ends', class: 'input', value: rule?.endAfter > 0 ? 'count' : rule?.endDate ? 'date' : 'never' },
    h('option', { value: 'never' }, 'Never'), h('option', { value: 'date' }, 'On a date'), h('option', { value: 'count' }, 'After a number of times'));
  const endDate = h('input', { name: 'end', type: 'date', class: 'input', 'aria-label': 'Last date', value: rule?.endDate ?? '' });
  const endCount = h('div', { class: 'inline-row' }, num('count', rule?.endAfter > 0 ? rule.endAfter : 12, 'How many times'), h('span', { class: 'muted' }, 'times in all'));
  const endsField = h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Ends'), ends, endDate, endCount);

  // Setting money aside for it ahead of time (expenses only).
  const fund = h('select', { name: 'fund', class: 'input', value: oldFund?.type ?? 'none' },
    h('option', { value: 'none' }, 'Don’t set money aside'),
    h('option', { value: 'date' }, 'All of it, ahead of time'),
    h('option', { value: 'rate' }, 'An amount every…'),
    h('option', { value: 'until' }, 'Spread monthly until it’s due'));
  const fundDays = h('div', { class: 'inline-row' }, num('fundDays', oldFund?.type === 'date' ? oldFund.daysBefore : 7, 'Days before'), h('span', { class: 'muted' }, 'days before each payment'));
  const fundDate = h('div', { class: 'inline-row' }, h('span', { class: 'muted' }, 'On'),
    h('input', { name: 'fundDate', type: 'date', class: 'input', 'aria-label': 'Date to set it aside', value: oldFund?.type === 'date' && rule ? addDays(rule.startDate, -oldFund.daysBefore) : today }));
  const fundRate = h('div', { class: 'inline-row' },
    h('input', { name: 'fundAmount', class: 'input', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Amount to set aside each time', placeholder: centsToInput(0, currency), value: oldFund?.type === 'rate' ? centsToInput(oldFund.amount, currency) : '' }),
    h('span', { class: 'muted' }, 'every'), num('fundEvery', oldFund?.type === 'rate' ? oldFund.every : 1, 'Every how many'),
    unitSelect('fundUnit', oldFund?.type === 'rate' ? oldFund.unit : 'month', ['day', 'week', 'month'], 'Days, weeks or months'));
  const fundUntil = h('div', { class: 'inline-row' }, h('span', { class: 'muted' }, 'Have it all by'),
    h('input', { name: 'fundUntil', type: 'date', class: 'input', 'aria-label': 'Have it all by', value: oldFund?.type === 'until' && oldFund.date ? oldFund.date : '' }), h('span', { class: 'muted' }, '(optional)'));
  const fundHint = h('span', { class: 'field-hint' });
  const fundField = h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Set money aside for it'), fund, fundDays, fundDate, fundRate, fundUntil, fundHint);

  const sync = () => {
    const once = repeat.value === 'once';
    customRow.hidden = repeat.value !== 'custom';
    twiceRow.hidden = repeat.value !== 'twice';
    startLabel.textContent = once ? 'Date' : 'First date';
    startHint.textContent = !once && isValidDate(start.value) && start.value < today ? 'This date has passed, so it starts waiting for you from today on. Record earlier ones as ordinary transactions.' : '';
    endsField.hidden = once;
    endDate.hidden = ends.value !== 'date';
    endCount.hidden = ends.value !== 'count';
    fundField.hidden = kind !== 'expense';
    fundDays.hidden = fund.value !== 'date' || once;
    fundDate.hidden = fund.value !== 'date' || !once;
    fundRate.hidden = fund.value !== 'rate';
    fundUntil.hidden = fund.value !== 'until' || !once;
    fundHint.textContent = {
      none: '',
      date: 'The whole amount moves out of your spending money then, and the payment is paid from it.',
      rate: 'Moves out of your spending money each time, until there’s enough for the next payment.',
      until: 'What’s still missing is spread evenly over the months until it’s due, and topped up each month.',
    }[fund.value];
  };
  for (const el of [repeat, ends, fund, start]) el.addEventListener('change', sync);
  sync();

  const extraActions = [];
  if (rule?.kind === 'income') {
    extraActions.push(h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { dialog.close(); splitDialog(ctx, null, { rule }); } }, rule.planSplit ? 'Change its split' : 'Plan its split'));
  }
  if (rule) {
    extraActions.push(h('button', { type: 'button', class: 'btn btn-ghost btn-danger', onclick: () => { dialog.close(); deleteRule(ctx, rule); } }, 'Delete'));
    const next = occurrences(state, rule, today).find((o) => o.status === 'open') ?? nextOpen(state, rule, today);
    if (next) {
      extraActions.push(h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { dialog.close(); paidDialog(ctx, next); } }, rule.kind === 'income' ? 'Received now' : 'Pay now'));
    }
  }

  const dialog = openDialog({
    title: `${rule ? 'Edit' : 'New'} ${planned ? 'planned payment/income' : 'recurring payment'}`,
    content: h('div', { class: 'form-grid' },
      segmented('kind', [['expense', 'Expense'], ['income', 'Income']], kind, (value) => {
        kind = value;
        fillCategories();
        sync();
      }),
      field('Name', h('input', { name: 'name', class: 'input', maxLength: 60, autocomplete: 'off', autofocus: !rule, value: rule?.name ?? '', placeholder: planned ? 'e.g. Birthday dinner, Concert ticket' : 'e.g. Rent, Phone plan, Salary' })),
      h('div', { class: 'form-row' },
        field('Amount', h('input', { name: 'amount', class: 'input', inputmode: 'decimal', autocomplete: 'off', value: rule ? centsToInput(rule.amount, currency) : '' })),
        field('Category', category)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Repeats'), repeat, customRow, twiceRow),
      h('label', { class: 'field' }, startLabel, start, startHint),
      endsField,
      fundField,
      rule && repeatOf(rule).type !== 'once' ? checkbox('paused', 'Paused (nothing waits for you while it’s paused)', rule.paused) : null,
      h('p', { class: 'field-hint' }, 'On its day it shows under To confirm, where you mark it paid, skip it or postpone it. To change just one payment, tap it in “The next 60 days”.')),
    extraActions,
    onSubmit(data) {
      const name = String(data.get('name')).trim();
      if (!name) throw new Error('Give it a name, like Rent or Salary.');
      const amount = parseAmount(data.get('amount'));
      if (!amount) throw new Error('Enter an amount greater than zero.');
      const categoryId = data.get('category');
      if (!categoryId) throw new Error('Choose a category.');
      const startDate = data.get('start');
      if (!isValidDate(startDate)) throw new Error('Choose the date.');

      const choice = data.get('repeat');
      const whole = (field2, what) => {
        const n = Math.round(Number(data.get(field2)));
        if (!(n >= 1)) throw new Error(`Enter ${what} as a whole number, 1 or more.`);
        return n;
      };
      let repeatValue;
      if (choice === 'once') repeatValue = 'once';
      else if (choice === 'twice') {
        const days = [Number(data.get('day1')), Number(data.get('day2'))];
        if (days[0] === days[1]) throw new Error('Choose two different days of the month.');
        repeatValue = { twice: days.sort((a, b) => a - b) };
      } else if (choice === 'custom') repeatValue = { every: whole('every', 'how often it repeats'), unit: data.get('unit') };
      else repeatValue = { every: PRESET[choice][0], unit: PRESET[choice][1] };
      const once = repeatValue === 'once';

      const endsOn = once ? 'never' : data.get('ends');
      const lastDate = endsOn === 'date' ? data.get('end') : null;
      if (endsOn === 'date' && (!isValidDate(lastDate) || lastDate < startDate)) throw new Error('The last date must be on or after the first date.');
      const endAfter = endsOn === 'count' ? whole('count', 'the number of times') : null;

      let fundValue = null;
      const fundType = kind === 'expense' ? data.get('fund') : 'none';
      const since = oldFund?.type === fundType && oldFund.since ? oldFund.since : today;
      if (fundType === 'date') {
        let daysBefore;
        if (once) {
          const on = data.get('fundDate');
          if (!isValidDate(on) || on > startDate) throw new Error('Choose a date on or before the payment to set the money aside.');
          daysBefore = daysBetween(on, startDate);
        } else {
          daysBefore = Math.round(Number(data.get('fundDays')));
          if (!(daysBefore >= 0)) throw new Error('Enter how many days before each payment to set the money aside.');
        }
        fundValue = { type: 'date', daysBefore, since };
      } else if (fundType === 'rate') {
        const each = parseAmount(data.get('fundAmount'));
        if (!each) throw new Error('Enter the amount to set aside each time.');
        fundValue = { type: 'rate', amount: each, every: whole('fundEvery', 'how often to set money aside'), unit: data.get('fundUnit'), since };
      } else if (fundType === 'until') {
        const by = once ? data.get('fundUntil') || null : null;
        if (by && (!isValidDate(by) || by > startDate)) throw new Error('“Have it all by” must be on or before the payment’s date.');
        fundValue = { type: 'until', date: by, since };
      }

      const paused = data.get('paused') === 'on';
      const changed = !rule || rule.startDate !== startDate || JSON.stringify(repeatOf(rule)) !== JSON.stringify(repeatOf({ repeat: repeatValue }));
      // A repeating payment only waits for you from today on: earlier dates are not brought up.
      let resumeDate = rule?.resumeDate ?? null;
      if (rule?.paused && !paused) resumeDate = today;
      else if (!once && changed && startDate < today) resumeDate = today;
      const saved = ctx.store.save('recurring', {
        ...rule, name, kind, amount, categoryId, startDate, repeat: repeatValue, endDate: lastDate, endAfter, fund: fundValue, planned, paused, resumeDate,
        moved: changed ? {} : rule?.moved ?? {},
        amounts: changed ? {} : rule?.amounts ?? {},
      });

      // The money set aside for it lives in its own hidden set-aside.
      const held = fundGoal(ctx.store.get(), saved);
      if (fundValue && !held) ctx.store.save('goals', { name, billId: saved.id, target: null, deadline: null, contributions: [] });
      else if (fundValue && held.name !== name) ctx.store.save('goals', { ...held, name });
      else if (!fundValue && held) ctx.store.remove('goals', held.id);
      if (!rule && kind === 'income') ctx.toast(`${name} added`, { label: 'Plan its split', run: () => splitDialog(ctx, null, { rule: saved }) });
      else ctx.toast(rule ? 'Payment saved' : `${name} added`);
    },
  });
}

async function deleteRule(ctx, rule) {
  const held = fundGoal(ctx.store.get(), rule);
  const inIt = held ? Math.max(0, potBalance(ctx.store.get(), held)) : 0;
  const ok = await confirmDialog({
    title: 'Delete this payment?',
    message: `Delete ${rule.name}? Entries already recorded stay in your transactions.${inIt ? ` The ${ctx.money(inIt)} set aside for it goes back to your spending money.` : ''}`,
  });
  if (!ok) return;
  if (held) ctx.store.remove('goals', held.id);
  ctx.store.remove('recurring', rule.id);
  ctx.toast(`${rule.name} deleted`);
}

// ---------- Wishlist ----------

const PRIORITIES = [['must', 'Must have'], ['nice', 'Nice to have'], ['someday', 'Someday']];
const priorityRank = (goal) => Math.max(0, PRIORITIES.findIndex(([value]) => value === goal.wish.priority));
const priorityName = (goal) => PRIORITIES[priorityRank(goal)][1];

// Only ordinary web links are shown as links.
function safeUrl(text) {
  try {
    const url = new URL(String(text ?? '').trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function wishlist(ctx, state, today) {
  const wishes = sortedGoals(state).filter(isWish).sort((a, b) => priorityRank(a) - priorityRank(b));
  const closed = state.goals.filter((g) => isWish(g) && isClosed(g));
  const saved = savedByNotBuying(state);
  const add = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => wishDialog(ctx) }, icon('plus', 'icon-sm'), 'New wishlist item');
  return card({ title: 'Wishlist', sub: 'Things you want. Each one saves up like a goal; tick it to see on Home what buying it would leave.', action: add, cls: 'wishlist' },
    wishes.length
      ? h('div', { class: 'wish-grid' }, wishes.map((goal) => wishCard(ctx, state, goal, today)))
      : empty('Nothing on your wishlist. Add something you want, and decide how to save for it.'),
    saved ? h('p', { class: 'card-foot' }, `Saved by not buying: ${ctx.money(saved)}.`) : null,
    closed.length
      ? h('details', { class: 'table-toggle' }, h('summary', {}, `Bought and dropped (${closed.length})`),
        h('ul', { class: 'wish-closed' }, closed.map((goal) => h('li', {},
          h('span', {}, goal.name, h('span', { class: 'tl-note' }, goal.wish.boughtTxId ? `Bought ${goal.wish.boughtDate ? formatShortDate(goal.wish.boughtDate) : ''}` : `Dropped ${formatShortDate(goal.wish.dropped)}`)),
          h('span', { class: 'amount' }, ctx.money(goal.target ?? 0)),
          h('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': `Remove ${goal.name} from this list`, onclick: () => ctx.store.remove('goals', goal.id) }, icon('trash'))))))
      : null);
}

function wishCard(ctx, state, goal, today) {
  const info = wishInfo(state, goal, today, ctx.ui.left);
  const url = safeUrl(goal.wish.link);
  const days = isValidDate(goal.wish.since) ? Math.max(0, daysBetween(goal.wish.since, today)) : 0;
  const schedule = scheduleText(ctx, state, goal);
  const funding = goal.auto && schedule ? `Automatically: ${schedule}` : schedule ? `From your income: ${schedule}` : 'From your income, when you split it';
  let ready;
  if (info.ready !== 'now' && isSnoozed(goal, monthOf(today))) ready = h('p', { class: 'goal-note' }, icon('clock', 'icon-sm'), `Snoozed for ${formatMonthName(monthOf(today))}: nothing goes into it this month.`);
  else if (info.ready === 'now') ready = h('p', { class: 'goal-note good' }, icon('check', 'icon-sm'), 'Fully set aside. Ready to buy.');
  else if (info.ready) ready = h('p', { class: 'goal-note' }, `Ready around ${formatMonth(info.ready)}, at about ${ctx.money(info.perMonth)} a month`);
  else ready = h('p', { class: 'goal-note' }, `${ctx.money(info.remaining)} to go. Nothing is going into it yet.`);
  const tick = h('input', {
    type: 'checkbox',
    checked: !!goal.wish.tick,
    onchange: (event) => ctx.store.save('goals', { ...goal, wish: { ...goal.wish, tick: event.target.checked } }),
  });
  return h('section', { class: 'wish-card', dataset: { wish: goal.id } },
    h('div', { class: 'wish-head' },
      h('h3', { class: 'wish-name' }, goal.name),
      h('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': `Edit ${goal.name}`, onclick: () => wishDialog(ctx, goal) }, icon('edit'))),
    h('p', { class: 'goal-tags' }, h('span', { class: 'badge' }, priorityName(goal)), h('span', { class: 'wish-age' }, days ? `On the list for ${plural(days, 'day')}` : 'Added today'),
      url ? h('a', { class: 'wish-link', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Link', icon('external', 'icon-xs')) : null),
    h('p', { class: 'goal-amount' }, h('span', { class: 'goal-saved' }, ctx.money(info.saved)), ` of ${ctx.money(info.price)}`),
    meter(info.price > 0 ? info.saved / info.price : 0),
    ready,
    h('p', { class: 'goal-source' }, funding),
    h('p', { class: `wish-leaves${info.leaves < 0 ? ' bad' : ''}` }, info.leaves < 0
      ? `Buying it now would leave you ${ctx.money(-info.leaves)} short this month.`
      : `Buying it now would leave you ${ctx.money(info.leaves)} this month.`),
    goal.wish.note ? h('p', { class: 'wish-note' }, goal.wish.note) : null,
    h('label', { class: 'checkbox wish-tick' }, tick, h('span', {}, 'Count it in what I’d have left (Home)')),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => contributionDialog(ctx, goal, 1) }, icon('plus'), 'Add money'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => boughtDialog(ctx, goal) }, 'Bought'),
      info.saved > 0 ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => contributionDialog(ctx, goal, -1) }, 'Withdraw') : null,
      snoozeControl(ctx, state, goal, today)));
}

export function wishDialog(ctx, goal = null) {
  const state = ctx.store.get();
  const currency = ctx.currency();
  const today = todayISO();
  const sched = scheduleFields(ctx, goal, today);
  const dialog = openDialog({
    title: goal ? 'Edit wishlist item' : 'New wishlist item',
    content: h('div', { class: 'form-grid' },
      field('What is it?', h('input', { name: 'name', class: 'input', maxLength: 60, autocomplete: 'off', autofocus: !goal, value: goal?.name ?? '', placeholder: 'e.g. Headphones' })),
      h('div', { class: 'form-row' },
        field('Price', h('input', { name: 'price', class: 'input', inputmode: 'decimal', autocomplete: 'off', value: goal?.target > 0 ? centsToInput(goal.target, currency) : '' })),
        field('How much you want it', h('select', { name: 'priority', class: 'input', value: goal?.wish?.priority ?? 'nice' }, PRIORITIES.map(([value, label]) => h('option', { value }, label))))),
      field('Link', h('input', { name: 'link', class: 'input', type: 'url', autocomplete: 'off', placeholder: 'https://… (optional)', value: goal?.wish?.link ?? '' })),
      field('Note', h('input', { name: 'note', class: 'input', maxLength: 160, autocomplete: 'off', placeholder: 'Optional', value: goal?.wish?.note ?? '' })),
      field('Want it by', h('input', { name: 'deadline', type: 'date', class: 'input', value: goal?.deadline ?? '' }), 'Optional'),
      sched.el,
      checkbox('auto', 'Move this money automatically from my spending money on that schedule', !!goal?.auto),
      h('p', { class: 'field-hint' }, 'Left unticked, it’s filled from your income when you split it (it’s offered in the split, on its schedule if it has one).')),
    extraActions: goal ? [h('button', { type: 'button', class: 'btn btn-ghost btn-danger', onclick: () => { dialog.close(); dropWish(ctx, goal); } }, 'Remove from list')] : [],
    onSubmit(data) {
      const name = String(data.get('name')).trim();
      if (!name) throw new Error('Say what it is.');
      const price = parseAmount(data.get('price'));
      if (!price) throw new Error('Enter its price, like 129 or 129.00.');
      const picked = data.get('deadline') || null;
      if (picked && !isValidDate(picked)) throw new Error('Choose a valid date, or leave it empty.');
      const { schedule, deadline } = sched.read(data, { target: price, deadline: picked });
      const auto = data.get('auto') === 'on';
      if (auto && !schedule) throw new Error('Choose a saving schedule to move money automatically, or untick the box.');
      const current = goal ? ctx.store.get().goals.find((g) => g.id === goal.id) ?? goal : null;
      let plan = current?.plan ?? null;
      if (auto && plan?.type === 'schedule') plan = null;
      else if (!auto && schedule && !plan) plan = { type: 'schedule' };
      else if (!schedule && plan?.type === 'schedule') plan = null;
      ctx.store.save('goals', {
        ...current,
        name,
        target: price,
        deadline,
        schedule,
        auto,
        autoSince: auto ? (current?.auto && current.autoSince ? current.autoSince : today) : null,
        plan,
        wish: { ...(current?.wish ?? {}), link: String(data.get('link') ?? '').trim(), note: String(data.get('note') ?? '').trim(), priority: data.get('priority'), since: current?.wish?.since ?? today, tick: current?.wish?.tick ?? false },
        contributions: current?.contributions ?? [],
      });
      if (schedule) markSplitUsed(ctx);
      ctx.toast(goal ? 'Wishlist item saved' : `${name} added to your wishlist`);
    },
  });
}

// Bought: records the expense, paid from what was set aside for it first.
function boughtDialog(ctx, goal) {
  const state = ctx.store.get();
  const currency = ctx.currency();
  const held = Math.max(0, potBalance(state, goal));
  const categories = categoriesFor(state, 'expense', goal.categoryId);
  openDialog({
    title: `Bought ${goal.name}`,
    submitLabel: 'Record it',
    content: h('div', { class: 'form-grid' },
      field('What you paid', h('input', { name: 'amount', class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', autofocus: true, value: centsToInput(goal.target ?? 0, currency) })),
      h('div', { class: 'form-row' },
        field('Category', h('select', { name: 'category', class: 'input', value: categories.some((c) => c.id === goal.categoryId) ? goal.categoryId : ctx.ui.lastCategory.expense ?? categories[0]?.id },
          categories.map((c) => h('option', { value: c.id }, c.name)))),
        field('Date', h('input', { name: 'date', type: 'date', class: 'input', value: todayISO() }))),
      h('p', { class: 'field-hint' }, held ? `The ${ctx.money(held)} set aside for it is used first; anything more comes from your spending money.` : 'Nothing is set aside for it yet, so it all comes from your spending money.')),
    onSubmit(data) {
      const amount = parseAmount(data.get('amount'));
      if (!amount) throw new Error('Enter what you paid.');
      const date = data.get('date');
      if (!isValidDate(date)) throw new Error('Choose a valid date.');
      const categoryId = data.get('category');
      if (!categoryId) throw new Error('Choose a category.');
      // Bring what's set aside to exactly the amount paid: top it up from spending money, or send the extra back.
      const inIt = potBalance(ctx.store.get(), goal);
      if (inIt !== amount) ctx.store.addContribution(goal.id, { amount: amount - inIt, date });
      const tx = ctx.store.save('transactions', { kind: 'expense', amount, date, categoryId, note: goal.name, potId: goal.id });
      const latest = ctx.store.get().goals.find((g) => g.id === goal.id);
      ctx.store.save('goals', { ...latest, auto: false, wish: { ...latest.wish, tick: false, boughtTxId: tx.id, boughtDate: date } });
      ctx.toast(`${goal.name} bought`);
    },
  });
}

// Dropped without buying: what was set aside goes back to spending money, and it counts as saved.
async function dropWish(ctx, goal) {
  const held = Math.max(0, potBalance(ctx.store.get(), goal));
  const ok = await confirmDialog({
    title: 'Remove from your wishlist?',
    message: `Remove ${goal.name}?${held ? ` The ${ctx.money(held)} set aside for it goes back to your spending money.` : ''} It’s counted under “saved by not buying”.`,
    confirm: 'Remove',
    danger: false,
  });
  if (!ok) return;
  const today = todayISO();
  const inIt = potBalance(ctx.store.get(), goal);
  if (inIt) ctx.store.addContribution(goal.id, { amount: -inIt, date: today });
  const latest = ctx.store.get().goals.find((g) => g.id === goal.id);
  ctx.store.save('goals', { ...latest, auto: false, plan: null, wish: { ...latest.wish, tick: false, dropped: today } });
  ctx.toast(`${goal.name} removed`);
}

// ---------- In this time frame ----------

// What recurring and planned payments have recorded in the time frame, and what's still open in it.
function rangeCard(ctx, state, range, today) {
  if (!state.recurring.length) return null;
  const span = rangeSpan(range, state, today);
  const added = inRange(state.transactions, range).filter((t) => t.recurringId).sort(byNewest);
  const coming = occurrencesBetween(state, span.from, span.to);
  const done = totals(added);
  const ahead = totals(coming.map((o) => ({ kind: o.rule.kind, amount: o.amount })));
  const line = (label, count, sums) => h('p', { class: 'range-line' }, h('b', {}, label), ` ${count} ${count === 1 ? 'entry' : 'entries'}`,
    sums.expense ? ` · ${ctx.money(sums.expense)} out` : '', sums.income ? ` · ${ctx.money(sums.income)} in` : '');
  const more = (list) => (list.length > 6 ? h('p', { class: 'range-more' }, `And ${list.length - 6} more.`) : null);
  return card({ title: 'In this time frame', sub: timeframeText(range), cls: 'card-list range-card' },
    line('Already recorded:', added.length, done),
    added.length ? h('div', { class: 'tx-list' }, added.slice(0, 6).map((t) => txRow(ctx, t, { showDate: true }))) : null,
    more(added),
    line('Still to confirm or to come:', coming.length, ahead),
    coming.length
      ? h('ul', { class: 'upcoming range-upcoming' }, coming.slice(0, 6).map(({ rule, date, amount }) => h('li', {},
        h('span', { class: 'upcoming-date' }, formatShortDate(date)),
        h('span', { class: 'upcoming-name' }, rule.name),
        signedAmount(ctx, rule.kind, amount))))
      : null,
    more(coming));
}
