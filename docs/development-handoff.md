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

- Room-oriented Home, Configuration, and Diagnostics pages, search, room filtering, responsive teal/cream design, and accessible form labels.
- On/off, dimming, blind position, DALI brightness, tunable white, and RGBW controls. Connected controls send real commands immediately; there is no enable-live switch.
- Brightness and blind inputs use percentages with 0.01% precision, translated to integer API values 0–10000. Separate RGBW inputs preserve unrelated channels.
- Personal names, custom room labels, and notes saved in localStorage, with validated JSON export/import. Mappings persist through browser restarts and gateway reconnects.
- Local mappings use gateway address and physical load identity. Installer metadata changes do not replace personal labels. Stale identities remain stored but are not applied to the UI.
- Separate gateway metadata editor for names and existing-room assignments. Explicit review and confirmation, expected-value and identity checks, and stale-session protection.
- Offline sample home with simulated controls, clearly separated from actual gateway data.
- Sequential core refresh, independent background diagnostics, and 30-second polling. Missing or invalid readings disable the affected controls.
- Credentials held only in server memory; browser forms clear tokens. Localhost binding, Host/Origin checks, fixed endpoints, redaction, cancellation handling, and session-scoped writes remain in place.

## Run

Use Node.js 22.12+ (or the included Nix shell), then run:

~~~sh
npm install
npm start
~~~

Open http://127.0.0.1:3000. Use **Explore sample home** for a disconnected demonstration, or connect to the actual gateway. Read [personal mappings](local-mappings.md) for storage and configuration behavior.

## Verification

- Svelte checks: zero errors and warnings.
- Production build: passed.
- Node tests: 32 passed (28 backend, 4 mapping tests).
- Browser tests: 13 passed using installed Chrome and a simulated gateway.
- Screenshots: desktop and 375px mobile layouts generated and reviewed.
- Physical gateway: not tested.

Tests use loopback fake gateways only. They cover DALI, explicit target acceptance versus reported state, local-only saving, persistence through reconnect, export/import without credentials, separate gateway metadata application, conflict handling, stale sessions, and configuration/discovery races.

## Next milestones

1. Validate the current controls against redacted data and safe light operations on the installed firmware.
2. Add backend WebSocket state updates with reconnect snapshots and polling fallback.
3. Add scene/job/timer workflows with verified account ownership and existing-app compatibility.
4. Add device/DALI configuration editors after confirming firmware-specific contracts and installer readiness.
5. Design authenticated household hosting and durable credential management before exposing the service beyond localhost.

## Limits

- Local unauthenticated service and one shared gateway session; use one tab. Session scopes prevent old tabs from writing to a replaced connection but are not user authentication.
- Gateway HTTP is unencrypted. Hostnames are syntactically validated, not DNS-pinned.
- Personal mappings are browser-origin/address-specific; export before changing ports, hostname, or browser profile.
- Metadata preflight is best-effort, not an atomic gateway transaction.
- No commissioning, DALI group setup, stop/tilt, HVAC writes, scene execution, or physical hardware validation yet.
- Disconnect cannot undo an already sent command or revoke a gateway account.

Earlier checkpoints remain in Git history and [restart-handoff.md](restart-handoff.md).
