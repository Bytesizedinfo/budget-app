// Brings in a backup exported from the Spend & Save app, merging it into the current budget.
//
// Imported records get ids derived from Spend & Save's own ids, and only records that aren't
// here yet are added. So importing the same file twice adds nothing, and anything edited or
// deleted here since the last import stays as it is.

import { isValidDate } from './dates.js';
import { mergeStates } from './merge.js';
import { SCHEMA } from './store.js';

const SYMBOLS = { S$: 'SGD', US$: 'USD', $: 'USD', A$: 'AUD', NZ$: 'NZD', C$: 'CAD', HK$: 'HKD', RM: 'MYR', '£': 'GBP', '€': 'EUR', '¥': 'JPY', '₹': 'INR', '฿': 'THB', '₱': 'PHP' };

// Spend & Save's built-in categories that match this app's starter categories.
const STARTERS = {
  expense: { food: 'c_food', transport: 'c_transport', shopping: 'c_shopping', fun: 'c_fun', bills: 'c_utilities', other: 'c_other' },
  income: { salary: 'c_salary' },
};

export function isSpendSaveBackup(raw) {
  return raw?.app === 'spend-save' && typeof raw.months === 'object' && typeof raw.settings === 'object';
}

export function importSpendSave(raw, state) {
  // Never stamp records in the future, or they'd win over edits made later on other devices.
  const at = Math.min(Date.parse(raw.exported) || Date.now(), Date.now());
  const known = new Set([...state.transactions.map((t) => t.id), ...state.goals.flatMap((g) => g.contributions.map((c) => c.id))]);
  const isNew = (id) => !known.has(id) && !(id in state.deleted);
  const cents = (amount) => Math.round(Number(amount) * 100);
  const settings = raw.settings ?? {};
  const labels = settings.labels ?? [];
  const incomeCats = settings.incomeCats ?? [];
  const pots = settings.saveCats ?? [];
  const summary = { income: 0, expenses: 0, moves: 0, skipped: 0, countsIn: 0, newCategories: [], renamed: [], archived: [], goals: [], emptyPots: [], recurring: [], unsupportedRecurring: [], currency: null, spendingLimit: null };

  // ---- Categories ----
  const categories = new Map(); // id -> record to add or update
  const findByName = (kind, name) => [...state.categories, ...categories.values()].find((c) => c.kind === kind && c.name.toLowerCase() === name.toLowerCase());
  const map = { expense: {}, income: {} };

  const mapCategory = (kind, item) => {
    const name = String(item.name ?? '').trim() || item.id;
    const starter = state.categories.find((c) => c.id === STARTERS[kind][item.id] && c.kind === kind);
    const sameName = findByName(kind, name);
    if (sameName) {
      map[kind][item.id] = sameName.id;
      // Bring an archived match back, unless it was archived here after this export.
      if (sameName.archived && !categories.has(sameName.id)) categories.set(sameName.id, { ...sameName, archived: false, updatedAt: at });
    } else if (starter && starter.updatedAt <= 1) {
      // An untouched starter category: take on the name used in Spend & Save.
      categories.set(starter.id, { ...starter, name, archived: false, updatedAt: at });
      summary.renamed.push(`${starter.name} → ${name}`);
      map[kind][item.id] = starter.id;
    } else if (starter) map[kind][item.id] = starter.id;
    else {
      const id = `ss-${kind}-${item.id}`;
      categories.set(id, { id, name, kind, monthlyBudget: null, archived: false, updatedAt: at });
      summary.newCategories.push(name);
      map[kind][item.id] = id;
    }
  };
  labels.forEach((item) => mapCategory('expense', item));
  incomeCats.forEach((item) => mapCategory('income', item));

  const fallback = (kind) => {
    if (kind === 'expense' && map.expense.other) return map.expense.other;
    const name = kind === 'expense' ? 'Other' : 'Other income';
    const existing = findByName(kind, name);
    if (existing) return existing.id;
    const id = `ss-${kind}-other`;
    categories.set(id, { id, name, kind, monthlyBudget: null, archived: false, updatedAt: at });
    summary.newCategories.push(name);
    return id;
  };
  // An expense with no category but a note like "food" goes in the category of that name.
  const guessFromNote = (note) => {
    const text = String(note ?? '').trim().toLowerCase();
    const label = text && labels.find((l) => l.id.toLowerCase() === text || String(l.name).toLowerCase() === text);
    return label ? map.expense[label.id] : null;
  };

  // ---- Transactions and savings ----
  const transactions = [];
  const potMoves = new Map(); // pot id -> contributions
  const potIds = new Set(pots.map((p) => p.id));
  // month: set for money set aside from pay that counts in the next month, so it counts there too.
  const addMove = (pot, id, date, amount, month = null) => {
    if (!potIds.has(pot) || !amount || !isNew(id)) return;
    potMoves.set(pot, [...(potMoves.get(pot) ?? []), { id, date, amount, updatedAt: at, ...(month ? { month } : {}) }]);
  };

  const months = Object.keys(raw.months).sort();
  for (const key of months) {
    for (const t of raw.months[key]?.tx ?? []) {
      const amount = cents(t.amt);
      if (!t.id || !isValidDate(t.d) || !(amount > 0) || !['in', 'out', 'move'].includes(t.t)) {
        summary.skipped += 1;
        continue;
      }
      // A move shifts money between Spending and savings pots; it isn't income or spending.
      // Moves tied to an income entry (`via`) are already reflected in that entry's split.
      if (t.t === 'move') {
        summary.moves += 1;
        if (!t.via) {
          addMove(t.from, `ss-${t.id}-from`, t.d, -amount);
          addMove(t.to, `ss-${t.id}-to`, t.d, amount);
        }
        continue;
      }
      const kind = t.t === 'in' ? 'income' : 'expense';
      summary[kind === 'income' ? 'income' : 'expenses'] += 1;
      // Pay logged late in a month for the next one (Spend & Save's `for`) counts in that month here too.
      const forMonth = kind === 'income' && /^\d{4}-\d{2}$/.test(t.for ?? '') && t.for !== t.d.slice(0, 7) ? t.for : null;
      if (isNew(`ss-${t.id}`)) {
        const source = kind === 'income' ? t.cat : t.label;
        const categoryId = map[kind][source] ?? (kind === 'expense' ? guessFromNote(t.note) : null) ?? fallback(kind);
        // Income from Spend & Save was already split there (into its savings pots), so it isn't asked about again.
        transactions.push({ id: `ss-${t.id}`, date: t.d, kind, amount, categoryId, note: String(t.note ?? '').trim(), updatedAt: at, ...(forMonth ? { month: forMonth } : {}), ...(kind === 'income' ? { split: 'kept' } : {}) });
      } else if (forMonth) {
        // Brought in before this was understood: mark it, unless it has been edited here since.
        const existing = state.transactions.find((r) => r.id === `ss-${t.id}`);
        if (existing && !existing.month && existing.date === t.d && existing.amount === amount) {
          transactions.push({ ...existing, month: forMonth, updatedAt: Math.max(at, (existing.updatedAt ?? 0) + 1) });
          summary.countsIn += 1;
        }
      }
      // Income set aside into savings pots, and spending paid straight out of a pot.
      if (kind === 'income') for (const [pot, value] of Object.entries(t.save ?? {})) addMove(pot, `ss-${t.id}-${pot}`, t.d, cents(value), forMonth);
      if (kind === 'expense' && t.from && t.from !== 'spend') addMove(t.from, `ss-${t.id}-${t.from}`, t.d, -amount);
    }
  }

  // ---- Savings pots become goals ----
  const firstDate = transactions.map((t) => t.date).sort()[0] ?? new Date(at).toISOString().slice(0, 10);
  const goals = [];
  for (const pot of pots) {
    const moves = potMoves.get(pot.id) ?? [];
    if (Number(pot.start) > 0 && isNew(`ss-start-${pot.id}`)) moves.unshift({ id: `ss-start-${pot.id}`, date: firstDate, amount: cents(pot.start), updatedAt: at });
    const target = Number(pot.target) > 0 ? cents(pot.target) : null;
    // Reuse the goal from an earlier import, or one with the same name; its own settings win.
    const existing = state.goals.find((g) => g.id === `ss-${pot.id}`)
      ?? state.goals.find((g) => g.name.toLowerCase() === String(pot.name).toLowerCase());
    if (!existing && !moves.length && !target) {
      summary.emptyPots.push(pot.name);
      continue;
    }
    if (existing && !moves.length) {
      summary.goals.push(pot.name);
      continue;
    }
    goals.push(existing
      ? { ...existing, contributions: moves }
      : { id: `ss-${pot.id}`, name: pot.name, target, deadline: isValidDate(pot.date) ? pot.date : null, contributions: moves, updatedAt: at });
    summary.goals.push(pot.name);
  }

  // ---- Bills and subscriptions become recurring items ----
  // They start from the next unpaid due date, since earlier payments are already transactions.
  // This app repeats monthly, so other cycles are reported back rather than guessed at.
  const recurring = [];
  for (const sub of settings.subs ?? []) {
    const id = `ss-sub-${sub.id}`;
    if (!sub.id || state.recurring.some((r) => r.id === id) || id in state.deleted) continue;
    if ((sub.cycle ?? 'monthly') !== 'monthly' || !isValidDate(sub.next) || !(cents(sub.amount) > 0)) {
      summary.unsupportedRecurring.push(sub.name);
      continue;
    }
    const categoryId = map.expense[sub.label] ?? fallback('expense');
    recurring.push({ id, name: String(sub.name ?? '').trim() || 'Subscription', kind: 'expense', amount: cents(sub.amount), categoryId, startDate: sub.next, endDate: null, paused: sub.active === false, resumeDate: null, updatedAt: at });
    summary.recurring.push(sub.name);
  }

  // ---- Tidy up: hide untouched starter categories that nothing uses ----
  const used = new Set([...state.transactions, ...transactions, ...state.recurring, ...recurring].map((r) => r.categoryId));
  for (const id of [...Object.values(map.expense), ...Object.values(map.income)]) used.add(id);
  for (const c of state.categories) {
    if (c.updatedAt <= 1 && !c.archived && !used.has(c.id) && !categories.has(c.id)) {
      categories.set(c.id, { ...c, archived: true, updatedAt: at });
      summary.archived.push(c.name);
    }
  }

  const patch = {};
  const currency = SYMBOLS[String(settings.symbol ?? '').trim()];
  if (currency && currency !== state.settings.currency) patch.currency = summary.currency = currency;
  // Spend & Save's overall spending budget becomes the monthly limit, unless one is set here already.
  const perMonth = { month: 1, week: 52 / 12, year: 1 / 12 }[settings.budget?.per];
  if (perMonth && cents(settings.budget.amt) > 0 && !(state.settings.spendingLimit > 0)) {
    patch.spendingLimit = summary.spendingLimit = Math.round(cents(settings.budget.amt) * perMonth);
  }
  const nextSettings = Object.keys(patch).length
    ? { ...state.settings, ...patch, updatedAt: Math.max(at, (state.settings.updatedAt ?? 0) + 1) }
    : state.settings;

  const incoming = { schema: SCHEMA, settings: nextSettings, categories: [...categories.values()], transactions, recurring, goals, deleted: {} };
  return { state: mergeStates(state, incoming), summary };
}
