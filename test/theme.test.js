import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEME_IDS, THEME_GROUPS } from '../src/themes.js';
import { validTheme, resolveTheme } from '../src/theme.js';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

const TOKENS = ['paper', 'surface', 'raised', 'ink', 'muted', 'rule', 'field', 'accent', 'accent-hover', 'accent-ink',
  'lit', 'lit-ink', 'lit-strong', 'shade', 'warn-bg', 'warn-ink', 'warn-rule', 'err', 'err-bg', 'ok',
  'disabled', 'disabled-ink', 'scrim'];
const DAISY = ['primary', 'secondary', 'accent', 'neutral', 'info', 'success', 'warning', 'error']
  .flatMap(name => [`color-${name}`, `color-${name}-content`])
  .concat(['color-base-100', 'color-base-200', 'color-base-300', 'color-base-content']);
const BUILT_IN = { light: 'light', dark: 'dark' };
const SCHEMES = {
  light: 'light', dark: 'dark', 'gruvbox-light': 'light', 'gruvbox-dark': 'dark',
  'catppuccin-latte': 'light', 'catppuccin-frappe': 'dark', 'catppuccin-macchiato': 'dark', 'catppuccin-mocha': 'dark',
};

// One source of truth: the token blocks in style.css. Declarations later in the file win, as in the cascade.
function parseThemes() {
  const themes = {};
  for (const [, selector, body] of css.matchAll(/(^[^{}@\n][^{}]*)\{([^{}]*)\}/gm)) {
    const ids = [...selector.matchAll(/\[data-theme="([^"]+)"\]/g)].map(match => match[1]);
    for (const id of ids) {
      themes[id] ??= {};
      for (const [, name, value] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) themes[id][name] = value.trim();
      const scheme = body.match(/color-scheme\s*:\s*(\w+)/);
      if (scheme) themes[id]['color-scheme'] = scheme[1];
    }
  }
  return themes;
}
const themes = parseThemes();

function resolve(id, name, depth = 0) {
  assert.ok(depth < 8, `${id}: --${name} reference loop`);
  const value = themes[id][name] ?? (id === 'dark' ? themes.light[name] : undefined);
  assert.ok(value, `${id}: --${name} is not defined`);
  const reference = value.match(/^var\(--([\w-]+)\)$/);
  return reference ? resolve(id, reference[1], depth + 1) : value;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('validTheme accepts system and every published theme, and rejects anything else', () => {
  for (const id of ['system', 'light', 'dark', 'gruvbox-light', 'gruvbox-dark', 'catppuccin-latte', 'catppuccin-frappe', 'catppuccin-macchiato', 'catppuccin-mocha']) {
    assert.equal(validTheme(id), true, id);
  }
  for (const value of [null, undefined, '', 'Dark', 'LIGHT', 'gruvbox', 'catppuccin', 'solarized-dark', ' system', 'constructor', '__proto__', 1, {}, []]) {
    assert.equal(validTheme(value), false, String(value));
  }
});

test('the picker groups list each preference exactly once with a readable label', () => {
  assert.deepEqual(THEME_GROUPS.map(group => group.label), ['Default', 'Gruvbox', 'Catppuccin']);
  assert.equal(new Set(THEME_IDS).size, THEME_IDS.length);
  assert.equal(THEME_IDS.length, 9);
  for (const { id, label } of THEME_GROUPS.flatMap(group => group.themes)) assert.match(label, /^\S.*\S$|^\S$/, id);
});

test('system resolves to light or dark only; explicit themes resolve to themselves', () => {
  const original = globalThis.matchMedia;
  try {
    globalThis.matchMedia = () => ({ matches: true });
    assert.equal(resolveTheme('system'), 'dark');
    globalThis.matchMedia = () => ({ matches: false });
    assert.equal(resolveTheme('system'), 'light');
    for (const id of THEME_IDS.filter(id => id !== 'system')) assert.equal(resolveTheme(id), id);
  } finally { globalThis.matchMedia = original; }
});

test('every selectable theme has a complete token block in style.css with the right color-scheme', () => {
  for (const id of THEME_IDS.filter(id => id !== 'system')) {
    assert.ok(themes[id], `${id} has no [data-theme] block`);
    assert.equal(themes[id]['color-scheme'], SCHEMES[id], `${id} color-scheme`);
    for (const token of TOKENS) assert.ok(resolve(id, token), `${id} --${token}`);
    if (!BUILT_IN[id]) {
      // Custom themes define every daisyUI colour themselves so no default leaks through.
      for (const token of DAISY) assert.ok(themes[id][token], `${id} --${token} must be set by the theme block`);
    }
  }
  const declared = Object.keys(themes);
  for (const id of declared) assert.ok(THEME_IDS.includes(id), `style.css defines ${id}, which the picker does not offer`);
});

const checks = [
  ['ink on paper', 'ink', 'paper', 4.5], ['ink on surface', 'ink', 'surface', 4.5], ['ink on raised', 'ink', 'raised', 4.5],
  ['muted on paper', 'muted', 'paper', 4.5], ['muted on surface', 'muted', 'surface', 4.5], ['muted on raised', 'muted', 'raised', 4.5],
  ['accent on paper', 'accent', 'paper', 4.5], ['accent on surface', 'accent', 'surface', 4.5], ['accent on raised', 'accent', 'raised', 4.5],
  ['accent-ink on accent', 'accent-ink', 'accent', 4.5], ['accent-ink on accent-hover', 'accent-ink', 'accent-hover', 4.5],
  ['lit-ink on lit', 'lit-ink', 'lit', 4.5], ['warn-ink on warn-bg', 'warn-ink', 'warn-bg', 4.5],
  ['err on err-bg', 'err', 'err-bg', 4.5], ['err on surface', 'err', 'surface', 4.5],
  ['field on raised', 'field', 'raised', 3], ['field on surface', 'field', 'surface', 3],
  ['lit-strong on surface', 'lit-strong', 'surface', 3], ['shade on surface', 'shade', 'surface', 3], ['ok on surface', 'ok', 'surface', 3],
];
const daisyPairs = ['primary', 'secondary', 'accent', 'neutral', 'info', 'success', 'warning', 'error']
  .map(name => [`daisy ${name}-content on ${name}`, `color-${name}-content`, `color-${name}`, 4.5]);

for (const id of THEME_IDS.filter(id => id !== 'system')) {
  test(`${id} meets contrast targets`, () => {
    const rows = [];
    const failures = [];
    for (const [label, fg, bg, min] of [...checks, ...(BUILT_IN[id] ? [] : daisyPairs)]) {
      const value = ratio(resolve(id, fg), resolve(id, bg));
      rows.push(`${label} ${value.toFixed(2)}`);
      if (value < min) failures.push(`${label}: ${value.toFixed(2)} < ${min}`);
    }
    if (process.env.THEME_TABLE) console.log(`${id}\n  ${rows.join('\n  ')}`);
    assert.deepEqual(failures, []);
  });
}
