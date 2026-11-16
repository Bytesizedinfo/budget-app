// Confirming payments on their day: the "To confirm" list, and the Paid, Skip and Postpone actions.
// Nothing is recorded until it's confirmed here.

import { potBalance } from './calc.js';
import { addDays, formatDate, formatShortDate, isValidDate, todayISO } from './dates.js';
import { h } from './dom.js';
import { fundGoal } from './forecast.js';
import { centsToInput, parseAmount } from './money.js';
import { dueList, occurrenceTransaction } from './recurring.js';
import { splitDialog } from './split.js';
import { card, confirmDialog, field, openDialog, signedAmount } from './ui.js';

const latestRule = (ctx, occ) => ctx.store.get().recurring.find((r) => r.id === occ.rule.id) ?? occ.rule;

// Marks an occurrence paid (or received): records it as a transaction, with the amount and date it really was.
// An expense is paid from the money set aside for it first.
export function paidDialog(ctx, occ) {
  const state = ctx.store.get();
  const rule = latestRule(ctx, occ);
  const today = todayISO();
  const income = rule.kind === 'income';
  const fund = income ? null : fundGoal(state, rule);
  const held = fund ? Math.max(0, potBalance(state, fund)) : 0;
  openDialog({
    title: income ? `${rule.name} received` : `${rule.name} paid`,
    submitLabel: income ? 'Received' : 'Paid',
    content: h('div', { class: 'form-grid' },
      field('Amount', h('input', { name: 'amount', class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', autofocus: true, value: centsToInput(occ.amount ?? rule.amount, ctx.currency()) }),
        'Change it if it was different this time.'),
      field('Date', h('input', { name: 'date', type: 'date', class: 'input', value: occ.date <= today ? occ.date : today })),
      held > 0 ? h('p', { class: 'field-hint' }, `${ctx.money(held)} is set aside for this, and is used first.`) : null),
    onSubmit(data) {
      const amount = parseAmount(data.get('amount'));
      if (!amount) throw new Error('Enter an amount greater than zero.');
      const date = data.get('date');
      if (!isValidDate(date)) throw new Error('Choose a valid date.');
      const extra = { amount, date };
      const now = ctx.store.get();
      const pot = income ? null : fundGoal(now, rule);
      const inPot = pot ? Math.max(0, potBalance(now, pot)) : 0;
      if (pot && inPot > 0) {
        // Paid from its set-aside. If that holds less than the amount, the rest goes in from spending money
        // first, so the set-aside ends at zero rather than below it.
        if (inPot < amount) ctx.store.addContribution(pot.id, { amount: amount - inPot, date });
        extra.potId = pot.id;
      }
      const saved = ctx.store.save('transactions', occurrenceTransaction({ ...occ, rule }, extra));
      ctx.toast(income ? `${rule.name} recorded` : `${rule.name} recorded${extra.potId ? ' · paid from its set-aside' : ''}`);
      if (income) setTimeout(() => splitDialog(ctx, saved), 0);
    },
  });
}

// Skips one occurrence: it isn't recorded and doesn't come back.
export async function skipOccurrence(ctx, occ) {
  const rule = latestRule(ctx, occ);
  const ok = await confirmDialog({
    title: `Skip ${rule.name}?`,
    message: `Skip ${rule.name} on ${formatDate(occ.date)}? It won’t be recorded, and this one won’t come back. Later ones are not affected.`,
    confirm: 'Skip it',
    danger: false,
  });
  if (!ok) return;
  ctx.store.tombstone(occ.id);
  ctx.toast(`${rule.name} skipped`);
}

// Moves one occurrence to another date. Later ones stay where they are.
export function postponeDialog(ctx, occ) {
  const rule = latestRule(ctx, occ);
  const today = todayISO();
  openDialog({
    title: `Postpone ${rule.name}`,
    submitLabel: 'Postpone',
    content: h('div', { class: 'form-grid' },
      field('New date', h('input', { name: 'date', type: 'date', class: 'input', autofocus: true, value: addDays(occ.date > today ? occ.date : today, 1) }),
        `It was due on ${formatDate(occ.due)}. Only this one moves.`)),
    onSubmit(data) {
      const date = data.get('date');
      if (!isValidDate(date)) throw new Error('Choose a valid date.');
      const current = latestRule(ctx, occ);
      ctx.store.save('recurring', { ...current, moved: { ...(current.moved ?? {}), [occ.key]: date } });
      ctx.toast(`${rule.name} moved to ${formatShortDate(date)}`);
    },
  });
}

// Changes one occurrence that's still to come: its amount this time, or its date. Later ones aren't affected.
export function occurrenceDialog(ctx, occ) {
  const rule = latestRule(ctx, occ);
  const income = rule.kind === 'income';
  const dialog = openDialog({
    title: `${rule.name} on ${formatShortDate(occ.date)}`,
    content: h('div', { class: 'form-grid' },
      h('p', { class: 'field-hint' }, `Just this one. To change every ${income ? 'time' : 'payment'} from now on, edit ${rule.name} in the list on the Upcoming page.`),
      field('Amount this time', h('input', { name: 'amount', class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', autofocus: true, value: centsToInput(occ.amount, ctx.currency()) }),
        `Usually ${ctx.money(rule.amount)}.`),
      field('Date', h('input', { name: 'date', type: 'date', class: 'input', value: occ.date }), `Scheduled for ${formatDate(occ.due)}.`)),
    extraActions: [
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { dialog.close(); skipOccurrence(ctx, occ); } }, 'Skip this one'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { dialog.close(); paidDialog(ctx, occ); } }, income ? 'Received now' : 'Pay now'),
    ],
    onSubmit(data) {
      const amount = parseAmount(data.get('amount'));
      if (!amount) throw new Error('Enter an amount greater than zero.');
      const date = data.get('date');
      if (!isValidDate(date)) throw new Error('Choose a valid date.');
      const current = latestRule(ctx, occ);
      const amounts = { ...(current.amounts ?? {}) };
      if (amount === current.amount) delete amounts[occ.key];
      else amounts[occ.key] = amount;
      const moved = { ...(current.moved ?? {}) };
      if (date === occ.due) delete moved[occ.key];
      else moved[occ.key] = date;
      ctx.store.save('recurring', { ...current, amounts, moved });
      ctx.toast(`${rule.name} changed for this one`);
    },
  });
}

// The three actions for one occurrence.
export function occurrenceActions(ctx, occ) {
  const income = occ.rule.kind === 'income';
  return h('span', { class: 'due-actions' },
    h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => paidDialog(ctx, occ) }, income ? 'Received' : 'Paid'),
    h('button', { type: 'button', class: 'btn btn-sm', onclick: () => skipOccurrence(ctx, occ) }, 'Skip'),
    h('button', { type: 'button', class: 'btn btn-sm', onclick: () => postponeDialog(ctx, occ) }, 'Postpone'));
}

// Payments and income whose date has come, waiting to be confirmed. Null when nothing is waiting.
export function dueCard(ctx) {
  const state = ctx.store.get();
  const today = todayISO();
  const list = dueList(state, today);
  if (!list.length) return null;
  const shown = list.slice(-6).reverse(); // The most recent first.
  const older = list.slice(0, -6);
  const skipOlder = async () => {
    const ok = await confirmDialog({
      title: `Skip ${older.length} older ones?`,
      message: `Skip the ${older.length} earlier payments that are still waiting? They won’t be recorded and won’t come back.`,
      confirm: 'Skip them',
      danger: false,
    });
    if (!ok) return;
    for (const o of older) ctx.store.tombstone(o.id);
    ctx.toast(`${older.length} skipped`);
  };
  return card({ title: 'To confirm', sub: 'Their date has come. Nothing is recorded until you confirm it.', cls: 'to-confirm' },
    h('ul', { class: 'due-list' }, shown.map((o) => h('li', { class: 'due-row' },
      h('span', { class: 'due-main' },
        h('span', { class: 'due-name' }, o.rule.name),
        h('span', { class: 'due-meta' }, o.date === today ? 'Due today' : `Due ${formatShortDate(o.date)}`, o.rule.planned ? ' · planned' : '')),
      signedAmount(ctx, o.rule.kind, o.amount),
      occurrenceActions(ctx, o)))),
    older.length
      ? h('p', { class: 'card-foot due-older' }, `And ${older.length} earlier ${older.length === 1 ? 'one' : 'ones'}. `, h('button', { type: 'button', class: 'link-btn', onclick: skipOlder }, 'Skip them all'))
      : null);
}
