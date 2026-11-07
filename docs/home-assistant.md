# Home Assistant and automations

## Direction

Use Home Assistant as the automation engine: schedules, presence, cross-vendor sensors, scenes, and notifications belong there. Keep this workspace focused on Wiser discovery, personal mappings, diagnostics, and explicit configuration.

Two paths are feasible:

| Path | Benefit | Tradeoff |
| --- | --- | --- |
| Home Assistant → Wiser gateway | Existing community integration; does not depend on this laptop running | Does not read this app's SQLite personal mappings; firmware and DALI coverage must be verified |
| Home Assistant → workspace API → Wiser gateway | Uses our personal labels and validated control model | New integration foundation; app must remain running and connected, secure deployment still required |

The [community integration](https://github.com/Syonix/ha-wiser-by-feller) documents HACS installation and support for lighting, covers, and scene buttons. It recommends finishing electrician configuration first and using a distinct pairing username for each client. Do not replace an existing gateway account or assume DALI capabilities without testing your firmware.

The repository now also includes a [native HA integration](ha-native.md) and a [machine-only listener](integration-listener.md) that starts with the app when `WISER_INTEGRATION_TOKEN` is set. These are not installed on your VM yet. The native adapter creates light, cover, sensor and diagnostic button entities; the older starter package provides an inventory sensor and guarded script. Choose one control integration per load to avoid duplicates.

## Enable locally, read-only first

The API is disabled unless `WISER_INTEGRATION_TOKEN` is set (preferably in `.env`, see `.env.example`); `npm start` then also starts the listener. Use a separate random integration credential, not the gateway token. It must be 32–256 URL-safe token characters; never commit it. Restarting with a replacement token revokes the old one. `WISER_INTEGRATION_CONTROL=1` separately enables the two write routes (target and identify); omit it initially, the default is read-only.

Authenticate with `Authorization: Bearer <integration-token>`. The integration token is not stored in SQLite or returned to the browser. Connect the app to the gateway normally before requesting snapshots; a gateway configured in `.env` or a remembered connection reconnects once on server startup, and a failed attempt requires a manual retry. A continuously supervised connection lifecycle is not yet implemented.

**Do not expose the app's own port (3000) to your LAN or Internet.** Its browser endpoints are an unauthenticated local workspace and stay bound to `127.0.0.1`. Home Assistant talks to the separate integration listener instead, which only proxies the routes below with token authentication. By default it is plain HTTP on an address you name explicitly (`WISER_API_TLS=0`, `WISER_API_BIND=<LAN address>`); the token then travels unencrypted, in the same exposure class as the gateway's own HTTP. See [integration-listener.md](integration-listener.md) for HTTPS, the handover safe-mode numbers and all settings.

## API v1

`GET /api/integration/v1/snapshot` returns a read of loads, states, rooms, sensors and buttons, served from a cache (see below):

```json
{
  "version": 1,
  "gateway": "wiser.local",
  "scope": "connection-specific-value",
  "observed_at": "2026-10-08T12:00:00.000Z",
  "entities": [{
    "id": 1,
    "identity": "opaque-physical-identity-hash",
    "name": "Entrance pendant",
    "room": "Entrance",
    "gateway_name": "Load 1",
    "gateway_room": "Room 2",
    "type": "dim",
    "sub_type": null,
    "unused": false,
    "state": {"bri": 2500}
  }]
}
```

Personal labels override gateway labels only when the saved physical identity matches; `gateway_name` and `gateway_room` always carry what the gateway itself reports. Notes and raw gateway responses are excluded. `identity` is independent of display names but includes the gateway address and physical load identity; keep the same gateway address rather than switching IP/hostname aliases. Unknown or missing state must not be treated as zero/off. `observed_at` is the snapshot acquisition time, not proof of physical response or a per-device last-seen timestamp.

With controls explicitly enabled, `PUT /api/integration/v1/loads/1/target` accepts:

```json
{
  "scope": "connection-specific-value-from-snapshot",
  "identity": "previously-verified-physical-identity-hash",
  "target": {"bri": 2500}
}
```

The server checks the connection scope, fetches the load again, validates identity and supported target fields, and then sends the command. Do not blindly adopt a changed identity for an existing automation. A success response means **accepted**, not physical-state confirmation. A timeout after transmission is ambiguous: refresh reported state before deciding whether to retry. Physical identity checks are best-effort, not atomic gateway transactions.

### Sensors and buttons (additive, still `version: 1`)

The snapshot also lists gateway sensors and physical buttons. An older client that ignores the two keys keeps working; a client talking to an older app should treat them as empty.

```json
{
  "sensors": [{"id": 19, "identity": "…", "name": "Terrace", "type": "temperature", "sub_type": "", "unit": "℃", "value": 0, "device": "0000a98f", "channel": 0}],
  "buttons": [{"id": null, "identity": "…", "name": null, "device": "0000a98f", "channel": 1, "type": "button", "sub_type": "up down", "registered": false}]
}
```

`value` is a finite number or a boolean exactly as reported (zero and `false` are real readings); anything else, including text and structured values, is `null`. Units are passed through unchanged and never guessed (the gateway documents `℃`/`°C`, `lux`, `m/s`, and `bool` for rain and hail). `name` is the gateway's own; there is no personal mapping for sensors or buttons. Sensor identities include the gateway address, device, channel, type, subtype and object id; button identities omit the id, because registering an input assigns an id without changing the physical input. Buttons are listed only when device and channel are valid and unique. A gateway that lacks either collection (404/405/501) yields `[]`; any other failure fails the whole snapshot.

With controls enabled, `PUT /api/integration/v1/buttons/identify` takes `{"scope": "…", "identity": "<button identity>"}` and flashes that button's LED for two seconds through the same fixed gateway request the browser uses. The app fetches the buttons again and requires exactly one match for the identity; a replaced or vanished input is 409. Nothing is registered, bound, reassigned or executed. No button **press** events are offered: the gateway's WebSocket documentation defines only load state events, and the OpenAPI text says registered buttons "send events" without any message format, so none is invented. **Settings → Diagnostics → Gateway events (raw)** in the browser app captures such undocumented messages (in memory, 200 at most, secrets removed) so the real format can be learned from a registered button on your own installation.

### Snapshot cache

`GET /api/integration/v1/snapshot` is served from a per-connection cache. The gateway (loads, states, rooms, sensors, buttons: five requests) is read at most once per `WISER_SNAPSHOT_TTL` seconds (default 60, minimum 15), concurrent requests share one read, and between reads the cached load states are patched from the live WebSocket. How often, or by how many clients, the snapshot is polled changes nothing on the gateway. Personal names and rooms are re-applied from SQLite on every response. `observed_at` is the time of the last real gateway read (patches do not move it). After an accepted command or a live reconnect the next request refreshes the cache once, but never within 2 seconds of the previous read. If the gateway fails, the retry is delayed by `min(TTL, 15 s)`; cached data is served only up to three times the TTL, then the request fails.

### Live stream

`GET /api/integration/v1/events` (read-only, no control flag) returns `application/x-ndjson`, one JSON object per line, each carrying the connection `scope` of the snapshot it belongs to:

```
{"type":"status","status":"live","scope":"…"}
{"type":"resync","scope":"…"}
{"type":"load","id":7,"state":{"bri":4200,"ct":null},"scope":"…"}
{"type":"heartbeat","scope":"…"}
```

`resync` means: fetch a fresh snapshot (sent when the gateway connection is (re)established). `load` carries the changed native fields only; `null` marks an observation that became invalid and must be dropped, never shown as zero. `status` is `live` or `polling` (gateway push down). A `heartbeat` arrives every 20 seconds so clients and proxies can detect a dead link. The stream is 503 when the app has no live gateway session, and ends when the app disconnects or reconnects (the scope changes: reconnect and take a new snapshot). Ignore events whose scope differs from your snapshot. No sensor or button events exist.

Native ranges remain unchanged: brightness `bri` 0–10000, blind `level` 0–10000 (0 open, 10000 closed), RGBW channels 0–255, supported tunable-white `ct` 1000–20000. On/off loads accept only brightness 0 or 10000. Never infer stop, tilt, or unsupported DALI controls. Future standard HA cover entities must invert position because HA uses 100 for fully open.

Disabled endpoints return 404; invalid credentials 401; disabled control or rejected local-origin checks 403; invalid targets 400; disconnected or changed connection/identity 409. Upstream failures return non-success responses; beyond three times the cache interval a failing gateway never yields a cached successful snapshot (see above). No pairing, metadata editing, commissioning, or general-purpose proxy is exposed through the machine API.

## Home Assistant starter package

[examples/home-assistant/wiser-workspace.yaml](../examples/home-assistant/wiser-workspace.yaml) uses HA's documented [REST sensors](https://www.home-assistant.io/integrations/rest/), [REST commands and response variables](https://www.home-assistant.io/integrations/rest_command/), and [scripts](https://www.home-assistant.io/docs/scripts/). It is a starting configuration, not runtime-validated against an actual HA instance.

For a same-network-namespace test deployment only:

1. Enable the API read-only and connect the workspace to a fake/test gateway first.
2. Add `wiser_workspace_authorization: "Bearer <integration-token>"` to HA's private `secrets.yaml`.
3. Include the example using [HA packages](https://www.home-assistant.io/docs/configuration/packages/). Merge into existing configuration; do not overwrite it. Keep the token out of source control and shared diagnostics.
4. Run HA's configuration validation before reloading/restarting. Verify the inventory sensor updates with personal labels and reported values, and becomes unavailable when the app disconnects.
5. Only after reviewing a safe physical test, enable API control and call `script.wiser_workspace_set_target` with `load_id`, pinned `expected_identity`, and native `target`. The script gets a fresh connection scope and refuses changed devices. A user with access to the raw REST command can bypass script-level checks but not server validation; this is not a household permissions system.

No triggers or schedules are installed by the example. Suggested first automations: a low-brightness evening light, an explicit bedtime lighting scene, or an offline-device notification. Delay automatic blinds until direction, travel, and safety behavior have been verified. Choose a single owner for each schedule to avoid conflicts with existing Wiser timers.

## Next milestones

1. Confirm HA deployment type and network placement; choose direct community integration versus workspace bridge.
2. Add an always-on connection lifecycle and secure remote machine-only access without exposing browser routes.
3. Add native light/cover discovery (custom integration or MQTT adapter), per-capability availability, and tested value conversions.
4. Add live updates/reconnect snapshots, then test automation recovery and missed events. No retrospective replay of movement commands.

API tests use fake gateways. No real Home Assistant configuration, broker, or gateway has been changed.
