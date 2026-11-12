import { addMonths, dateInMonth, dayOf, monthOf, monthRange } from './dates.js';

// Each monthly occurrence gets a fixed id, so two devices generating the same month
// produce the same record, and deleting one leaves a tombstone that stops it coming back.
export const occurrenceId = (ruleId, month) => `r_${ruleId}_${month}`;

// After a pause, occurrences restart from the day the rule was resumed.
const activeFrom = (rule) => (rule.resumeDate && rule.resumeDate > rule.startDate ? rule.resumeDate : rule.startDate);

export function dueOccurrences(state, today) {
  const existing = new Set(state.transactions.map((t) => t.id));
  const due = [];
  for (const rule of state.recurring) {
    if (rule.paused || !rule.startDate) continue;
    const from = activeFrom(rule);
    const until = rule.endDate && rule.endDate < today ? rule.endDate : today;
    for (const month of monthRange(monthOf(rule.startDate), monthOf(until))) {
      const date = dateInMonth(month, dayOf(rule.startDate));
      const id = occurrenceId(rule.id, month);
      if (date < from || date > until || existing.has(id) || id in state.deleted) continue;
      due.push({ id, date, kind: rule.kind, amount: rule.amount, categoryId: rule.categoryId, note: rule.name, recurringId: rule.id });
    }
  }
  return due;
}

// The next date after today on which this rule will add an entry, or null if it won't.
export function nextDate(rule, today) {
  if (rule.paused || !rule.startDate) return null;
  const from = activeFrom(rule);
  let month = monthOf(today > from ? today : from);
  for (let i = 0; i < 2; i += 1, month = addMonths(month, 1)) {
    const date = dateInMonth(month, dayOf(rule.startDate));
    if (date > today && date >= from) return rule.endDate && date > rule.endDate ? null : date;
  }
  return null;
}

// How many entries a new rule would add straight away (for past start dates).
export function backfillCount(rule, today) {
  return dueOccurrences({ transactions: [], deleted: {}, recurring: [rule] }, today).length;
}
