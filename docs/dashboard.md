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

**Configuration** saves names, custom room labels, and notes in browser localStorage. This is a personal mapping, not a draft for later automatic application. Save, remove, import, and export never send gateway commands. Mappings survive browser restarts and reconnects. **Export mappings** downloads a portable JSON backup.

The collapsed **Change gateway metadata…** editor is separate. Its name and existing-room changes require review and **Apply this change to gateway** confirmation. It never copies personal labels automatically. The backend checks session scope, physical identity, expected metadata, and room existence. Installer changes detected at preflight reject the update, although no atomic conditional update is available.

See [local mappings](local-mappings.md) for storage boundaries and import behavior. Installer settings, commissioning, DALI groups, and calibration are not implemented.

## Diagnostics and sample home

Diagnostics exposes fixed, read-only resource collections: info, rooms, devices, sensors, HVAC groups and states. The app also reads loads and load states. Unsupported resources are shown separately.

**Explore sample home** is explicitly fictional and disconnected. Its controls simulate values without gateway requests. Sample mappings have their own local storage scope.

## Local security boundary

This app has no user login and stays bound to localhost. Do not expose, forward, or reverse-proxy its port. All tabs share the backend gateway session; a stale tab cannot write to a replacement session.

Tokens stay in server memory and are not persisted or included in exported mappings. Closing a tab does not clear the token. Disconnect clears local server credentials but does not revoke the gateway account. Pairing creates an account; cancelling cannot guarantee that an already created account is undone.

Gateway traffic uses unencrypted HTTP. Prefer a known gateway IP on a trusted network. No DNS pinning or LAN interception protection is claimed.

## Safe first hardware validation

1. Identify gateway generation/firmware and verify that discovery matches the intended installation.
2. Test an accessible, low-risk light first and compare the physical result with reported state.
3. Confirm blind orientation and travel behavior before using motor controls.
4. Use local personal configuration while installer setup is unfinished. Open the gateway metadata editor only for intentional real configuration changes.
5. Test network interruption and reconnect behavior separately. Current automated tests use fake gateways, not physical equipment.

See the [static visual concepts](ui-concepts.html).
