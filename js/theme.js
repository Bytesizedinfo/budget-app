// Light/dark preference for this device only ("system" follows the OS setting).

const KEY = 'budget:theme';

export function readTheme() {
  try {
    return localStorage.getItem(KEY) || 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Not remembered in private browsing; still applied for this visit.
  }
  applyTheme(theme);
}
