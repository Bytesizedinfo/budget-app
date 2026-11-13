import { budgetLevel, budgetSummary, inRange, rangeMonths, safeToSpend, sortCategories, sumBy } from '../calc.js';
import { formatMonthName, formatShortDate, monthOf, timeframe, timeframeText, todayISO } from '../dates.js';
import { h, icon } from '../dom.js';
import { centsToInput, parseAmount } from '../money.js';
import { budgetRow, card, checkbox, confirmDialog, empty, field, meter, openDialog, segmented, timeframePicker, viewHead } from '../ui.js';

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });

// How a time frame compares with a month, when it isn't one: "45% of a month" or "1.5 months".
function scaleText(scale) {
  if (Math.abs(scale - 1) < 0.005) return null;
  return scale < 1 ? `${percent.format(scale)} of a month` : `${Number(scale.toFixed(1))} months`;
}

export function renderBudgets(ctx) {
  const state = ctx.store.get();
  const today = todayISO();
  // Spending follows the time frame, and each monthly budget is scaled to the same stretch.
  const range = timeframe(ctx.ui.timeframe.choice, today, ctx.ui.timeframe);
  const scale = rangeMonths(range, state, today);
  const scaled = scaleText(scale);
  const summary = budgetSummary(state, range, scale);
  const received = sumBy(inRange(state.transactions, range), 'income');
  const incomeCategories = sortCategories(state.categories.filter((c) => c.kind === 'income' && !c.archived));
  const archived = sortCategories(state.categories.filter((c) => c.archived));
  const edit = (category) => () => categoryDialog(ctx, category);

  return h('div', { class: 'view' },
    viewHead(ctx, 'Budgets', {
      actions: [timeframePicker(ctx), h('button', { type: 'button', class: 'btn', onclick: () => categoryDialog(ctx) }, icon('plus'), 'New category')],
    }),
    h('div', { class: 'stack' },
      limitCard(ctx, monthOf(today)),
      summaryCard(ctx, summary, range, scaled),
      card({
        title: 'Spending categories',
        sub: `${timeframeText(range)}${scaled ? ` · monthly budgets scaled to ${scaled}` : ''}. Select a category to set or change its monthly budget.`,
        cls: 'card-list',
      },
        h('div', { class: 'row-list' }, summary.rows.map((row) => h('button', { type: 'button', class: 'row-btn', onclick: edit(row.category) },
          row.budget !== null
            ? budgetRow(ctx, row)
            : h('span', { class: 'budget-row' },
              h('span', { class: 'budget-top' },
                h('span', { class: 'budget-name' }, row.category.name, row.category.archived ? h('span', { class: 'badge' }, 'Archived') : null, needTag(row.category)),
                h('span', { class: 'budget-left muted' }, `${ctx.money(row.spent)} spent`)),
              h('span', { class: 'budget-sub' }, 'No budget')))))),
      card({ title: 'Income categories', sub: timeframeText(range), cls: 'card-list' },
        incomeCategories.length
          ? h('div', { class: 'row-list' }, incomeCategories.map((c) => h('button', { type: 'button', class: 'row-btn', onclick: edit(c) },
            h('span', { class: 'budget-top' },
              h('span', { class: 'budget-name' }, c.name),
              h('span', { class: 'budget-left muted' }, `${ctx.money(received.get(c.id) ?? 0)} received`)))))
          : empty('No income categories.')),
      archived.length
        ? card({ title: 'Archived', sub: 'Hidden when adding transactions. Past entries keep their category.', cls: 'card-list' },
          h('div', { class: 'row-list' }, archived.map((c) => h('button', { type: 'button', class: 'row-btn', onclick: edit(c) },
            h('span', { class: 'budget-top' }, h('span', { class: 'budget-name' }, c.name), h('span', { class: 'budget-left muted' }, c.kind === 'income' ? 'Income' : 'Spending'))))))
        : null));
}

const needTag = (c) => (typeof c.need === 'boolean' ? h('span', { class: 'badge' }, c.need ? 'Need' : 'Want') : null);

// One overall limit for everything spent in a month, bills included. Always about this month.
function limitCard(ctx, month) {
  const safe = safeToSpend(ctx.store.get(), month, todayISO());
  if (!safe) {
    return card({ title: 'Monthly spending limit', action: h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => limitDialog(ctx) }, 'Set a limit') },
      h('p', { class: 'card-text' }, 'One amount for all your spending each month, bills included. The Overview then shows what’s safe to spend today and this week.'));
  }
  const over = safe.left < 0;
  return card({ title: 'Monthly spending limit', sub: formatMonthName(month), action: h('button', { type: 'button', class: 'btn btn-sm', onclick: () => limitDialog(ctx) }, icon('edit', 'icon-sm'), 'Change') },
    h('dl', { class: 'totals' },
      h('div', {}, h('dt', {}, 'Limit'), h('dd', {}, ctx.money(safe.limit))),
      h('div', {}, h('dt', {}, 'Spent'), h('dd', {}, ctx.money(safe.spent))),
      safe.reserved ? h('div', {}, h('dt', {}, 'Bills to come'), h('dd', {}, ctx.money(safe.reserved))) : null,
      h('div', {}, h('dt', {}, over ? 'Over by' : 'Left'), h('dd', { class: over ? 'over' : '' }, ctx.money(Math.abs(safe.left))))),
    meter((safe.spent + safe.reserved) / safe.limit, safe.level, 'meter-lg'),
    safe.upcoming.length
      ? h('p', { class: 'card-foot' }, `Set aside for bills: ${safe.upcoming.map((u) => `${u.rule.name} ${ctx.money(u.rule.amount)} on ${formatShortDate(u.date)}`).join(', ')}.`)
      : null);
}

export function limitDialog(ctx) {
  const current = ctx.store.get().settings.spendingLimit;
  openDialog({
    title: 'Monthly spending limit',
    content: h('div', { class: 'form-grid' },
      field('Limit per month',
        h('input', { name: 'limit', class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', autofocus: true, placeholder: 'No limit', value: current > 0 ? centsToInput(current, ctx.currency()) : '' }),
        'Covers all your spending, bills included. Leave it empty to turn the limit off. Category budgets still work alongside it.')),
    onSubmit(data) {
      const text = String(data.get('limit') ?? '').trim();
      if (!text) {
        ctx.store.setSettings({ spendingLimit: null });
        ctx.toast('Spending limit turned off');
        return;
      }
      const limit = parseAmount(text);
      if (!limit) throw new Error('Enter the limit as an amount, like 200 or 200.00, or leave it empty.');
      ctx.store.setSettings({ spendingLimit: limit });
      ctx.toast(`Monthly limit set to ${ctx.money(limit)}`);
    },
  });
}

function summaryCard(ctx, { totalBudget, budgetedSpent, unbudgeted }, range, scaled) {
  if (!totalBudget) {
    return card({ title: 'Category budgets' },
      h('p', { class: 'card-text' }, 'You can also give a spending category its own monthly limit: select it below. Budgets repeat every month, and you can change them any time.'));
  }
  const left = totalBudget - budgetedSpent;
  return card({ title: 'Category budgets at a glance', sub: `${timeframeText(range)}${scaled ? ` · monthly budgets scaled to ${scaled}` : ''}` },
    h('dl', { class: 'totals' },
      h('div', {}, h('dt', {}, 'Budgeted'), h('dd', {}, ctx.money(totalBudget))),
      h('div', {}, h('dt', {}, 'Spent'), h('dd', {}, ctx.money(budgetedSpent))),
      h('div', {}, h('dt', {}, left < 0 ? 'Over by' : 'Left'), h('dd', { class: left < 0 ? 'over' : '' }, ctx.money(Math.abs(left))))),
    meter(budgetedSpent / totalBudget, budgetLevel(budgetedSpent, totalBudget), 'meter-lg'),
    unbudgeted ? h('p', { class: 'card-foot' }, `Plus ${ctx.money(unbudgeted)} spent in categories without a budget.`) : null);
}

export function categoryDialog(ctx, category = null) {
  const state = ctx.store.get();
  const currency = ctx.currency();
  let kind = category?.kind ?? 'expense';
  const budgetField = field('Monthly budget',
    h('input', { name: 'budget', class: 'input', inputmode: 'decimal', autocomplete: 'off', placeholder: 'No budget', value: category?.monthlyBudget != null ? centsToInput(category.monthlyBudget, currency) : '' }),
    'Leave empty for no limit.');
  budgetField.hidden = kind !== 'expense';
  const needField = field('For the 50/30/20 rule, this is',
    h('select', { name: 'need', class: 'input', value: category?.need === true ? 'need' : category?.need === false ? 'want' : '' },
      h('option', { value: '' }, 'Not sorted yet'), h('option', { value: 'need' }, 'A need (bills, transport, groceries)'), h('option', { value: 'want' }, 'A want (shopping, fun)')),
    'The Plan page compares what you spend on needs and wants with the rule.');
  needField.hidden = kind !== 'expense';

  const content = h('div', { class: 'form-grid' },
    category ? null : segmented('kind', [['expense', 'Spending'], ['income', 'Income']], kind, (value) => {
      kind = value;
      budgetField.hidden = kind !== 'expense';
      needField.hidden = kind !== 'expense';
    }),
    field('Name', h('input', { name: 'name', class: 'input', maxLength: 40, value: category?.name ?? '', autofocus: !category, autocomplete: 'off' })),
    budgetField,
    needField,
    category ? checkbox('archived', 'Archive this category (hide it when adding transactions)', category.archived) : null);

  const dialog = openDialog({
    title: category ? 'Edit category' : 'New category',
    content,
    extraActions: category ? [h('button', { type: 'button', class: 'btn btn-ghost btn-danger', onclick: () => { dialog.close(); deleteCategory(ctx, category); } }, 'Delete')] : [],
    onSubmit(data) {
      const name = String(data.get('name')).trim();
      if (!name) throw new Error('Give the category a name.');
      const clash = state.categories.find((c) => c.id !== category?.id && c.kind === kind && c.name.toLowerCase() === name.toLowerCase());
      if (clash) throw new Error(`You already have a category called ${clash.name}.`);
      const archived = data.get('archived') === 'on';
      let monthlyBudget = null;
      const budgetText = String(data.get('budget') ?? '').trim();
      if (kind === 'expense' && budgetText && !archived) {
        monthlyBudget = parseAmount(budgetText);
        if (monthlyBudget === null) throw new Error('Enter the budget as a number, like 450 or 450.00.');
      }
      const need = kind !== 'expense' || !data.get('need') ? null : data.get('need') === 'need';
      ctx.store.save('categories', { ...category, name, kind, monthlyBudget, archived, need });
      ctx.toast(category ? 'Category saved' : 'Category added');
    },
  });
}

async function deleteCategory(ctx, category) {
  const state = ctx.store.get();
  const used = state.transactions.filter((t) => t.categoryId === category.id).length
    + state.recurring.filter((r) => r.categoryId === category.id).length;
  if (used) {
    const archive = await confirmDialog({
      title: 'This category is in use',
      message: `${category.name} is used by ${used} ${used === 1 ? 'entry' : 'entries'}, so it can't be deleted. Archive it instead to hide it from new transactions.`,
      confirm: 'Archive it',
      danger: false,
    });
    if (archive) ctx.store.save('categories', { ...category, archived: true, monthlyBudget: null });
    return;
  }
  if (await confirmDialog({ title: 'Delete category?', message: `Delete ${category.name}? This can't be undone.` })) {
    ctx.store.remove('categories', category.id);
    ctx.toast('Category deleted');
  }
}
