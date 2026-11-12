// Drives the real app through its main flows by clicking and typing: first in demo mode,
// then connected to a fake GitHub (see fake-github.js), so no real repository is touched.

import { fakeGitHub } from './fake-github.js';

const frame = document.getElementById('app');
const errors = [];
const steps = [];
const step = (name, fn) => steps.push({ name, fn });

const doc = () => frame.contentDocument;
const $ = (selector) => doc().querySelector(selector);
const $$ = (selector) => [...doc().querySelectorAll(selector)];
const text = (selector) => $$(selector).map((el) => el.textContent);

// Polls once per animation frame, so waits keep pace with rendering even when a headless
// browser fast-forwards timers. The timeout is counted in frames (about 60 per second).
async function until(check, what, timeout = 3000) {
  for (let frames = 0; ; frames += 1) {
    const result = check();
    if (result) return result;
    if (frames > timeout / 16) throw new Error(`Timed out waiting for ${typeof what === 'function' ? what() : what}`);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const openDialog = () => until(() => $('dialog[open]'), 'a dialog to open');
const dialogClosed = () => until(() => !$('dialog[open]'), 'the dialog to close');
function fill(dialog, name, value) {
  const input = dialog.querySelector(`[name="${name}"]`);
  expect(input, `field ${name} exists`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function submit(dialog) {
  dialog.querySelector('form').requestSubmit();
}
async function go(route) {
  frame.contentWindow.location.hash = `#/${route}`;
  await until(() => frame.contentDocument.querySelector('[aria-current="page"]')?.dataset.route === route, `${route} to render`);
}
function button(label, root = doc()) {
  return [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
}

step('app loads in demo mode with sample data', async () => {
  frame.src = '../?demo#/transactions';
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  frame.contentWindow.addEventListener('error', (e) => errors.push(e.message));
  frame.contentWindow.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  await until(() => $$('.tx-row').length > 3, () => `transaction rows (page: ${frame.contentWindow.location.href} ${doc().body.innerHTML.slice(0, 300)})`, 10000);
  expect($('.demo-banner'), 'demo banner shown');
});

step('add an expense through the dialog', async () => {
  $('.btn-add').click();
  const dialog = await openDialog();
  fill(dialog, 'amount', '12.34');
  fill(dialog, 'note', 'UI check coffee');
  submit(dialog);
  await dialogClosed();
  await until(() => text('.tx-title').includes('UI check coffee'), 'the new row');
  expect($('#toast').textContent.includes('Expense added'), 'toast confirms');
});

step('validation stops an empty amount', async () => {
  $('.btn-add').click();
  const dialog = await openDialog();
  submit(dialog);
  await until(() => !dialog.querySelector('.form-error').hidden, 'an error message');
  expect(dialog.querySelector('.form-error').textContent.includes('amount'), 'mentions the amount');
  button('Cancel', dialog).click();
  await dialogClosed();
});

step('edit the expense', async () => {
  $$('.tx-row').find((row) => row.textContent.includes('UI check coffee')).click();
  const dialog = await openDialog();
  expect(dialog.querySelector('[name="amount"]').value === '12.34', 'amount prefilled');
  fill(dialog, 'amount', '20');
  submit(dialog);
  await dialogClosed();
  await until(() => $$('.tx-row').some((row) => row.textContent.includes('UI check coffee') && row.textContent.includes('20.00')), 'updated amount');
});

step('delete, then undo', async () => {
  $$('.tx-row').find((row) => row.textContent.includes('UI check coffee')).click();
  const dialog = await openDialog();
  button('Delete', dialog).click();
  await until(() => !text('.tx-title').includes('UI check coffee'), 'row removed');
  const undo = button('Undo', $('#toast'));
  expect(undo, `undo button in toast: ${$('#toast').innerHTML}`);
  undo.click();
  await until(() => text('.tx-title').includes('UI check coffee'), () => `row restored (rows now: ${text('.tx-title').slice(0, 5).join(', ')})`);
});

step('search filters the list', async () => {
  const search = $('#tx-search');
  search.value = 'UI check';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await until(() => $$('.tx-row').length === 1, 'one matching row');
  search.value = '';
  search.dispatchEvent(new Event('input', { bubbles: true }));
});

step('the time frame changes which transactions are listed, and custom dates work', async () => {
  const pick = (value) => {
    const select = $('#timeframe');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const count = () => $$('.tx-row').length;
  pick('all');
  await until(() => $('#timeframe').value === 'all' && /All time/.test($('.list-summary').textContent), 'all time');
  const all = count();
  pick('today');
  await until(() => $('#timeframe').value === 'today', 'today');
  expect(count() <= all, 'today lists no more than all time');
  pick('custom');
  await until(() => $('#timeframe-from') && $('#timeframe-to'), 'custom date fields');
  const from = $('#timeframe-from');
  from.value = '2000-01-01';
  from.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => count() === all, () => `custom range from 2000 lists everything (${count()} of ${all})`);
  expect(frame.contentWindow.localStorage.getItem('budget-timeframe').includes('custom'), 'remembered on this device');
  pick('month');
  await until(() => $('#timeframe').value === 'month', 'back to this month');
});

step('set a category budget', async () => {
  await go('budgets');
  $$('.row-btn').find((row) => row.textContent.includes('Other')).click();
  const dialog = await openDialog();
  fill(dialog, 'budget', '999');
  submit(dialog);
  await dialogClosed();
  await until(() => $$('.row-btn').some((row) => row.textContent.includes('Other') && row.textContent.includes('999.00')), 'budget shown');
});

step('add money to a savings goal', async () => {
  await go('goals');
  const before = $('.goal-saved').textContent;
  button('Add money').click();
  const dialog = await openDialog();
  fill(dialog, 'amount', '100');
  submit(dialog);
  await dialogClosed();
  await until(() => $('.goal-saved').textContent !== before, 'saved amount to grow');
});

step('withdrawing more than saved is refused', async () => {
  button('Withdraw').click();
  const dialog = await openDialog();
  fill(dialog, 'amount', '99999999');
  submit(dialog);
  await until(() => !dialog.querySelector('.form-error').hidden, 'an error');
  button('Cancel', dialog).click();
  await dialogClosed();
});

step('create a recurring item that back-fills past months', async () => {
  await go('recurring');
  button('New recurring item').click();
  const dialog = await openDialog();
  const start = new Date();
  start.setMonth(start.getMonth() - 2, 1);
  const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;
  fill(dialog, 'name', 'UI check insurance');
  fill(dialog, 'amount', '45');
  fill(dialog, 'start', iso);
  await until(() => dialog.querySelector('.field-hint').textContent.includes('3 past entries'), 'back-fill hint');
  submit(dialog);
  await dialogClosed();
  await until(() => text('.tx-title').includes('UI check insurance'), 'rule listed');
  await go('transactions');
  await until(() => text('.tx-title').includes('UI check insurance'), 'this month’s entry was added');
});

step('reports draw a 12-month chart with a table', async () => {
  await go('reports');
  await until(() => $$('.col-hit').length === 12, '12 month columns');
  expect($$('.bar').length > 6, 'bars drawn');
  expect($$('.table-toggle tbody tr').length === 12, 'table has 12 rows');
  $$('.col-hit')[11].dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
  await until(() => !$('#tooltip').hidden, 'tooltip');
  expect($('#tooltip').textContent.includes('Income'), `tooltip lists income (tooltip says: "${$('#tooltip').textContent}")`);
});

step('the overview leads with what is safe to spend, by period, and the total balance', async () => {
  await go('dashboard');
  await until(() => $('.hero .segmented'), 'the safe-to-spend switch');
  const label = () => $('.hero-label').textContent;
  expect(/Safe to spend today|Over today’s share/.test(label()), label());
  $$('.hero .segmented input')[1].click();
  await until(() => /this week/.test(label()), 'the week view');
  $$('.hero .segmented input')[2].click();
  await until(() => /rest of/.test(label()) && !/week/.test(label()), 'the month view');
  expect(/\d/.test($('.balance-value').textContent) && $('.balance-parts').textContent.includes('In savings goals'), 'total balance shown');
});

step('spend per day sits next to safe to spend and explains itself', async () => {
  const card = await until(() => $('.perday'), 'the spend-per-day card');
  expect(/You can spend per day/.test(card.textContent) && /a day/.test($('.perday-value').textContent), card.textContent);
  expect(card.parentElement.classList.contains('hero-row'), 'beside the safe-to-spend card');
  button('How is this worked out?', card).click();
  const dialog = await openDialog();
  expect(/shared over the/.test(dialog.textContent), dialog.textContent.slice(0, 200));
  button('Done', dialog).click();
  await dialogClosed();
});

step('every overview number opens a sheet listing the entries behind it', async () => {
  for (const label of ['Income', 'Spent', 'Net']) {
    $$('.stat-btn').find((b) => b.querySelector('.stat-label').textContent.startsWith(label)).click();
    const dialog = await openDialog();
    expect(dialog.textContent.includes('how it’s worked out'), `${label} sheet title`);
    expect(label === 'Net' || dialog.querySelectorAll('.bd-list li').length > 0, `${label} lists entries`);
    button('Done', dialog).click();
    await dialogClosed();
  }
  $('.balance-value').click();
  let dialog = await openDialog();
  const listed = dialog.querySelectorAll('.bd-list li').length;
  expect(listed > 3 && /Everything that came in up to today/.test(dialog.textContent), `total balance lists every entry (${listed})`);
  button('Done', dialog).click();
  await dialogClosed();
  $$('.balance-parts .tap')[0].click();
  dialog = await openDialog();
  expect(/In savings goals/.test(dialog.textContent), 'savings sheet');
  button('Done', dialog).click();
  await dialogClosed();
});

step('adding an expense says what is left to spend today', async () => {
  $('.btn-add').click();
  const dialog = await openDialog();
  fill(dialog, 'amount', '3.20');
  fill(dialog, 'note', 'UI check snack');
  submit(dialog);
  await dialogClosed();
  await until(() => /left to spend today|over today’s share|over your monthly limit/.test($('#toast').textContent), () => `the limit in the toast (says "${$('#toast').textContent}")`);
});

step('the spending limit can be turned off and back on from Budgets', async () => {
  await go('budgets');
  button('Change').click();
  let dialog = await openDialog();
  fill(dialog, 'limit', '');
  submit(dialog);
  await dialogClosed();
  await go('dashboard');
  await until(() => !$('.hero .segmented') && /Left to spend|Over budget/.test($('.hero-label').textContent), 'the category-budget hero');
  await go('budgets');
  button('Set a limit').click();
  dialog = await openDialog();
  fill(dialog, 'limit', '4200');
  submit(dialog);
  await dialogClosed();
  await until(() => $$('.card').some((c) => c.textContent.includes('Monthly spending limit') && c.textContent.includes('4,200.00')), 'the limit card');
});

step('changing currency reformats amounts', async () => {
  await go('settings');
  const select = $('#set-currency');
  select.value = 'JPY';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await go('dashboard');
  await until(() => $('.hero-value')?.textContent.includes('¥'), 'yen amounts');
  expect(!$('.hero-value').textContent.includes('.'), 'no decimals for yen');
});

step('importing a Spend & Save backup adds its transactions and savings', async () => {
  await go('settings');
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const backup = {
    app: 'spend-save',
    v: 1,
    exported: `${today}T00:00:00.000Z`,
    settings: {
      symbol: 'S$',
      labels: [{ id: 'food', name: 'Food & drinks' }],
      incomeCats: [{ id: 'salary', name: 'Salary' }],
      saveCats: [{ id: 'trip', name: 'UI check trip', start: 0, target: 0 }],
    },
    months: {
      [`m-${today.slice(0, 7)}`]: {
        tx: [
          { id: 'u1', t: 'out', amt: 9.9, label: 'food', d: today, note: 'UI check import', from: 'spend' },
          { id: 'u2', t: 'in', amt: 100, cat: 'salary', d: today, note: '', save: { trip: 40 }, spend: 60 },
        ],
      },
    },
  };
  const { DataTransfer, File } = frame.contentWindow;
  const files = new DataTransfer();
  files.items.add(new File([JSON.stringify(backup)], 'spend-save-backup.json', { type: 'application/json' }));
  const input = $('#data-file');
  input.files = files.files;
  input.dispatchEvent(new Event('change'));
  const dialog = await openDialog();
  expect(dialog.textContent.includes('2 new transactions'), dialog.textContent);
  submit(dialog);
  await dialogClosed();
  await go('transactions');
  await until(() => text('.tx-title').includes('UI check import'), 'the imported transaction');
  await go('goals');
  await until(() => $$('.goal-card').some((c) => c.textContent.includes('UI check trip') && c.textContent.includes('S$40.00 saved')), 'the imported savings pot');
});

step('the header toggle switches between light and dark', async () => {
  const toggle = $('.theme-toggle');
  const root = frame.contentDocument.documentElement;
  const background = () => frame.contentWindow.getComputedStyle(frame.contentDocument.body).backgroundColor;
  const startedDark = toggle.getAttribute('aria-label').includes('light');
  toggle.click();
  await until(() => root.dataset.theme === (startedDark ? 'light' : 'dark'), 'the theme to switch');
  expect(background() === (startedDark ? 'rgb(246, 246, 243)' : 'rgb(13, 13, 13)'), `page colour is ${background()}`);
  expect(toggle.getAttribute('aria-label').includes(startedDark ? 'dark' : 'light'), 'label flips');
  toggle.click();
  await until(() => root.dataset.theme === (startedDark ? 'dark' : 'light'), 'the theme to switch back');
  frame.contentWindow.localStorage.removeItem('budget:theme');
});

step('no uncaught errors in the demo', () => {
  expect(!errors.length, errors.join('\n'));
});

// ---------- Connected mode, against a fake GitHub ----------

const github = fakeGitHub({ isPrivate: false });
const pill = () => $('.sync-pill')?.textContent ?? '';

async function loadApp(src) {
  frame.src = src;
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  frame.contentWindow.fetch = github.fetch; // The app looks fetch up at call time, so this intercepts every GitHub request.
  frame.contentWindow.addEventListener('error', (e) => errors.push(e.message));
  frame.contentWindow.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
}

step('without a token, only the setup screen is shown', async () => {
  frame.contentWindow.localStorage.removeItem('budget:config');
  frame.contentWindow.localStorage.removeItem('budget:cache');
  await loadApp('../#/dashboard');
  await until(() => $('.setup-card'), 'the setup screen');
  expect(!$('.shell'), 'no budget UI before connecting');
});

step('a public repository is refused', async () => {
  const form = $('.setup-card form');
  form.querySelector('[name="owner"]').value = 'me';
  form.querySelector('[name="token"]').value = 'good';
  form.requestSubmit();
  await until(() => !$('.setup-card .form-error').hidden, 'an error');
  expect($('.setup-card .form-error').textContent.includes('public'), $('.setup-card .form-error').textContent);
  expect(github.file === null, 'nothing was written');
});

step('connecting to a private repository creates the budget file', async () => {
  github.isPrivate = true;
  $('.setup-card form').requestSubmit();
  await until(() => $('.view-title')?.textContent === 'Overview', 'the app to open');
  expect(github.file, 'budget.json created');
  expect(github.state().categories.length > 5, 'seeded with categories');
  await until(() => pill() === 'Synced', () => `sync pill to say Synced (says "${pill()}")`);
});

step('a new transaction is pushed to GitHub', async () => {
  $('.btn-add').click();
  const dialog = await openDialog();
  fill(dialog, 'amount', '7.50');
  fill(dialog, 'note', 'Synced coffee');
  submit(dialog);
  await dialogClosed();
  await until(() => github.state().transactions.some((t) => t.note === 'Synced coffee'), 'the push', 6000);
  await until(() => pill() === 'Synced', 'Synced');
});

step('changes from another device arrive when the app regains focus', async () => {
  github.edit((s) => s.transactions.push({ id: 'phone-1', date: s.transactions[0].date, kind: 'expense', amount: 4200, categoryId: 'c_food', note: 'Lunch from phone', updatedAt: Date.now() }));
  frame.contentDocument.dispatchEvent(new Event('visibilitychange'));
  await go('transactions');
  await until(() => text('.tx-title').includes('Lunch from phone'), 'the other device’s entry', 4000);
});

step('offline edits wait on the device, then sync on reconnect', async () => {
  github.offline = true;
  $('.btn-add').click();
  const dialog = await openDialog();
  fill(dialog, 'amount', '3');
  fill(dialog, 'note', 'Offline bus');
  submit(dialog);
  await dialogClosed();
  await until(() => pill().startsWith('Offline'), () => `offline status (pill says "${pill()}")`, 6000);
  expect(JSON.parse(frame.contentWindow.localStorage.getItem('budget:cache')).dirty, 'kept on the device');
  github.offline = false;
  frame.contentWindow.dispatchEvent(new Event('online'));
  await until(() => github.state().transactions.some((t) => t.note === 'Offline bus'), 'the queued push', 6000);
  await until(() => pill() === 'Synced', 'Synced');
});

step('locking the device removes the token and returns to setup', async () => {
  await go('settings');
  button('Lock').click();
  const dialog = await openDialog();
  const reloaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  submit(dialog);
  await reloaded;
  await until(() => $('.setup-card'), 'the setup screen');
  expect(frame.contentWindow.localStorage.getItem('budget:config') === null, 'token removed');
  expect(frame.contentWindow.localStorage.getItem('budget:cache') === null, 'local copy removed');
  expect(github.state().transactions.length >= 3, 'data still on GitHub');
});

step('no uncaught errors in connected mode', () => {
  expect(!errors.length, errors.join('\n'));
});

const list = document.getElementById('results');
const failures = [];
let passed = 0;
let failed = 0;
for (const { name, fn } of steps) {
  const item = document.createElement('li');
  try {
    await fn();
    passed += 1;
    item.className = 'pass';
    item.textContent = `PASS ${name}`;
  } catch (err) {
    failed += 1;
    failures.push(`${name}: ${err.message}`);
    item.className = 'fail';
    item.textContent = `FAIL ${name}`;
    const detail = document.createElement('pre');
    detail.textContent = err.stack || String(err);
    item.append(detail);
  }
  list.append(item);
}
document.getElementById('summary').textContent = `${passed} passed, ${failed} failed`;
// The title carries the result so a script can read it from the browser's debugging endpoint.
document.title = `${failed ? 'FAIL' : 'PASS'} ${passed}/${steps.length}${failures.map((f) => ` | ${f}`).join('')}`;
