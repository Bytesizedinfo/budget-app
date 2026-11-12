import { categoriesFor, categoryName } from '../calc.js';
import { dayOf, formatShortDate, isValidDate, ordinal, todayISO } from '../dates.js';
import { h, icon } from '../dom.js';
import { centsToInput, parseAmount } from '../money.js';
import { backfillCount, nextDate } from '../recurring.js';
import { card, checkbox, confirmDialog, empty, field, initialBadge, openDialog, segmented, signedAmount, viewHead } from '../ui.js';

export function renderRecurring(ctx) {
  const state = ctx.store.get();
  const today = todayISO();
  const rules = state.recurring
    .map((rule) => ({ rule, next: nextDate(rule, today) }))
    .sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999') || a.rule.name.localeCompare(b.rule.name));
  const active = state.recurring.filter((r) => !r.paused && (!r.endDate || r.endDate >= today));
  const monthlyOut = active.filter((r) => r.kind === 'expense').reduce((sum, r) => sum + r.amount, 0);
  const monthlyIn = active.filter((r) => r.kind === 'income').reduce((sum, r) => sum + r.amount, 0);
  const newRule = h('button', { type: 'button', class: 'btn', onclick: () => ruleDialog(ctx) }, icon('plus'), 'New recurring item');

  return h('div', { class: 'view' },
    viewHead(ctx, 'Recurring', { actions: [newRule] }),
    h('p', { class: 'view-intro' }, 'Bills and income that repeat every month. Each one is added to your transactions automatically on its day.'),
    rules.length
      ? h('div', { class: 'stack' },
        h('div', { class: 'kpis kpis-2' },
          h('div', { class: 'card stat' }, h('p', { class: 'stat-label' }, 'Going out each month'), h('p', { class: 'stat-value' }, ctx.money(monthlyOut))),
          h('div', { class: 'card stat' }, h('p', { class: 'stat-label' }, 'Coming in each month'), h('p', { class: 'stat-value' }, ctx.money(monthlyIn)))),
        card({ cls: 'card-list' }, h('div', { class: 'tx-list' }, rules.map(({ rule, next }) => ruleRow(ctx, rule, next, today)))))
      : card({}, empty('Add rent, subscriptions, salary and other regular amounts once, and they’ll be recorded for you every month.',
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => ruleDialog(ctx) }, icon('plus'), 'New recurring item'))));
}

function ruleRow(ctx, rule, next, today) {
  const category = categoryName(ctx.store.get(), rule.categoryId);
  let when;
  if (rule.paused) when = h('span', { class: 'badge' }, 'Paused');
  else if (next) when = `Next ${formatShortDate(next)}`;
  else if (rule.endDate && rule.endDate < today) when = h('span', { class: 'badge' }, 'Ended');
  else when = 'No upcoming date';
  return h('button', { type: 'button', class: 'tx-row', onclick: () => ruleDialog(ctx, rule) },
    initialBadge(rule.name),
    h('span', { class: 'tx-main' },
      h('span', { class: 'tx-title' }, rule.name),
      h('span', { class: 'tx-meta' }, when, ` · Monthly on the ${ordinal(dayOf(rule.startDate))} · ${category}`)),
    signedAmount(ctx, rule.kind, rule.amount));
}

function ruleDialog(ctx, rule = null) {
  const state = ctx.store.get();
  const currency = ctx.currency();
  const today = todayISO();
  let kind = rule?.kind ?? 'expense';

  const category = h('select', { name: 'category', class: 'input' });
  const fillCategories = () => {
    const options = categoriesFor(state, kind, rule?.categoryId);
    category.replaceChildren(...options.map((c) => h('option', { value: c.id }, c.name)));
    if (rule?.kind === kind) category.value = rule.categoryId;
  };
  fillCategories();

  const startInput = h('input', { name: 'start', type: 'date', class: 'input', value: rule?.startDate ?? today });
  const startHint = h('span', { class: 'field-hint' });
  const describeStart = () => {
    const start = startInput.value;
    if (!isValidDate(start)) {
      startHint.textContent = '';
      return;
    }
    const day = ordinal(dayOf(start));
    const backfill = rule ? 0 : backfillCount({ id: 'preview', startDate: start, endDate: null, paused: false }, today);
    startHint.textContent = `Repeats on the ${day} of each month${dayOf(start) > 28 ? ' (or the last day in shorter months)' : ''}.`
      + (backfill ? ` ${backfill} past ${backfill === 1 ? 'entry' : 'entries'} up to today will be added now.` : '');
  };
  startInput.addEventListener('input', describeStart);
  describeStart();

  const content = h('div', { class: 'form-grid' },
    segmented('kind', [['expense', 'Expense'], ['income', 'Income']], kind, (value) => {
      kind = value;
      fillCategories();
    }),
    field('Name', h('input', { name: 'name', class: 'input', maxLength: 60, autocomplete: 'off', autofocus: !rule, value: rule?.name ?? '', placeholder: 'e.g. Rent, Phone plan, Salary' })),
    h('div', { class: 'form-row' },
      field('Amount', h('input', { name: 'amount', class: 'input', inputmode: 'decimal', autocomplete: 'off', value: rule ? centsToInput(rule.amount, currency) : '' })),
      field('Category', category)),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'First date'), startInput, startHint),
    field('Last date', h('input', { name: 'end', type: 'date', class: 'input', value: rule?.endDate ?? '' }), 'Optional. Leave empty to keep it going.'),
    rule ? checkbox('paused', 'Paused (nothing is added while paused)', rule.paused) : null,
    rule ? h('p', { class: 'field-hint' }, 'Changes apply to future entries. Entries already added stay as they are.') : null);

  const dialog = openDialog({
    title: rule ? 'Edit recurring item' : 'New recurring item',
    content,
    extraActions: rule ? [h('button', { type: 'button', class: 'btn btn-ghost btn-danger', onclick: () => { dialog.close(); deleteRule(ctx, rule); } }, 'Delete')] : [],
    onSubmit(data) {
      const name = String(data.get('name')).trim();
      if (!name) throw new Error('Give it a name, like Rent or Salary.');
      const amount = parseAmount(data.get('amount'));
      if (!amount) throw new Error('Enter an amount greater than zero.');
      const categoryId = data.get('category');
      if (!categoryId) throw new Error('Choose a category.');
      const startDate = data.get('start');
      if (!isValidDate(startDate)) throw new Error('Choose the first date.');
      const endDate = data.get('end') || null;
      if (endDate && (!isValidDate(endDate) || endDate < startDate)) throw new Error('The last date must be after the first date.');
      const paused = data.get('paused') === 'on';
      // Resuming starts again from today, rather than back-filling the paused months.
      const resumeDate = rule?.paused && !paused ? today : rule?.resumeDate ?? null;
      ctx.store.save('recurring', { ...rule, name, kind, amount, categoryId, startDate, endDate, paused, resumeDate });
      ctx.toast(rule ? 'Recurring item saved' : `${name} will be added every month`);
    },
  });
}

async function deleteRule(ctx, rule) {
  const ok = await confirmDialog({
    title: 'Delete recurring item?',
    message: `Stop adding ${rule.name} each month? Entries already added stay in your transactions.`,
  });
  if (ok) {
    ctx.store.remove('recurring', rule.id);
    ctx.toast(`${rule.name} deleted`);
  }
}
