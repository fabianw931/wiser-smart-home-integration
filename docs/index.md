---
title: Wiser by Feller research
aliases:
  - Wiser research index
  - Start here
tags:
  - wiser
  - index
type: index
status: researched-not-hardware-tested
---

# Wiser by Feller research

## What we found

- **Wiser by Feller** is a Swiss wired home-automation system covering lighting, blinds, heating, and weather-based control.
- It uses an additional **K+ wire** to connect the installation. A WLAN-enabled device provides the **µGateway** used for app and API access.
- Feller publishes an **OpenAPI specification** for the gateway's local REST API.
- The official tutorial documents **WebSocket push updates** for load states.
- Physical devices, controllable outputs, sensors, buttons, rooms, and automation objects are separate API resources—not a single generic “entity” collection.
- API **5.x** targets µGateway v1 / Generation A; API **6.x** targets µGateway v2 / Generation B. Feller describes 6.x as backward compatible with 5.1.
- An existing community Home Assistant integration and asynchronous Python library are available.

**Important distinction:** Wiser by Feller is not the same platform as Wiser by Schneider Electric. Do not assume Schneider Wiser hubs, Zigbee devices, or APIs are compatible.

## Reading paths

### Understand the hardware

Read [Products and generations](products.md), then [Integration options](integration-options.md).

### Connect to a gateway

Read [API overview](api-overview.md), then [Getting started](getting-started.md).

### Try the local proof of concept

See the [dashboard architecture, use, scope, and hardware-validation checklist](dashboard.md).

### Restart paused development

Read the [checkpoint and fresh-worker handoff](restart-handoff.md). It distinguishes the committed vanilla POC from the unfinished Svelte migration and backend fixes.

### Design an integration

Read [Entity model](entity-model.md), then [Integration options](integration-options.md).

### Check evidence and limitations

Read [Sources and open questions](sources.md).

## Research boundaries

These notes summarize the public product pages, the official tutorial, and OpenAPI **6.0.47**. The official documentation index also lists **5.1.31**. Those are documentation versions observed during this research, not a guarantee that an installed gateway runs them.

No connection to a real installation has been made. Examples are illustrative, and entity mappings are integration recommendations rather than claims of tested platform support.
