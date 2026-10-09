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
3. Ask where the app should run permanently (always-on server/VM preferred over sleeping laptop). That choice is still unanswered. Confirm HA installation type and VM address.
4. Agree on private endpoint DNS, trusted TLS certificate provisioning, service account, token distribution, and firewall restricted to the HA VM. Do not expose port 3000 or disable TLS verification.
5. With explicit deployment approval, install the custom integration into HA, validate read-only first, then supervise a harmless light command before any blind movement. HA runtime validation is still outstanding.
6. Keep installer commissioning untouched. No schedules/automations are installed automatically. Do not rebind changed device identities silently.
