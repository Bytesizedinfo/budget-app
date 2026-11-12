// Keeps the budget in sync with one JSON file in a private GitHub repository.
//
// Every change is written to this browser's storage first, then pushed to GitHub a moment
// later. Pushes carry the file's last-known sha, so GitHub refuses them if another device
// saved in between; when that happens we fetch the newer file, merge, and push again.

import { mergeStates } from './merge.js';
import { guessCurrency } from './money.js';
import { normalize, parseState, seedState, serialize } from './store.js';

const API = 'https://api.github.com';
const CONFIG_KEY = 'budget:config';
const CACHE_KEY = 'budget:cache';

export class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // network | auth | forbidden | notfound | conflict | public | http
  }
}

export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function decodeBase64(base64) {
  const binary = atob(base64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function github({ owner, repo, path, token }, fetchImpl) {
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const file = `${base}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

  async function call(url, { method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        cache: 'no-store',
        headers: {
          Accept: accept,
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body && JSON.stringify(body),
      });
    } catch {
      throw new SyncError('network', "Can't reach GitHub. Check your internet connection.");
    }
    if (res.ok) return res;
    if (res.status === 401) throw new SyncError('auth', 'GitHub rejected the access token. It may have expired or been revoked.');
    if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) {
      throw new SyncError('http', 'GitHub is limiting requests right now. Trying again shortly.');
    }
    if (res.status === 403) throw new SyncError('forbidden', "The access token isn't allowed to change this repository. Give it Contents: Read and write access.");
    if (res.status === 404) throw new SyncError('notfound', 'Not found on GitHub.');
    if (res.status === 409 || res.status === 422) throw new SyncError('conflict', 'The file changed on GitHub.');
    throw new SyncError('http', `GitHub returned an error (${res.status}). Trying again shortly.`);
  }

  return {
    async repo() {
      return (await call(base)).json();
    },
    async read() {
      const meta = await (await call(file)).json();
      if (Array.isArray(meta) || meta.type !== 'file') throw new SyncError('http', `${path} in your repository is a folder, not a file.`);
      // Files over 1 MB come back without inline content, so fetch those raw.
      const text = meta.encoding === 'base64' ? decodeBase64(meta.content) : await (await call(file, { accept: 'application/vnd.github.raw+json' })).text();
      return { text, sha: meta.sha };
    },
    async write(text, sha, message) {
      const body = { message, content: encodeBase64(text) };
      if (sha) body.sha = sha;
      return (await (await call(file, { method: 'PUT', body })).json()).content.sha;
    },
  };
}

function readJson(storage, key) {
  try {
    return JSON.parse(storage.getItem(key));
  } catch {
    return null;
  }
}

export function createSync({
  store,
  storage = globalThis.localStorage,
  fetchImpl = (...args) => fetch(...args),
  timers = globalThis,
  online = () => navigator.onLine,
  debounceMs = 1500,
  retryMs = 30000,
}) {
  let config = readJson(storage, CONFIG_KEY);
  let sha = null;
  let dirty = false;
  let timer = null;
  let running = null;
  let again = false;
  let status = { state: 'idle', message: '', lastSynced: null };
  const listeners = new Set();

  const setStatus = (state, message = '') => {
    status = { ...status, state, message };
    listeners.forEach((fn) => fn(status));
  };
  const persist = () => {
    try {
      storage.setItem(CACHE_KEY, JSON.stringify({ state: store.get(), sha, dirty, lastSynced: status.lastSynced }));
    } catch {
      // Storage full or blocked: everything already pushed is still safe on GitHub.
    }
  };
  const schedule = (ms) => {
    timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      syncNow();
    }, ms);
  };

  store.subscribe((_, source) => {
    if (!config) return;
    if (source === 'local') {
      dirty = true;
      setStatus('pending');
      schedule(debounceMs);
    }
    persist();
  });

  // Returns the remote file, or null if it's missing or empty (then `sha` says how to recreate it).
  async function readRemote(gh) {
    try {
      const remote = await gh.read();
      if (remote.text.trim()) return remote;
      sha = remote.sha;
    } catch (err) {
      if (err.kind !== 'notfound') throw err;
      sha = null;
    }
    return null;
  }

  async function cycle() {
    const gh = github(config, fetchImpl);
    if (!dirty) {
      const version = store.version;
      const remote = await readRemote(gh);
      if (!remote) dirty = true; // The file was removed or emptied on GitHub: recreate it from this device.
      else if (remote.sha !== sha) {
        const incoming = parseState(remote.text);
        sha = remote.sha;
        // If something was edited here while we were downloading, merge instead of overwriting it.
        if (store.version === version && !dirty) store.replace(incoming, 'remote');
        else {
          store.replace(mergeStates(store.get(), incoming), 'merge');
          dirty = true;
        }
      }
    }
    let conflicts = 0;
    while (dirty) {
      const version = store.version;
      try {
        sha = await gh.write(serialize(store.get()), sha, 'Update budget');
        if (store.version === version) dirty = false; // Otherwise more edits arrived mid-upload: go again.
      } catch (err) {
        if (err.kind !== 'conflict' || ++conflicts > 3) throw err;
        const remote = await readRemote(gh);
        if (remote) {
          sha = remote.sha;
          store.replace(mergeStates(store.get(), parseState(remote.text)), 'merge');
        }
      }
    }
  }

  function syncNow() {
    if (!config) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    timers.clearTimeout(timer);
    timer = null;
    if (!online()) {
      setStatus('offline', dirty ? 'Your changes are saved on this device and will sync when you are back online.' : "You're offline.");
      schedule(retryMs);
      return Promise.resolve();
    }
    setStatus('syncing');
    running = (async () => {
      try {
        await cycle();
        status = { ...status, lastSynced: Date.now() };
        setStatus('synced');
      } catch (err) {
        const kind = err instanceof SyncError ? err.kind : 'data';
        const state = kind === 'network' ? 'offline' : kind === 'auth' || kind === 'forbidden' ? 'auth' : 'error';
        const message = kind === 'network' && dirty ? 'Your changes are saved on this device and will sync when GitHub can be reached.' : err.message;
        setStatus(state, message);
        if (state !== 'auth') schedule(retryMs);
      } finally {
        persist();
        running = null;
      }
      if (again) {
        again = false;
        await syncNow();
      }
    })();
    return running;
  }

  return {
    get configured() {
      return Boolean(config);
    },
    get config() {
      return config;
    },
    get status() {
      return status;
    },
    get dirty() {
      return dirty;
    },
    onStatus(fn) {
      listeners.add(fn);
      fn(status);
      return () => listeners.delete(fn);
    },

    // Shows the copy saved on this device straight away, then checks GitHub for anything newer.
    start() {
      const cache = readJson(storage, CACHE_KEY);
      if (cache?.state) {
        try {
          sha = cache.sha ?? null;
          dirty = Boolean(cache.dirty);
          status = { ...status, lastSynced: cache.lastSynced ?? null };
          store.replace(normalize(cache.state), 'cache');
        } catch {
          sha = null;
          dirty = false;
        }
      }
      return syncNow();
    },

    // First-time setup on a device: checks the repository, then loads (or creates) the budget file.
    async connect(cfg) {
      const gh = github(cfg, fetchImpl);
      let repo;
      try {
        repo = await gh.repo();
      } catch (err) {
        if (err.kind === 'notfound') {
          throw new SyncError('notfound', `Couldn't find ${cfg.owner}/${cfg.repo}. Check the names, and that the token was given access to this repository.`);
        }
        throw err;
      }
      if (!repo.private) {
        throw new SyncError('public', `${cfg.owner}/${cfg.repo} is public, so anyone could read your budget. Make it private on GitHub, then connect again.`);
      }
      let remote = null;
      try {
        remote = await gh.read();
      } catch (err) {
        if (err.kind !== 'notfound') throw err;
      }
      let state;
      let remoteSha = remote?.sha ?? null;
      if (remote?.text.trim()) state = parseState(remote.text);
      else {
        state = seedState(guessCurrency());
        try {
          remoteSha = await gh.write(serialize(state), remoteSha, 'Create budget');
        } catch (err) {
          if (err.kind === 'forbidden') {
            throw new SyncError('forbidden', `The token can read ${cfg.repo} but can't write to it. Edit the token and set Contents to "Read and write".`);
          }
          throw err;
        }
      }
      config = { ...cfg };
      storage.setItem(CONFIG_KEY, JSON.stringify(config));
      sha = remoteSha;
      dirty = false;
      status = { ...status, lastSynced: Date.now() };
      store.replace(state, 'remote');
      setStatus('synced');
      return state;
    },

    updateToken(token) {
      config = { ...config, token };
      storage.setItem(CONFIG_KEY, JSON.stringify(config));
      return syncNow();
    },

    // Forgets the token and the local copy. The data on GitHub is untouched.
    disconnect() {
      timers.clearTimeout(timer);
      storage.removeItem(CONFIG_KEY);
      storage.removeItem(CACHE_KEY);
      config = null;
      sha = null;
      dirty = false;
    },

    syncNow,
  };
}
