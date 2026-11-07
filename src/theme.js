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
