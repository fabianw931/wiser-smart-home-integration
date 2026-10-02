---
title: Wiser smart home integration
aliases:
  - Wiser research
tags:
  - wiser
  - research
type: project-index
status: research
---

# Wiser smart home integration

Research into **Wiser by Feller** products and the local API available to discover, read, and control their entities.

**Main finding:** Feller provides a documented local REST API and a WebSocket interface through the installation's WLAN-enabled µGateway. Lights and blinds are represented as *loads*. Newer gateways also expose heating, sensors, and weather-related resources.

This repository contains research documentation and a small, dependency-free local web proof of concept. Findings and controls are based on public documentation; no physical gateway has been tested.

## Run the local web POC

Requires **Node.js 20 or newer** and a modern browser. No dependency installation or build step is needed.

```sh
npm start
# Or:
node server.js
```

Open **http://127.0.0.1:3000**. To choose another local port, run `PORT=3001 node server.js` (POSIX shell). The server binds only to `127.0.0.1`.

1. Enter your commissioned Wiser by Feller gateway's IP address or hostname, without a URL scheme, port, or path. The gateway must be reachable over HTTP port 80.
2. Either supply an existing bearer token, or click **Pair new client** and press a flashing physical gateway button within approximately **30 seconds**. Pairing sends `POST /api/account/claim` with a generated unique `local-poc-<UUID>` username. The backend allows up to 45 seconds for the claim response.
3. Inspect discovered loads and their reported states before operating equipment. On/off lights support off/on; dimmers support integer brightness **0–10000**.
4. Blinds support integer target **level 0–10000**, explicitly labeled **0 = open, 10000 = closed**, following the [official load tutorial](https://github.com/Feller-AG/wiser-tutorial/blob/main/doc/api_loads.md). Verify installation orientation and keep the path clear. Tilt, button simulation, stop, calibration, and HVAC writes are deliberately omitted. Tilt is a count of motor tilt commands, not an angle or percentage; a motor button click can stop movement or tilt when idle, so this POC does not present it as an unconditional stop.
5. Use **Refresh now** or leave the page open for polling, scheduled 30 seconds after each completed refresh. Requests are sequential within the page, and failures of optional resources are shown separately. Unknown/unused load types and rooms, devices, sensors, and HVAC groups/states are read-only.
6. Click **Disconnect & forget credentials** when finished, or stop the Node process with Ctrl+C. Closing the browser alone does **not** clear the server session.

### Safety and limitations

- **This is a local unauthenticated app controlling real equipment.** Anyone or any program with access to this local service can use its current gateway session. All tabs share one in-memory connection; use one tab. Do not expose, reverse-proxy, forward, or tunnel its port. It is not a multi-user service or a production home-automation controller.
- Gateway HTTP traffic, including bearer tokens, is **unencrypted**. Use a trusted computer and LAN. Host/Origin checks, no CORS, a required custom API header, and a restrictive content security policy reduce hostile-webpage access; they are not authentication against local software.
- Credentials live only in server memory. The app never writes them to disk, logs them, returns pairing secrets to the browser, or uses cookies/localStorage/sessionStorage. An existing token necessarily passes through the password input and request memory and is cleared from the input immediately. Browser/password-manager behavior and developer tools are outside the app's control; do not save or share credentials there.
- Disconnect forgets credentials but does not delete the account from the gateway or revoke an existing token. Pairing again creates another account. Cancelled pairing might still have created a gateway account. A target already sent cannot be undone by disconnecting.
- Only fixed read endpoints (`info`, `loads`, `loads/state`, `rooms`, `devices`, `sensors`, `hvacgroups`, `hvacgroups/state`), account claim, and validated targets for discovered loads are proxied. There is no generic URL proxy. No job execution, identification, commissioning, calibration, or other potentially side-effecting GET discovery is performed.
- Gateway host validation allows IP addresses and DNS hostnames, not arbitrary URLs/ports/paths. It does not enforce a private-address subnet; only enter a gateway you trust. Redirects are not followed.
- Optional resources vary by firmware and may show **unsupported** or an error. Read-only JSON preserves gateway fields without inventing sensor units or HVAC behavior. A write acknowledgement is not physical-state confirmation; the page refreshes reported state after writes. No fabricated demo data is displayed.
- No WebSocket subscription, automatic token persistence, cloud access, account management, color controls, or hardware integration test is included. Polling and real equipment behavior still require validation on your installation.

### Tests

```sh
npm test
```

Tests use Node's built-in test runner and a fake HTTP gateway on loopback. They cover host/target validation, discovery and write allowlisting, pairing, credential redaction, unsupported resources, envelope errors, timeouts, redirects, and disconnect behavior. They do not contact a real installation.

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
  integration-options.md    ← Existing integrations and implementation direction
  sources.md                ← Sources, confidence, and outstanding questions
```

## Using the documentation in Obsidian

In Obsidian, choose **Open folder as vault** and select `docs/`. Start with `index.md`.

Every note has YAML frontmatter with a title, aliases, tags, type, and status. Links use standard relative Markdown paths, so they work in Obsidian and repository viewers without plugins. No `.obsidian/` configuration is required or checked in.
