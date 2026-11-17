// Offline support: always try the network first so updates show up straight away, and fall
// back to the last cached copy of the app when offline. GitHub API calls are never cached.
// Bump CACHE when files are added or renamed.

const CACHE = 'budget-v10';
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icon.svg',
  'icon-180.png',
  'js/app.js',
  'js/calc.js',
  'js/charts.js',
  'js/csv.js',
  'js/dates.js',
  'js/demo.js',
  'js/dom.js',
  'js/due.js',
  'js/forecast.js',
  'js/import-spendsave.js',
  'js/insights.js',
  'js/keypad.js',
  'js/merge.js',
  'js/money.js',
  'js/month.js',
  'js/move.js',
  'js/pots.js',
  'js/recurring.js',
  'js/savings.js',
  'js/split.js',
  'js/store.js',
  'js/sync.js',
  'js/syncui.js',
  'js/theme.js',
  'js/tx.js',
  'js/ui.js',
  'js/views/activity.js',
  'js/views/budget.js',
  'js/views/budgets.js',
  'js/views/dashboard.js',
  'js/views/insights.js',
  'js/views/more.js',
  'js/views/plan.js',
  'js/views/reports.js',
  'js/views/savings.js',
  'js/views/settings.js',
  'js/views/setup.js',
  'js/views/transactions.js',
  'js/views/upcoming.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/tests/')) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
