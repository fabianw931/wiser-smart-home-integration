# Home Assistant and automations

## Direction

Use Home Assistant as the automation engine: schedules, presence, cross-vendor sensors, scenes, and notifications belong there. Keep this workspace focused on Wiser discovery, personal mappings, diagnostics, and explicit configuration.

Two paths are feasible:

| Path | Benefit | Tradeoff |
| --- | --- | --- |
| Home Assistant → Wiser gateway | Existing community integration; does not depend on this laptop running | Does not read this app's SQLite personal mappings; firmware and DALI coverage must be verified |
| Home Assistant → workspace API → Wiser gateway | Uses our personal labels and validated control model | New integration foundation; app must remain running and connected, secure deployment still required |

The [community integration](https://github.com/Syonix/ha-wiser-by-feller) documents HACS installation and support for lighting, covers, and scene buttons. It recommends finishing electrician configuration first and using a distinct pairing username for each client. Do not replace an existing gateway account or assume DALI capabilities without testing your firmware.

The repository now also includes a [native HA integration](ha-native.md) and [machine-only HTTPS listener](integration-listener.md). These are not installed on your VM yet. The native adapter creates light/cover entities at setup; the older starter package provides an inventory sensor and guarded script. Choose one control integration per load to avoid duplicates.

## Enable locally, read-only first

The API is disabled unless `WISER_INTEGRATION_TOKEN` is supplied at server startup. Use a separate random integration credential, not the gateway token. It must be 32–256 URL-safe token characters. Supply it through your service's secret environment; never commit it. Restarting with a replacement token revokes the old one. `WISER_INTEGRATION_CONTROL=1` separately enables target commands; omit it initially.

The app still binds only to `127.0.0.1`. Authenticate with `Authorization: Bearer <integration-token>`. The integration token is not stored in SQLite or returned to the browser. Connect the app to the gateway normally before requesting snapshots. Opt-in [remembered connections](remembered-connection.md) reconnect once on server startup; a failed attempt requires a manual retry. A continuously supervised connection lifecycle is not yet implemented.

**Do not expose the current app port to your LAN or Internet.** Its browser endpoints are still an unauthenticated local workspace. Adding a machine token does not secure those endpoints. The separate HTTPS listener is implemented, but needs certificate provisioning and VM-restricted firewall/service configuration before remote access. In HA OS or a container, `127.0.0.1` refers to HA's own network namespace, not your laptop.

## API v1

`GET /api/integration/v1/snapshot` returns a fresh, non-atomic read of loads, states, and rooms:

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
    "type": "dim",
    "sub_type": null,
    "unused": false,
    "state": {"bri": 2500}
  }]
}
```

Personal labels override gateway labels only when the saved physical identity matches. Notes and raw gateway responses are excluded. `identity` is independent of display names but includes the gateway address and physical load identity; keep the same gateway address rather than switching IP/hostname aliases. Unknown or missing state must not be treated as zero/off. `observed_at` is the snapshot acquisition time, not proof of physical response or a per-device last-seen timestamp.

With controls explicitly enabled, `PUT /api/integration/v1/loads/1/target` accepts:

```json
{
  "scope": "connection-specific-value-from-snapshot",
  "identity": "previously-verified-physical-identity-hash",
  "target": {"bri": 2500}
}
```

The server checks the connection scope, fetches the load again, validates identity and supported target fields, and then sends the command. Do not blindly adopt a changed identity for an existing automation. A success response means **accepted**, not physical-state confirmation. A timeout after transmission is ambiguous: refresh reported state before deciding whether to retry. Physical identity checks are best-effort, not atomic gateway transactions.

Native ranges remain unchanged: brightness `bri` 0–10000, blind `level` 0–10000 (0 open, 10000 closed), RGBW channels 0–255, supported tunable-white `ct` 1000–20000. On/off loads accept only brightness 0 or 10000. Never infer stop, tilt, or unsupported DALI controls. Future standard HA cover entities must invert position because HA uses 100 for fully open.

Disabled endpoints return 404; invalid credentials 401; disabled control or rejected local-origin checks 403; invalid targets 400; disconnected or changed connection/identity 409. Upstream failures return non-success responses rather than cached successful snapshots. No pairing, metadata editing, commissioning, or general-purpose proxy is exposed through the machine API.

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
