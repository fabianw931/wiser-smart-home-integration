---
title: Wiser local dashboard
aliases:
  - Local dashboard
tags:
  - wiser
  - dashboard
type: guide
status: software-tested-hardware-untested
---

# Wiser local dashboard

The Svelte/Vite frontend and Node backend share a localhost origin at port 3000 by default. The backend talks to the Wiser by Feller gateway over its local HTTP API. See [README](../README.md) for startup and [handoff](development-handoff.md) for verification.

## Home and device control

Connect using an existing token or explicitly pair a new gateway account. Connected controls operate real equipment immediately. Personal configuration does not disable controls or simulate them.

Home shows load cards, reported state, a name search, and room filters. Personal mappings override dashboard names and rooms without changing gateway data. Brightness and blind positions use 0–100%; 0% means open and 100% closed for blinds. Keep the travel path clear and verify orientation.

DALI loads support brightness; subtype tw also supports ct 1000–20000 in the documented API scale, and subtype rgb supports red, green, blue, and white 0–255. Unknown or unused loads remain read-only. Missing/invalid reported primary values disable the affected card.

Commands send explicit targets, then refresh the reported states. An accepted target is not confirmation that equipment reached it. Core reads are sequential; optional diagnostics refresh in their own background pass. Polling starts 30 seconds after core requests finish.

## Personal configuration

**Configuration** saves names, custom room labels, and notes in the local SQLite database. This is a personal mapping, not a draft for later automatic application. Save, remove, import, and export never send gateway commands. Mappings survive browser and server restarts and reconnects. **Export mappings** downloads a portable JSON backup.

The collapsed **Change gateway metadata…** editor is separate. Its name and existing-room changes require review and **Apply this change to gateway** confirmation. It never copies personal labels automatically. The backend checks session scope, physical identity, expected metadata, and room existence. Installer changes detected at preflight reject the update, although no atomic conditional update is available.

See [local mappings](local-mappings.md) for storage boundaries and import behavior. Installer settings, commissioning, DALI groups, and calibration are not implemented.

## Diagnostics and sample home

The dashboard now subscribes to gateway load-state changes through a scoped local stream. The update indicator shows Live or Polling. Partial updates preserve unrelated channels; reconnect requests a fresh snapshot. Thirty-second polling remains enabled as a fallback and consistency check. This is tested with fake gateways, not yet on physical equipment.

Diagnostics exposes fixed, read-only resource collections: info, rooms, devices, sensors, buttons, SmartButtons, weather groups, HVAC groups and states. The app also reads loads and load states. Unsupported resources are shown separately.

## Buttons and weather

**Buttons** lists registered and unregistered physical inputs, with search, physical-device filters, and reported job references. Missing job metadata does not mean a switch is unbound. The SmartButton list is shown separately; no registration, reassignment, job execution, or press-event monitoring is implemented yet.

**Identify · flash LED for 2 seconds** is an explicit physical action. The backend freshly checks the selected device/channel, requires the current session and live intent, and sends only a fixed two-second LED ping. It cannot change assignments or override LEDs persistently. Unregistered inputs use the documented physical `device_channel` address. Sample-home identification is disabled.

**Weather** shows sensor values and units reported by the gateway. Zero wind and false rain/hail are valid readings, not missing data. Missing or unrecognized values are marked unavailable. All sensor types are included because temperature/illuminance alone do not establish weather-station membership; filter by physical device to inspect a station. No sensor units or station associations are guessed.

Weather protection cards show configured wind/temperature/rain/hail actions, thresholds, and associated load names. These are configuration snapshots, **not live alarms, active-lock indicators, or proof that equipment is protected**. Weather tests, bindings, thresholds, and commissioning remain untouched.

Both pages use background snapshot reads with independent fetch timestamps, unsupported/unavailable indicators, and stale status after 90 seconds. The Live indicator concerns load updates only; button/weather push events are not consumed. Refresh now requests a new snapshot. The sample home includes fictional buttons and weather for disconnected exploration.

Contract: [Feller OpenAPI 6.0.47](https://github.com/Feller-AG/wiser-api/blob/main/docs/6.0.47/ugateway_openapi_domain_public.yaml), button inventory/ping, sensors, SmartButtons, and WEST groups. These features have fake-gateway coverage; exact firmware support and physical LED behavior still require hardware validation.

**Explore sample home** is explicitly fictional and disconnected. Its controls simulate values without gateway requests. Sample mappings have their own local storage scope.

## Local security boundary

This app has no user login and stays bound to localhost. Do not expose, forward, or reverse-proxy its port. All tabs share the backend gateway session; a stale tab cannot write to a replacement session.

Tokens stay in server memory by default. Opt-in [remembered connections](remembered-connection.md) use encrypted local files and reconnect on startup. Tokens are never included in exported mappings. Closing a tab does not clear the token. Disconnect for now keeps saved credentials; Disconnect & forget credentials clears them without revoking the gateway account. Pairing creates an account; cancelling cannot guarantee that an already created account is undone.

Gateway traffic uses unencrypted HTTP. Prefer a known gateway IP on a trusted network. No DNS pinning or LAN interception protection is claimed.

## Safe first hardware validation

1. Identify gateway generation/firmware and verify that discovery matches the intended installation.
2. Test an accessible, low-risk light first and compare the physical result with reported state.
3. Confirm blind orientation and travel behavior before using motor controls.
4. Use local personal configuration while installer setup is unfinished. Open the gateway metadata editor only for intentional real configuration changes.
5. Test network interruption and reconnect behavior separately. Current automated tests use fake gateways, not physical equipment.

See the [static visual concepts](ui-concepts.html).
