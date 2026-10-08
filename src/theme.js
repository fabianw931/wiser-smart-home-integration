const THEME_KEY = 'wiser-appearance';
export const validTheme = value => ['system', 'light', 'dark'].includes(value);

export function readTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return validTheme(saved) ? saved : 'system';
  } catch { return 'system'; }
}

export function applyTheme(preference) {
  const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function saveTheme(preference) {
  applyTheme(preference);
  try { localStorage.setItem(THEME_KEY, preference); return true; }
  catch { return false; }
}

export { THEME_KEY };
