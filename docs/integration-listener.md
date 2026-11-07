# Home Assistant machine listener

The browser application always stays bound to `127.0.0.1`. When `WISER_INTEGRATION_TOKEN` is set, `node server.js` (`npm start`) also starts a second, separate listener for Home Assistant in the same process. It proxies only a fixed list of authenticated requests to the app over loopback; configuration, browser pages, cookies, static files, redirects and query strings are excluded, and requests carrying a browser `Origin` or cross-site fetch metadata are refused. `npm run start:integration` still runs the same listener standalone (do not run both at once: the port is taken).

## Allowed requests

| Request | Needs `WISER_INTEGRATION_CONTROL=1` | Purpose |
| --- | --- | --- |
| `GET /api/integration/v1/snapshot` | no | Loads, states, sensors and buttons from the app's cache |
| `GET /api/integration/v1/events` | no | Long-lived NDJSON stream of live state changes |
| `PUT /api/integration/v1/loads/<id>/target` | yes | Command a light or blind |
| `PUT /api/integration/v1/buttons/identify` | yes | Flash one wall button's LED for two seconds |

Everything else is 404. Every request needs `Authorization: Bearer <token>`. Request bodies are limited to 8 KiB and ordinary responses to 2 MiB. The event stream has no size cap (it is endless by design) but a silent upstream is dropped after 65 seconds; the app sends a heartbeat every 20 seconds.

## Configuration (`.env`)

Put these in `.env` (see `.env.example`; `chmod 600 .env`). Shell variables win over the file.

| Variable | Purpose | Default |
| --- | --- | --- |
| `WISER_INTEGRATION_TOKEN` | Shared bearer token, 32–256 characters `A-Za-z0-9_-`. Setting it enables the integration | off |
| `WISER_INTEGRATION_CONTROL` | `1` allows the two write routes | read-only |
| `WISER_API_TLS` | `0` = plain HTTP, unset/`1` = HTTPS | HTTPS |
| `WISER_API_BIND` | Address to listen on. **Required** for plain HTTP | HTTPS: `127.0.0.1` |
| `WISER_API_PORT` | Port | `3443` |
| `WISER_SNAPSHOT_TTL` | Seconds between gateway reads for snapshots, 15–3600 | `60` |
| `WISER_TLS_CERT`, `WISER_TLS_KEY` | PEM certificate (with chain) and private key, HTTPS only | – |

If the listener cannot start (bad address, missing certificate, port in use) the reason is printed as `Home Assistant integration API NOT started: …` and the dashboard keeps running.

## Plain HTTP on the LAN (the usual setup)

```
WISER_INTEGRATION_TOKEN=<random>
WISER_API_TLS=0
WISER_API_BIND=192.168.1.50
```

Plain HTTP is an explicit opt-in. It has no default address, so it can never expose itself by accident: you must name the interface. A concrete LAN address is the safest choice; `0.0.0.0` (or `::`) is accepted only when typed deliberately and is called out in the startup line. At startup the app prints, once:

> Home Assistant integration API: http://192.168.1.50:3443 WITHOUT TLS - the integration token travels unencrypted on the network (the same exposure class as the gateway's own HTTP). Use only on a trusted LAN and never forward this port.

Everyone who can sniff that network segment can read the token. The token cannot open the gateway (the app holds that credential) and, without `WISER_INTEGRATION_CONTROL=1`, can only read; but treat it as a secret and keep it out of source control. Never forward the port to the Internet, and do not expose the app's own port (3000); it stays on loopback regardless.

## Optional HTTPS

Leave `WISER_API_TLS` unset and provide `WISER_TLS_CERT` and `WISER_TLS_KEY`. On POSIX the key must be a regular file owned by the account running the app with no group or other permissions (mode `0600`); symlinks are refused. Use a certificate whose DNS name or IP SAN matches the address Home Assistant uses and that Home Assistant's host trusts: the Home Assistant integration always verifies certificates and cannot be told not to. A self-signed certificate therefore only works if its CA is installed on the Home Assistant host; most home setups use plain HTTP on the LAN instead.

## Handover safe mode

The installation must not be disturbed before the installer hands it over. Home Assistant only mirrors this app and adds no meaningful load to the gateway:

- **Steady state: 5 gateway HTTP requests per minute** with the default 60 s TTL (`loads`, `loads/state`, `rooms`, `sensors`, `buttons`, one set per refresh), plus the single WebSocket the app already keeps open (library-level ping every 30 s). A longer `WISER_SNAPSHOT_TTL` lowers it: 15 s gives at most 20 requests/min, 300 s gives 1/min. This does not depend on how often or by how many clients the snapshot is polled: concurrent requests share one refresh, and between refreshes the cache is patched from live WebSocket events.
- If the gateway fails, it is retried at most every `min(TTL, 15 s)`; older cached data is served only inside 3 × TTL with its true age in `observed_at`, after which the snapshot fails (502/409) instead of showing old data.
- Extra requests only in these cases, each at most one refresh set (5 requests) and never more often than every 2 seconds: after the live connection (re)connects, and after an accepted command.
- A command costs one `GET loads/<id>` (identity check) and one `PUT loads/<id>/target_state`. Identification costs one `GET buttons` and one `PUT buttons/<id>/ping`.
- Never done: configuration or commissioning endpoints, jobs, calibration, button registration or simulation, pairing, or any write without `WISER_INTEGRATION_CONTROL=1` (the default is read-only; both write routes answer 403 and send nothing to the gateway).
- Open browser dashboards are separate and make their own gateway requests (they poll every 30 seconds without live updates); close them when minimising gateway traffic.

Suggested order: start read-only, confirm the entities and values in Home Assistant, only then set `WISER_INTEGRATION_CONTROL=1` for a supervised test of a harmless light.

## Tests

`node --test test/integration-listener.test.js` runs the proxy checks over plain HTTP, and over HTTPS when `openssl` is available. `node --test test/integration-api.test.js` covers the app side (snapshot, cache, stream, identify).
