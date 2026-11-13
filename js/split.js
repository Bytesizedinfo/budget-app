// Splitting income: where one income entry goes ("Where should this go?"), the default split for each kind
// of income (with the "Save for my goals" and 50/30/20 presets), and the list of income still waiting to be split.

import { categoryName, spendPerDay, splitOf, splitTotal } from './calc.js';
import { formatDate, formatMonthName, formatShortDate, monthOf, todayISO } from './dates.js';
import { h } from './dom.js';
import { centsToInput, parseAmount } from './money.js';
import { dateAfter, defaultSplit, incomeMonths, planSplit, presetSplit, ratioOf, scheduleDue, sortedGoals, toSplit, validSchedule } from './pots.js';
import { card, field, notice, openDialog, segmented } from './ui.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A saving schedule in words: "S$40.00 every 2 weeks", "S$87.25 a month to reach S$349.00 by 28 Feb 2027".
export function scheduleText(ctx, state, goal, month = monthOf(todayISO())) {
  const s = validSchedule(goal);
  if (!s) return null;
  if (s.type === 'rate') return `${ctx.money(s.amount)} ${s.every === 1 ? `a ${s.unit}` : `every ${plural(s.every, s.unit)}`}`;
  const within = s.within ? ` (${plural(s.within.n, s.within.unit)})` : '';
  return `${ctx.money(scheduleDue(state, goal, month))} a month to reach ${ctx.money(goal.target)} by ${formatDate(goal.deadline)}${within}`;
}

// "20%", "S$100.00 a month" or "on its schedule".
export function ruleText(ctx, rule) {
  if (rule.type === 'schedule') return 'on its schedule';
  return rule.type === 'percent' ? `${Number(rule.value.toFixed(2))}%` : `${ctx.money(rule.value)} a month`;
}

export function ratioText(ratio) {
  return `${Number(ratio.needs.toFixed(1))}/${Number(ratio.wants.toFixed(1))}/${Number(ratio.savings.toFixed(1))}`;
}

// A default split in words. categoryId null: the general default for all income.
export function splitWords(ctx, state, categoryId) {
  const { source, rules, ratio } = defaultSplit(state, categoryId);
  if (source === 'keep') return 'Keep it all for spending';
  if (source === 'ratio') {
    const rest = ratio.restId ? state.goals.find((g) => g.id === ratio.restId)?.name : null;
    return `${ratioText(ratio)}: ${Number(ratio.savings.toFixed(1))}% to savings (goals on their schedules first${rest ? `, the rest to ${rest}` : ''}), the other ${Number((100 - ratio.savings).toFixed(1))}% kept for needs and wants`;
  }
  const parts = sortedGoals(state).filter((g) => rules.has(g.id)).map((g) => `${g.name} ${ruleText(ctx, rules.get(g.id))}`);
  return parts.length ? `${parts.join(' · ')} · the rest kept for spending` : 'Nothing set aside: all kept for spending';
}

// Income added automatically is listed as "to split" from the day splitting is first used.
export function markSplitUsed(ctx) {
  if (!ctx.store.get().settings.splitSince) ctx.store.setSettings({ splitSince: todayISO() });
}

const PRESETS = [['default', 'My default'], ['goals', 'Save for my goals'], ['ratio', '50/30/20']];

// Asks where one income entry should go: an amount for each set-aside, the rest kept for spending.
export function splitDialog(ctx, income) {
  markSplitUsed(ctx);
  const state = ctx.store.get();
  const tx = state.transactions.find((t) => t.id === income.id) ?? income;
  if (tx.kind !== 'income' || !state.goals.length) return;
  const currency = ctx.currency();
  const today = todayISO();
  const category = categoryName(state, tx.categoryId);
  const answered = !!tx.split;
  const current = splitOf(tx) ?? {};
  const before = splitTotal(state, tx);
  const d = spendPerDay(state, today);
  const counted = tx.date <= today; // Already part of today's balance.
  const hasSchedules = state.goals.some((g) => validSchedule(g));

  const inputs = new Map();
  const subs = new Map();
  const keepValue = h('b', {});
  const leaves = h('p', { class: 'field-hint split-leaves' });
  const warning = h('div', {});
  const lead = h('p', { class: 'field-hint' });

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

  // Fills the amounts in from a preset (or the saved split) and explains where they came from.
  const apply = (preset) => {
    const plan = planSplit(state, tx, presetSplit(state, preset, tx.categoryId));
    for (const row of plan.rows) {
      const value = preset === 'saved' ? current[row.goal.id] ?? 0 : row.give;
      inputs.get(row.goal.id).value = value > 0 ? centsToInput(value, currency) : '';
      const notes = [
        row.rule ? `${preset === 'default' ? 'Default' : 'Preset'}: ${row.rule.type === 'schedule' ? scheduleText(ctx, state, row.goal, monthOf(tx.date)) ?? 'on its schedule' : ruleText(ctx, row.rule)}` : null,
        row.rest ? `plus ${ctx.money(row.rest)} of the savings part left over` : null,
        row.rule && row.rule.type !== 'percent' && row.already > 0 ? `${ctx.money(row.already)} already this month` : null,
        row.toTarget === null ? null : row.toTarget === 0 ? 'target reached' : `${ctx.money(row.toTarget)} to its target`,
      ].filter(Boolean);
      subs.get(row.goal.id).textContent = notes.join(' · ') || (preset === 'goals' ? 'No saving schedule' : 'Not in this split');
    }
    let text;
    if (preset === 'saved') text = 'This is how it’s split now. Change any amount.';
    else if (preset === 'goals') text = hasSchedules ? 'Each goal gets what’s due on its saving schedule this month.' : 'None of your set-asides has a saving schedule yet. Give them one on the Plan page (edit a set-aside).';
    else if (preset === 'ratio') text = `The ${ratioText(plan.ratio)} rule: ${Number(plan.ratio.savings.toFixed(1))}% of this (${ctx.money(Math.round((tx.amount * plan.ratio.savings) / 100))}) is for savings, goals on their schedules first.`;
    else if (plan.source === 'keep') text = `Your default for ${category} is to keep it all. Type an amount to set some aside anyway.`;
    else if (plan.source === 'ratio') text = `Filled in from your default for ${category}: the ${ratioText(plan.ratio)} rule.`;
    else if (plan.rows.some((r) => r.rule)) text = `Filled in from your default split for ${category}. Change any amount.`;
    else text = 'You haven’t set a default split yet, so nothing is filled in. Type what you want to set aside, or pick a preset.';
    if (preset !== 'saved' && plan.short > 0) text += ` It asks for ${ctx.money(plan.short)} more than this income covers, so set-asides lower in your order get less.`;
    lead.replaceChildren(text, ' ',
      h('button', { type: 'button', class: 'link-btn', onclick: () => { dialog.close(); defaultSplitDialog(ctx, tx.categoryId, { then: () => splitDialog(ctx, tx) }); } }, 'Change the default'));
    update();
  };

  const rows = sortedGoals(state).map((goal) => {
    const input = h('input', {
      name: `amt-${goal.id}`,
      class: 'input split-input',
      inputmode: 'decimal',
      autocomplete: 'off',
      placeholder: centsToInput(0, currency),
      'aria-label': `Set aside for ${goal.name}`,
      oninput: update,
    });
    inputs.set(goal.id, input);
    const sub = h('span', { class: 'split-sub' });
    subs.set(goal.id, sub);
    return h('label', { class: 'split-row' }, h('span', { class: 'split-name' }, goal.name, sub), input);
  });

  const save = (split) => {
    const latest = ctx.store.get().transactions.find((t) => t.id === tx.id) ?? tx;
    ctx.store.save('transactions', { ...latest, split });
  };

  const dialog = openDialog({
    title: answered ? 'Change split' : 'Where should this go?',
    submitLabel: 'Set aside',
    content: h('div', { class: 'form-grid split' },
      h('p', { class: 'split-lead' }, h('b', {}, ctx.money(tx.amount)), ` · ${tx.note || category} · ${formatShortDate(tx.date)}`),
      h('div', { class: 'preset-row' },
        h('span', { class: 'field-label' }, 'Fill in from'),
        h('div', { class: 'btn-row preset-btns' }, [...(answered ? [['saved', 'As saved']] : []), ...PRESETS].map(([id, label]) =>
          h('button', { type: 'button', class: 'btn btn-sm', dataset: { preset: id }, onclick: () => apply(id) }, label)))),
      lead,
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
  apply(answered ? 'saved' : 'default');
}

// Edits the 50/30/20 ratio: the shares for needs, wants and savings, and where the savings part goes once
// the goals' schedules have had theirs.
export function ratioDialog(ctx, { then } = {}) {
  const state = ctx.store.get();
  const ratio = ratioOf(state);
  const goals = sortedGoals(state);
  const num = (name, value) => h('input', { name, class: 'input', inputmode: 'decimal', autocomplete: 'off', value: String(Number(value.toFixed(1))) });
  const needs = num('needs', ratio.needs);
  const wants = num('wants', ratio.wants);
  const savings = num('savings', ratio.savings);
  const sum = h('p', { class: 'field-hint' });
  const check = () => {
    const total = [needs, wants, savings].reduce((s, i) => s + (Number(i.value) || 0), 0);
    sum.textContent = Math.abs(total - 100) < 0.05 ? 'Adds up to 100%.' : `Adds up to ${Number(total.toFixed(1))}%: it needs to be 100%.`;
    sum.className = Math.abs(total - 100) < 0.05 ? 'field-hint' : 'field-hint bad';
  };
  for (const input of [needs, wants, savings]) input.addEventListener('input', check);
  check();
  openDialog({
    title: 'The 50/30/20 rule',
    content: h('div', { class: 'form-grid' },
      h('p', { class: 'field-hint' }, 'Of each income, a share for needs (bills, transport, groceries), a share for wants, and a share for savings. Only the savings share is set aside: goals get what’s due on their schedules first, and what’s left goes to one set-aside. Mark each spending category as a need or a want on the Budgets page to compare your spending with the rule.'),
      h('div', { class: 'ratio-row' }, field('Needs %', needs), field('Wants %', wants), field('Savings %', savings)),
      sum,
      field('What’s left of the savings share goes to',
        h('select', { name: 'rest', class: 'input', value: ratio.restId ?? 'keep' }, goals.map((g) => h('option', { value: g.id }, g.name)), h('option', { value: 'keep' }, 'Nothing: keep it for spending')))),
    onSubmit(data) {
      const read = (name) => {
        const n = Number(String(data.get(name)).replace('%', '').replace(',', '.'));
        if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('Enter each share as a number between 0 and 100.');
        return Math.round(n * 10) / 10;
      };
      const next = { needs: read('needs'), wants: read('wants'), savings: read('savings'), restId: data.get('rest') };
      if (Math.abs(next.needs + next.wants + next.savings - 100) > 0.05) throw new Error('The three shares need to add up to 100%.');
      ctx.store.setSettings({ ratio: next });
      ctx.toast(`Rule set to ${ratioText(next)}`);
      if (then) setTimeout(then, 0);
    },
  });
}

// Edits a default split. categoryId null: the general default for all income. Otherwise one income category,
// which can follow all income, keep everything, use the 50/30/20 rule, or have its own rules.
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
  // Switching to own rules starts from the rules in use now (the general default's, if those are inherited).
  const start = current.source === 'own' || (current.source === 'general' && !category) ? current.rules : defaultSplit(state, null).rules;
  let mode = category ? (current.inherited ? 'general' : current.source) : (current.source === 'ratio' ? 'ratio' : 'own');
  const example = incomeMonths(state, todayISO())?.average ?? 100000;
  const exampleLine = h('p', { class: 'field-hint' });

  const rows = goals.map((goal) => {
    const rule = start.get(goal.id);
    const scheduled = validSchedule(goal);
    const type = h('select', { name: `type-${goal.id}`, class: 'input', 'aria-label': `How to set aside for ${goal.name}`, value: rule?.type ?? 'none' },
      h('option', { value: 'none' }, 'Nothing'),
      scheduled ? h('option', { value: 'schedule' }, 'On its schedule') : null,
      h('option', { value: 'fixed' }, 'Amount a month'),
      h('option', { value: 'percent' }, '% of the income'));
    const value = h('input', {
      name: `value-${goal.id}`,
      class: 'input',
      inputmode: 'decimal',
      autocomplete: 'off',
      'aria-label': `Amount or percent for ${goal.name}`,
      value: rule?.value ? (rule.type === 'percent' ? String(Number(rule.value.toFixed(2))) : centsToInput(rule.value, currency)) : '',
    });
    const note = h('span', { class: 'rule-note' }, scheduled ? scheduleText(ctx, state, goal) : '');
    const sync = () => {
      value.hidden = type.value === 'none' || type.value === 'schedule';
      note.hidden = type.value !== 'schedule';
      value.placeholder = type.value === 'percent' ? 'e.g. 20' : centsToInput(0, currency);
    };
    type.addEventListener('change', () => {
      sync();
      describe();
    });
    value.addEventListener('input', () => describe());
    sync();
    return { goal, type, value, el: h('div', { class: 'rule-row' }, h('span', { class: 'rule-name' }, goal.name), type, value, note) };
  });

  // Reads the rows into { setAsideId: rule }. Throws with a message that names the row at fault.
  const readRules = () => {
    const rules = {};
    let percent = 0;
    for (const { goal, type, value } of rows) {
      if (type.value === 'none') continue;
      if (type.value === 'schedule') {
        rules[goal.id] = { type: 'schedule' };
        continue;
      }
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
  const useGoals = () => {
    for (const { goal, type } of rows) {
      type.value = validSchedule(goal) ? 'schedule' : 'none';
      type.dispatchEvent(new Event('change'));
    }
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
    const month = monthOf(todayISO());
    let left = example;
    for (const { goal } of rows) {
      const rule = rules[goal.id];
      if (!rule) continue;
      const want = rule.type === 'percent' ? Math.round((example * rule.value) / 100) : rule.type === 'schedule' ? scheduleDue(state, goal, month) : rule.value;
      left -= Math.min(left, want);
    }
    exampleLine.textContent = `Example: from ${ctx.money(example)} in a month, ${ctx.money(example - left)} is set aside and ${ctx.money(left)} is kept for spending.`;
  }

  const rowsBox = h('div', { class: 'rule-rows' },
    h('div', { class: 'btn-row preset-btns' },
      h('button', { type: 'button', class: 'btn btn-sm', onclick: useGoals }, 'Save for my goals: each on its schedule'),
      h('span', { class: 'field-hint' }, state.goals.some((g) => validSchedule(g)) ? '' : 'No set-aside has a saving schedule yet. Edit one on the Plan page to give it one.')),
    rows.map((r) => r.el));
  const general = h('p', { class: 'field-hint' }, `All income: ${splitWords(ctx, state, null)}.`);
  const ratioBox = h('div', { class: 'ratio-box' },
    h('p', { class: 'field-hint' }, splitWords(ctx, { ...state, settings: { ...state.settings, allIncome: 'ratio' } }, null), '.'),
    h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { dialog.close(); ratioDialog(ctx, { then: () => defaultSplitDialog(ctx, categoryId, { then }) }); } }, 'Change the ratio'));
  const showMode = () => {
    rowsBox.hidden = mode !== 'own';
    general.hidden = mode !== 'general';
    ratioBox.hidden = mode !== 'ratio';
    describe();
  };
  showMode();

  const modes = category
    ? [['general', 'Same as all income'], ['own', 'Its own split'], ['ratio', '50/30/20'], ['keep', 'Keep it all']]
    : [['own', 'My own split'], ['ratio', '50/30/20 rule']];
  const dialog = openDialog({
    title: category ? `Default split: ${category.name}` : 'Default split: all income',
    content: h('div', { class: 'form-grid' },
      h('p', { class: 'field-hint' }, category
        ? `What’s filled in each time ${category.name} comes in. You can still change it every time.`
        : 'What’s filled in each time income comes in, unless that kind of income has its own split. An amount a month (or a schedule) is topped up once a month; a percentage applies to each income.'),
      segmented('mode', modes, mode, (next) => {
        mode = next;
        showMode();
      }),
      general,
      ratioBox,
      rowsBox,
      exampleLine),
    onSubmit() {
      if (category) {
        const split = mode === 'general' ? null : mode === 'keep' ? 'keep' : mode === 'ratio' ? 'ratio' : readRules();
        ctx.store.save('categories', { ...category, split });
      } else if (mode === 'ratio') {
        ctx.store.setSettings({ allIncome: 'ratio' });
      } else {
        const rules = readRules();
        const same = (a, b) => (a?.type ?? null) === (b?.type ?? null) && (a?.value ?? null) === (b?.value ?? null);
        const changed = goals.filter((g) => !same(g.plan, rules[g.id])).map((g) => ({ ...g, plan: rules[g.id] ?? null }));
        if (changed.length) ctx.store.saveMany('goals', changed);
        if (state.settings.allIncome === 'ratio') ctx.store.setSettings({ allIncome: null });
      }
      markSplitUsed(ctx);
      ctx.toast('Default split saved');
      if (then) setTimeout(then, 0);
    },
  });
}

// The saving schedule part of the set-aside form: nothing, an amount every N days/weeks/months, reach the
// target by its date, or reach it within a length of time (which sets the target date).
export function scheduleFields(ctx, goal, today) {
  const currency = ctx.currency();
  const s = validSchedule(goal ?? {});
  let kind = s ? (s.type === 'rate' ? 'rate' : s.within ? 'within' : 'date') : 'none';
  const type = h('select', { name: 'sched', class: 'input', value: kind },
    h('option', { value: 'none' }, 'No schedule'),
    h('option', { value: 'rate' }, 'An amount every…'),
    h('option', { value: 'date' }, 'Reach the target by its target date'),
    h('option', { value: 'within' }, 'Reach the target within…'));
  const amount = h('input', { name: 'sched-amount', class: 'input', inputmode: 'decimal', autocomplete: 'off', placeholder: centsToInput(0, currency), 'aria-label': 'Amount', value: s?.type === 'rate' ? centsToInput(s.amount, currency) : '' });
  const every = h('input', { name: 'sched-every', class: 'input', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Every how many', value: String(s?.type === 'rate' ? s.every : s?.within?.n ?? 1) });
  const unit = h('select', { name: 'sched-unit', class: 'input', 'aria-label': 'Days, weeks or months', value: s?.type === 'rate' ? s.unit : s?.within?.unit ?? 'month' },
    h('option', { value: 'day' }, 'days'), h('option', { value: 'week' }, 'weeks'), h('option', { value: 'month' }, 'months'));
  const hint = h('span', { class: 'field-hint' });
  const rateRow = h('div', { class: 'sched-row' }, amount, h('span', { class: 'muted' }, 'every'), every, unit);
  const withinRow = h('div', { class: 'sched-row' }, every, unit);
  const sync = () => {
    kind = type.value;
    rateRow.hidden = kind !== 'rate';
    withinRow.hidden = kind !== 'within';
    if (kind === 'within') withinRow.prepend(every, unit);
    else if (kind === 'rate') rateRow.append(every, unit);
    const n = Math.max(1, Math.round(Number(every.value) || 1));
    hint.textContent = kind === 'within'
      ? `Sets the target date to ${formatDate(dateAfter(today, n, unit.value))}, and spreads what’s left evenly over the months until then.`
      : kind === 'date' ? 'Needs a target amount and a target date. What’s left is spread evenly over the months until then.'
        : kind === 'rate' ? 'Daily and weekly amounts count the days of each month.' : '';
  };
  for (const el of [type, every, unit]) el.addEventListener('change', sync);
  every.addEventListener('input', sync);
  sync();
  return {
    el: h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Saving schedule'), type, rateRow, withinRow, hint),
    // Reads the form into { schedule, deadline } (deadline only when "within" sets it). Throws when incomplete.
    read(data, { target, deadline }) {
      const picked = data.get('sched');
      if (picked === 'none') return { schedule: null, deadline };
      const n = Math.max(1, Math.round(Number(data.get('sched-every')) || 0));
      const u = data.get('sched-unit');
      if (picked === 'rate') {
        const cents = parseAmount(data.get('sched-amount'));
        if (!cents) throw new Error('Enter the amount to set aside each time, like 40 or 40.00.');
        if (!(n > 0)) throw new Error('Enter how often, like every 2 weeks.');
        return { schedule: { type: 'rate', amount: cents, every: n, unit: u, since: s?.type === 'rate' && s.since ? s.since : today }, deadline };
      }
      if (!(target > 0)) throw new Error('A schedule that reaches the target needs a target amount.');
      if (picked === 'within') {
        if (!(n > 0)) throw new Error('Enter the length of time, like 3 months.');
        return { schedule: { type: 'target', within: { n, unit: u } }, deadline: dateAfter(today, n, u) };
      }
      if (!deadline) throw new Error('Choose a target date, or pick "Reach the target within…" instead.');
      return { schedule: { type: 'target', within: null }, deadline };
    },
  };
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
