// Quick add: a big amount with a number keypad (so the phone's keyboard stays away), and three kinds:
//   Expense    a grid of categories, the date, a note and where it was paid from
//   Income     the same, plus where it goes (its split) right in the form, so one Save records both
//   Set aside  money put towards a wishlist item, goal or savings pot (or something new), taken from spending
//              money, a category's budget or another set-aside

import { balance, categoriesFor, categoryName, potBalance } from './calc.js';
import { addDays, addMonths, isValidDate, monthOf, todayISO } from './dates.js';
import { h, icon } from './dom.js';
import { centsToInput, parseAmount } from './money.js';
import { monthPicture } from './month.js';
import { confirmDip, moveChanges, moveSources } from './move.js';
import { isWish, sortedGoals } from './pots.js';
import { isSavings } from './savings.js';
import { newId } from './store.js';
import { markSplitUsed, splitFields, splitSummary } from './split.js';
import { limitNote } from './tx.js';
import { field, initialBadge, notice, openDialog, segmented } from './ui.js';

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
const KINDS = [['expense', 'Expense'], ['income', 'Income'], ['setaside', 'Set aside']];

export function quickAdd(ctx, { date = todayISO(), kind: startKind = 'expense' } = {}) {
  const state = ctx.store.get();
  const currency = ctx.currency();
  const today = todayISO();
  const pots = sortedGoals(state);
  let kind = KINDS.some(([id]) => id === startKind) ? startKind : 'expense';
  let another = false;

  // inputmode="none" keeps the on-screen keyboard closed; a real keyboard still types into it.
  const amount = h('input', { name: 'amount', class: 'keypad-amount', inputmode: 'none', autocomplete: 'off', placeholder: centsToInput(0, currency), 'aria-label': 'Amount', autofocus: true });
  const result = h('p', { class: 'keypad-result', 'aria-live': 'polite' });
  const cents = () => evaluateAmount(amount.value);
  const showResult = () => {
    const value = cents();
    result.textContent = /[+−-]/.test(amount.value.slice(1)) && value !== null ? `= ${ctx.money(value)}` : '';
  };
  const press = (key) => {
    if (key === 'back') amount.value = amount.value.slice(0, -1);
    else if (key === '=') {
      const value = cents();
      if (value !== null && value >= 0) amount.value = centsToInput(value, currency);
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
    if (kind === 'setaside') return;
    const options = byRecentUse(state, kind);
    const preferred = options.some((c) => c.id === ctx.ui.lastCategory[kind]) ? ctx.ui.lastCategory[kind] : options[0]?.id;
    chips.replaceChildren(...options.map((c) => h('label', { class: 'chip' },
      h('input', { type: 'radio', name: 'category', value: c.id, checked: c.id === preferred, onchange: () => changed() }),
      h('span', { class: 'chip-body' }, initialBadge(c.name), h('span', { class: 'chip-name' }, c.name)))));
    if (!options.length) chips.append(h('p', { class: 'field-hint' }, 'No categories yet. Add one on the Budget page.'));
  };

  const dateInput = h('input', { name: 'date', type: 'date', class: 'input', 'aria-label': 'Date', value: date, onchange: () => changed() });
  const setDate = (value) => () => {
    dateInput.value = value;
    changed();
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
  const counts = h('select', { name: 'counts', class: 'input', onchange: () => changed() }, h('option', { value: 'same' }, 'The month it came in'), h('option', { value: 'next' }, 'The next month'));
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
    const value = cents() ?? 0;
    const linked = pots.find((g) => g.categoryId === picked() && potBalance(state, g) > 0 && potBalance(state, g) >= value);
    paidFrom.value = linked ? linked.id : '';
    paidHint.textContent = linked ? `Pre-set, because ${linked.name} is for ${categoryName(state, picked())}.` : '';
  }
  paidFrom.addEventListener('change', () => {
    chosen = true;
    paidHint.textContent = '';
  });

  // Income: where it goes, right here. It's filled in from the default split as the amount, category or date
  // change, except rows typed in by hand.
  const dateValue = () => (isValidDate(dateInput.value) ? dateInput.value : today);
  const incomeNow = () => ({
    id: '(new)',
    kind: 'income',
    amount: Math.max(0, cents() ?? 0),
    categoryId: picked() || null,
    date: dateValue(),
    note: note.value.trim(),
    ...(counts.value === 'next' ? { month: addMonths(monthOf(dateValue()), 1) } : {}),
  });
  const splitBox = h('section', { class: 'split-box', 'aria-label': 'Where it goes' });
  let split = null;
  const buildSplit = () => {
    split = splitFields(ctx, { income: incomeNow, isNew: true });
    splitBox.replaceChildren(h('h3', { class: 'split-box-title' }, 'Where it goes'), split.el);
  };

  // Set aside: what it's for, and where the money comes from.
  const aside = asideFields(ctx, state, today, () => cents() ?? 0);

  // Something about the entry changed: update what depends on it.
  function changed() {
    preset();
    if (kind === 'income') split?.refill();
    if (kind === 'setaside') aside.check();
  }
  amount.addEventListener('input', () => {
    showResult();
    changed();
  });

  const showKind = () => {
    chips.hidden = kind === 'setaside';
    splitBox.hidden = kind !== 'income';
    aside.el.hidden = kind !== 'setaside';
    note.hidden = kind === 'setaside';
    countsField.hidden = kind !== 'income';
    paidField.hidden = kind !== 'expense' || !pots.length;
    if (dialog) dialog.dialog.querySelector('.dialog-head h2').textContent = kind === 'setaside' ? 'Set money aside' : 'Add transaction';
  };
  let dialog = null;
  fillCategories();
  buildSplit();

  dialog = openDialog({
    title: kind === 'setaside' ? 'Set money aside' : 'Add transaction',
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
      segmented('kind', KINDS, kind, (value) => {
        kind = value;
        fillCategories();
        showKind();
        changed();
      }),
      h('div', { class: 'keypad-display' }, amount, result),
      chips,
      splitBox,
      aside.el,
      keypad,
      dateRow,
      note,
      noteList,
      countsField,
      paidField),
    async onSubmit(data) {
      const again = another;
      another = false;
      const value = cents();
      if (!value || value < 0) throw new Error('Enter an amount greater than zero.');
      const when = data.get('date');
      if (!isValidDate(when)) throw new Error('Choose a valid date.');
      if (kind === 'setaside') {
        if (!(await aside.save(value, when))) return false;
        // The list of set-asides has changed, so start again with a fresh form.
        if (again) setTimeout(() => quickAdd(ctx, { date: when, kind: 'setaside' }), 0);
        return true;
      }
      const categoryId = data.get('category');
      if (!categoryId) throw new Error('Choose a category. You can add categories on the Budget page.');
      const record = { kind, amount: value, date: when, categoryId, note: String(data.get('note') ?? '').trim() };
      let pot = null;
      let splitResult = null;
      if (kind === 'income') {
        if (data.get('counts') === 'next') record.month = addMonths(monthOf(when), 1);
        splitResult = split.read();
        record.split = splitResult.split;
        if (Object.keys(splitResult.cats).length) record.cats = splitResult.cats;
      } else {
        const latest = ctx.store.get();
        pot = sortedGoals(latest).find((g) => g.id === data.get('pot')) ?? null;
        if (pot && value > potBalance(latest, pot)) {
          throw new Error(`Only ${ctx.money(Math.max(0, potBalance(latest, pot)))} is in ${pot.name}. Lower the amount, move money in first, or pay from spending money.`);
        }
        if (pot && isSavings(pot) && !(await confirmDip(ctx, pot, value))) return false;
        if (pot) record.potId = pot.id;
      }
      ctx.ui.lastCategory[kind] = categoryId;
      ctx.store.save('transactions', record);
      if (kind === 'income') {
        markSplitUsed(ctx);
        ctx.toast(`Income added · ${splitSummary(ctx, value, splitResult)}`);
      } else ctx.toast(pot ? `Expense added · paid from ${pot.name}` : `Expense added${limitNote(ctx, when)}`);
      if (again) {
        amount.value = '';
        note.value = '';
        showResult();
        if (kind === 'income') {
          buildSplit(); // Starts again from the default split, now counting this income as already in.
          showKind();
        }
        amount.focus();
        return false;
      }
      return true;
    },
  });
  dialog.dialog.classList.add('dialog-keypad');
  showKind();
  if (kind === 'income') split.refill();
}

// The Set aside part of the Add form: a list of wishlist items, goals and savings pots (with their progress)
// or something new, where the money comes from, and a warning when it would take spending money below what's
// still due this month. amount(): the amount typed so far.
function asideFields(ctx, state, today, amount) {
  const goals = sortedGoals(state);
  const order = (g) => (isWish(g) ? 0 : isSavings(g) ? 2 : 1);
  const targets = [...goals].sort((a, b) => order(a) - order(b));
  const kindName = (g) => (isWish(g) ? 'Wishlist' : isSavings(g) ? 'Savings' : 'Goal');
  const progress = (g) => {
    const saved = Math.max(0, potBalance(state, g));
    return g.target > 0 ? `${ctx.money(saved)} of ${ctx.money(g.target)}` : `${ctx.money(saved)} set aside`;
  };
  const start = targets.some((g) => g.id === ctx.ui.lastAside) ? ctx.ui.lastAside : targets[0]?.id ?? 'new';
  const option = (value, name, sub) => h('label', { class: 'aside-option' },
    h('input', { type: 'radio', name: 'for', value, checked: value === start, onchange: () => showNew() }),
    h('span', { class: 'aside-name' }, name, h('span', { class: 'aside-sub' }, sub)));
  const list = h('div', { class: 'aside-for', role: 'radiogroup', 'aria-label': 'What it’s for' },
    targets.map((g) => option(g.id, g.name, `${kindName(g)} · ${progress(g)}`)),
    option('new', 'Something new…', 'Add it to your wishlist'));
  const newName = h('input', { name: 'new-name', class: 'input', maxLength: 60, autocomplete: 'off', placeholder: 'e.g. Headphones' });
  const newPrice = h('input', { name: 'new-price', class: 'input', inputmode: 'decimal', autocomplete: 'off', placeholder: centsToInput(0, ctx.currency()) });
  const newRow = h('div', { class: 'form-row aside-new' }, field('What is it?', newName), field('Price', newPrice));
  const showNew = () => {
    newRow.hidden = list.querySelector('input:checked')?.value !== 'new';
  };

  // Where it comes from: spending money (what you have), a category's budget, or another set-aside.
  const sources = moveSources(state, today);
  const spending = balance(state, today).spending;
  const cats = sources.filter((s) => s.kind === 'cat' && s.available > 0);
  const others = sources.filter((s) => s.kind === 'pot' && s.available > 0);
  const from = h('select', { name: 'from', class: 'input', onchange: () => check() },
    h('option', { value: 'free' }, `Spending money (${ctx.money(spending)})`),
    cats.length ? h('optgroup', { label: 'A category’s budget this month' }, cats.map((s) => h('option', { value: s.key }, `${s.label} (${ctx.money(s.available)} left)`))) : null,
    others.length ? h('optgroup', { label: 'Another set-aside' }, others.map((s) => h('option', { value: s.key }, `${s.label} (${ctx.money(s.available)} in it)`))) : null);

  // Money leaving spending money can take it below what's still due this month: say so, but allow it.
  const left = monthPicture(state, monthOf(today), today, ctx.ui.left).left;
  const warning = h('div', { 'aria-live': 'polite' });
  const check = () => {
    const leaves = !from.value.startsWith('pot:');
    const value = amount();
    warning.replaceChildren(leaves && value > 0 && value > left
      ? notice('warn', left > 0
        ? `That’s more than the ${ctx.money(left)} you’d have left this month once everything still due has come out. You can still go ahead.`
        : 'Your spending money doesn’t cover what’s still due this month, so this leaves you shorter. You can still go ahead.')
      : '');
  };
  showNew();
  check();

  return {
    el: h('div', { class: 'aside-fields' },
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'For'), list, newRow),
      field('From', from),
      warning),
    check,
    // Records it. Resolves to false when it was called off (taking money out of savings, asked first).
    async save(cents, date) {
      const picked = list.querySelector('input:checked')?.value;
      if (!picked) throw new Error('Choose what it’s for.');
      const now = ctx.store.get();
      let goal;
      let withGoal = now;
      const save = {};
      if (picked === 'new') {
        const name = newName.value.trim();
        if (!name) throw new Error('Say what it is.');
        const price = parseAmount(newPrice.value);
        if (!price) throw new Error('Enter its price, like 129 or 129.00.');
        // A wishlist item, made the way the wishlist's own form makes one.
        goal = { id: newId(), name, target: price, deadline: null, schedule: null, auto: false, autoSince: null, plan: null, wish: { priority: 'nice', since: today, tick: false, link: '', note: '' }, contributions: [] };
        withGoal = { ...now, goals: [...now.goals, goal] };
        save.goals = [goal];
      } else {
        goal = now.goals.find((g) => g.id === picked);
        if (!goal) throw new Error('That set-aside no longer exists. Choose another.');
      }
      // From spending money it's simply added. From a category or another set-aside it's a move, which checks
      // there's enough there.
      const changes = from.value === 'free'
        ? { save: {}, contributions: [{ goalId: goal.id, contribution: { amount: cents, date } }] }
        : moveChanges(withGoal, { from: from.value, to: `pot:${goal.id}`, amount: cents, date });
      const source = from.value.startsWith('pot:') ? now.goals.find((g) => `pot:${g.id}` === from.value) : null;
      if (source && isSavings(source) && !isSavings(goal) && !(await confirmDip(ctx, source, cents))) return false;
      ctx.store.batch({ ...changes, save: { ...changes.save, ...save } });
      ctx.ui.lastAside = goal.id;
      ctx.toast(`${ctx.money(cents)} set aside for ${goal.name}`);
      return true;
    },
  };
}
