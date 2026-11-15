// Quick add: a big amount with a number keypad (so the phone's keyboard stays away), a grid of categories,
// and the few other details, for adding a transaction in a few taps.

import { categoriesFor, categoryName, potBalance } from './calc.js';
import { addDays, addMonths, isValidDate, monthOf, todayISO } from './dates.js';
import { h, icon } from './dom.js';
import { centsToInput, parseAmount } from './money.js';
import { sortedGoals } from './pots.js';
import { splitDialog } from './split.js';
import { limitNote } from './tx.js';
import { field, initialBadge, openDialog, segmented } from './ui.js';

// Works out what's typed in the amount box: a number, or numbers joined by + and − ("12.50+4").
// Returns whole cents, or null if it can't be read.
export function evaluateAmount(text) {
  const s = String(text ?? '').replace(/\s/g, '').replace(/−/g, '-');
  if (!s) return null;
  let total = 0;
  for (const part of s.match(/[+-]?[^+-]+/g) ?? []) {
    const sign = part.startsWith('-') ? -1 : 1;
    const cents = parseAmount(part.replace(/^[+-]/, ''));
    if (cents === null) return null;
    total += sign * cents;
  }
  return /[^+-]/.test(s) && !/[+-]$/.test(s) ? total : null;
}

// Categories of a kind, the most recently used first.
function byRecentUse(state, kind) {
  const last = new Map();
  for (const t of state.transactions) {
    const key = `${t.date} ${String(t.updatedAt ?? 0).padStart(15, '0')}`;
    if (t.kind === kind && (last.get(t.categoryId) ?? '') < key) last.set(t.categoryId, key);
  }
  return categoriesFor(state, kind).sort((a, b) => (last.get(b.id) ?? '').localeCompare(last.get(a.id) ?? ''));
}

const KEYS = ['7', '8', '9', 'back', '4', '5', '6', '+', '1', '2', '3', '−', '.', '0', '00', '='];

export function quickAdd(ctx, { date = todayISO(), kind: startKind = 'expense' } = {}) {
  const state = ctx.store.get();
  const currency = ctx.currency();
  const today = todayISO();
  const pots = sortedGoals(state);
  let kind = startKind;
  let another = false;

  // inputmode="none" keeps the on-screen keyboard closed; a real keyboard still types into it.
  const amount = h('input', { name: 'amount', class: 'keypad-amount', inputmode: 'none', autocomplete: 'off', placeholder: centsToInput(0, currency), 'aria-label': 'Amount', autofocus: true });
  const result = h('p', { class: 'keypad-result', 'aria-live': 'polite' });
  const showResult = () => {
    const cents = evaluateAmount(amount.value);
    result.textContent = /[+−-]/.test(amount.value.slice(1)) && cents !== null ? `= ${ctx.money(cents)}` : '';
  };
  const press = (key) => {
    if (key === 'back') amount.value = amount.value.slice(0, -1);
    else if (key === '=') {
      const cents = evaluateAmount(amount.value);
      if (cents !== null && cents >= 0) amount.value = centsToInput(cents, currency);
    } else amount.value += key;
    amount.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const keypad = h('div', { class: 'keypad', role: 'group', 'aria-label': 'Number keypad' }, KEYS.map((key) => h('button', {
    type: 'button',
    class: `key${/\d/.test(key) || key === '.' ? '' : ' key-op'}`,
    'aria-label': key === 'back' ? 'Delete the last digit' : key === '=' ? 'Work out the sum' : key === '+' ? 'Plus' : key === '−' ? 'Minus' : key,
    onclick: () => press(key),
  }, key === 'back' ? icon('backspace') : key)));

  // Categories as a grid of chips, the last-used first.
  const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Category' });
  const picked = () => chips.querySelector('input:checked')?.value ?? '';
  const fillCategories = () => {
    const options = byRecentUse(state, kind);
    const preferred = options.some((c) => c.id === ctx.ui.lastCategory[kind]) ? ctx.ui.lastCategory[kind] : options[0]?.id;
    chips.replaceChildren(...options.map((c) => h('label', { class: 'chip' },
      h('input', { type: 'radio', name: 'category', value: c.id, checked: c.id === preferred, onchange: () => preset() }),
      h('span', { class: 'chip-body' }, initialBadge(c.name), h('span', { class: 'chip-name' }, c.name)))));
    if (!options.length) chips.append(h('p', { class: 'field-hint' }, 'No categories yet. Add one on the Budget page.'));
  };

  const dateInput = h('input', { name: 'date', type: 'date', class: 'input', 'aria-label': 'Date', value: date });
  const setDate = (value) => () => {
    dateInput.value = value;
  };
  const dateRow = h('div', { class: 'keypad-date' },
    h('button', { type: 'button', class: 'btn btn-sm', onclick: setDate(today) }, 'Today'),
    h('button', { type: 'button', class: 'btn btn-sm', onclick: setDate(addDays(today, -1)) }, 'Yesterday'),
    dateInput);

  // Notes used before are offered as suggestions.
  const notes = [...new Set(state.transactions.filter((t) => t.note).sort((a, b) => String(b.date).localeCompare(String(a.date))).map((t) => t.note))].slice(0, 40);
  const note = h('input', { name: 'note', class: 'input', maxLength: 120, placeholder: 'Note (optional)', 'aria-label': 'Note', autocomplete: 'off' });
  note.setAttribute('list', 'note-history'); // `list` can only be set as an attribute.
  const noteList = h('datalist', { id: 'note-history' }, notes.map((text) => h('option', { value: text })));

  // Pay that lands at the end of a month can count in the next one.
  const counts = h('select', { name: 'counts', class: 'input' }, h('option', { value: 'same' }, 'The month it came in'), h('option', { value: 'next' }, 'The next month'));
  const countsField = field('Counts in', counts);

  // An expense can be paid from a set-aside; one meant for its category is pre-selected when it has enough.
  const paidFrom = h('select', { name: 'pot', class: 'input' },
    h('option', { value: '' }, 'Spending money'),
    pots.map((g) => h('option', { value: g.id }, `${g.name} (${ctx.money(Math.max(0, potBalance(state, g)))} in it)`)));
  const paidHint = h('span', { class: 'field-hint' });
  const paidField = h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Paid from'), paidFrom, paidHint);
  let chosen = false;
  function preset() {
    if (chosen || kind !== 'expense') return;
    const cents = evaluateAmount(amount.value) ?? 0;
    const linked = pots.find((g) => g.categoryId === picked() && potBalance(state, g) > 0 && potBalance(state, g) >= cents);
    paidFrom.value = linked ? linked.id : '';
    paidHint.textContent = linked ? `Pre-set, because ${linked.name} is for ${categoryName(state, picked())}.` : '';
  }
  paidFrom.addEventListener('change', () => {
    chosen = true;
    paidHint.textContent = '';
  });
  amount.addEventListener('input', () => {
    showResult();
    preset();
  });

  const showKind = () => {
    countsField.hidden = kind !== 'income';
    paidField.hidden = kind !== 'expense' || !pots.length;
  };
  fillCategories();
  showKind();
  preset();

  const dialog = openDialog({
    title: 'Add transaction',
    submitLabel: 'Save',
    extraActions: [h('button', {
      type: 'button',
      class: 'btn btn-ghost',
      onclick: () => {
        another = true;
        dialog.form.requestSubmit();
      },
    }, 'Save & add another')],
    content: h('div', { class: 'form-grid quick-add' },
      segmented('kind', [['expense', 'Expense'], ['income', 'Income']], kind, (value) => {
        kind = value;
        fillCategories();
        showKind();
        preset();
      }),
      h('div', { class: 'keypad-display' }, amount, result),
      chips,
      keypad,
      dateRow,
      note,
      noteList,
      countsField,
      paidField),
    onSubmit(data) {
      const again = another;
      another = false;
      const cents = evaluateAmount(data.get('amount'));
      if (!cents || cents < 0) throw new Error('Enter an amount greater than zero.');
      const when = data.get('date');
      if (!isValidDate(when)) throw new Error('Choose a valid date.');
      const categoryId = data.get('category');
      if (!categoryId) throw new Error('Choose a category. You can add categories on the Budget page.');
      const record = { kind, amount: cents, date: when, categoryId, note: String(data.get('note') ?? '').trim() };
      let pot = null;
      if (kind === 'income') {
        if (data.get('counts') === 'next') record.month = addMonths(monthOf(when), 1);
      } else {
        const latest = ctx.store.get();
        pot = sortedGoals(latest).find((g) => g.id === data.get('pot')) ?? null;
        if (pot && cents > potBalance(latest, pot)) {
          throw new Error(`Only ${ctx.money(Math.max(0, potBalance(latest, pot)))} is in ${pot.name}. Lower the amount, move money in first, or pay from spending money.`);
        }
        if (pot) record.potId = pot.id;
      }
      ctx.ui.lastCategory[kind] = categoryId;
      const saved = ctx.store.save('transactions', record);
      if (kind === 'income') ctx.toast('Income added');
      else ctx.toast(pot ? `Expense added · paid from ${pot.name}` : `Expense added${limitNote(ctx, when)}`);
      if (again) {
        amount.value = '';
        note.value = '';
        showResult();
        amount.focus();
        return false;
      }
      // New income: ask where it should go, once this dialog has closed.
      if (kind === 'income' && pots.length) setTimeout(() => splitDialog(ctx, saved), 0);
      return true;
    },
  });
  dialog.dialog.classList.add('dialog-keypad');
}
