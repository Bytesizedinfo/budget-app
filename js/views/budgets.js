import { budgetLevel, budgetSummary, inMonth, sortCategories, sumBy } from '../calc.js';
import { formatMonthName } from '../dates.js';
import { h, icon } from '../dom.js';
import { centsToInput, parseAmount } from '../money.js';
import { budgetRow, card, checkbox, confirmDialog, empty, field, meter, openDialog, segmented, viewHead } from '../ui.js';

export function renderBudgets(ctx) {
  const state = ctx.store.get();
  const month = ctx.ui.month;
  const summary = budgetSummary(state, month);
  const received = sumBy(inMonth(state.transactions, month), 'income');
  const incomeCategories = sortCategories(state.categories.filter((c) => c.kind === 'income' && !c.archived));
  const archived = sortCategories(state.categories.filter((c) => c.archived));
  const edit = (category) => () => categoryDialog(ctx, category);

  return h('div', { class: 'view' },
    viewHead(ctx, 'Budgets', {
      month: true,
      actions: [h('button', { type: 'button', class: 'btn', onclick: () => categoryDialog(ctx) }, icon('plus'), 'New category')],
    }),
    h('div', { class: 'stack' },
      summaryCard(ctx, summary, month),
      card({ title: 'Spending categories', sub: 'Select a category to set or change its monthly budget.', cls: 'card-list' },
        h('div', { class: 'row-list' }, summary.rows.map((row) => h('button', { type: 'button', class: 'row-btn', onclick: edit(row.category) },
          row.budget !== null
            ? budgetRow(ctx, row)
            : h('span', { class: 'budget-row' },
              h('span', { class: 'budget-top' },
                h('span', { class: 'budget-name' }, row.category.name, row.category.archived ? h('span', { class: 'badge' }, 'Archived') : null),
                h('span', { class: 'budget-left muted' }, `${ctx.money(row.spent)} spent`)),
              h('span', { class: 'budget-sub' }, 'No budget')))))),
      card({ title: 'Income categories', cls: 'card-list' },
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

function summaryCard(ctx, { totalBudget, budgetedSpent, unbudgeted }, month) {
  if (!totalBudget) {
    return card({ title: 'Set your monthly budgets' },
      h('p', { class: 'card-text' }, 'Choose a spending category below and give it a monthly limit. Budgets repeat every month, and you can change them any time.'));
  }
  const left = totalBudget - budgetedSpent;
  return card({ title: `${formatMonthName(month)} at a glance` },
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

  const content = h('div', { class: 'form-grid' },
    category ? null : segmented('kind', [['expense', 'Spending'], ['income', 'Income']], kind, (value) => {
      kind = value;
      budgetField.hidden = kind !== 'expense';
    }),
    field('Name', h('input', { name: 'name', class: 'input', maxLength: 40, value: category?.name ?? '', autofocus: !category, autocomplete: 'off' })),
    budgetField,
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
      ctx.store.save('categories', { ...category, name, kind, monthlyBudget, archived });
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
