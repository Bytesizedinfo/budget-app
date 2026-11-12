import { transactionsCsv } from '../csv.js';
import { todayISO } from '../dates.js';
import { download, h, icon } from '../dom.js';
import { importSpendSave, isSpendSaveBackup } from '../import-spendsave.js';
import { CURRENCIES } from '../money.js';
import { parseState, serialize } from '../store.js';
import { tokenDialog } from '../syncui.js';
import { readTheme, saveTheme } from '../theme.js';
import { card, confirmDialog, field, segmented, viewHead } from '../ui.js';

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function renderSettings(ctx) {
  const state = ctx.store.get();
  const current = state.settings.currency;
  const options = CURRENCIES.some(([code]) => code === current) ? CURRENCIES : [[current, current], ...CURRENCIES];
  const currency = h('select', {
    id: 'set-currency',
    class: 'input',
    value: current,
    onchange: (event) => {
      ctx.store.setSettings({ currency: event.target.value });
      ctx.toast(`Showing amounts in ${event.target.value}`);
    },
  }, options.map(([code, name]) => h('option', { value: code }, `${code} · ${name}`)));

  return h('div', { class: 'view' },
    viewHead(ctx, 'Settings'),
    h('div', { class: 'stack narrow' },
      card({ title: 'Currency' },
        field('Show amounts in', currency, 'This only changes the symbol and formatting. Amounts you’ve entered are not converted.')),
      card({ title: 'Appearance' },
        segmented('theme', [['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']], readTheme(), saveTheme)),
      syncCard(ctx),
      dataCard(ctx, state)));
}

function syncCard(ctx) {
  if (!ctx.sync) {
    return card({ title: 'Sync' }, h('p', { class: 'card-text' }, 'This is the demo, so nothing is saved. ', h('a', { href: './' }, 'Connect your own budget'), ' to keep your data.'));
  }
  const { config, status } = ctx.sync;
  const masked = config.token.length > 16 ? `${config.token.slice(0, 11)}…${config.token.slice(-4)}` : '••••••••';
  return card({ title: 'Sync with GitHub' },
    h('dl', { class: 'kv' },
      h('dt', {}, 'Repository'), h('dd', {}, `${config.owner}/${config.repo}`),
      h('dt', {}, 'File'), h('dd', {}, config.path),
      h('dt', {}, 'Token'), h('dd', {}, masked),
      h('dt', {}, 'Last synced'), h('dd', {}, status.lastSynced ? timeFormat.format(status.lastSynced) : 'Not yet')),
    h('p', { class: 'card-text' }, 'Every save is a commit, so GitHub keeps the full history of your budget.'),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.sync.syncNow() }, icon('refresh'), 'Sync now'),
      h('button', { type: 'button', class: 'btn', onclick: () => tokenDialog(ctx) }, 'Update token'),
      h('a', { class: 'btn', href: `https://github.com/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/commits`, target: '_blank', rel: 'noopener noreferrer' }, 'History on GitHub', icon('external', 'icon-sm'))),
    h('div', { class: 'danger-zone' },
      h('div', {},
        h('p', { class: 'field-label' }, 'Lock this device'),
        h('p', { class: 'field-hint' }, 'Removes the token and the saved copy from this browser. Your data stays on GitHub.')),
      h('button', { type: 'button', class: 'btn btn-danger', onclick: () => lockDevice(ctx) }, icon('lock'), 'Lock')));
}

async function lockDevice(ctx) {
  const unsynced = ctx.sync.dirty ? ' You have changes that haven’t reached GitHub yet, and they will be lost.' : '';
  const ok = await confirmDialog({
    title: 'Lock this device?',
    message: `This removes your access token and budget from this browser. You’ll need the token to open it here again.${unsynced}`,
    confirm: 'Lock device',
  });
  if (ok) {
    ctx.sync.disconnect();
    location.reload();
  }
}

// Accepts this app's own backups (which replace everything) and Spend & Save backups (merged in).
async function openDataFile(ctx, file) {
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    ctx.toast("That file isn't a backup this app can read.");
    return;
  }
  if (isSpendSaveBackup(raw)) {
    importFromSpendSave(ctx, raw);
    return;
  }
  let next;
  try {
    next = parseState(JSON.stringify(raw));
  } catch (err) {
    ctx.toast(err.message);
    return;
  }
  const ok = await confirmDialog({
    title: 'Restore this backup?',
    message: `This replaces your whole budget with the backup (${next.transactions.length} transactions, ${next.goals.length} goals). The current version stays in your GitHub history.`,
    confirm: 'Replace my data',
  });
  if (ok) {
    ctx.store.replace(next, 'local');
    ctx.toast('Backup restored');
  }
}

async function importFromSpendSave(ctx, raw) {
  const { state, summary } = importSpendSave(raw, ctx.store.get());
  const before = ctx.store.get();
  const added = state.transactions.length - before.transactions.length;
  const lines = [
    added
      ? `${added} new ${added === 1 ? 'transaction' : 'transactions'} (out of ${summary.income + summary.expenses} in the file).`
      : `All ${summary.income + summary.expenses} transactions in this file are already here.`,
    summary.goals.length ? `Savings: ${summary.goals.join(', ')}.` : '',
    summary.newCategories.length ? `New categories: ${summary.newCategories.join(', ')}.` : '',
    summary.archived.length ? `Unused starter categories will be archived: ${summary.archived.join(', ')}.` : '',
    'Nothing already here is removed, and importing the same file again won’t create duplicates.',
  ];
  const ok = await confirmDialog({ title: 'Import from Spend & Save?', message: lines.filter(Boolean).join(' '), confirm: 'Import', danger: false });
  if (ok) {
    // Merge again in case a sync changed things while the dialog was open.
    ctx.store.replace(importSpendSave(raw, ctx.store.get()).state, 'local');
    ctx.toast(added ? `Imported ${added} ${added === 1 ? 'transaction' : 'transactions'}` : 'Already up to date');
  }
}

function dataCard(ctx, state) {
  const fileInput = h('input', {
    id: 'data-file',
    type: 'file',
    accept: '.json,application/json',
    hidden: true,
    onchange: (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (file) openDataFile(ctx, file);
    },
  });
  return card({ title: 'Your data' },
    h('p', { class: 'card-text' }, 'Download a copy of everything, export transactions for a spreadsheet, or bring in a backup from Spend & Save.'),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => download(`budget-backup-${todayISO()}.json`, serialize(state), 'application/json') }, icon('download'), 'Download backup'),
      h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, icon('upload'), 'Restore backup'),
      h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, icon('upload'), 'Import from Spend & Save'),
      h('button', { type: 'button', class: 'btn', onclick: () => download(`budget-transactions-${todayISO()}.csv`, transactionsCsv(state), 'text/csv') }, icon('download'), 'Export CSV'),
      fileInput));
}
