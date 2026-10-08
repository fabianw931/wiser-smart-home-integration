---
title: Wiser smart home integration
aliases:
  - Wiser research
tags:
  - wiser
  - research
type: project-index
status: functional-poc-hardware-untested
---

# Wiser smart home integration

Research into **Wiser by Feller** products and the local API available to discover, read, and control their entities.

**Main finding:** Feller provides a documented local REST API and a WebSocket interface through the installation's WLAN-enabled µGateway. Lights and blinds are represented as *loads*. Newer gateways also expose heating, sensors, and weather-related resources.

This repository contains research documentation and a working **Svelte + Vite** local dashboard styled with **Tailwind + daisyUI**. A small Node backend talks to the gateway. Browser workflows are tested against a simulated gateway; no physical gateway has been tested.

## Run the local web POC

Requires **Node.js 22.13 or newer** and a modern browser. On NixOS, enter `nix-shell` in the repository to get Node and npm using the included `shell.nix`.

```sh
npm install
npm start
```

`npm start` builds the frontend into `dist/` and starts the local server. Open **http://127.0.0.1:3000**. To choose another local port, run `PORT=3001 npm start` (POSIX shell). The server binds only to `127.0.0.1`; the frontend and API share one origin. CSS is built locally, with no runtime CDN dependency. After building, `node server.js` starts the server without rebuilding.

1. Enter your commissioned gateway's IP or hostname and connect with an existing token, or explicitly pair a new account by pressing the gateway button when prompted.
2. Use Home to control lights and blinds normally. Brightness and blind-position inputs use 0–100% with 0.01% precision. DALI tunable-white and RGBW controls appear for the appropriate load subtype.
3. In **Configuration**, save your personal names, custom room labels, and notes. These are stored in the local `data/wiser.sqlite` database and are never sent to the gateway. Device controls keep working. **Export mappings** downloads a portable JSON backup; **Import mappings** restores missing entries. See [personal mappings](docs/local-mappings.md).
4. Actual gateway name/room changes are available separately under **Change gateway metadata…**. Review the changes and confirm **Apply this change to gateway**. Personal mappings are never applied automatically. Installer settings and device commissioning are not touched.
5. Use **Explore sample home** for a clearly labeled offline demonstration. Its controls simulate fictional devices.
6. **Diagnostics** shows optional read-only resources. Core state polling runs 30 seconds after requests finish; slow diagnostics do not block controls.
7. **Disconnect & forget credentials** clears the server session. Closing the browser alone does not clear its gateway token.

### Appearance

Use **Appearance** in the sidebar to choose **System**, **Light**, or **Dark**. System follows your operating system automatically; an explicit choice is remembered in this browser. This preference is separate from SQLite personal mappings and never affects gateway controls.

### Safety and limitations

- **This is a local unauthenticated app controlling real equipment.** Anyone or any program with access to this local service can use its current gateway session. All tabs share one in-memory connection; use one tab. Do not expose, reverse-proxy, forward, or tunnel its port. It is not a multi-user service or a production home-automation controller.
- Gateway HTTP traffic, including bearer tokens, is **unencrypted**. Use a trusted computer and LAN. Host/Origin checks, no CORS, a required custom API header, and a restrictive content security policy reduce hostile-webpage access; they are not authentication against local software.
- Gateway credentials stay in server memory, never in browser storage or exported mappings. Existing-token inputs are cleared immediately after submission. Personal names, room labels, and notes are saved in SQLite on the computer running the server; browser storage is migrated automatically. Back up the database or export mappings. Writes require the current session scope, so stale tabs cannot operate a replacement connection.
- Disconnect forgets credentials but does not delete the account from the gateway or revoke an existing token. Pairing again creates another account. Cancelled pairing might still have created a gateway account. A target already sent cannot be undone by disconnecting.
- Only fixed read endpoints (`info`, `loads`, `loads/state`, `rooms`, `devices`, `sensors`, `hvacgroups`, `hvacgroups/state`), account claim, validated targets, and validated name/room updates for discovered loads are proxied. There is no generic URL proxy. No job execution, identification, commissioning, calibration, or other potentially side-effecting GET discovery is performed.
- Gateway host validation allows IP addresses and DNS hostnames, not arbitrary URLs/ports/paths. It does not enforce a private-address subnet or pin hostname resolution; only enter a gateway you trust, preferably its known IP address. Redirects are not followed.
- Optional resources vary by firmware and may show **unsupported** or an error. Read-only JSON preserves gateway fields without inventing sensor units or HVAC behavior. A write acknowledgement is not physical-state confirmation; the page refreshes reported state after writes. Sample data is displayed only in the explicitly selected sample home.
- No WebSocket subscription, automatic token persistence, cloud access, account management, full device/DALI group configuration, advanced installer settings, scenes, or hardware integration test is included. Personal configuration supports names, custom room labels, and notes; actual gateway configuration supports names and existing-room assignments. Limited DALI color and tunable-white target controls are available for recognized load subtypes. Polling and real equipment behavior still require validation on your installation.

### Tests

```sh
npm run check
npm test
```

`npm test` builds the frontend and runs the Node regression suite (backend tests using a loopback fake gateway, SQLite persistence tests, and personal-mapping tests). They cover validation, discovery and write allowlisting, credential redaction, unsupported resources, timeouts, redirects, cancellation races, and local mapping handling. `npm run check` checks the Svelte components. See the [handoff](docs/development-handoff.md) for browser-suite status.

To run the browser tests, point Playwright at an existing Chrome/Chromium executable:

```sh
# POSIX example; replace the path for your machine.
CHROME_BIN=/run/current-system/sw/bin/google-chrome npm run test:e2e
```

In PowerShell, set `$env:CHROME_BIN = 'C:\path\to\chrome.exe'`, then run `npm run test:e2e`. If Playwright's Chromium is already installed, omit `CHROME_BIN`.

Browser tests cover the local app against a loopback-only fake gateway and never contact a real installation. Test traces/screenshots contain synthetic data and are ignored by Git. The [handoff](docs/development-handoff.md) records current verification and remaining work.

### Code layout

- `src/App.svelte`: connection lifecycle, resource refresh, polling, and command feedback.
- `src/components/`: connection form, load cards, personal configuration, and read-only resource panels.
- `src/api.js`: same-origin API calls, timeouts, and cancellation.
- `src/mappings.js`: personal mapping validation, legacy browser migration helpers, and JSON import/export.
- `storage.js`: versioned SQLite personal mapping store; defaults to `data/wiser.sqlite`, configurable with `WISER_DB_PATH`.
- `server.js`: localhost HTTP server, gateway session, validation, and narrowly scoped proxy.
- `test/`: backend regressions; `e2e/`: browser tests and fake gateway.
- `dist/`: generated assets; `package-lock.json`: pinned dependency resolution.

See the [completed-work handoff](docs/development-handoff.md) for verification and next-session work.

## Start here

Open [the documentation index](docs/index.md).

```text
README.md
docs/                       ← Open this directory as an Obsidian vault
  index.md                  ← Reading guide and research summary
  products.md               ← Product families and gateway generations
  api-overview.md            ← Local access, versions, authentication, events
  entity-model.md            ← Resource-to-entity mapping and endpoint reference
  getting-started.md         ← Practical discovery and control examples
  dashboard.md               ← Dashboard operation and safety
  local-mappings.md         ← Personal labels, laptop storage, and gateway changes
  ui-concepts.html           ← Static visual directions for the dashboard
  development-handoff.md     ← Delivered work, verification, and next steps
  restart-handoff.md         ← Historical checkpoint before the migration
  integration-options.md    ← Existing integrations and implementation direction
  sources.md                ← Sources, confidence, and outstanding questions
```

## Using the documentation in Obsidian

In Obsidian, choose **Open folder as vault** and select `docs/`. Start with `index.md`.

Every note has YAML frontmatter with a title, aliases, tags, type, and status. Links use standard relative Markdown paths, so they work in Obsidian and repository viewers without plugins. No `.obsidian/` configuration is required or checked in.
