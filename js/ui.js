// Shared building blocks for the views: headers, cards, meters, form fields and dialogs.

import { budgetLevel } from './calc.js';
import { addMonths, formatMonth, monthOf, todayISO } from './dates.js';
import { h, icon } from './dom.js';

export function viewHead(ctx, title, { month = false, actions = [] } = {}) {
  return h('div', { class: 'view-head' },
    h('h1', { class: 'view-title' }, title),
    h('div', { class: 'view-actions' }, month ? monthSwitcher(ctx) : null, actions));
}

export function monthSwitcher(ctx) {
  const current = monthOf(todayISO());
  const go = (month) => {
    ctx.ui.month = month;
    ctx.refresh();
  };
  return h('div', { class: 'month-switch' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => go(addMonths(ctx.ui.month, -1)) }, icon('chevronLeft')),
    h('button', {
      type: 'button',
      class: 'month-label',
      'aria-live': 'polite',
      title: ctx.ui.month === current ? null : 'Back to this month',
      onclick: () => go(current),
    }, formatMonth(ctx.ui.month)),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next month', onclick: () => go(addMonths(ctx.ui.month, 1)) }, icon('chevronRight')));
}

export function card({ title, sub, action, cls = '' } = {}, ...body) {
  return h('section', { class: `card ${cls}`.trim() },
    title
      ? h('div', { class: 'card-head' },
        h('div', {}, h('h2', { class: 'card-title' }, title), sub ? h('p', { class: 'card-sub' }, sub) : null),
        action)
      : null,
    ...body);
}

export function cardLink(label, href) {
  return h('a', { class: 'card-link', href }, label, icon('chevronRight', 'icon-sm'));
}

// A progress bar whose fill changes colour as a limit gets close (warn) or is passed (over).
export function meter(ratio, level = 'ok', size = '') {
  const pct = Math.min(100, Math.max(0, ratio * 100));
  return h('span', { class: `meter meter-${level} ${size}`.trim() }, h('span', { class: 'meter-fill', style: { width: `${pct}%` } }));
}

export function budgetRow(ctx, { category, spent, budget }) {
  const level = budgetLevel(spent, budget);
  const ratio = budget > 0 ? spent / budget : spent > 0 ? 1 : 0;
  const left = budget - spent;
  return h('span', { class: 'budget-row' },
    h('span', { class: 'budget-top' },
      h('span', { class: 'budget-name' }, category.name),
      level === 'over'
        ? h('span', { class: 'budget-left over' }, icon('alert', 'icon-sm'), `${ctx.money(-left)} over`)
        : h('span', { class: 'budget-left' }, `${ctx.money(left)} left`)),
    meter(ratio, level),
    h('span', { class: 'budget-sub' },
      h('span', {}, `${ctx.money(spent)} of ${ctx.money(budget)}`),
      level === 'warn' ? h('span', { class: 'warn-note' }, icon('alert', 'icon-xs'), `${Math.round(ratio * 100)}% used`) : null));
}

export function empty(text, action) {
  return h('div', { class: 'empty' }, h('p', {}, text), action);
}

export function initialBadge(name) {
  return h('span', { class: 'initial', 'aria-hidden': 'true' }, (name || '?').trim().charAt(0).toUpperCase());
}

export function signedAmount(ctx, kind, cents) {
  const income = kind === 'income';
  return h('span', { class: `amount${income ? ' income' : ''}` }, ctx.money(income ? cents : -cents, { sign: true }));
}

export function field(label, control, hint) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function segmented(name, options, value, onChange) {
  return h('div', { class: 'segmented', role: 'radiogroup' },
    options.map(([optionValue, label]) => h('label', {},
      h('input', { type: 'radio', name, value: optionValue, checked: optionValue === value, onchange: () => onChange(optionValue) }),
      h('span', {}, label))));
}

export function checkbox(name, label, checked) {
  return h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', name, checked }), h('span', {}, label));
}

// Opens a modal form. onSubmit gets the FormData; throw an Error to show its message in the form.
export function openDialog({ title, content, submitLabel = 'Save', danger = false, extraActions = [], onSubmit }) {
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const dialog = h('dialog', { class: 'dialog', 'aria-label': title });
  const close = () => dialog.open && dialog.close();
  const form = h('form', {
    class: 'dialog-form',
    novalidate: true,
    onsubmit: async (event) => {
      event.preventDefault();
      error.hidden = true;
      try {
        if ((await onSubmit?.(new FormData(form), form)) !== false) close();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    },
  },
    h('header', { class: 'dialog-head' },
      h('h2', {}, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close'))),
    h('div', { class: 'dialog-body' }, content, error),
    h('footer', { class: 'dialog-foot' },
      extraActions,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'),
      h('button', { type: 'submit', class: `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}` }, submitLabel)));
  dialog.append(form);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return { close, dialog, form };
}

export function confirmDialog({ title, message, confirm = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    let confirmed = false;
    const { dialog } = openDialog({
      title,
      content: h('p', { class: 'dialog-text' }, message),
      submitLabel: confirm,
      danger,
      onSubmit: () => {
        confirmed = true;
      },
    });
    dialog.addEventListener('close', () => resolve(confirmed));
  });
}
