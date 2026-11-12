// Light/dark preference for this device only ("system" follows the OS setting).

const KEY = 'budget:theme';
const COLORS = { light: '#f6f6f3', dark: '#0d0d0d' };
const deviceDark = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

export function readTheme() {
  try {
    return localStorage.getItem(KEY) || 'system';
  } catch {
    return 'system';
  }
}

export const isDark = () => {
  const theme = readTheme();
  return theme === 'dark' || (theme === 'system' && deviceDark.matches);
};

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  // Keep the phone's status bar in step with the page.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const forDark = theme === 'dark' || (theme === 'system' && meta.media.includes('dark'));
    meta.content = forDark ? COLORS.dark : COLORS.light;
  }
  listeners.forEach((fn) => fn());
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Not remembered in private browsing; still applied for this visit.
  }
  applyTheme(theme);
}

export function onThemeChange(fn) {
  listeners.add(fn);
  deviceDark.addEventListener('change', fn);
}
