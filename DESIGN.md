# Design

Recorded from the built interface (`src/style.css`, `src/components/`). Surface strategy lives in `.impeccable/surfaces/`.

## World

A room schedule for a home: state first, the room as the unit of action, level drawn as fill. Operate mode, restrained palette, hairline rules, no shadows on content. Light and dark are both first-class and follow the system unless the user chooses; Gruvbox and Catppuccin are optional colour themes on the same roles.

## Color

| Role | Light | Dark | Meaning |
| --- | --- | --- | --- |
| paper / surface / raised | #eceff0 / #fafbfb / #ffffff | #111416 / #1a1e21 / #21272b | page, panels, inputs |
| ink / muted / rule | #15191c / #525d63 / #cfd5d8 | #e9ecee / #a2adb3 / #323b41 | text, secondary text, hairlines |
| accent | #1f4e79 | #8fbbe3 | actions, selection, focus |
| lit | #f2b632 | #f0b83a | a light is on (fill, icon tile, glyph) |
| shade | #5d7d98 | #7f9db6 | a blind is lowered (fill from the top) |
| warn | #fff0cf bg / #5e4100 ink | #3a2f17 / #f0cf8a | stale readings, alerts, confirmations |
| err | #a8231b | #f4a79f | faults only |

### Custom themes

Appearance offers System (resolves to Light or Dark), Light, Dark, Gruvbox (Light, Dark) and Catppuccin (Latte, Frappé, Macchiato, Mocha). Each is a complete `[data-theme]` block in `src/style.css` with every token above plus the daisyUI colour variables, so no default leaks through; the choices are listed in `src/themes.js`. `test/theme.test.js` reads those blocks and enforces contrast: ink and muted 4.5:1 on paper, surface and raised; accent text and accent-ink on accent 4.5:1; lit-ink on lit, warn-ink on warn-bg and err on err-bg 4.5:1; control borders (`--field`) 3:1 on surface and raised; lit-strong, shade and ok 3:1 on surface.

| Theme | paper / surface / raised | accent | lit | shade | Notes |
| --- | --- | --- | --- | --- | --- |
| Gruvbox Light | #ebdbb2 / #f2e5bc / #fbf1c7 | #076678 (faded blue) | #d79921 | #458588 | lit-strong #9a6a0f and warn-ink #6b4500 are darkened yellows; success text colour is white |
| Gruvbox Dark | #1d2021 / #282828 / #32302f | #83a598 (blue) | #fabd2f | #458588 | err is #fe5c4a, a slightly lighter red than #fb4934, to reach 4.5:1 on surface |
| Catppuccin Latte | #dce0e8 / #e6e9ef / #eff1f5 | #1a57d0 (darkened blue) | #df8e1d | #7c7f93 (overlay2) | accent and err (#c10e34) are darkened to reach 4.5:1; lit-strong #a35d00 and warn-ink #6b4100 are darkened yellows |
| Catppuccin Frappé | #292c3c / #303446 / #414559 | #babbf1 (lavender) | #e5c890 | #838ba7 | lavender instead of blue so accent text holds 4.5:1 on raised |
| Catppuccin Macchiato | #1e2030 / #24273a / #363a4f | #8aadf4 (blue) | #eed49f | #8087a2 | official values |
| Catppuccin Mocha | #181825 / #1e1e2e / #313244 | #89b4fa (blue) | #f9e2af | #7f849c | official values |

Surfaces, text, borders and the accent, yellow, overlay and red roles use the published Gruvbox and Catppuccin hex values. Tinted backgrounds (`--warn-bg`, `--err-bg`, `--disabled`) are mixes of the palette's own colours, and the deviations listed above are deliberate contrast fixes.

Amber and slate are state colours, never decoration. The pinned star uses a darker amber stroke (`--lit-strong`) so it holds 3:1 on light surfaces.

## Type

One system sans stack (`system-ui`, Segoe UI, Roboto). Fixed scale, no fluid sizes: 13 small, 14 secondary, 15–16 body, 17 room title, 18–22 headings (700, -0.01 to -0.02em). Numerals are tabular wherever values change (`.tabular`).

## Shape and space

8px radius on controls, 12px on panels and rooms. Panels use a 1px rule, never a shadow. Only toasts and dialogs lift. 44px minimum height for every button, input, switch hit area and summary; sliders are 24px and rely on a 44px row.

## Signature

Level strips: one small vertical glyph per light or blind in each room header. Amber fill from the bottom is light level; slate fill from the top is how closed a blind is; hollow is off or open; dashed is no valid reading. Purely visual and `aria-hidden`; the text line beside it carries the meaning.

## Components

- Top bar with Home / Sensors & buttons / Settings; becomes a bottom tab bar under 720px.
- Segmented controls (`.segments`) for floors, sensor views, sign-in method.
- Room block: header button (expand), pin, quick actions, then device rows in a responsive grid.
- Device row: icon tile, name, status text, switch; slider (+ Open/Close for blinds); a "More" disclosure for exact entry, DALI channels, rename, raw data.
- Blind quick actions confirm inline (a warning-coloured button replaces the action), never in a modal.
- Messages: a stale banner at the top, toasts for command results and errors.
- Native `<dialog>` only for protected edits (personal details, gateway metadata review).

Class names that collide with daisyUI components (`.status`, `.toast`) are not used.
