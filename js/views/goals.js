import { goalProgress } from '../calc.js';
import { formatDate, isValidDate, todayISO } from '../dates.js';
import { h, icon } from '../dom.js';
import { centsToInput, parseAmount } from '../money.js';
import { newId } from '../store.js';
import { card, confirmDialog, empty, field, meter, openDialog, viewHead } from '../ui.js';

export function renderGoals(ctx) {
  const state = ctx.store.get();
  const today = todayISO();
  const newGoal = h('button', { type: 'button', class: 'btn', onclick: () => goalDialog(ctx) }, icon('plus'), 'New goal');
  return h('div', { class: 'view' },
    viewHead(ctx, 'Savings goals', { actions: [newGoal] }),
    state.goals.length
      ? h('div', { class: 'goal-grid' }, state.goals.map((goal) => goalCard(ctx, goal, today)))
      : card({}, empty('Saving up for something? Add a goal (with or without a target), put money in as you set it aside, and watch it grow.',
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => goalDialog(ctx) }, icon('plus'), 'New goal'))));
}

function goalCard(ctx, goal, today) {
  const p = goalProgress(goal, today);
  let note;
  if (p.open) note = h('p', { class: 'goal-note' }, 'No target. Just tracking what you’ve put aside.');
  else if (p.done) note = h('p', { class: 'goal-note good' }, icon('check', 'icon-sm'), 'Goal reached');
  else if (p.overdue) note = h('p', { class: 'goal-note' }, `The target date has passed · ${ctx.money(p.remaining)} to go`);
  else if (p.perMonth) note = h('p', { class: 'goal-note' }, `Put aside about ${ctx.money(p.perMonth)} a month to get there on time`);
  else note = h('p', { class: 'goal-note' }, `${ctx.money(p.remaining)} to go`);

  return card({
    title: goal.name,
    sub: goal.deadline ? `Target date ${formatDate(goal.deadline)}` : p.open ? 'Savings pot' : 'No target date',
    action: h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${goal.name}`, onclick: () => goalDialog(ctx, goal) }, icon('edit')),
    cls: 'goal-card',
  },
    h('p', { class: 'goal-amount' }, h('span', { class: 'goal-saved' }, ctx.money(p.saved)), p.open ? ' saved' : ` of ${ctx.money(goal.target)}`),
    p.open ? null : meter(p.ratio),
    note,
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => contributionDialog(ctx, goal, 1) }, icon('plus'), 'Add money'),
      p.saved > 0 ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => contributionDialog(ctx, goal, -1) }, 'Withdraw') : null));
}

function contributionDialog(ctx, goal, sign) {
  const saved = goalProgress(goal, todayISO()).saved;
  openDialog({
    title: sign > 0 ? `Add to ${goal.name}` : `Withdraw from ${goal.name}`,
    submitLabel: sign > 0 ? 'Add' : 'Withdraw',
    content: h('div', { class: 'form-grid' },
      field('Amount', h('input', { name: 'amount', class: 'input input-amount', inputmode: 'decimal', autocomplete: 'off', autofocus: true, placeholder: centsToInput(0, ctx.currency()) }),
        sign < 0 ? `${ctx.money(saved)} saved so far` : null),
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

function goalDialog(ctx, goal = null) {
  const currency = ctx.currency();
  const history = goal ? [...goal.contributions].sort((a, b) => b.date.localeCompare(a.date)) : [];
  const content = h('div', { class: 'form-grid' },
    field('Name', h('input', { name: 'name', class: 'input', maxLength: 60, autocomplete: 'off', autofocus: !goal, value: goal?.name ?? '', placeholder: 'e.g. Emergency fund' })),
    h('div', { class: 'form-row' },
      field('Target amount', h('input', { name: 'target', class: 'input', inputmode: 'decimal', autocomplete: 'off', placeholder: 'No target', value: goal?.target > 0 ? centsToInput(goal.target, currency) : '' }), 'Optional'),
      field('Target date', h('input', { name: 'deadline', type: 'date', class: 'input', value: goal?.deadline ?? '' }), 'Optional')),
    goal ? null : field('Already saved', h('input', { name: 'saved', class: 'input', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Optional' })),
    history.length
      ? h('div', { class: 'history' },
        h('p', { class: 'field-label' }, 'History'),
        h('ul', { class: 'history-list' }, history.map((c) => h('li', {},
          h('span', {}, formatDate(c.date)),
          h('span', { class: `amount${c.amount > 0 ? ' income' : ''}` }, ctx.money(c.amount, { sign: true })),
          h('button', {
            type: 'button',
            class: 'icon-btn icon-btn-sm',
            'aria-label': `Remove ${ctx.money(c.amount)} on ${formatDate(c.date)}`,
            onclick: (event) => {
              ctx.store.removeContribution(goal.id, c.id);
              event.currentTarget.closest('li').remove();
            },
          }, icon('trash'))))))
      : null);

  const dialog = openDialog({
    title: goal ? 'Edit goal' : 'New savings goal',
    content,
    extraActions: goal ? [h('button', { type: 'button', class: 'btn btn-ghost btn-danger', onclick: () => { dialog.close(); deleteGoal(ctx, goal); } }, 'Delete')] : [],
    onSubmit(data) {
      const name = String(data.get('name')).trim();
      if (!name) throw new Error('Give the goal a name.');
      const targetText = String(data.get('target') ?? '').trim();
      const target = targetText ? parseAmount(targetText) : null;
      if (targetText && !target) throw new Error('Enter a target amount greater than zero, or leave it empty.');
      const deadline = data.get('deadline') || null;
      if (deadline && !isValidDate(deadline)) throw new Error('Choose a valid target date, or leave it empty.');
      const savedText = String(data.get('saved') ?? '').trim();
      const saved = savedText ? parseAmount(savedText) : 0;
      if (saved === null) throw new Error('Enter the amount already saved as a number.');
      // Read the latest copy so contributions removed in this dialog stay removed.
      const current = goal ? ctx.store.get().goals.find((g) => g.id === goal.id) ?? goal : null;
      const contributions = current?.contributions ?? (saved ? [{ id: newId(), date: todayISO(), amount: saved, updatedAt: Date.now() }] : []);
      ctx.store.save('goals', { ...current, name, target, deadline, contributions });
      ctx.toast(goal ? 'Goal saved' : 'Goal created');
    },
  });
}

async function deleteGoal(ctx, goal) {
  if (await confirmDialog({ title: 'Delete goal?', message: `Delete ${goal.name} and its history? This can't be undone.` })) {
    ctx.store.remove('goals', goal.id);
    ctx.toast('Goal deleted');
  }
}
