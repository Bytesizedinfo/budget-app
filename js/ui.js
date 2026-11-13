// Shared building blocks for the views: headers, cards, meters, form fields and dialogs.

import { budgetLevel } from './calc.js';
import { TIMEFRAMES, timeframe, todayISO } from './dates.js';
import { h, icon } from './dom.js';

export function viewHead(ctx, title, { actions = [] } = {}) {
  return h('div', { class: 'view-head' },
    h('h1', { class: 'view-title' }, title),
    h('div', { class: 'view-actions' }, actions));
}

// A list of findings in plain words. items: [{ level: 'good' | 'warn' | 'info', text }]; the icon carries
// the level as well as the colour.
export function pointList(items) {
  const icons = { good: 'check', warn: 'alert', info: 'info' };
  return h('ul', { class: 'points' }, items.map((item) => h('li', { class: `point point-${item.level}` }, icon(icons[item.level] ?? 'info', 'icon-sm'), h('span', {}, item.text))));
}

// The table view of a chart, folded away under it. The first column is text, the rest are numbers.
export function tableToggle(head, rows) {
  return h('details', { class: 'table-toggle' }, h('summary', {}, 'Show as a table'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, head.map((text, i) => h('th', { class: i ? 'num' : '' }, text)))),
      h('tbody', {}, rows.map((row) => h('tr', {}, row.map((text, i) => h('td', { class: i ? 'num' : '' }, text))))))));
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
      h('span', { class: 'budget-name' }, category.name, typeof category.need === 'boolean' ? h('span', { class: 'badge' }, category.need ? 'Need' : 'Want') : null),
      level === 'over'
        ? h('span', { class: 'budget-left over' }, icon('alert', 'icon-sm'), `${ctx.money(-left)} over`)
        : h('span', { class: 'budget-left' }, `${ctx.money(left)} left`)),
    meter(ratio, level),
    h('span', { class: 'budget-sub' },
      h('span', {}, `${ctx.money(spent)} of ${ctx.money(budget)}`),
      level === 'warn' ? h('span', { class: 'warn-note' }, icon('alert', 'icon-xs'), `${Math.round(ratio * 100)}% used`) : null));
}

// A warning ('warn') or problem ('over') message; the icon and words carry it, not colour alone.
export function notice(level, text) {
  return h('p', { class: `notice notice-${level}` }, icon('alert', 'icon-sm'), h('span', {}, text));
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

export function segmented(name, options, value, onChange, className = '') {
  return h('div', { class: `segmented ${className}`.trim(), role: 'radiogroup' },
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

// The time frame shared by every page that shows money, remembered on this device.
const TIMEFRAME_KEY = 'budget-timeframe';

export function loadTimeframe() {
  try {
    const saved = JSON.parse(localStorage.getItem(TIMEFRAME_KEY) || 'null');
    if (saved && TIMEFRAMES.some(([choice]) => choice === saved.choice)) return saved;
  } catch {
    // Storage can be blocked; fall back to this month.
  }
  return { choice: 'month' };
}

export function timeframePicker(ctx) {
  const set = (patch) => {
    ctx.ui.timeframe = { ...ctx.ui.timeframe, ...patch };
    try {
      localStorage.setItem(TIMEFRAME_KEY, JSON.stringify(ctx.ui.timeframe));
    } catch {
      // Not remembered on this device, but still applied.
    }
    ctx.refresh();
  };
  const current = ctx.ui.timeframe;
  const range = timeframe(current.choice, todayISO(), current);
  const choice = h('select', {
    id: 'timeframe',
    class: 'input timeframe-select',
    'aria-label': 'Time frame',
    value: current.choice,
    onchange: (event) => set({ choice: event.target.value }),
  }, TIMEFRAMES.map(([value, label]) => h('option', { value }, label)));
  if (current.choice !== 'custom') return h('div', { class: 'timeframe' }, choice);
  const date = (id, label, key) => h('input', { id, type: 'date', class: 'input', 'aria-label': label, value: range[key], onchange: (event) => set({ [key]: event.target.value }) });
  return h('div', { class: 'timeframe' }, choice, h('span', { class: 'timeframe-dates' }, date('timeframe-from', 'From', 'from'), h('span', { class: 'muted' }, 'to'), date('timeframe-to', 'To', 'to')));
}
