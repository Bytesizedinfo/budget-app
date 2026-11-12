// Offline support: always try the network first so updates show up straight away, and fall
// back to the last cached copy of the app when offline. GitHub API calls are never cached.
// Bump CACHE when files are added or renamed.

const CACHE = 'budget-v2';
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
  'js/import-spendsave.js',
  'js/merge.js',
  'js/money.js',
  'js/recurring.js',
  'js/store.js',
  'js/sync.js',
  'js/syncui.js',
  'js/theme.js',
  'js/tx.js',
  'js/ui.js',
  'js/views/budgets.js',
  'js/views/dashboard.js',
  'js/views/goals.js',
  'js/views/more.js',
  'js/views/recurring.js',
  'js/views/reports.js',
  'js/views/settings.js',
  'js/views/setup.js',
  'js/views/transactions.js',
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
