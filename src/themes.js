// Appearance choices. Every id except "system" has a matching [data-theme] block in style.css.
export const THEME_GROUPS = [
  { label: 'Default', themes: [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ] },
  { label: 'Gruvbox', themes: [
    { id: 'gruvbox-light', label: 'Gruvbox Light' },
    { id: 'gruvbox-dark', label: 'Gruvbox Dark' },
  ] },
  { label: 'Catppuccin', themes: [
    { id: 'catppuccin-latte', label: 'Latte (light)' },
    { id: 'catppuccin-frappe', label: 'Frappé' },
    { id: 'catppuccin-macchiato', label: 'Macchiato' },
    { id: 'catppuccin-mocha', label: 'Mocha (dark)' },
  ] },
];

export const THEME_IDS = THEME_GROUPS.flatMap(group => group.themes.map(theme => theme.id));
