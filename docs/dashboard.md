---
title: Wiser local dashboard POC
aliases:
  - Local dashboard
  - Dashboard POC
tags:
  - wiser
  - dashboard
  - poc
type: guide
status: software-tested-hardware-untested
---

# Wiser local dashboard POC

This note describes the repository's local dashboard proof of concept (POC), not a supported production integration. A small Node HTTP server serves a Svelte frontend built with Vite, Tailwind, and daisyUI. The server listens on `127.0.0.1` and defaults to port `3000`; `PORT` can override it (see [server startup](../server.js)). Read the [development handoff](development-handoff.md) for delivered work, verification, and next-session priorities.

## Architecture and behavior

- The browser UI and API are served from one origin. The backend makes HTTP requests to the gateway's local API, rather than having browser code contact it directly. Its allowlisted read resources and gateway request handling are in [server.js](../server.js); the dashboard's lifecycle and refresh flow are in [src/App.svelte](../src/App.svelte), with separate connection, load-card, and resource-panel components.
- Credentials and the connected gateway session live only in the Node process's memory. It is one shared session for that server process, including across browser tabs; closing a tab does not clear credentials. They are not persisted; disconnect forgets the local session/token but does not revoke or delete the gateway account/credential, and stopping the server clears its memory. The browser clears the entered token after submission. Pairing credentials are not returned to the browser, and gateway responses are sanitized to remove secret-like fields and echoed tokens.
- Pair by entering the gateway host and choosing pairing, then press the physically flashing gateway button within 30 seconds. The backend sends a unique generated username for each physical pairing claim. Alternatively, connect with a token already obtained through another supported process.
- The UI refreshes load definitions and reported states at startup/after actions and supports manual refresh. Core reads run sequentially; a separate sequential pass reads six optional diagnostic resources in the background and may overlap core refresh. Diagnostic failures do not hide discovered loads, and load commands do not trigger diagnostic reads. Polling is scheduled 30 seconds after each core refresh finishes.
- A successful target command is not proof of physical movement. The UI reports acceptance separately from reported state. Failed state refreshes mark old readings as stale and disable controls until a successful refresh.
- Writes are limited to validated target-state controls for active, recognized load subtypes. On/off accepts `bri` 0 or 10000; dim uses `bri` 0–10000; motor uses `level` 0–10000. DALI loads with an empty or missing subtype support brightness `bri` 0–10000; `tw` adds integer `ct` 1000–20000 in API units (not confirmed Kelvin); `rgb` adds integer `red`, `green`, `blue`, and `white`, each 0–255. UI forms submit only their supported fields and backend validation is strict. Unknown subtypes are read-only. Motors are position-only: the POC does not expose tilt, stop, or calibration controls. It does not write HVAC targets, run jobs/scenes, or control the cloud.

The wider gateway resource model and documented endpoint semantics are described in [entity model](entity-model.md) and [API overview](api-overview.md). Those research notes are not a promise that this POC implements every documented resource or operation.

## Run locally

Requires Node.js 22.12 or later. NixOS users can enter the repository's `nix-shell` first:

```sh
npm install
npm start
```

This builds local assets and starts the backend. Open the localhost URL printed by the server. The backend uses `PORT` or defaults to `3000`. Never put gateway credentials in source files, documentation, shell history, or committed configuration.

## Local security boundary

The dashboard has no user login and must remain bound to localhost. Do not forward its port or expose it to other machines. All tabs share the server's gateway session.

Gateway traffic uses unencrypted HTTP, so use a trusted network. Hostname validation rejects URLs and paths but does not pin DNS resolution: a hostname whose address changes can send later authenticated requests to a different destination. Prefer the gateway's known IP address. This does not protect against a compromised local network or an HTTP man-in-the-middle.

## Safe first hardware validation

Automated tests use a fake gateway; they verify software behavior but are not evidence of real-gateway compatibility or safe motor behavior. No real hardware validation is claimed here.

1. Confirm the installation is a Wiser by Feller µGateway installation and that you can identify the correct gateway host on the local network. This POC is not for Schneider Electric Wiser.
2. Before connecting, identify a low-risk, accessible load. For a blind, confirm its installation orientation and keep the full travel path clear; make sure you know how to isolate power or stop operation using the installation's normal safety method.
3. Start the local server and use the printed localhost URL. Prefer physical pairing: enter the gateway host, initiate pairing, and press the flashing gateway button promptly (within 30 seconds). Do not share or record the resulting credentials.
4. First inspect the discovered load names/types/IDs and reported state without issuing a target. Confirm the selected output matches the intended physical device, and skip unused or ambiguous channels.
5. For a light, issue a single conservative target and confirm the physical result and refreshed reported state. For a motor, only proceed if orientation is verified and the area remains clear: use a small intermediate `level` target first, observe motion continuously, and be ready to isolate power if behavior is unexpected. Do not infer direction or percentage mapping from another installation.
6. Stop if the device, direction, or state is unexpected. Disconnect in the UI; if disconnect cannot be confirmed, stop the Node server so its in-memory credentials are discarded. Recheck installation setup before retrying.

The UI's open/closed labels reflect the POC's current convention (0 open, 10000 closed), not a verified property of every installation. Hardware behavior must be established locally before relying on those labels.

## Scope/acceptance checklist

- [ ] Credentials are entered by the user or obtained by physical pairing, remain session-only in server memory, and are not shown back to the browser.
- [ ] Discovery and reported load states are readable; missing state is shown as unavailable rather than treated as a confirmed value.
- [ ] Only recognized on/off, dimming, motor-position, and supported DALI targets are writable; unknown subtypes, motor tilt/stop/calibration, HVAC writes, and cloud operations remain out of scope.
- [ ] Automated fake-gateway tests pass, and real hardware behavior is separately validated before operational use.
