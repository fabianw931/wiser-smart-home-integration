---
version: 1
slug: "src-app-svelte"
primary_target: "src/App.svelte"
related_targets: []
---

# Surface brief: Home dashboard (all views)

Scope and mode: Operate. Whole app shell (Home, Sensors & buttons, Settings), phone + desktop, touch-friendly.

Audience / job / task: one household member glancing at state and switching rooms; rare setup.

## Direction contract
seed: seed:87713e0228845be5 (assigned index 5; built from my own grounded candidate "Raumbuch / Swiss room schedule"; labanotation challenger judged competitive and contributed level-as-fill encoding)

THESIS: A home read like a room schedule: state first, the room as the unit of action, level drawn as fill. Refuses the card-per-device grid with number fields and Set-target buttons.
OWN-WORLD: cool paper ground, ink, hairline rules, one workhorse sans with tabular numerals; lamp amber means lit, slate blue means shade lowered, red only for faults; 8px radius, no shadows; light and dark both first-class.
STORY: At a glance: what is on, what is open, is the weather a problem. One tap: room lights off, blinds open (confirmed), dim, pin. Setup and diagnostics live in Settings.
FIRST VIEWPORT: Sticky top bar (brand, Home / Sensors / Settings, Live status; bottom tab bar on phone). Under it a status line (3 of 7 lights on, 2 blinds closed), home quick actions, weather chips, floor segmented control, then room rows.
FORM: Room schedule: each room is a titled block with a level-strip glyph per device and compact device rows beneath; floors group rooms.
SIGNATURE: Level strips: a row of small glyphs per room (amber fill = light level, slate fill from the top = blind closed share) readable without opening the room.
UNRESOLVED: real gateway room data unverified.
