---
title: Wiser local API overview
aliases:
  - REST API
  - WebSocket API
tags:
  - wiser
  - api
type: reference
status: documented-not-hardware-tested
---

# Wiser local API overview

## Access model

The integration talks to the installation's **µGateway on the local network**:

- REST: `http://<gateway-ip>/api/...`
- WebSocket: `ws://<gateway-ip>/api`
- REST payloads and WebSocket messages use JSON.
- Normal authenticated requests carry `Authorization: Bearer <token>`.

The documented local workflow does not require a cloud API account. Do not infer cloud remote-access capabilities from these local endpoints.

## Versions

Feller publishes separate API specifications for gateway generations:

| Gateway | API family | Documentation version observed |
| --- | --- | --- |
| µGW v1 / Generation A | 5.x | 5.1.31 |
| µGW v2 / Generation B | 6.x | 6.0.47 |

The API repository states that 6.x is backward compatible with 5.1. Match implementation details to the actual gateway firmware and capabilities; the newest published specification is not evidence of what a particular installation supports.

Start with `GET /api/info` to inspect gateway information. Discover resources rather than assuming every product family is present.

## Authentication and pairing

The official tutorial describes:

1. Send `POST /api/account/claim` with `{"user":"your-client-name"}`.
2. The gateway's physical buttons flash for approximately **30 seconds**.
3. Press a physical gateway button within that window.
4. The successful response contains `data.user` and `data.secret`.
5. Use `data.secret` as the Bearer token for subsequent requests.

Use a **different username for each client installation**. The community Home Assistant integration warns that a second claim with the same username deauthorizes the first client.

Treat the returned token as a credential. Never commit it, include it in documentation, or save it in an Obsidian vault. Read [Getting started](getting-started.md) for examples.

## REST response shape

The official tutorial shows responses such as:

```json
{
  "data": [
    {
      "id": 1,
      "type": "onoff",
      "name": "Hall light",
      "device": "0000133a",
      "channel": 0,
      "unused": false
    }
  ],
  "status": "success"
}
```

Errors can carry `"status":"error"` and a message. A client should check both HTTP results and the API response envelope.

## State snapshots versus push updates

For lighting and blinds:

- `GET /api/loads` discovers the resources.
- `GET /api/loads/state` reads a complete current-state snapshot.
- An authenticated WebSocket connection to `/api` receives load-state changes.
- `{"command":"dump_loads"}` requests current load states over WebSocket.

Example pushed message from the official tutorial:

```json
{"load":{"id":1,"state":{"bri":10000}}}
```

The tutorial explicitly says **only changes are transmitted** during normal event delivery. Obtain an initial snapshot, and resynchronize after reconnecting. Do not mark unreported loads as off.

The tutorial also documents a `ctrl_loads` WebSocket command that simulates a button event. Prefer REST `target_state` for explicit desired-state writes unless button semantics are needed.

WebSocket behavior for newer sensors, HVAC groups, and button events still needs verification against the current client library, firmware, or hardware. Do not extrapolate the tutorial's load examples into guaranteed event coverage for every resource.

## Safety considerations

- The documented examples use unencrypted HTTP and WebSocket. Keep the gateway on a trusted LAN and do not expose it directly to the Internet. Confirm any HTTPS/WSS support separately.
- Some **GET** endpoints have side effects: job execution, device identification, configuration mode, and motor calibration. Do not blindly enumerate or prefetch every GET endpoint.
- Use ordinary discovery endpoints for initial research. Avoid resets, binding changes, calibration, and commissioning APIs.
- Writing a target state does not prove the physical device reached it. Observe the reported state afterward.

## Sources

- [Official versioned API documentation](https://feller-ag.github.io/wiser-api/)
- [Official authentication tutorial](https://github.com/Feller-AG/wiser-tutorial/blob/main/doc/authentication.md)
- [Official WebSocket tutorial](https://github.com/Feller-AG/wiser-tutorial/blob/main/doc/websocket.md)
- [Home Assistant integration pairing guidance](https://github.com/Syonix/ha-wiser-by-feller)

Related: [Entity model](entity-model.md) · [Getting started](getting-started.md)
