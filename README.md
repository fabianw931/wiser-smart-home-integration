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

Requires **Node.js 22.12 or newer** and a modern browser. On NixOS, enter `nix-shell` in the repository to get Node and npm using the included `shell.nix`.

```sh
npm install
npm start
```

`npm start` builds the frontend into `dist/` and starts the local server. Open **http://127.0.0.1:3000**. To choose another local port, run `PORT=3001 npm start` (POSIX shell). The server binds only to `127.0.0.1`; the frontend and API share one origin. CSS is built locally, with no runtime CDN dependency. After building, `node server.js` starts the server without rebuilding.

1. Enter your commissioned Wiser by Feller gateway's IP address or hostname, without a URL scheme, port, or path. The gateway must be reachable over HTTP port 80.
2. Either supply an existing bearer token and click **Connect**, or select **Pair new client**, click **Start pairing**, and press a flashing physical gateway button within approximately **30 seconds**. Pairing sends `POST /api/account/claim` with a generated unique `local-poc-<UUID>` username. The backend allows up to 45 seconds for the claim response.
3. Inspect discovered loads and their reported states before operating equipment. On/off lights support off/on; dimmers and recognized DALI loads support integer brightness **0–10000**. DALI `tw` loads also support `ct` **1000–20000**; `rgb` loads support separate red, green, blue, and white targets **0–255**. Each form sends only its own field. Missing or invalid brightness/position readings disable that load's controls.
4. Blinds support integer target **level 0–10000**, explicitly labeled **0 = open, 10000 = closed**, following the [official load tutorial](https://github.com/Feller-AG/wiser-tutorial/blob/main/doc/api_loads.md). Verify installation orientation and keep the path clear. Tilt, button simulation, stop, calibration, and HVAC writes are deliberately omitted. Tilt is a count of motor tilt commands, not an angle or percentage; a motor button click can stop movement or tilt when idle, so this POC does not present it as an unconditional stop.
5. Use **Refresh now** or leave the page open for polling, scheduled 30 seconds after each completed core refresh. Core load definitions and states refresh sequentially. Six optional diagnostic resources load in a separate sequential background pass that may overlap core refresh; their failures are shown separately. Load commands do not trigger diagnostic reads. Unknown/unused load subtypes and rooms, devices, sensors, and HVAC groups/states are read-only.
6. Click **Disconnect & forget credentials** when finished, or stop the Node process with Ctrl+C. Closing the browser alone does **not** clear the server session.

### Safety and limitations

- **This is a local unauthenticated app controlling real equipment.** Anyone or any program with access to this local service can use its current gateway session. All tabs share one in-memory connection; use one tab. Do not expose, reverse-proxy, forward, or tunnel its port. It is not a multi-user service or a production home-automation controller.
- Gateway HTTP traffic, including bearer tokens, is **unencrypted**. Use a trusted computer and LAN. Host/Origin checks, no CORS, a required custom API header, and a restrictive content security policy reduce hostile-webpage access; they are not authentication against local software.
- Credentials live only in server memory. The app never writes them to disk, logs them, returns pairing secrets to the browser, or uses cookies/localStorage/sessionStorage. An existing token necessarily passes through the password input and request memory and is cleared from the input immediately. Browser/password-manager behavior and developer tools are outside the app's control; do not save or share credentials there.
- Disconnect forgets credentials but does not delete the account from the gateway or revoke an existing token. Pairing again creates another account. Cancelled pairing might still have created a gateway account. A target already sent cannot be undone by disconnecting.
- Only fixed read endpoints (`info`, `loads`, `loads/state`, `rooms`, `devices`, `sensors`, `hvacgroups`, `hvacgroups/state`), account claim, and validated targets for discovered loads are proxied. There is no generic URL proxy. No job execution, identification, commissioning, calibration, or other potentially side-effecting GET discovery is performed.
- Gateway host validation allows IP addresses and DNS hostnames, not arbitrary URLs/ports/paths. It does not enforce a private-address subnet or pin hostname resolution; only enter a gateway you trust, preferably its known IP address. Redirects are not followed.
- Optional resources vary by firmware and may show **unsupported** or an error. Read-only JSON preserves gateway fields without inventing sensor units or HVAC behavior. A write acknowledgement is not physical-state confirmation; the page refreshes reported state after writes. No fabricated demo data is displayed.
- No WebSocket subscription, automatic token persistence, cloud access, account management, full device/DALI group configuration, or hardware integration test is included. Limited DALI color and tunable-white target controls are available for recognized load subtypes. Polling and real equipment behavior still require validation on your installation.

### Tests

```sh
npm run check
npm test
```

`npm test` builds the frontend and runs **19 backend tests** against a fake HTTP gateway on loopback. They cover validation, discovery and write allowlisting, credential redaction, unsupported resources, timeouts, redirects, and cancellation races. `npm run check` checks the Svelte components.

To run the browser tests, point Playwright at an existing Chrome/Chromium executable:

```sh
# POSIX example; replace the path for your machine.
CHROME_BIN=/run/current-system/sw/bin/google-chrome npm run test:e2e
```

In PowerShell, set `$env:CHROME_BIN = 'C:\path\to\chrome.exe'`, then run `npm run test:e2e`. If Playwright's Chromium is already installed, omit `CHROME_BIN`.

Browser tests cover token connection, simulated pairing, light/dimmer/blind targets, optional resources, stale states, credential errors, disconnect, keyboard form submission, and a narrow-screen layout. All gateway traffic in these tests stays on loopback; they never contact a real installation. Test traces/screenshots contain synthetic data and are ignored by Git.

### Code layout

- `src/App.svelte`: connection lifecycle, resource refresh, polling, and command feedback.
- `src/components/`: connection form, load cards, and read-only resource panels.
- `src/api.js`: same-origin API calls, timeouts, and cancellation.
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
  development-handoff.md     ← Delivered work, verification, and next steps
  restart-handoff.md         ← Historical checkpoint before the migration
  integration-options.md    ← Existing integrations and implementation direction
  sources.md                ← Sources, confidence, and outstanding questions
```

## Using the documentation in Obsidian

In Obsidian, choose **Open folder as vault** and select `docs/`. Start with `index.md`.

Every note has YAML frontmatter with a title, aliases, tags, type, and status. Links use standard relative Markdown paths, so they work in Obsidian and repository viewers without plugins. No `.obsidian/` configuration is required or checked in.
