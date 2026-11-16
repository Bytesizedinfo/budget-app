import { budgetLevel, budgetSummary, inRange, rangeMonths, rangeSpan, safeToSpend, sortCategories, sumBy } from '../calc.js';
import { formatMonthName, formatShortDate, monthOf, timeframe, timeframeText, todayISO } from '../dates.js';
import { h, icon } from '../dom.js';
import { centsToInput, parseAmount } from '../money.js';
import { monthPlan, suggestBudgets } from '../forecast.js';
import { categoryLeft, deleteCategoryChanges, moveMoneyDialog } from '../move.js';
import { budgetRow, card, checkbox, confirmDialog, empty, field, meter, openDialog, segmented } from '../ui.js';

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });

// How a time frame compares with a month, when it isn't one: "45% of a month" or "1.5 months".
function scaleText(scale) {
  if (Math.abs(scale - 1) < 0.005) return null;
  return scale < 1 ? `${percent.format(scale)} of a month` : `${Number(scale.toFixed(1))} months`;
}

// The Categories section of the Budget page.
export function categoriesSection(ctx) {
  const state = ctx.store.get();
  const today = todayISO();
  // Spending follows the time frame, and each monthly budget is scaled to the same stretch.
  const range = timeframe(ctx.ui.timeframe.choice, today, ctx.ui.timeframe);
  const scale = rangeMonths(range, state, today);
  const scaled = scaleText(scale);
  const summary = budgetSummary(state, range, scale, rangeSpan(range, state, today));
  const thisMonth = range.month === monthOf(today); // Moves apply to this month's budgets.
  const fromIncome = summary.rows.some((r) => r.fromIncome);
  const given = (row) => {
    if (!row.fromIncome) return row.adjust ? `Usual amount, ${row.adjust > 0 ? 'plus' : 'less'} ${ctx.money(Math.abs(row.adjust))} moved ${row.adjust > 0 ? 'in' : 'out'}` : null;
    const parts = [`${ctx.money(row.given)} given from income`];
    if (row.adjust) parts.push(`${ctx.money(Math.abs(row.adjust))} moved ${row.adjust > 0 ? 'in' : 'out'}`);
    if (row.usual !== null && row.usual !== row.budget) parts.push(`usually ${ctx.money(row.usual)}`);
    return parts.join(' · ');
  };
  const received = sumBy(inRange(state.transactions, range), 'income');
  const incomeCategories = sortCategories(state.categories.filter((c) => c.kind === 'income' && !c.archived));
  const archived = sortCategories(state.categories.filter((c) => c.archived));
  const edit = (category) => () => categoryDialog(ctx, category);

  return h('div', { class: 'stack' },
      h('div', { class: 'section-tools' },
        h('p', { class: 'view-intro' }, 'Each category’s budget for a month is what you give it when you split your income. In a month where income hasn’t been given to categories, its usual monthly amount is used. Unspent money goes back to your spending money.'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => moveMoneyDialog(ctx) }, icon('swap'), 'Move money'),
          h('button', { type: 'button', class: 'btn', onclick: () => amountsDialog(ctx) }, icon('edit'), 'Set monthly amounts'),
          h('button', { type: 'button', class: 'btn', onclick: () => categoryDialog(ctx) }, icon('plus'), 'New category'))),
      limitCard(ctx, monthOf(today)),
      summaryCard(ctx, summary, range, scaled),
      card({
        title: 'Spending categories',
        sub: `${timeframeText(range)}${scaled ? ` · monthly budgets scaled to ${scaled}` : ''}${fromIncome ? ' · budgets given from income' : ''}. Select a category to change its usual monthly amount.`,
        cls: 'card-list',
      },
        h('div', { class: 'row-list' }, summary.rows.map((row) => {
          const over = row.budget !== null && row.spent > row.budget;
          const left = row.budget !== null ? row.budget - row.spent : 0;
          return h('div', { class: 'cat-row', dataset: { category: row.category.id } },
            h('button', { type: 'button', class: 'row-btn', onclick: edit(row.category) },
              row.budget !== null
                ? [budgetRow(ctx, row), given(row) ? h('span', { class: 'budget-given' }, given(row)) : null]
                : h('span', { class: 'budget-row' },
                  h('span', { class: 'budget-top' },
                    h('span', { class: 'budget-name' }, row.category.name, row.category.archived ? h('span', { class: 'badge' }, 'Archived') : null, needTag(row.category)),
                    h('span', { class: 'budget-left muted' }, `${ctx.money(row.spent)} spent`)),
                  h('span', { class: 'budget-sub' }, 'No budget'))),
            thisMonth && !row.category.archived && (over || left > 0)
              ? h('div', { class: 'cat-actions' },
                over ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => moveMoneyDialog(ctx, { to: `cat:${row.category.id}`, amount: -left }) }, 'Cover it') : null,
                left > 0 ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => moveMoneyDialog(ctx, { from: `cat:${row.category.id}` }) }, icon('swap', 'icon-sm'), 'Move') : null)
              : null);
        }))),
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
        : null);
}

// "If I budget this much for each category, how much is left?": every spending category's monthly amount in
// one place, with what's left of the month plan updating as you type, and amounts suggested from what you
// actually spent.
export function amountsDialog(ctx, month = monthOf(todayISO())) {
  const state = ctx.store.get();
  const currency = ctx.currency();
  const today = todayISO();
  const plan = monthPlan(state, month, today);
  const before = plan.left + plan.categories.total; // What's left for categories once everything else is planned.
  const suggested = suggestBudgets(state, today);
  const categories = sortCategories(state.categories.filter((c) => c.kind === 'expense' && !c.archived));
  // Payments already planned in each category count inside its amount.
  const bills = new Map();
  for (const o of [...plan.recurring.items, ...plan.planned.items]) bills.set(o.rule.categoryId, (bills.get(o.rule.categoryId) ?? 0) + o.amount);
  const total = h('b', {});
  const left = h('b', {});
  const leftRow = h('p', { class: 'split-keep amounts-left' }, h('span', {}, 'Left unbudgeted'), left);
  const inputs = categories.map((c) => h('input', {
    name: `budget-${c.id}`,
    class: 'input amounts-input',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: 'No budget',
    'aria-label': `Monthly amount for ${c.name}`,
    value: Number.isSafeInteger(c.monthlyBudget) ? centsToInput(c.monthlyBudget, currency) : '',
  }));
  const read = () => {
    let sum = 0;
    let extra = 0;
    for (const [i, input] of inputs.entries()) {
      const text = input.value.trim();
      if (!text) continue;
      const cents = parseAmount(text);
      if (cents === null) return null;
      sum += cents;
      extra += Math.max(0, cents - (bills.get(categories[i].id) ?? 0));
    }
    return { sum, extra };
  };
  const update = () => {
    const r = read();
    if (!r) {
      total.textContent = '–';
      left.textContent = '–';
      return;
    }
    total.textContent = ctx.money(r.sum);
    const after = before - r.extra;
    left.textContent = ctx.money(after);
    leftRow.classList.toggle('bad', after < 0);
  };
  for (const input of inputs) input.addEventListener('input', update);
  const suggest = () => {
    for (const [i, c] of categories.entries()) {
      const cents = suggested.get(c.id);
      if (cents) inputs[i].value = centsToInput(cents, currency);
    }
    update();
  };
  openDialog({
    title: 'Monthly amounts',
    submitLabel: 'Save amounts',
    content: h('div', { class: 'form-grid' },
      h('p', { class: 'field-hint' }, `From ${ctx.money(plan.expected.amount)} expected income, after payments and set-asides, ${ctx.money(before)} is left for your categories. Payments already planned in a category count inside its amount.`),
      suggested.size
        ? h('button', { type: 'button', class: 'btn btn-sm amounts-suggest', onclick: suggest }, 'Suggest from my spending (average of the last 3 months)')
        : null,
      h('div', { class: 'amounts' }, categories.map((c, i) => h('label', { class: 'amounts-row' },
        h('span', { class: 'amounts-name' }, c.name,
          h('span', { class: 'split-sub' }, [suggested.get(c.id) ? `Usually ${ctx.money(suggested.get(c.id))}` : null, bills.get(c.id) ? `${ctx.money(bills.get(c.id))} of payments` : null].filter(Boolean).join(' · '))),
        inputs[i]))),
      h('p', { class: 'split-keep' }, h('span', {}, 'All categories'), total),
      leftRow),
    onSubmit() {
      if (!read()) throw new Error('Enter each amount as a number, like 150 or 150.00, or leave it empty.');
      const changed = [];
      for (const [i, c] of categories.entries()) {
        const text = inputs[i].value.trim();
        const value = text ? parseAmount(text) : null;
        if ((c.monthlyBudget ?? null) !== value) changed.push({ ...c, monthlyBudget: value });
      }
      if (changed.length) ctx.store.saveMany('categories', changed);
      ctx.toast(changed.length ? 'Monthly amounts saved' : 'No changes');
    },
  });
  update();
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
      ? h('p', { class: 'card-foot' }, `Set aside for bills: ${safe.upcoming.map((u) => `${u.rule.name} ${ctx.money(u.amount)} on ${formatShortDate(u.date)}`).join(', ')}.`)
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

// Deleting a category: its budget is shared out and its transactions move to another category, so nothing is
// lost. A category nothing uses is simply deleted.
async function deleteCategory(ctx, category) {
  const state = ctx.store.get();
  const month = monthOf(todayISO());
  const expense = category.kind === 'expense';
  const refs = (r) => r.categoryId === category.id || (r.cats && category.id in r.cats) || (r.planSplit?.cats && category.id in r.planSplit.cats);
  const txCount = state.transactions.filter((t) => t.categoryId === category.id).length;
  const ruleCount = state.recurring.filter((r) => r.categoryId === category.id).length;
  const used = state.transactions.some(refs) || state.recurring.some(refs) || state.goals.some((g) => g.categoryId === category.id);
  const left = expense ? Math.max(0, categoryLeft(state, month).get(category.id)?.left ?? 0) : 0;
  const usual = expense && category.monthlyBudget > 0 ? category.monthlyBudget : 0;
  const others = sortCategories(state.categories.filter((c) => c.kind === category.kind && c.id !== category.id && !c.archived));
  const archive = () => {
    ctx.store.save('categories', { ...category, archived: true, monthlyBudget: null });
    ctx.toast(`${category.name} archived`);
  };

  if (!used && !left && !usual) {
    if (await confirmDialog({ title: 'Delete category?', message: `Delete ${category.name}? This can't be undone.` })) {
      ctx.store.remove('categories', category.id);
      ctx.toast('Category deleted');
    }
    return;
  }
  if (used && !others.length) {
    const ok = await confirmDialog({
      title: 'This category is in use',
      message: `${category.name} is the only ${expense ? 'spending' : 'income'} category, so its transactions have nowhere to move to. Archive it instead to hide it from new transactions.`,
      confirm: 'Archive it',
      danger: false,
    });
    if (ok) archive();
    return;
  }

  const currency = ctx.currency();
  const share = left > 0 ? left : usual; // What's being shared out: this month's unspent budget, or else the usual amount.
  const inputs = new Map(others.map((c) => [c.id, h('input', { name: `share-${c.id}`, class: 'input amounts-input', inputmode: 'decimal', autocomplete: 'off', placeholder: centsToInput(0, currency), 'aria-label': `Amount for ${c.name}` })]));
  const rest = h('b', {});
  const read = () => {
    const shares = new Map();
    let sum = 0;
    for (const [id, input] of inputs) {
      const text = input.value.trim();
      if (!text) continue;
      const cents = parseAmount(text);
      if (cents === null) return null;
      if (cents > 0) shares.set(id, cents);
      sum += cents;
    }
    return { shares, sum };
  };
  const update = () => {
    const r = read();
    rest.textContent = r ? ctx.money(share - r.sum) : '–';
    rest.className = r && r.sum > share ? 'bad' : '';
  };
  for (const input of inputs.values()) input.addEventListener('input', update);
  update();
  const target = h('select', { name: 'target', class: 'input' }, others.map((c) => h('option', { value: c.id }, c.name)));
  const counts = [txCount ? `${txCount} ${txCount === 1 ? 'transaction' : 'transactions'}` : null, ruleCount ? `${ruleCount} recurring or planned ${ruleCount === 1 ? 'payment' : 'payments'}` : null].filter(Boolean).join(' and ');

  const dialog = openDialog({
    title: `Delete ${category.name}?`,
    submitLabel: 'Delete and move',
    danger: true,
    content: h('div', { class: 'form-grid' },
      h('p', { class: 'field-hint' }, 'Deleting it removes the category for good. Choose where its things go first. To hide it but keep its history under its own name, archive it instead.'),
      used
        ? field('Move its transactions to', target, `${counts || 'Its links'} will be under that category from now on, with everything income gave it and any set-asides tied to it.`)
        : null,
      expense && share > 0 && others.length
        ? h('div', { class: 'field' },
          h('span', { class: 'field-label' }, left > 0 ? `Share out the ${ctx.money(left)} left of its budget this month` : `Share out its usual ${ctx.money(usual)} a month`),
          h('div', { class: 'amounts' }, others.map((c) => h('label', { class: 'amounts-row' }, h('span', { class: 'amounts-name' }, c.name), inputs.get(c.id)))),
          h('p', { class: 'split-keep' }, h('span', {}, left > 0 ? 'Back to unbudgeted' : 'Not passed on'), rest))
        : null,
      expense && left > 0 && usual > 0 ? checkbox('usual', `Also add its usual ${ctx.money(usual)} a month to those categories, in the same shares`, true) : null),
    extraActions: [h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { dialog.close(); archive(); } }, 'Archive instead')],
    onSubmit(data) {
      const r = read();
      if (!r) throw new Error('Enter each amount as a number, like 20 or 20.00, or leave it empty.');
      if (r.sum > share) throw new Error(`That’s ${ctx.money(r.sum - share)} more than there is to share out.`);
      let shares = new Map();
      let usualShares = new Map();
      if (left > 0) {
        shares = r.shares;
        if (usual > 0 && data.get('usual') === 'on' && r.sum > 0) for (const [id, cents] of r.shares) usualShares.set(id, Math.floor((usual * cents) / r.sum));
      } else usualShares = r.shares;
      ctx.store.batch(deleteCategoryChanges(ctx.store.get(), category, { shares, usual: usualShares, target: used ? data.get('target') : null, month }));
      ctx.toast(`${category.name} deleted`);
    },
  });
}
