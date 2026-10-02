---
title: Dashboard implementation handoff
aliases:
  - Current development handoff
  - Next session
tags:
  - wiser
  - dashboard
  - handoff
type: handoff
status: functional-poc-hardware-untested
---

# Dashboard implementation handoff

The requested local POC is implemented. This note replaces the [historical restart handoff](restart-handoff.md). Development can pause here; no agent work needs recovery.

Branch: `checkpoint/wiser-poc-restart`.

## Delivered

- **Svelte + Vite**, with locally built **Tailwind + daisyUI** styling.
- Components for connection setup, load controls, and read-only resource inspection.
- Gateway IP/hostname entry, existing-token connection, or physical-button pairing with a generated unique account name.
- Discovery and reported state for lights and blinds. On/off, numeric dimming, and blind-position targets; no speculative HVAC, tilt, or stop controls.
- Manual refresh and sequential polling; visible request failures, last update, stale-state indicators, and controls disabled when state refresh fails.
- Command acceptance is displayed separately from reported/physical state.
- Existing local Node proxy protections retained: localhost binding, Host/Origin checks, custom client header, fixed endpoints, validated targets, redirect rejection, and credential redaction.
- Server-memory credentials only; disconnect aborts outstanding requests and forgets the local session.
- Both reviewed connection races fixed: requests still receiving their body cannot reconnect after disconnect; abandoning a pending pairing request cannot establish a new local session. Normal successful connection closure still retains the session.
- Production assets served by the same Node process; no separate development proxy or runtime CDN is required.
- Dependency lockfile, Nix development shell, backend regressions, and browser tests with a simulated gateway.

The backend cancellation milestone is commit `0cd6789`. Subsequent frontend and documentation milestones are recorded in Git history on this branch.

## Run

With Node 22.12+ (or after entering `nix-shell`):

```sh
npm install
npm start
```

Open `http://127.0.0.1:3000`. The browser must run on the same machine as the local server, and that machine must be able to reach the gateway's HTTP port 80.

See [README](../README.md) for commands, environment details, and restrictions; see [dashboard operation](dashboard.md) before using real equipment.

## Verification performed

| Check | Result |
| --- | --- |
| Svelte component check | Zero errors and warnings |
| Vite production build | Passed |
| Backend suite | 17 tests passed, simulated gateway |
| Playwright browser suite | 5 tests passed using installed Google Chrome |
| Narrow layout | 375px viewport passed overflow check; captured screenshot inspected |
| Real installation | **Not tested** |

The browser suite exercises the built frontend through the real local backend and a loopback-only fake gateway. It covers existing-token connection, simulated physical pairing, optional unsupported resources, on/off/dimming/blind target requests, credential retry, acceptance versus state, stale-state recovery, disconnect, lack of browser credential storage, and keyboard form submission.

This is not exhaustive accessibility, load, compatibility, or long-duration testing. Backend concurrency regressions are automated, but real gateway timing, firmware differences, and physical motion still require installation-specific validation.

## Next session

1. Follow the [safe hardware-validation checklist](dashboard.md#safe-first-hardware-validation). Start with discovery and a low-risk light, not a blind.
2. Record the real gateway generation/firmware and capture only redacted responses if compatibility fixes are needed.
3. Confirm cover orientation, travel behavior, and actual reported state before relying on blind controls.
4. Verify sustained polling, interrupted network connections, gateway restarts, and expiry/revocation against the installation.
5. Decide future features from actual needs: room grouping/search, richer sensors, HVAC, scenes, or WebSocket updates. None is required for this POC.

## Deliberate limits

- Local, unauthenticated, single shared gateway session; no multi-user isolation or persistent token storage.
- Plain HTTP to a trusted gateway. DNS hostnames are not pinned to an address; prefer a known IP. Do not expose the local server to the Internet or other machines.
- No TLS gateway discovery, cloud access, Matter bridge, configuration/calibration, stop/tilt buttons, HVAC writes, scene execution, or color controls.
- UI polling uses sequential requests; slow optional resources can delay a refresh.
- Cancelling pairing cannot undo an account the gateway has already created, and disconnect cannot undo a command already sent.
- One tab is recommended because server credentials/session are shared across tabs.

## Ownership for future work

No workers remain assigned. Start fresh from this branch and this note, not interrupted subagent transcripts.

Follow [AGENT.md](../AGENT.md): use GPT-6.1 Sol for Sol assignments, GPT-6 Luna for requirements/documentation/UX, and Astra only when warranted. Keep ownership separate, verify integrated changes, and commit/push coherent milestones.
