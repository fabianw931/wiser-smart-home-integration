import { THEME_IDS } from './themes.js';

const THEME_KEY = 'wiser-appearance';
export const validTheme = value => THEME_IDS.includes(value);

export function readTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return validTheme(saved) ? saved : 'system';
  } catch { return 'system'; }
}

// "system" resolves to light or dark; every other preference is its own data-theme.
export function resolveTheme(preference) {
  if (preference !== 'system') return preference;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(preference) {
  document.documentElement.dataset.theme = resolveTheme(preference);
}

export function saveTheme(preference) {
  applyTheme(preference);
  try { localStorage.setItem(THEME_KEY, preference); return true; }
  catch { return false; }
}

// Keeps the page theme current for the whole app, independent of the settings screen.
export function watchTheme() {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const update = () => applyTheme(readTheme());
  const sync = event => { if (event.key === THEME_KEY || event.key === null) update(); };
  media.addEventListener('change', update);
  window.addEventListener('storage', sync);
  update();
  return () => { media.removeEventListener('change', update); window.removeEventListener('storage', sync); };
}

export { THEME_KEY };
