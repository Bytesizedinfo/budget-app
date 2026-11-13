// Splitting income: where one income entry goes ("Where should this go?"), the default split for each kind
// of income, and the list of income still waiting to be split.

import { categoryName, spendPerDay, splitOf, splitTotal } from './calc.js';
import { formatMonthName, formatShortDate, monthOf, todayISO } from './dates.js';
import { h } from './dom.js';
import { centsToInput, parseAmount } from './money.js';
import { defaultSplit, incomeMonths, planSplit, sortedGoals, toSplit } from './pots.js';
import { card, notice, openDialog, segmented } from './ui.js';

// "20%" or "S$100.00 a month".
export function ruleText(ctx, rule) {
  return rule.type === 'percent' ? `${Number(rule.value.toFixed(2))}%` : `${ctx.money(rule.value)} a month`;
}

// A default split in words. categoryId null: the general default for all income.
export function splitWords(ctx, state, categoryId) {
  const { source, rules } = defaultSplit(state, categoryId);
  if (source === 'keep') return 'Keep it all for spending';
  const parts = sortedGoals(state).filter((g) => rules.has(g.id)).map((g) => `${ruleText(ctx, rules.get(g.id))} to ${g.name}`);
  return parts.length ? `${parts.join(' · ')} · the rest kept for spending` : 'Nothing set aside: all kept for spending';
}

// Income added automatically is listed as "to split" from the day splitting is first used.
export function markSplitUsed(ctx) {
  if (!ctx.store.get().settings.splitSince) ctx.store.setSettings({ splitSince: todayISO() });
}

// Asks where one income entry should go: an amount for each set-aside, the rest kept for spending.
export function splitDialog(ctx, income) {
  markSplitUsed(ctx);
  const state = ctx.store.get();
  const tx = state.transactions.find((t) => t.id === income.id) ?? income;
  if (tx.kind !== 'income' || !state.goals.length) return;
  const currency = ctx.currency();
  const today = todayISO();
  const category = categoryName(state, tx.categoryId);
  const plan = planSplit(state, tx);
  const answered = !!tx.split;
  const current = splitOf(tx) ?? {};
  const before = splitTotal(state, tx);
  const d = spendPerDay(state, today);
  const counted = tx.date <= today; // Already part of today's balance.

  const inputs = new Map();
  const keepValue = h('b', {});
  const leaves = h('p', { class: 'field-hint split-leaves' });
  const warning = h('div', {});

  const read = () => {
    let total = 0;
    for (const input of inputs.values()) {
      const text = input.value.trim();
      if (!text) continue;
      const cents = parseAmount(text);
      if (cents === null) return null;
      total += cents;
    }
    return total;
  };
  const update = () => {
    const total = read();
    warning.replaceChildren();
    if (total === null) {
      keepValue.textContent = '–';
      leaves.textContent = 'Enter amounts as numbers, like 100 or 100.00.';
      return;
    }
    const keep = tx.amount - total;
    keepValue.textContent = ctx.money(keep);
    keepValue.className = keep < 0 ? 'bad' : '';
    if (keep < 0) {
      leaves.textContent = `That’s ${ctx.money(-keep)} more than this income.`;
      return;
    }
    if (!counted) {
      leaves.textContent = '';
      return;
    }
    const free = d.free - (total - before); // Spending money after bills still to come, once this is set aside.
    const perDay = Math.floor(Math.max(0, free + d.spentToday) / d.daysLeft);
    leaves.textContent = `That leaves about ${ctx.money(perDay)} a day to spend for the ${d.daysLeft} ${d.daysLeft === 1 ? 'day' : 'days'} left in ${formatMonthName(monthOf(today))}.`;
    if (free < 0) {
      warning.append(notice('warn', d.reserved > 0
        ? `After this, your spending money won’t cover the ${ctx.money(d.reserved)} of bills still to come this month.`
        : `This sets aside ${ctx.money(-free)} more than the spending money you have.`));
    }
  };

  const rows = plan.rows.map((row) => {
    const { goal } = row;
    const value = answered ? current[goal.id] ?? 0 : row.give;
    const input = h('input', {
      name: `amt-${goal.id}`,
      class: 'input split-input',
      inputmode: 'decimal',
      autocomplete: 'off',
      placeholder: centsToInput(0, currency),
      'aria-label': `Set aside for ${goal.name}`,
      value: value > 0 ? centsToInput(value, currency) : '',
      oninput: update,
    });
    inputs.set(goal.id, input);
    const notes = [
      row.rule ? `Default: ${ruleText(ctx, row.rule)}` : null,
      row.rule?.type === 'fixed' && row.already > 0 ? `${ctx.money(row.already)} already this month` : null,
      row.toTarget === null ? null : row.toTarget === 0 ? 'target reached' : `${ctx.money(row.toTarget)} to its target`,
    ].filter(Boolean);
    return h('label', { class: 'split-row' },
      h('span', { class: 'split-name' }, goal.name, h('span', { class: 'split-sub' }, notes.join(' · ') || 'Not in the default split')),
      input);
  });

  let lead;
  if (answered) lead = 'This is how it’s split now. Change any amount.';
  else if (plan.source === 'keep') lead = `Your default for ${category} is to keep it all. Type an amount to set some aside anyway.`;
  else if (plan.rows.some((r) => r.rule)) lead = `Filled in from your default split for ${category}. Change any amount.`;
  else lead = 'You haven’t set a default split yet, so nothing is filled in. Type what you want to set aside.';

  const save = (split) => {
    const latest = ctx.store.get().transactions.find((t) => t.id === tx.id) ?? tx;
    ctx.store.save('transactions', { ...latest, split });
  };

  const dialog = openDialog({
    title: answered ? 'Change split' : 'Where should this go?',
    submitLabel: 'Set aside',
    content: h('div', { class: 'form-grid split' },
      h('p', { class: 'split-lead' }, h('b', {}, ctx.money(tx.amount)), ` · ${tx.note || category} · ${formatShortDate(tx.date)}`),
      h('p', { class: 'field-hint' }, lead, ' ',
        h('button', { type: 'button', class: 'link-btn', onclick: () => { dialog.close(); defaultSplitDialog(ctx, tx.categoryId, { then: () => splitDialog(ctx, tx) }); } }, 'Change the default')),
      !answered && plan.short > 0
        ? h('p', { class: 'field-hint' }, `Your default asks for ${ctx.money(plan.short)} more than this income covers, so set-asides lower in your order get less.`)
        : null,
      h('div', { class: 'split-rows' }, rows),
      h('p', { class: 'split-keep' }, h('span', {}, 'Keep for spending'), keepValue),
      leaves,
      warning),
    extraActions: [h('button', {
      type: 'button',
      class: 'btn btn-ghost',
      onclick: () => {
        save('kept');
        dialog.close();
        ctx.toast(`All ${ctx.money(tx.amount)} kept for spending`);
      },
    }, 'Keep it all')],
    onSubmit() {
      const total = read();
      if (total === null) throw new Error('Enter amounts as numbers, like 100 or 100.00.');
      if (total > tx.amount) throw new Error(`That’s ${ctx.money(total - tx.amount)} more than this income. Lower an amount.`);
      const split = {};
      for (const [id, input] of inputs) {
        const cents = parseAmount(input.value.trim()) ?? 0;
        if (cents > 0) split[id] = cents;
      }
      save(total > 0 ? split : 'kept');
      ctx.toast(total > 0 ? `${ctx.money(total)} set aside · ${ctx.money(tx.amount - total)} kept for spending` : `All ${ctx.money(tx.amount)} kept for spending`);
    },
  });
  update();
}

// Edits a default split. categoryId null: the general default for all income (kept on each set-aside).
// Otherwise one income category, which can follow the general default, keep everything, or have its own.
export function defaultSplitDialog(ctx, categoryId = null, { then } = {}) {
  const state = ctx.store.get();
  const goals = sortedGoals(state);
  if (!goals.length) {
    ctx.toast('Add a set-aside first, then choose how income is split into it.');
    return;
  }
  const currency = ctx.currency();
  const category = categoryId ? state.categories.find((c) => c.id === categoryId && c.kind === 'income') : null;
  const current = defaultSplit(state, category?.id ?? null);
  // A category switching to its own split starts from the general default.
  const start = current.source === 'own' ? current.rules : defaultSplit(state, null).rules;
  let mode = category ? current.source : 'own';
  const example = incomeMonths(state, todayISO())?.average ?? 100000;
  const exampleLine = h('p', { class: 'field-hint' });

  const rows = goals.map((goal) => {
    const rule = start.get(goal.id);
    const type = h('select', { name: `type-${goal.id}`, class: 'input', 'aria-label': `How to set aside for ${goal.name}`, value: rule?.type ?? 'none' },
      h('option', { value: 'none' }, 'Nothing'),
      h('option', { value: 'fixed' }, 'Amount a month'),
      h('option', { value: 'percent' }, '% of the income'));
    const value = h('input', {
      name: `value-${goal.id}`,
      class: 'input',
      inputmode: 'decimal',
      autocomplete: 'off',
      'aria-label': `Amount or percent for ${goal.name}`,
      value: rule ? (rule.type === 'percent' ? String(Number(rule.value.toFixed(2))) : centsToInput(rule.value, currency)) : '',
    });
    const sync = () => {
      value.hidden = type.value === 'none';
      value.placeholder = type.value === 'percent' ? 'e.g. 20' : centsToInput(0, currency);
    };
    type.addEventListener('change', () => {
      sync();
      describe();
    });
    value.addEventListener('input', () => describe());
    sync();
    return { goal, type, value, el: h('div', { class: 'rule-row' }, h('span', { class: 'rule-name' }, goal.name), type, value) };
  });

  // Reads the rows into { setAsideId: rule }. Throws with a message that names the row at fault.
  const readRules = () => {
    const rules = {};
    let percent = 0;
    for (const { goal, type, value } of rows) {
      if (type.value === 'none') continue;
      const text = value.value.trim();
      if (type.value === 'fixed') {
        const cents = parseAmount(text);
        if (!cents) throw new Error(`Enter an amount for ${goal.name}, like 100 or 100.00, or choose Nothing.`);
        rules[goal.id] = { type: 'fixed', value: cents };
      } else {
        const number = Number(text.replace('%', '').replace(',', '.'));
        if (!text || !(number > 0) || number > 100) throw new Error(`Enter a percentage between 0 and 100 for ${goal.name}, or choose Nothing.`);
        rules[goal.id] = { type: 'percent', value: number };
        percent += number;
      }
    }
    if (percent > 100) throw new Error(`The percentages add up to ${Number(percent.toFixed(2))}%. Keep them to 100% or less.`);
    return rules;
  };
  function describe() {
    if (mode !== 'own') {
      exampleLine.textContent = '';
      return;
    }
    let rules;
    try {
      rules = readRules();
    } catch {
      exampleLine.textContent = '';
      return;
    }
    let left = example;
    for (const { goal } of rows) {
      const rule = rules[goal.id];
      if (rule) left -= Math.min(left, rule.type === 'percent' ? Math.round((example * rule.value) / 100) : rule.value);
    }
    exampleLine.textContent = `Example: from ${ctx.money(example)} in a month, ${ctx.money(example - left)} is set aside and ${ctx.money(left)} is kept for spending.`;
  }

  const rowsBox = h('div', { class: 'rule-rows' }, rows.map((r) => r.el));
  const general = h('p', { class: 'field-hint' }, `All income: ${splitWords(ctx, state, null)}.`);
  const showMode = () => {
    rowsBox.hidden = mode !== 'own';
    general.hidden = mode !== 'general';
    describe();
  };
  showMode();

  openDialog({
    title: category ? `Default split: ${category.name}` : 'Default split: all income',
    content: h('div', { class: 'form-grid' },
      h('p', { class: 'field-hint' }, category
        ? `What’s filled in each time ${category.name} comes in. You can still change it every time.`
        : 'What’s filled in each time income comes in, unless that kind of income has its own split. An amount a month is topped up once a month; a percentage applies to each income.'),
      category
        ? segmented('mode', [['general', 'Same as all income'], ['own', 'Its own split'], ['keep', 'Keep it all']], mode, (next) => {
          mode = next;
          showMode();
        })
        : null,
      general,
      rowsBox,
      exampleLine),
    onSubmit() {
      if (category) {
        const split = mode === 'general' ? null : mode === 'keep' ? 'keep' : readRules();
        ctx.store.save('categories', { ...category, split });
      } else {
        const rules = readRules();
        const same = (a, b) => (a?.type ?? null) === (b?.type ?? null) && (a?.value ?? null) === (b?.value ?? null);
        const changed = goals.filter((g) => !same(g.plan, rules[g.id])).map((g) => ({ ...g, plan: rules[g.id] ?? null }));
        if (changed.length) ctx.store.saveMany('goals', changed);
      }
      markSplitUsed(ctx);
      ctx.toast('Default split saved');
      if (then) setTimeout(then, 0);
    },
  });
}

// Income that hasn't been split yet, e.g. added by a recurring item.
export function toSplitCard(ctx) {
  const state = ctx.store.get();
  const list = toSplit(state);
  if (!list.length) return null;
  return card({ title: 'To split', sub: 'Income that came in and hasn’t been split yet', cls: 'to-split' },
    h('ul', { class: 'split-todo' }, list.slice(0, 5).map((t) => h('li', {},
      h('span', { class: 'split-todo-main' },
        h('span', { class: 'split-todo-name' }, t.note || categoryName(state, t.categoryId)),
        h('span', { class: 'split-todo-meta' }, `${formatShortDate(t.date)} · ${ctx.money(t.amount)}`)),
      h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => splitDialog(ctx, t) }, 'Split')))),
    list.length > 5 ? h('p', { class: 'card-foot' }, `And ${list.length - 5} more.`) : null);
}
