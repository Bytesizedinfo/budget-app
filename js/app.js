import { todayISO } from './dates.js';
import { demoState } from './demo.js';
import { h, icon, toast } from './dom.js';
import { formatMoney } from './money.js';
import { dueOccurrences } from './recurring.js';
import { createStore } from './store.js';
import { createSync } from './sync.js';
import { syncPill } from './syncui.js';
import { applyTheme, isDark, onThemeChange, readTheme, saveTheme } from './theme.js';
import { transactionDialog } from './tx.js';
import { loadTimeframe } from './ui.js';
import { renderBudgets } from './views/budgets.js';
import { renderDashboard } from './views/dashboard.js';
import { renderInsights } from './views/insights.js';
import { renderMore } from './views/more.js';
import { renderPlan } from './views/plan.js';
import { renderRecurring } from './views/recurring.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';
import { renderSetup } from './views/setup.js';
import { renderTransactions } from './views/transactions.js';

const NAV = [
  { route: 'dashboard', label: 'Overview', icon: 'home', render: renderDashboard },
  { route: 'transactions', label: 'Transactions', icon: 'list', render: renderTransactions },
  { route: 'plan', label: 'Plan', icon: 'target', render: renderPlan },
  { route: 'insights', label: 'Insights', icon: 'trend', render: renderInsights },
  { route: 'budgets', label: 'Budgets', icon: 'budget', render: renderBudgets },
  { route: 'recurring', label: 'Recurring', icon: 'repeat', render: renderRecurring },
  { route: 'reports', label: 'Reports', icon: 'chart', render: renderReports },
  { route: 'settings', label: 'Settings', icon: 'settings', render: renderSettings },
];
const MORE = { route: 'more', label: 'More', icon: 'more', render: renderMore };
const ROUTES = new Map([...NAV, MORE].map((item) => [item.route, item]));
ROUTES.set('goals', ROUTES.get('plan')); // Savings goals moved into the Plan page; old links still work.
// The phone's bottom bar has room for five; the rest live under More.
const TABS = ['dashboard', 'transactions', 'plan', 'insights', 'more'];
const UNDER_MORE = new Set(['budgets', 'recurring', 'reports', 'settings', 'more']);

const demo = new URLSearchParams(location.search).has('demo');
const store = createStore();
const sync = demo ? null : createSync({ store });
const ctx = {
  store,
  sync,
  demo,
  ui: { timeframe: loadTimeframe(), txFilter: { q: '', kind: 'all', category: 'all' }, lastCategory: {} },
  currency: () => store.get().settings.currency,
  money: (cents, options) => formatMoney(cents, ctx.currency(), options),
  refresh: () => render(),
  toast,
};
let main;
let renderQueued = false;

applyTheme(readTheme());
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

if (demo) {
  store.replace(demoState(todayISO()), 'remote');
  start();
} else if (sync.configured) {
  sync.start();
  start();
} else {
  renderSetup(ctx, start);
}

function start() {
  buildShell();
  // Any change (a new or edited rule, or data from another device) may make entries due.
  // applyRecurring only adds entries that are missing, so this settles after one pass.
  store.subscribe(() => {
    queueMicrotask(applyRecurring);
    scheduleRender();
  });
  applyRecurring();
  addEventListener('hashchange', () => {
    render();
    scrollTo(0, 0);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      applyRecurring();
      sync?.syncNow();
    } else if (sync?.dirty) {
      sync.syncNow(); // Leaving the app: push now rather than after the usual short delay.
    }
  });
  addEventListener('online', () => sync?.syncNow());
  addEventListener('offline', () => sync?.syncNow());
  render();
}

// Adds any recurring bills or income that have come due since the app was last open.
function applyRecurring() {
  const due = dueOccurrences(store.get(), todayISO());
  if (due.length) store.saveMany('transactions', due);
}

function buildShell() {
  main = h('main', { id: 'main', class: 'main' });
  const add = () => transactionDialog(ctx);
  const app = document.getElementById('app');
  app.replaceChildren(
    h('div', { class: 'shell' },
      h('nav', { class: 'sidebar', 'aria-label': 'Main' }, brand(), h('div', { class: 'nav-list' }, NAV.map((item) => navLink(item, 'nav-link')))),
      h('div', { class: 'content' },
        h('header', { class: 'topbar' },
          brand(),
          h('span', { class: 'spacer' }),
          themeToggle(),
          syncPill(ctx),
          h('button', { type: 'button', class: 'btn btn-primary btn-add', onclick: add }, icon('plus'), 'Add transaction')),
        main)),
    h('nav', { class: 'tabbar', 'aria-label': 'Main' }, TABS.map((route) => navLink(ROUTES.get(route), 'tab'))),
    h('button', { type: 'button', class: 'fab', 'aria-label': 'Add transaction', onclick: add }, icon('plus')));
  if (demo) {
    app.prepend(h('div', { class: 'demo-banner' }, 'You’re trying the demo with sample data. Nothing you change is saved. ', h('a', { href: './' }, 'Use my own budget')));
  }
}

function themeToggle() {
  const button = h('button', {
    type: 'button',
    class: 'icon-btn theme-toggle',
    onclick: () => {
      saveTheme(isDark() ? 'light' : 'dark');
      render(); // Settings shows the current choice.
    },
  });
  const update = () => {
    const label = isDark() ? 'Switch to light mode' : 'Switch to dark mode';
    button.replaceChildren(icon(isDark() ? 'sun' : 'moon'));
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  onThemeChange(update);
  update();
  return button;
}

function brand() {
  return h('a', { class: 'brand', href: '#/dashboard' }, h('img', { src: 'icon.svg', alt: '', width: 28, height: 28 }), 'Budget');
}

function navLink(item, className) {
  return h('a', { class: className, href: `#/${item.route}`, dataset: { route: item.route } }, icon(item.icon), h('span', {}, item.label));
}

// Several store changes in a row (e.g. a sync merge, then recurring entries) render once.
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  const route = location.hash.replace(/^#\/?/, '');
  const item = ROUTES.get(route) ?? ROUTES.get('dashboard');
  // A sync can re-render the page while someone is typing in a search box: keep their cursor.
  const active = document.activeElement;
  const focusId = active && main.contains(active) ? active.id : '';
  const selection = focusId && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;

  main.replaceChildren(item.render(ctx));

  for (const link of document.querySelectorAll('[data-route]')) {
    const current = link.dataset.route === item.route || (link.dataset.route === 'more' && UNDER_MORE.has(item.route));
    if (current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = item.route === 'dashboard' ? 'Budget' : `${item.label} · Budget`;

  if (focusId) {
    const el = document.getElementById(focusId);
    el?.focus({ preventScroll: true });
    if (el && selection) el.setSelectionRange(...selection);
  }
}
