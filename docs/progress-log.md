# Progress and restart notes

## 2026-10-09 — live updates, then Home Assistant

- User confirms remembered gateway credentials work. HA runs in a VM, probably HA OS (not yet verified).
- Requested order: live updates first, then HA integration. Keep durable process notes here.
- Baseline commit: `1b67e3f`; 52 Node tests and 22 browser tests.
- Existing machine API is localhost-only, opt-in bearer token, controls separately enabled. Do not expose the browser server to the LAN.
- Credential storage: encrypted host/token in `data/credentials/gateway.json`, owner-only key alongside. Do not read real secret files during development or put credentials in notes.
- Live updates design: backend authenticated gateway WebSocket; browser receives safe session-scoped updates through a same-origin stream. Retain polling and snapshots for recovery. No simulated button commands.
- Official contract verified: https://github.com/Feller-AG/wiser-tutorial/blob/main/doc/websocket.md — `/api` WebSocket uses Authorization header; load events carry partial state; snapshot required.
- HA deployment remains unconfigured. Native entity adapter and secure remote access must be distinct from the local browser interface. No VM changes or automation activation without explicit deployment approval.
- Live update milestone completed: authenticated backend WebSocket, scoped NDJSON browser stream, partial-state merging, invalid-state clearing, bounded reconnects, socket heartbeat, polling fallback, reconnect snapshot, and cleanup on disconnect.
- Verification: Svelte check/build passed; 23 browser tests passed, including wall-switch updates and reconnect. Live/backend tests pass against fake gateways. No actual gateway commands or credential reads performed during development.
- Dependency: added `ws` (Node built-in WebSocket cannot supply gateway authorization headers). Existing npm lockfile retained; pnpm bootstrap-generated alternate lockfiles were moved to `/tmp`, not adopted.
- Live milestone committed as `035b4fa`.
- HA implementation completed in `custom_components/wiser_workspace`: HTTPS config flow, polling coordinator, native lights/covers, pinned physical identity, fresh command preflight, no optimistic state, reauthentication. DALI brightness only; color/CT mapping remains deferred. Rooms are attributes, not automatically assigned HA areas.
- Separate `integration-listener.js` exposes only authenticated snapshot/target HTTPS routes; browser server stays loopback-only. Start command: `npm run start:integration`. Default listener is also loopback until explicitly configured. No certificates, network bindings, firewall rules, services, or VM configuration were deployed.
- Final verification: 57 Node tests validated (TLS test separately rerun with `nix shell nixpkgs#openssl -c node --test test/integration-listener.test.js`, no skips); 23 browser tests; 13 Python adapter/transport tests using `UV_CACHE_DIR=/tmp/wiser-ha-uv-cache uv run --no-project --python 3.13 --with aiohttp python -B -m unittest discover -s test -p '*_test.py'`; Svelte check and production build passed. No full HA-runtime or physical-hardware verification.
- User requested merge to main and push. Fetched `origin` (`fabianw931/wiser-smart-home-integration`); remote main is an ancestor, no divergence. Publish verified commits via fast-forward, never force-push; do not push to the local filesystem remote.

## Resume here

1. Inspect `git status` and `git log -5 --oneline`; confirm published main state if needed.
2. Read `docs/ha-native.md`, `docs/integration-listener.md`, and `docs/remembered-connection.md`.
3. User chose the laptop as app host for now; it must remain awake for HA connectivity. HA installation is deferred while refining the web app. Confirm HA installation type and VM address when resuming deployment.
4. Agree on private endpoint DNS, trusted TLS certificate provisioning, service account, token distribution, and firewall restricted to the HA VM. Do not expose port 3000 or disable TLS verification.
5. With explicit deployment approval, install the custom integration into HA, validate read-only first, then supervise a harmless light command before any blind movement. HA runtime validation is still outstanding.
6. Keep installer commissioning untouched. No schedules/automations are installed automatically. Do not rebind changed device identities silently.

## 2026-10-09 — buttons and weather

- User prioritizes installed weather station and button functionality over HA deployment.
- Compared current Feller OpenAPI 6.0.47 button, sensor, SmartButton and WEST-group schemas. Sensor values may be scalar despite the broad schema; zero/false must not be treated as missing. Button IDs may be null for unregistered inputs.
- Added dedicated Buttons and Weather navigation, searchable/filterable resource cards, job references, weather protection rules with load names, raw-detail fallbacks, separate fetch timestamps, and 90-second stale status. Included disconnected sample data.
- New read-only collections: buttons, smartbuttons, westgroups. Existing sensors collection supplies readings. No weather test calls or installer configuration writes.
- Only new write: explicit two-second button identification. Backend validates physical identity against fresh discovery and current scoped live intent before fixed PUT ping. No registration, bindings, reassignment, job execution, or persistent LED override.
- Deliberately do not infer station ownership, live protection alarms, switch-to-load bindings, or undocumented button event formats. Press-event monitoring and optional registration are follow-up work needing verified firmware/event examples.
- No real gateway credentials read and no physical equipment contacted. Restart `npm start` to rebuild and expose the new navigation.
- Verification: production build and Svelte checks passed; 26 browser tests passed, with the 3 installation tests rerun after the final identification-error wording change. Node suite: 63 passed, 1 TLS test skipped in the default environment then passed using `nix shell nixpkgs#openssl -c node --test test/integration-listener.test.js` (both TLS tests passed). All 64 Node tests validated. Tests use synthetic loopback gateways, not installed equipment.
