import { byNewest, categoryName, monthKey } from './calc.js';

// Cells starting with = + - @ are prefixed with ' so spreadsheet apps don't run them as formulas.
function cell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const plain = (cents) => `${Math.trunc(cents / 100)}.${String(Math.abs(cents % 100)).padStart(2, '0')}`;

export function transactionsCsv(state, list = state.transactions) {
  const rows = [['Date', 'Type', 'Category', 'Amount', 'Note', 'Counts in month']];
  for (const t of [...list].sort(byNewest)) {
    rows.push([t.date, t.kind === 'income' ? 'Income' : 'Expense', categoryName(state, t.categoryId), plain(t.amount), t.note, monthKey(t) !== String(t.date).slice(0, 7) ? monthKey(t) : '']);
  }
  // The byte-order mark makes Excel read accented characters correctly.
  return `﻿${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
