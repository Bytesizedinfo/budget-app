// The whole budget lives in one state object. Every change goes through the store, which
// stamps records with updatedAt and leaves a tombstone in `deleted` when something is removed,
// so two devices' copies can be merged record by record (see merge.js).

export const SCHEMA = 1;

const SEED_CATEGORIES = [
  ['c_food', 'Food & drink', 'expense'],
  ['c_groceries', 'Groceries', 'expense'],
  ['c_transport', 'Transport', 'expense'],
  ['c_housing', 'Housing', 'expense'],
  ['c_utilities', 'Bills & utilities', 'expense'],
  ['c_shopping', 'Shopping', 'expense'],
  ['c_health', 'Health', 'expense'],
  ['c_fun', 'Entertainment', 'expense'],
  ['c_other', 'Other', 'expense'],
  ['c_salary', 'Salary', 'income'],
  ['c_other_income', 'Other income', 'income'],
];

export function newId() {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return Date.now().toString(36) + Array.from(random, (n) => n.toString(36)).join('').slice(0, 8);
}

export function emptyState(currency = 'USD') {
  return { schema: SCHEMA, settings: { currency, updatedAt: 0 }, categories: [], transactions: [], recurring: [], goals: [], deleted: {} };
}

// Seed categories have fixed ids, so two devices that both start a budget don't duplicate them.
export function seedState(currency) {
  const state = emptyState(currency);
  state.categories = SEED_CATEGORIES.map(([id, name, kind]) => ({ id, name, kind, monthlyBudget: null, archived: false, updatedAt: 1 }));
  return state;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = (v) => (Array.isArray(v) ? v.filter((r) => isObject(r) && typeof r.id === 'string') : []);

// Unknown fields are kept untouched so nothing is lost if the file is edited by hand.
export function normalize(raw) {
  if (!isObject(raw) || !Array.isArray(raw.categories) || !Array.isArray(raw.transactions)) throw new Error("This file doesn't contain budget data.");
  if (raw.schema > SCHEMA) throw new Error('This budget was saved by a newer version of the app. Reload the page to update.');
  return {
    schema: SCHEMA,
    settings: { ...emptyState().settings, ...(isObject(raw.settings) ? raw.settings : {}) },
    categories: records(raw.categories),
    transactions: records(raw.transactions),
    recurring: records(raw.recurring),
    goals: records(raw.goals).map((g) => ({ ...g, contributions: records(g.contributions) })),
    deleted: isObject(raw.deleted) ? raw.deleted : {},
  };
}

export function parseState(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The budget file isn't valid JSON, so it can't be read.");
  }
  return normalize(raw);
}

// One record per line keeps the file small and makes each commit's diff on GitHub readable.
export function serialize(state) {
  const byDate = (a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id);
  const ordered = { ...state, transactions: [...state.transactions].sort(byDate) };
  const lines = Object.entries(ordered).map(([key, value]) => {
    if (!Array.isArray(value)) return `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
    if (!value.length) return `${JSON.stringify(key)}: []`;
    return `${JSON.stringify(key)}: [\n${value.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n]`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

export function createStore(initial = emptyState()) {
  let state = initial;
  let version = 0;
  let lastStamp = 0;
  const listeners = new Set();

  // Strictly increasing, so two quick edits on one device never share a timestamp.
  const stamp = () => (lastStamp = Math.max(Date.now(), lastStamp + 1));
  const commit = (next, source) => {
    state = next;
    version += 1;
    listeners.forEach((fn) => fn(state, source));
  };
  const upsert = (list, record) =>
    list.some((r) => r.id === record.id) ? list.map((r) => (r.id === record.id ? record : r)) : [...list, record];
  const updateGoal = (goalId, fn) => state.goals.map((g) => (g.id === goalId ? { ...fn(g), updatedAt: stamp() } : g));

  return {
    get: () => state,
    get version() {
      return version;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // source: 'local' for edits made here (these get synced), anything else for data loaded from elsewhere.
    replace(next, source = 'remote') {
      commit(next, source);
    },
    save(collection, record) {
      const saved = { ...record, id: record.id || newId(), updatedAt: stamp() };
      commit({ ...state, [collection]: upsert(state[collection], saved) }, 'local');
      return saved;
    },
    saveMany(collection, list) {
      let next = state[collection];
      for (const record of list) next = upsert(next, { ...record, id: record.id || newId(), updatedAt: stamp() });
      commit({ ...state, [collection]: next }, 'local');
    },
    remove(collection, id) {
      commit({ ...state, [collection]: state[collection].filter((r) => r.id !== id), deleted: { ...state.deleted, [id]: stamp() } }, 'local');
    },
    setSettings(patch) {
      commit({ ...state, settings: { ...state.settings, ...patch, updatedAt: stamp() } }, 'local');
    },
    addContribution(goalId, { amount, date }) {
      const contribution = { id: newId(), amount, date, updatedAt: stamp() };
      commit({ ...state, goals: updateGoal(goalId, (g) => ({ ...g, contributions: [...g.contributions, contribution] })) }, 'local');
    },
    removeContribution(goalId, id) {
      const goals = updateGoal(goalId, (g) => ({ ...g, contributions: g.contributions.filter((c) => c.id !== id) }));
      commit({ ...state, goals, deleted: { ...state.deleted, [id]: stamp() } }, 'local');
    },
  };
}
