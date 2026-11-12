// Combines two copies of the budget (e.g. this device's and GitHub's) without losing edits:
// records are matched by id, the most recently updated copy wins, and anything either side
// deleted stays deleted. Ids are never reused, so a tombstone can safely win over any edit.

const COLLECTIONS = ['categories', 'transactions', 'recurring', 'goals'];

const newer = (a, b) => ((b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? b : a);

function mergeRecords(mine, theirs, deleted, combine = newer) {
  const byId = new Map(mine.map((r) => [r.id, r]));
  for (const record of theirs) byId.set(record.id, byId.has(record.id) ? combine(byId.get(record.id), record) : record);
  return [...byId.values()].filter((r) => !(r.id in deleted));
}

export function mergeStates(mine, theirs) {
  const deleted = { ...mine.deleted };
  for (const [id, at] of Object.entries(theirs.deleted)) deleted[id] = Math.max(deleted[id] ?? 0, at);

  // A goal's own fields follow the newer copy, but contributions from both devices are kept.
  const mergeGoal = (a, b) => ({ ...newer(a, b), contributions: mergeRecords(a.contributions, b.contributions, deleted) });

  const merged = { schema: Math.max(mine.schema, theirs.schema), settings: newer(mine.settings, theirs.settings), deleted };
  for (const key of COLLECTIONS) merged[key] = mergeRecords(mine[key], theirs[key], deleted, key === 'goals' ? mergeGoal : newer);
  merged.goals = merged.goals.map((g) => ({ ...g, contributions: g.contributions.filter((c) => !(c.id in deleted)) }));
  return merged;
}
