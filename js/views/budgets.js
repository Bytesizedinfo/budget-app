import { budgetLevel, budgetSummary, inRange, rangeMonths, rangeSpan, sortCategories, sumBy } from '../calc.js';
import { formatMonthName, monthOf, timeframe, timeframeText, todayISO } from '../dates.js';
import { h, icon } from '../dom.js';
import { centsToInput, parseAmount } from '../money.js';
import { suggestBudgets } from '../forecast.js';
import { budgetChoice, budgetSettings, monthPicture } from '../month.js';
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
  const pic = monthPicture(state, monthOf(today), today, ctx.ui.left);
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
      spendingBudgetCard(ctx, pic),
      summaryCard(ctx, summary, range, scaled, thisMonth ? pic : null),
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
  const planned = monthPicture(state, month, today, ctx.ui.left).planned;
  const { plan } = planned;
  const before = planned.amount; // The month's spending budget, as planned: what the categories share.
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
      h('p', { class: 'field-hint' }, `${budgetChoice(state.settings, month).mode === 'fixed'
        ? `Your fixed spending budget for ${formatMonthName(month)} is ${ctx.money(before)}.`
        : `Your spending budget for ${formatMonthName(month)} is ${ctx.money(before)} as planned (${ctx.money(plan.expected.amount)} expected income, after set-asides and payments${planned.carriedIn ? `, with ${ctx.money(planned.carriedIn)} carried in` : ''}).`} Payments already planned in a category count inside its amount.`),
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

// ---------- The spending budget ----------
// Automatic (the default): the income that counts in the month, plus what was carried in, less set-asides and
// recurring and planned payments. Or a fixed amount, for one month or every month. See month.js.

// How a month's spending budget is set, in a few words: "Automatic", "Fixed for November", "Fixed, every month".
export function budgetModeText(budget, month) {
  if (budget.mode !== 'fixed') return budget.scope === 'month' ? `Automatic for ${formatMonthName(month)}` : 'Automatic';
  return budget.scope === 'month' ? `Fixed for ${formatMonthName(month)}` : 'Fixed, every month';
}

// This month's spending budget, what's spent and what's left, with the choice of automatic or fixed.
function spendingBudgetCard(ctx, pic) {
  const { month } = pic;
  const b = pic.budget;
  const over = pic.leftToSpend < 0;
  return card({
    title: 'Spending budget',
    sub: `${formatMonthName(month)} · ${budgetModeText(b, month)}`,
    action: h('button', { type: 'button', class: 'btn btn-sm', onclick: () => spendingBudgetDialog(ctx, month) }, icon('edit', 'icon-sm'), 'Change'),
    cls: 'spending-budget',
  },
    h('dl', { class: 'totals' },
      h('div', {}, h('dt', {}, 'Budget'), h('dd', {}, ctx.money(b.amount))),
      h('div', {}, h('dt', {}, 'Spent'), h('dd', {}, ctx.money(pic.spent))),
      h('div', {}, h('dt', {}, over ? 'Short by' : 'Left'), h('dd', { class: over ? 'over' : '' }, ctx.money(Math.abs(pic.leftToSpend))))),
    meter(b.amount > 0 ? pic.spent / b.amount : pic.spent > 0 ? 1 : 0, budgetLevel(pic.spent, Math.max(0, b.amount)), 'meter-lg'),
    h('p', { class: 'card-foot' }, b.mode === 'fixed'
      ? `Your income would allow ${ctx.money(b.auto)}.${pic.limitedBy === 'money' ? ' Your money runs out before your budget does, so what’s left follows your money.' : ''}`
      : 'Worked out for you: the income that counts this month, plus anything carried in, less what you set aside and your recurring and planned payments. The Budget’s month plan shows each line.'));
}

// Chooses how a month's spending budget is set: automatic or a fixed amount, for that month only or every month.
export function spendingBudgetDialog(ctx, month = monthOf(todayISO())) {
  const state = ctx.store.get();
  const today = todayISO();
  const pic = monthPicture(state, month, today, ctx.ui.left);
  const b = pic.budget;
  const name = formatMonthName(month);
  let mode = b.mode;
  const start = b.fixed ?? b.limit ?? Math.max(0, b.auto);
  const amount = h('input', { name: 'budget', class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', value: start > 0 ? centsToInput(start, ctx.currency()) : '', 'aria-label': 'Fixed amount' });
  const amountField = field('Amount for the month', amount, `Your income would allow ${ctx.money(b.auto)}. What’s left to spend is the smaller of what this allows and what your money allows.`);
  const autoHint = h('p', { class: 'field-hint' }, `The income that counts in ${name}, plus anything carried in, less what you set aside and your recurring and planned payments: ${ctx.money(b.auto)} so far.`);
  const show = () => {
    amountField.hidden = mode !== 'fixed';
    autoHint.hidden = mode === 'fixed';
  };
  show();
  openDialog({
    title: `Spending budget: ${name}`,
    content: h('div', { class: 'form-grid' },
      segmented('budget-mode', [['auto', 'Automatic'], ['fixed', 'A fixed amount']], mode, (next) => {
        mode = next;
        show();
      }),
      autoHint,
      amountField,
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Use it for'),
        h('label', { class: 'checkbox' }, h('input', { type: 'radio', name: 'scope', value: 'month', checked: b.scope === 'month' }), h('span', {}, `${name} only`)),
        h('label', { class: 'checkbox' }, h('input', { type: 'radio', name: 'scope', value: 'every', checked: b.scope !== 'month' }), h('span', {}, 'Every month')))),
    onSubmit(data) {
      const scope = data.get('scope') === 'month' ? 'month' : 'every';
      let cents = null;
      if (mode === 'fixed') {
        cents = parseAmount(String(data.get('budget') ?? '').trim());
        if (!cents) throw new Error('Enter the amount, like 200 or 200.00.');
      }
      ctx.store.setSettings(budgetSettings(ctx.store.get().settings, month, { mode, amount: cents, scope }));
      const when = scope === 'month' ? ` for ${name}` : ' for every month';
      ctx.toast(mode === 'fixed' ? `Spending budget fixed at ${ctx.money(cents)}${when}` : `Spending budget set to automatic${when}`);
    },
  });
}

// Kept for older callers: the monthly limit is now the fixed spending budget.
export const limitDialog = (ctx) => spendingBudgetDialog(ctx);

function summaryCard(ctx, { totalBudget, budgetedSpent, unbudgeted }, range, scaled, pic) {
  // This month: how much of the spending budget the category budgets take.
  const compare = pic
    ? h('p', { class: 'card-foot' }, pic.categories.unbudgeted < 0
      ? `Your category budgets for ${formatMonthName(pic.month)} take ${ctx.money(pic.categories.given)} of your ${ctx.money(pic.budget.amount)} spending budget: ${ctx.money(-pic.categories.unbudgeted)} more than it has. Payments already count inside it, so only the rest of each budget is counted.`
      : `Your category budgets for ${formatMonthName(pic.month)} take ${ctx.money(pic.categories.given)} of your ${ctx.money(pic.budget.amount)} spending budget, and ${ctx.money(pic.categories.unbudgeted)} isn’t given to any category. Payments already count inside it, so only the rest of each budget is counted.`)
    : null;
  if (!totalBudget) {
    return card({ title: 'Category budgets' },
      h('p', { class: 'card-text' }, 'You can also give a spending category its own monthly limit: select it below. Budgets repeat every month, and you can change them any time.'),
      compare);
  }
  const left = totalBudget - budgetedSpent;
  return card({ title: 'Category budgets at a glance', sub: `${timeframeText(range)}${scaled ? ` · monthly budgets scaled to ${scaled}` : ''}` },
    h('dl', { class: 'totals' },
      h('div', {}, h('dt', {}, 'Budgeted'), h('dd', {}, ctx.money(totalBudget))),
      h('div', {}, h('dt', {}, 'Spent'), h('dd', {}, ctx.money(budgetedSpent))),
      h('div', {}, h('dt', {}, left < 0 ? 'Over by' : 'Left'), h('dd', { class: left < 0 ? 'over' : '' }, ctx.money(Math.abs(left))))),
    meter(budgetedSpent / totalBudget, budgetLevel(budgetedSpent, totalBudget), 'meter-lg'),
    unbudgeted ? h('p', { class: 'card-foot' }, `Plus ${ctx.money(unbudgeted)} spent in categories without a budget.`) : null,
    compare);
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
