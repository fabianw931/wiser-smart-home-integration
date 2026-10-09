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
- Next work in this turn: review native HA adapter and restricted HTTPS listener; complete their tests and deployment handoff. HA adapter will initially expose DALI brightness only, not unverified color-temperature conversions.
