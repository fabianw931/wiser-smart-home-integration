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

## 2026-11-07 — Home Assistant: sensors, buttons, live stream, cache (app side)

- Snapshot (still `version: 1`) gained additive `sensors` and `buttons`; new routes `GET /api/integration/v1/events` (NDJSON: status, resync, load patches, 20 s heartbeat; each line scoped) and `PUT /api/integration/v1/buttons/identify` (control-gated, identity and scope pinned, existing 2 s LED ping). Both write routes stay behind `WISER_INTEGRATION_CONTROL=1`.
- Snapshot cache per connection: one set of five gateway reads per `WISER_SNAPSHOT_TTL` (default 60 s, min 15), single-flight, live WebSocket patches, honest `observed_at`, 3 x TTL stale limit, at most one extra refresh per 2 s after commands or live reconnects. Steady state is 5 gateway requests per minute independent of Home Assistant polling.
- Listener: `WISER_API_TLS=0` opt-in plain HTTP (explicit literal `WISER_API_BIND` required; unencrypted-token warning at startup), HTTPS stays default; exact allowlist unchanged plus the two new routes; streaming relay with idle timeout. `node server.js` starts it when `WISER_INTEGRATION_TOKEN` is set (failure never stops the dashboard).
- Button press events: not implemented, because no official format exists (WebSocket guide defines load events only; OpenAPI says registered buttons "send events" with no shape). Added Settings → Diagnostics → Gateway events (raw): in-memory ring of the last 200 non-load WebSocket messages, secrets removed, no polling, no new gateway requests, to learn the real format.
- Tests: `test/integration-api.test.js` (shapes, cache, stream, identify, read-only default, raw capture), listener tests for both modes, e2e `gateway-events.spec.js`.


## 2026-11-07 — Button capture findings, quick-action fixes

- Raw gateway-events capture now also keeps load updates (flagged `kind: "load"`, last 50) and binary frames (length + first 64 bytes as hex) besides the 200 other messages. Real-gateway capture of single/double/long presses on an unprogrammed button and a programmable scene button showed only load updates (a scene burst: lights off, blinds down); no button, press-type or binary messages. Button press events are therefore not available over the WebSocket; only registering a button (a gateway write, not done) could change that.
- Button identification (`POST /api/buttons/identify`) returned "Resource unsupported by this gateway" for all scene devices on this gateway.
- Quick actions send one request at a time again (parallel light sends reverted).
- Open/Close blinds now also target blinds still travelling away from the goal: a moving blind reports its start level (level 0 while moving down), which previously made Open blinds skip it. `"up"` while opening is assumed, not yet observed.
- HA component complete in the working tree (lights, covers, sensors, binary sensors, identify buttons, coordinator with event stream); 59 Python tests pass; not run on a real Home Assistant.
- "Half-open" was first built as a level-5000 action, then replaced by a slat-tilt quick action: **Tilt blinds for light** sends `{"tilt": 4}` (`TILT_LIGHT` in `src/home.js`) to standing slat blinds that report a tilt. Tilt is 0–9 command steps (OpenAPI 6.0.47), not degrees; direction (0 = flat or closed slats) is unverified, and a tilt-only `target_state` is unverified on hardware (the tutorial example sends level and tilt together). `validateTarget` now accepts motor `level` and/or `tilt` (0–9).
