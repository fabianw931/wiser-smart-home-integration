# Native Home Assistant integration

`custom_components/wiser_workspace` connects Home Assistant (HA) to the **Wiser Workspace app** (the Node app in this repository), never to the gateway: HA → app's integration listener → app → gateway. HA mirrors the configuration you made in the app (your names and rooms). It has been written against current HA core APIs, but it has **not been installed or run on a real HA instance**; unit tests cover the pure logic and the coordinator against stubs only. Needs a recent HA (2025.1 or newer is assumed because of the Kelvin-based light API and `ConfigEntry.runtime_data`).

## Install

1. In the app's `.env` set `WISER_INTEGRATION_TOKEN` (32–256 characters `A-Za-z0-9_-`) and start the app on the computer that stays on, e.g. `npm start`. The listener serves port `3443` by default; see [integration-listener.md](integration-listener.md) for binding it to the LAN address and for the control switch. Make sure the firewall of that computer lets HA reach the port.
2. Copy the whole `custom_components/wiser_workspace` directory to `/config/custom_components/wiser_workspace` on HA (keep other custom integrations) and restart Home Assistant.
3. Settings → Devices & services → Add integration → **Wiser Workspace** and enter:
   - **IP address or hostname**: of the computer running the app (not the gateway). No `http://`, port, path or credentials in this field.
   - **Port**: `3443` unless you changed `WISER_API_PORT`.
   - **Integration token**: the `WISER_INTEGRATION_TOKEN` from the app's `.env`.
   - **Use HTTPS**: off by default. See below.
4. The integration fetches a snapshot to prove address, protocol and token, and uses the gateway the app reports as the entry's unique ID (one entry per gateway).

Entry data (`host`, `port`, `ssl`, `token`) is stored by HA in plain text under `/config/.storage`, like every HA integration credential. Protect HA access and backups and do not share that file or screenshots containing it. A rejected token starts HA's reauthentication flow. **Reconfigure** (the entry's three-dot menu) changes host, port, protocol or token, for instance after the app's computer got a new IP address; it refuses an endpoint that serves a different gateway. An older prerelease entry that stored a single `url` cannot be loaded: delete it and add the integration again.

### Plain HTTP or HTTPS

- **Off (plain HTTP, default).** Matches how the app's listener is normally run on a trusted LAN (`WISER_API_TLS=0`). The token and all traffic are unencrypted on the network, in the same exposure class as the gateway's own HTTP. Never forward this port to the Internet.
- **On (HTTPS).** HA verifies the certificate and that check can never be switched off. The app's certificate therefore has to be one HA trusts, for example one issued by a CA HA knows, or a private CA you added to HA's trust store. A **self-signed certificate does not work**, and connecting by IP only works if the certificate lists that IP. Redirects are never followed in either mode.

## Read-only first

The app is read-only unless `WISER_INTEGRATION_CONTROL=1` is set in its `.env` (restart the app). Until then everything is visible in HA but light, cover and identify commands fail with a message saying the app is read-only. Suggested order: connect read-only, check names, rooms, brightness values and cover direction, then enable control and try one harmless light, then a blind only after confirming direction and travel safety. The integration installs no schedules or automations.

## Entities

| Platform | What | Notes |
|---|---|---|
| `light` | on/off, dimmable and DALI loads | Brightness only needs the brightness reading. DALI **tunable white** has colour temperature (slider 2000–6500 K; the app accepts 1000–20000 K), DALI **RGB** has RGBW (HA colour picker plus white). Only the values you change are sent, so changing colour never re-sends brightness. Turning on without a brightness gives full brightness only when the load is off. Unknown colour state leaves the colour unknown but the light usable for brightness. Unknown DALI sub types are brightness only |
| `cover` | blinds (motor loads) | Wiser 0 (open) is HA 100 (open), Wiser 10000 (closed) is HA 0. Position only |
| `sensor` | temperature (°C), illuminance (lx), wind speed (m/s) | Only readings whose type **and** unit the gateway documents (`℃`/`°C`, `lux`, `m/s`) are created; anything else is skipped rather than guessed. Zero is a real value |
| `binary_sensor` | rain, hail | Rain uses the moisture class; HA has no hail class, so hail shows plain on/off |
| `button` | **Identify** per physical wall button channel | Diagnostic, disabled by default (enable it in the entity settings). Flashes that button's LED for about 2 s. Needs control enabled in the app |

Each load and each sensor is its own HA device; the identify buttons are grouped per physical button device. Entity unique IDs use the app's stable identity hashes (gateway plus device), so renaming in the app never changes them.

**Names.** Entity and device names are the personal names you set in the app (the gateway's name when none is set); entity names follow later renames. The original gateway name and room are the attributes `wiser_gateway_name` and `wiser_gateway_room`, your personal room is `wiser_room` and is also the suggested area when HA first creates a load's device (it never moves an existing device). An entity you renamed in HA keeps your HA name.

**Discovery** happens when the integration (re)loads: new or replaced hardware appears after you review it in the app and reload the entry. Entities of vanished hardware stay unavailable until you remove them deliberately; nothing is rebound automatically. Unused loads and unknown types are skipped.

## How updates and commands work

Load changes are pushed over a long-lived event stream (`/api/integration/v1/events`) and applied immediately. A new snapshot is fetched on every (re)connect or `resync` event, and in any case at least every 30 s (the app answers snapshots from a cache, so this is cheap for the gateway); sensor readings only change with snapshots. If the stream goes quiet for 60 s (the app sends a heartbeat about every 20 s) it is treated as dead and reconnected with a growing delay (1 s up to 60 s). If snapshots fail, entities become unavailable and recover on the next success. If the gateway behind the endpoint changes, entities become unavailable (`wrong gateway`) rather than silently switching.

Commands are not optimistic. Before sending, HA checks the entity against data that is at most a few seconds old (fetching a snapshot only if it is older), refuses a missing or replaced load, sends the command with the entity's original identity, then reads state once more. An accepted command does not prove physical movement; after a timeout look at the refreshed state before retrying.

## Not supported

Button **press events** (no documented message format yet; HA event entities will be added once real messages are captured), blind tilt and stop, scenes, HVAC/heating, configuration, commissioning, button registration, and any write to the gateway outside the app's controlled routes.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "The integration token was rejected" / reauth notification | Token differs from `WISER_INTEGRATION_TOKEN` in the app's `.env` (restart the app after editing). Enter the current one |
| "Cannot fetch a valid workspace snapshot" | Wrong IP or port, app not running or not connected to the gateway (the app must be connected first), firewall, listener bound to `127.0.0.1` only (`WISER_API_BIND`), HTTP/HTTPS mismatch (HTTPS toggle on against a plain HTTP listener or vice versa), or an untrusted/self-signed/wrong-name certificate when HTTPS is on |
| "Enter an IP address or hostname without http://…" | Remove the scheme, path, port or user info from the address field; the port has its own field |
| Entities unavailable | App stopped, gateway disconnected in the app, or the network path is down. Check the app's status; they recover by themselves |
| Entities unavailable after the app reconnected | The app serves another gateway than the entry was created for: use the original gateway, or add the integration anew for the new one |
| "The endpoint now serves a different gateway" during reauth or reconfigure | Same cause; the entry stays bound to its gateway |
| Commands fail with "The Wiser app is read-only" | Set `WISER_INTEGRATION_CONTROL=1` in the app's `.env` and restart it |
| "Load identity changed or unavailable; command not sent" | The load's identity or state changed; reload the integration after checking the app |
| No identify button visible | It is disabled by default: Settings → Devices & services → Wiser Workspace → Entities → show disabled entities → enable |
| Temperature/lux/wind sensor missing | The gateway reports a unit this integration does not map; nothing is guessed |

## Validation

`python3 -m unittest discover -s test -p '*_test.py'` covers the pure model (URL, host, port and token validation, snapshots, event patching, backoff, colour and sensor mapping). With aiohttp available (`uv run --no-project --with aiohttp python -m unittest discover -s test -p '*_test.py'`) it also runs the HTTP client and event stream against a local fake server, and the coordinator against stubbed HA base classes. Config flow, entity classes and everything inside real HA still need your running instance; verify there with the read-only-first order above.

References: HA developer docs for [fetching data](https://developers.home-assistant.io/docs/integration_fetching_data/), [config flows](https://developers.home-assistant.io/docs/config_entries_config_flow_handler/), [light colour modes](https://developers.home-assistant.io/docs/core/entity/light/), [sensors](https://developers.home-assistant.io/docs/core/entity/sensor/) and [buttons](https://developers.home-assistant.io/docs/core/entity/button/).
