// The sync status pill in the header, and the dialogs it opens.

import { h, icon } from './dom.js';
import { field, openDialog } from './ui.js';

const LABELS = { idle: 'Connecting…', syncing: 'Syncing…', pending: 'Saving…', synced: 'Synced', offline: 'Offline', auth: 'Reconnect', error: 'Sync problem' };
const ICONS = { idle: 'refresh', syncing: 'refresh', pending: 'refresh', synced: 'cloudCheck', offline: 'cloudOff', auth: 'lock', error: 'alert' };

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function syncPill(ctx) {
  if (!ctx.sync) return h('span', { class: 'sync-pill', dataset: { state: 'demo' } }, icon('info'), h('span', {}, 'Demo'));
  const pill = h('button', { type: 'button', class: 'sync-pill', onclick: () => syncDialog(ctx) });
  ctx.sync.onStatus((status) => {
    const label = status.state === 'offline' && ctx.sync.dirty ? 'Offline · saved here' : LABELS[status.state];
    const busy = status.state === 'syncing' || status.state === 'pending';
    pill.dataset.state = status.state;
    pill.title = status.message || label;
    pill.setAttribute('aria-label', `Sync status: ${label}`);
    pill.replaceChildren(icon(ICONS[status.state], busy ? 'spin' : ''), h('span', { class: 'sync-label' }, label));
  });
  return pill;
}

function describe(status) {
  switch (status.state) {
    case 'synced': return 'Everything is saved to GitHub.';
    case 'pending':
    case 'syncing': return 'Saving your latest changes to GitHub…';
    case 'auth': return `${status.message} Update the token to keep syncing. Your changes are kept on this device in the meantime.`;
    default: return status.message || 'Checking GitHub…';
  }
}

export function syncDialog(ctx) {
  const { sync } = ctx;
  const { status, config } = sync;
  const dialog = openDialog({
    title: 'Sync',
    content: h('div', { class: 'form-grid' },
      h('p', { class: 'dialog-text' }, describe(status)),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Saved to'), h('dd', {}, `${config.owner}/${config.repo}/${config.path}`),
        h('dt', {}, 'Last synced'), h('dd', {}, status.lastSynced ? timeFormat.format(status.lastSynced) : 'Not yet'))),
    submitLabel: 'Sync now',
    extraActions: [h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { dialog.close(); tokenDialog(ctx); } }, 'Update token')],
    onSubmit: () => {
      sync.syncNow();
    },
  });
}

export function tokenDialog(ctx) {
  openDialog({
    title: 'Update access token',
    content: h('div', { class: 'form-grid' },
      h('p', { class: 'dialog-text' }, 'Paste a new fine-grained token with Contents: Read and write access to your budget repository.'),
      field('Access token', h('input', { name: 'token', type: 'password', class: 'input', autocomplete: 'current-password', autofocus: true, placeholder: 'github_pat_…' }))),
    onSubmit: async (data) => {
      const token = String(data.get('token')).trim();
      if (!token) throw new Error('Paste the token first.');
      await ctx.sync.updateToken(token);
      if (ctx.sync.status.state === 'auth') throw new Error(ctx.sync.status.message);
      ctx.toast('Token updated');
    },
  });
}
