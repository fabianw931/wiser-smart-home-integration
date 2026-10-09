---
title: Dashboard implementation handoff
aliases:
  - Current development handoff
tags:
  - wiser
  - dashboard
  - handoff
type: handoff
status: software-tested-hardware-untested
---

# Dashboard implementation handoff

The current milestone extends the Svelte dashboard with personal configuration and a refreshed interface. The user's intended distinction is **local configuration with normal real device control**, not a simulated-control mode.

## Delivered

- Opt-in localhost machine API for Home Assistant: bearer authentication, personal-label snapshots, native target commands with separate control enablement, scope/identity preflight, and secret redaction. HA starter package includes an inventory sensor and guarded script, not automatic light/cover discovery. See [Home Assistant guide](home-assistant.md); not deployed or HA-runtime-tested.

- Dashboard room groups (personal room overrides gateway room), optional type/flat grouping, and per-device **Edit details** for local names, rooms, and notes without opening Configuration. Failed edits retain input; cancel makes no changes. See [feature ideas](feature-backlog.md) for the next priorities.

- Room-oriented Home, Configuration, and Diagnostics pages, search, room filtering, responsive teal/cream design, and accessible form labels.
- System/light/dark appearance selector, browser-local preference persistence, live system-theme updates, refined stat tiles, device icons and reported-on highlights, filter counts/reset, and larger touch targets. Appearance does not change device behavior.
- On/off, dimming, blind position, DALI brightness, tunable white, and RGBW controls. Connected controls send real commands immediately; there is no enable-live switch.
- Brightness and blind inputs use percentages with 0.01% precision, translated to integer API values 0–10000. Separate RGBW inputs preserve unrelated channels.
- Personal names, custom room labels, and notes saved in SQLite (`data/wiser.sqlite`), with validated JSON export/import. Mappings persist through browser/server restarts and gateway reconnects; old browser entries migrate automatically without replacing existing database entries.
- Local mappings use gateway address and physical load identity. Installer metadata changes do not replace personal labels. Stale identities remain stored but are not applied to the UI.
- Separate gateway metadata editor for names and existing-room assignments. Explicit review and confirmation, expected-value and identity checks, and stale-session protection.
- Offline sample home with simulated controls, clearly separated from actual gateway data.
- Sequential core refresh, independent background diagnostics, and 30-second polling. Missing or invalid readings disable the affected controls.
- Credentials held only in server memory; browser forms clear tokens. Localhost binding, Host/Origin checks, fixed endpoints, redaction, cancellation handling, and session-scoped writes remain in place.

## Run

Use Node.js 22.13+ (or the included Nix shell), then run:

~~~sh
npm install
npm start
~~~

Open http://127.0.0.1:3000. Use **Explore sample home** for a disconnected demonstration, or connect to the actual gateway. Read [personal mappings](local-mappings.md) for storage and configuration behavior.

## Verification

- Svelte checks: zero errors and warnings.
- Production build: passed.
- Node tests: 44 passed (37 backend, 3 SQLite, 4 mapping tests).
- Browser tests: 21 passed using installed Chrome and a simulated gateway, including dashboard grouping/editing, migration, persistence, failed-save recovery, theme switching, storage failures, and dark desktop/mobile workflows.
- Screenshots: desktop and 375px mobile layouts generated and reviewed.
- Physical gateway: not tested.

Tests use loopback fake gateways only. They cover DALI, explicit target acceptance versus reported state, local-only saving, persistence through reconnect, export/import without credentials, separate gateway metadata application, conflict handling, stale sessions, and configuration/discovery races.

## Next milestones

1. Validate the current controls against redacted data and safe light operations on the installed firmware.
2. Cache installation inventory in SQLite so personal mappings can be edited while disconnected.
3. Add backend WebSocket state updates with reconnect snapshots and polling fallback.
4. Add scene/job/timer workflows with verified account ownership and existing-app compatibility.
5. Add device/DALI configuration editors after confirming firmware-specific contracts and installer readiness.
6. Design authenticated household hosting and durable credential management before exposing the service beyond localhost.

## Limits

- Local unauthenticated service and one shared gateway session; use one tab. Session scopes prevent old tabs from writing to a replaced connection but are not user authentication.
- Gateway HTTP is unencrypted. Hostnames are syntactically validated, not DNS-pinned.
- Personal mappings are gateway-address-specific and stored on the server computer. IP and hostname aliases remain separate. Back up SQLite or export JSON before moving installations.
- Metadata preflight is best-effort, not an atomic gateway transaction.
- No commissioning, DALI group setup, stop/tilt, HVAC writes, scene execution, or physical hardware validation yet.
- Disconnect cannot undo an already sent command or revoke a gateway account.

Earlier checkpoints remain in Git history and [restart-handoff.md](restart-handoff.md).
