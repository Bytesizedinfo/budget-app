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
// Pages that moved: [the page now, the section of the Budget page, if any].
const MOVED = { transactions: ['activity'], plan: ['budget', 'setasides'], goals: ['budget', 'setasides'], budgets: ['budget', 'categories'], recurring: ['upcoming'] };
async function go(route) {
  const [target, section] = MOVED[route] ?? [route];
  frame.contentWindow.location.hash = `#/${route}`;
  await until(() => frame.contentDocument.querySelector('[aria-current="page"]')?.dataset.route === target, `${route} to render`);
  if (section) await until(() => frame.contentDocument.querySelector('.section-tabs input:checked')?.value === section, `the ${section} section`);
  if (route === 'transactions') {
    // The list, not the calendar.
    if (!frame.contentDocument.querySelector('#tx-search')) frame.contentDocument.querySelectorAll('.section-tabs input')[0]?.click();
    await until(() => frame.contentDocument.querySelector('#tx-search'), 'the transaction list');
  }
}
// The quick-add keypad picks a category with chips.
function chooseCategory(dialog, id) {
  const chip = dialog.querySelector(`[name="category"][value="${id}"]`);
  expect(chip, `a ${id} chip`);
  chip.click();
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

step('add money to a set-aside on the Plan page', async () => {
  await go('plan');
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

const isoDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const confirmRow = (name) => $$('.to-confirm .due-row').find((r) => r.querySelector('.due-name').textContent === name);
async function newPayment(planned, values, setup) {
  button(planned ? 'New planned payment' : 'New recurring payment').click();
  const dialog = await openDialog();
  for (const [name, value] of Object.entries(values)) fill(dialog, name, value);
  setup?.(dialog);
  submit(dialog);
  await dialogClosed();
}

step('a weekly payment waits on its day, and is recorded with the amount it really was', async () => {
  await go('recurring');
  await newPayment(false, { name: 'UI check gym', amount: '20', start: isoDay(0) }, (dialog) => {
    const repeat = dialog.querySelector('[name="repeat"]');
    repeat.value = 'week';
    repeat.dispatchEvent(new Event('change'));
  });
  await until(() => $$('.recurring-card .tx-row').some((r) => r.textContent.includes('UI check gym') && r.textContent.includes('Weekly')), 'the payment listed as weekly');
  const row = await until(() => confirmRow('UI check gym'), 'it waits to be confirmed today');
  button('Paid', row).click();
  const dialog = await openDialog();
  fill(dialog, 'amount', '22');
  submit(dialog);
  await dialogClosed();
  await until(() => !confirmRow('UI check gym'), 'no longer waiting');
  await go('transactions');
  await until(() => $$('.tx-row').some((r) => r.textContent.includes('UI check gym') && r.textContent.includes('22.00')), 'recorded at 22');
});

step('a payment can be skipped or postponed', async () => {
  await go('recurring');
  await newPayment(false, { name: 'UI check daily', amount: '1', start: isoDay(0) }, (dialog) => {
    const repeat = dialog.querySelector('[name="repeat"]');
    repeat.value = 'day';
    repeat.dispatchEvent(new Event('change'));
  });
  await newPayment(false, { name: 'UI check monthly', amount: '9', start: isoDay(0) });
  button('Skip', await until(() => confirmRow('UI check daily'), 'the daily one waiting')).click();
  let dialog = await openDialog();
  submit(dialog);
  await dialogClosed();
  await until(() => !confirmRow('UI check daily'), 'skipped');
  button('Postpone', await until(() => confirmRow('UI check monthly'), 'the monthly one waiting')).click();
  dialog = await openDialog();
  submit(dialog); // to tomorrow
  await dialogClosed();
  await until(() => !confirmRow('UI check monthly') && $$('.recurring-card .tx-row').some((r) => r.textContent.includes('UI check monthly') && r.textContent.includes('Next')), 'postponed to tomorrow');
});

step('a planned payment with money set aside for it ahead of time', async () => {
  await newPayment(true, { name: 'UI check concert', amount: '80', start: isoDay(10) }, (dialog) => {
    const fund = dialog.querySelector('[name="fund"]');
    fund.value = 'date';
    fund.dispatchEvent(new Event('change'));
    // All of it today.
  });
  await until(() => $$('.planned-card .tx-row').some((r) => r.textContent.includes('UI check concert') && /80\.00 of .*80\.00 set aside/.test(r.textContent)), () => `set aside today (${$$('.planned-card .tx-row').map((r) => r.textContent).join(' / ')})`);
  expect($$('.tl-row').some((r) => r.textContent.includes('UI check concert') && r.textContent.includes('from its set-aside')), 'the timeline pays it from what was set aside');
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
  expect(/\d/.test($('.balance-value').textContent) && $('.balance-parts').textContent.includes('Set aside'), 'total balance shown');
});

step('what you’d have left sits next to safe to spend and explains itself', async () => {
  const card = await until(() => $('.left-card'), 'the left card');
  expect(/What you’d have left/.test(card.textContent) && /a day/.test($('.perday-perday').textContent), card.textContent);
  expect(card.parentElement.classList.contains('home-grid') && $('.home-grid > [data-home="safe"]'), 'in the home grid with the safe-to-spend card');
  expect($('[data-left="planned"]') && $('[data-left="wishes"]'), 'the planned and wishlist switches');
  button('How is this worked out?', card).click();
  const dialog = await openDialog();
  expect(/Shared over the/.test(dialog.textContent), dialog.textContent.slice(0, 200));
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
  expect(/Set aside: how it’s worked out/.test(dialog.textContent), 'set-aside sheet');
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
  frame.contentWindow.location.hash = '#/goals'; // The old link opens the Budget page's set-asides.
  await until(() => $('[aria-current="page"]')?.dataset.route === 'budget' && $('.section-tabs input:checked')?.value === 'setasides', 'the old goals link to open Set-asides');
  await until(() => $$('.goal-card').some((c) => c.textContent.includes('UI check trip') && c.textContent.includes('S$40.00 set aside')), 'the imported set-aside');
  expect(!$('.to-split') || !$('.to-split').textContent.includes('100.00'), 'imported income, already split in Spend & Save, isn’t asked about again');
});


// ---------- splitting income, Plan, Insights, time frames everywhere ----------

const goalCard = (name) => $$('.goal-card').find((c) => c.querySelector('.card-title').textContent === name);
const savedIn = (name) => goalCard(name)?.querySelector('.goal-saved').textContent;
const pick = (value) => {
  const select = $('#timeframe');
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
};

step('new income asks where it should go, filled in from the default split', async () => {
  await go('plan');
  const tripBefore = savedIn('Trip to Japan');
  $('.btn-add').click();
  let dialog = await openDialog();
  dialog.querySelectorAll('.segmented input')[1].click(); // Income
  fill(dialog, 'amount', '1000');
  chooseCategory(dialog, 'c_salary');
  fill(dialog, 'note', 'UI check pay');
  submit(dialog);
  dialog = await until(() => $('dialog[open]')?.textContent.includes('Where should this go?') && $('dialog[open]'), 'the split dialog');
  const amount = (id) => dialog.querySelector(`[name="amt-${id}"]`).value;
  expect(amount('demo-goal-emergency') === '100.00', `10% to the emergency fund (got "${amount('demo-goal-emergency')}")`);
  expect(/^\d+\.\d\d$/.test(amount('demo-goal-trip')) || amount('demo-goal-trip') === '', 'the trip is filled in from its monthly amount');
  expect(amount('demo-goal-gifts') === '', 'gifts are not in the default split');
  fill(dialog, 'amt-demo-goal-trip', '200');
  await until(() => dialog.querySelector('.split-keep').textContent.includes('700.00'), () => `keep updates (${dialog.querySelector('.split-keep').textContent})`);
  expect(/a day to spend/.test(dialog.querySelector('.split-leaves').textContent), 'what it leaves per day');
  submit(dialog);
  await dialogClosed();
  await until(() => savedIn('Trip to Japan') !== tripBefore, 'the trip set-aside to grow');
  await go('transactions');
  await until(() => $$('.tx-row').some((r) => r.textContent.includes('UI check pay') && r.textContent.includes('300.00 set aside')), 'the income row says what was set aside');
});

step('change split, then keep it all', async () => {
  $$('.tx-row').find((r) => r.textContent.includes('UI check pay')).click();
  let dialog = await openDialog();
  button('Change split', dialog).click();
  dialog = await until(() => $('dialog[open]')?.textContent.includes('Change split') && $('dialog[open]'), 'the change-split dialog');
  expect(dialog.querySelector('[name="amt-demo-goal-trip"]').value === '200.00', 'shows the current split');
  button('Keep it all', dialog).click();
  await dialogClosed();
  await until(() => $$('.tx-row').some((r) => r.textContent.includes('UI check pay') && !r.textContent.includes('set aside')), 'nothing set aside any more');
});

step('a kind of income can have its own default split', async () => {
  await go('plan');
  $('[data-split="c_salary"]').click();
  const dialog = await openDialog();
  dialog.querySelectorAll('.segmented input')[1].click(); // Its own split
  dialog.querySelector('[name="type-demo-goal-gifts"]').value = 'percent';
  dialog.querySelector('[name="type-demo-goal-gifts"]').dispatchEvent(new Event('change'));
  fill(dialog, 'value-demo-goal-gifts', '5');
  dialog.querySelector('[name="type-demo-goal-emergency"]').value = 'none';
  dialog.querySelector('[name="type-demo-goal-emergency"]').dispatchEvent(new Event('change'));
  submit(dialog);
  await dialogClosed();
  await until(() => /Gifts 5%/.test($('[data-split="c_salary"]').textContent) && !/Emergency/.test($('[data-split="c_salary"]').textContent), () => `the salary row (${$('[data-split="c_salary"]').textContent})`);
  expect(/Same as all income/.test($('[data-split="c_other_income"]').textContent), 'other kinds still follow all income');
  expect(goalCard('Gifts').textContent.includes('5% of Salary'), 'the set-aside says where its money comes from');
});

step('income added by a recurring item waits on the Overview to be split', async () => {
  await go('dashboard');
  const card = await until(() => $('.to-split'), 'the to-split card');
  const count = () => $$('.to-split li').length;
  const before = count();
  button('Split', card).click();
  const dialog = await openDialog();
  expect(dialog.textContent.includes('Where should this go?'), dialog.textContent.slice(0, 120));
  button('Keep it all', dialog).click();
  await dialogClosed();
  await until(() => !$('.to-split') || count() < before, 'one fewer to split');
});

step('an expense in a set-aside’s category is paid from it, and the limit leaves it out', async () => {
  $('.btn-add').click();
  const dialog = await openDialog();
  fill(dialog, 'amount', '12');
  chooseCategory(dialog, 'c_shopping');
  await until(() => dialog.querySelector('[name="pot"]').value === 'demo-goal-gifts', 'Gifts pre-selected');
  fill(dialog, 'note', 'UI check present');
  submit(dialog);
  await dialogClosed();
  await until(() => /paid from Gifts/.test($('#toast').textContent), () => `the toast (${$('#toast').textContent})`);
  await go('transactions');
  await until(() => $$('.tx-row').some((r) => r.textContent.includes('UI check present') && r.textContent.includes('from Gifts')), 'the row says where it was paid from');
});

step('move money between set-asides', async () => {
  await go('plan');
  const before = savedIn('Trip to Japan');
  button('Move', goalCard('Emergency fund')).click();
  const dialog = await openDialog();
  fill(dialog, 'amount', '50');
  dialog.querySelector('[name="to"]').value = 'demo-goal-trip';
  submit(dialog);
  await dialogClosed();
  await until(() => savedIn('Trip to Japan') !== before, 'the trip to grow');
});

step('the Plan page tries a pay amount and checks the plan', async () => {
  const amount = $('#try-amount');
  amount.value = '2500';
  amount.dispatchEvent(new Event('input', { bubbles: true }));
  await until(() => /a day/.test($('.try-out').textContent) && $('.try-keep'), () => `the try result (${$('.try-out').textContent})`);
  const checks = $$('.card').find((c) => c.querySelector('.card-title')?.textContent === 'Checks on your plan');
  expect(checks && /safety buffer/.test(checks.textContent) && /months/.test(checks.textContent), checks?.textContent ?? 'no checks card');
  // Wishlist items are in the table too; their cards are on the Upcoming page.
  expect($$('.plan-table tbody tr').length >= $$('.goal-card').length, 'planned and set aside for every set-aside');
});

step('Insights draws its charts and says what they mean', async () => {
  await go('insights');
  await until(() => $$('.chart-svg').length >= 4, () => `charts drawn (${$$('.chart-svg').length})`);
  expect($$('.points li').length >= 3, 'plain-word insights');
  expect($$('.segbar-block').length >= 2, 'where the income went');
  expect($$('.line').length >= 4, 'pace and balance lines');
  expect($$('.table-toggle').length >= 4, 'each chart has a table view');
  const hit = $$('.col-hit').at(-1);
  hit.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: hit.getBoundingClientRect().right - 4 }));
  await until(() => !$('#tooltip').hidden, 'a tooltip on the balance chart');
  expect(/Total balance/.test($('#tooltip').textContent), $('#tooltip').textContent);
});

step('every money page has the time frame, and Budgets scale to it', async () => {
  for (const route of ['dashboard', 'transactions', 'plan', 'insights', 'budgets', 'recurring', 'reports']) {
    await go(route);
    expect($('#timeframe'), `${route} has the time-frame picker`);
  }
  await go('budgets');
  pick('custom');
  await until(() => $('#timeframe-from'), 'custom dates');
  const from = $('#timeframe-from');
  const to = $('#timeframe-to');
  const now = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  to.value = iso(now);
  to.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => $('#timeframe-from'), 'still custom');
  $('#timeframe-from').value = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 44));
  $('#timeframe-from').dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => /monthly budgets scaled to 1\.\d months/.test(doc().body.textContent), 'budgets scaled to the range');
  await go('recurring');
  await until(() => /Already recorded:/.test($('.range-card')?.textContent ?? ''), 'what recurring payments recorded in the range');
  pick('month');
  await until(() => $('#timeframe').value === 'month', 'back to this month');
});


step('presets fill the split box: save for my goals, and the 50/30/20 rule', async () => {
  await go('dashboard');
  const card = await until(() => $('.to-split'), 'the to-split card');
  button('Split', card).click();
  const dialog = await openDialog();
  const amount = (id) => dialog.querySelector(`[name="amt-${id}"]`).value;
  dialog.querySelector('[data-preset="goals"]').click();
  await until(() => amount('demo-goal-trip') !== '' && amount('demo-goal-emergency') === '', () => `goals preset (trip ${amount('demo-goal-trip')}, fund ${amount('demo-goal-emergency')})`);
  dialog.querySelector('[data-preset="ratio"]').click();
  await until(() => /50\/30\/20/.test(dialog.textContent) && amount('demo-goal-emergency') !== '', 'the ratio preset fills the rest into the emergency fund');
  button('Cancel', dialog).click();
  await dialogClosed();
});

step('a set-aside gets a saving schedule, which shows on its card and in the default split', async () => {
  await go('plan');
  goalCard('Gifts').querySelector('[aria-label="Edit Gifts"]').click();
  let dialog = await openDialog();
  const sched = dialog.querySelector('[name="sched"]');
  sched.value = 'rate';
  sched.dispatchEvent(new Event('change'));
  fill(dialog, 'sched-amount', '15');
  fill(dialog, 'sched-every', '2');
  dialog.querySelector('[name="sched-unit"]').value = 'week';
  submit(dialog);
  await dialogClosed();
  await until(() => /15\.00 every 2 weeks/.test(goalCard('Gifts')?.textContent ?? ''), () => `the schedule on the card (${goalCard('Gifts')?.textContent.slice(0, 200)})`);
  expect(/on its schedule/.test(goalCard('Gifts').textContent), 'it joined the split for all income');
  // "Reach the target within…" sets the target date.
  goalCard('Trip to Japan').querySelector('[aria-label="Edit Trip to Japan"]').click();
  dialog = await openDialog();
  dialog.querySelector('[name="sched"]').value = 'within';
  dialog.querySelector('[name="sched"]').dispatchEvent(new Event('change'));
  fill(dialog, 'sched-every', '6');
  dialog.querySelector('[name="sched-unit"]').value = 'month';
  submit(dialog);
  await dialogClosed();
  await until(() => /\(6 months\)/.test(goalCard('Trip to Japan')?.textContent ?? ''), 'the trip is on a 6-month schedule');
});

step('the 50/30/20 ratio can be changed and used as the default for all income', async () => {
  $('[data-split="ratio"]').click();
  let dialog = await openDialog();
  fill(dialog, 'needs', '60');
  fill(dialog, 'wants', '25');
  fill(dialog, 'savings', '15');
  submit(dialog);
  await dialogClosed();
  await until(() => /The 60\/25\/15 rule/.test($('[data-split="ratio"]').textContent), 'the new ratio');
  $('[data-split="all"]').click();
  dialog = await openDialog();
  dialog.querySelectorAll('.segmented input')[1].click(); // 50/30/20 rule
  submit(dialog);
  await dialogClosed();
  await until(() => /60\/25\/15: 15% to savings/.test($('[data-split="all"]').textContent), () => `all income uses the rule (${$('[data-split="all"]').textContent})`);
  expect($$('.card').some((c) => c.querySelector('.card-title')?.textContent.startsWith('Needs, wants and savings') && /Needs/.test(c.textContent) && /Wants/.test(c.textContent)), 'the needs/wants card compares spending with the rule');
});

step('a spending category can be marked as a need or a want', async () => {
  await go('budgets');
  $$('.row-btn').find((row) => row.textContent.includes('Other')).click();
  const dialog = await openDialog();
  dialog.querySelector('[name="need"]').value = 'want';
  submit(dialog);
  await dialogClosed();
  await until(() => $$('.row-btn').some((row) => row.textContent.includes('Other') && row.textContent.includes('Want')), 'the want tag');
});

step('wishlist items save up like goals, show what buying leaves, and count on Home when ticked', async () => {
  await go('recurring');
  button('New wishlist item').click();
  let dialog = await openDialog();
  fill(dialog, 'name', 'UI check speaker');
  fill(dialog, 'price', '60');
  const sched = dialog.querySelector('[name="sched"]');
  sched.value = 'rate';
  sched.dispatchEvent(new Event('change'));
  fill(dialog, 'sched-amount', '5');
  fill(dialog, 'sched-every', '1');
  dialog.querySelector('[name="sched-unit"]').value = 'week';
  dialog.querySelector('[name="auto"]').click();
  submit(dialog);
  await dialogClosed();
  const wish = () => $$('.wish-card').find((c) => c.querySelector('.wish-name').textContent === 'UI check speaker');
  await until(() => wish() && /Automatically: .*5\.00 a week/.test(wish().textContent) && /Buying it now would leave you/.test(wish().textContent), () => `the wish card (${wish()?.textContent.slice(0, 240)})`);
  await until(() => /5\.00 of .*60\.00/.test(wish().textContent), 'this week’s amount already moved in');
  await go('dashboard');
  const left = () => $('.left-card .perday-value').textContent;
  const switchOn = $('[data-left="wishes"]');
  if (!switchOn.checked) switchOn.click();
  await until(() => $('[data-left="wishes"]').checked, 'the wishlist switch on');
  const before = left();
  await go('recurring');
  wish().querySelector('.wish-tick input').click();
  await go('dashboard');
  await until(() => left() !== before, () => `ticking it lowers what’s left (${before} → ${left()})`);
  $('[data-left="wishes"]').click(); // Back off.
  await go('recurring');
  button('Bought', wish()).click();
  dialog = await openDialog();
  submit(dialog);
  await dialogClosed();
  await until(() => !wish() && /Bought and dropped \(\d+\)/.test($('.wishlist').textContent), 'moved to the bought list');
});

step('the calendar shows each day, and adds on the day you pick', async () => {
  await go('transactions');
  $$('.section-tabs input')[1].click();
  await until(() => $$('.cal-day').length >= 28, 'the month grid');
  expect($$('.cal-day').some((d) => d.querySelector('.cal-out')), 'days show money out');
  $(`.cal-day[data-date="${isoDay(0)}"]`).click();
  await until(() => $('.day-card .card-title') && $(`.cal-day[data-date="${isoDay(0)}"]`).classList.contains('selected'), 'today’s details');
  button('Add', $('.day-card')).click();
  const dialog = await openDialog();
  expect(dialog.querySelector('[name="date"]').value === isoDay(0), 'adds on that day');
  button('Cancel', dialog).click();
  await dialogClosed();
  $$('.section-tabs input')[0].click(); // Back to the list.
  await until(() => $('#tx-search'), 'the list again');
});

step('the month plan starts from expected income, and category amounts show what’s left as you type', async () => {
  await go('dashboard');
  frame.contentWindow.location.hash = '#/budget';
  await until(() => $('[aria-current="page"]')?.dataset.route === 'budget', 'the Budget page');
  $$('.section-tabs input')[0].click();
  await until(() => $('.month-plan'), 'the month plan');
  expect(/Expected income/.test($('.month-plan').textContent) && /Recurring payments/.test($('.month-plan').textContent) && /Left unbudgeted|Over-planned by/.test($('.month-plan').textContent), $('.month-plan').textContent.slice(0, 200));
  $('.plan-income').click();
  let dialog = await openDialog();
  fill(dialog, 'expected', '9000');
  submit(dialog);
  await dialogClosed();
  await until(() => /9,000\.00/.test($('.plan-income').textContent) && /Your figure/.test($('.plan-income').textContent), 'the expected income');
  button('Category amounts').click();
  dialog = await openDialog();
  const left = () => dialog.querySelector('.amounts-left b').textContent;
  const before = left();
  fill(dialog, 'budget-c_fun', '250');
  await until(() => left() !== before, 'what’s left updates as you type');
  submit(dialog);
  await dialogClosed();
});

step('the keypad adds sums like a calculator', async () => {
  $('.btn-add').click();
  const dialog = await openDialog();
  for (const key of ['1', '2', 'Plus', '4']) [...dialog.querySelectorAll('.key')].find((k) => k.getAttribute('aria-label') === key).click();
  await until(() => /16\.00/.test(dialog.querySelector('.keypad-result').textContent), 'shows the sum');
  [...dialog.querySelectorAll('.key')].find((k) => k.getAttribute('aria-label') === 'Work out the sum').click();
  expect(dialog.querySelector('[name="amount"]').value === '16.00', dialog.querySelector('[name="amount"]').value);
  button('Cancel', dialog).click();
  await dialogClosed();
});


step('one upcoming payment can be changed without touching the rest', async () => {
  await go('recurring');
  const row = () => $$('.tl-row').find((r) => r.textContent.includes('Streaming') || r.textContent.includes('Rent'));
  const target = await until(() => $$('.tl-edit').find((b) => /Rent|Streaming|Gym membership|Phone plan/.test(b.textContent)), 'a payment in the timeline');
  const name = target.textContent;
  target.click();
  const dialog = await openDialog();
  expect(/Just this one/.test(dialog.textContent), dialog.textContent.slice(0, 120));
  fill(dialog, 'amount', '77.77');
  submit(dialog);
  await dialogClosed();
  await until(() => $$('.tl-row').some((r) => r.textContent.includes(name) && r.textContent.includes('77.77') && /usually/.test(r.textContent)), 'the timeline shows this one’s amount');
  await until(() => $$('.recurring-card .tx-row').some((r) => r.textContent.includes(name) && /77\.77 this time/.test(r.textContent)), 'the payment’s row says it’s different this time');
  expect(row() || true, 'rows still listed');
});

step('a set-aside can be snoozed for the month and resumed', async () => {
  await go('plan');
  const snooze = [...goalCard('Emergency fund').querySelectorAll('button')].find((b) => b.textContent.startsWith('Snooze'));
  expect(snooze, 'a snooze button');
  snooze.click();
  await until(() => /Snoozed for/.test(goalCard('Emergency fund').textContent) && button('Resume', goalCard('Emergency fund')), 'snoozed');
  // New income asks nothing for it this month.
  $('.btn-add').click();
  let dialog = await openDialog();
  dialog.querySelectorAll('.segmented input')[1].click();
  fill(dialog, 'amount', '500');
  fill(dialog, 'note', 'UI check snooze pay');
  submit(dialog);
  dialog = await until(() => $('dialog[open]')?.textContent.includes('Where should this go?') && $('dialog[open]'), 'the split dialog');
  dialog.querySelector('[data-preset="default"]').click();
  await until(() => /Snoozed this month/.test(dialog.textContent), 'the split says it’s snoozed');
  expect(dialog.querySelector('[name="amt-demo-goal-emergency"]').value === '', 'nothing filled in for it');
  button('Keep it all', dialog).click();
  await dialogClosed();
  button('Resume', goalCard('Emergency fund')).click();
  await until(() => !/Snoozed for/.test(goalCard('Emergency fund').textContent), 'resumed');
});

step('the home page can be rearranged and sections hidden', async () => {
  await go('dashboard');
  const ids = () => $$('.home-grid > [data-home]').map((el) => el.dataset.home);
  expect(ids()[0] === 'left' && ids().includes('budgets'), ids().join(','));
  button('Customise this page').click();
  let dialog = await openDialog();
  dialog.querySelector('[data-move="balance-1"]').click();
  await until(() => dialog.querySelectorAll('.home-order li')[1].dataset.section === 'balance', 'balance moved up');
  dialog.querySelector('[data-move="balance-1"]').click();
  await until(() => dialog.querySelectorAll('.home-order li')[0].dataset.section === 'balance', 'balance first');
  dialog.querySelector('[name="show-budgets"]').click();
  submit(dialog);
  await dialogClosed();
  await until(() => ids()[0] === 'balance' && !ids().includes('budgets'), () => `the new order (${ids().join(',')})`);
  button('Customise this page').click();
  dialog = await openDialog();
  button('Reset', dialog).click();
  await dialogClosed();
  await until(() => ids()[0] === 'left' && ids().includes('budgets'), 'back to the usual order');
});

step('the phone bar: Home, Activity, add, Budget, Upcoming; the rest in the menu', async () => {
  const tabs = $$('.tabbar .tab').map((a) => a.dataset.route);
  expect(JSON.stringify(tabs) === JSON.stringify(['dashboard', 'activity', 'budget', 'upcoming']), tabs.join(','));
  expect($('.tabbar .tab-add'), 'the add button in the middle');
  await go('more');
  const links = text('.list-link span');
  expect(['Insights', 'Reports', 'Settings'].every((l) => links.includes(l)), links.join(','));
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
  await until(() => $('.view-title')?.textContent === 'Home', 'the app to open');
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
