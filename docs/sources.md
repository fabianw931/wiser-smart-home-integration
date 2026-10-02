---
title: Wiser research sources and open questions
aliases:
  - Sources
  - Open questions
tags:
  - wiser
  - research
  - sources
type: source-register
status: public-source-research
---

# Wiser research sources and open questions

## Primary sources

| Source | Used for |
| --- | --- |
| [Feller product/system overview](https://www.feller.ch/de/connected-buildings/wiser-by-feller/digitale-elektroinstallation) | K+ architecture; switches, dimmers, DALI, blinds, temperature control, weather station |
| [Feller news / Generation B](https://www.feller.ch/de/connected-buildings/wiser-by-feller/wiser-news) | Generation B expansion, 100-device limit, mixed-system limit, upgrade process |
| [Feller integration partners](https://www.feller.ch/de/connected-buildings/wiser-by-feller/integrationen) | Commercial and Matter integration options |
| [Official API documentation index](https://feller-ag.github.io/wiser-api/) | Published versioned documentation |
| [Official API repository](https://github.com/Feller-AG/wiser-api) | Gateway generations, API compatibility statement, article numbers, community projects |
| [OpenAPI 6.0.47](https://github.com/Feller-AG/wiser-api/blob/main/docs/6.0.47/ugateway_openapi_domain_public.yaml) | Exact REST resource and operation names used in these notes |
| [Official tutorial](https://github.com/Feller-AG/wiser-tutorial) | Local API workflow |
| [Authentication tutorial](https://github.com/Feller-AG/wiser-tutorial/blob/main/doc/authentication.md) | Physical pairing, 30-second window, Bearer token |
| [Loads tutorial](https://github.com/Feller-AG/wiser-tutorial/blob/main/doc/api_loads.md) | Basic load types, states, target-state control |
| [WebSocket tutorial](https://github.com/Feller-AG/wiser-tutorial/blob/main/doc/websocket.md) | `/api` connection, load changes, `dump_loads`, `ctrl_loads` |
| [cURL tutorial](https://github.com/Feller-AG/wiser-tutorial/blob/main/doc/tool_curl.md) | Practical HTTP request examples |

## Community sources

- [Home Assistant integration](https://github.com/Syonix/ha-wiser-by-feller): platform distinction, installation, discovery, unique client username, and pairing guidance.
- [Asynchronous Python client](https://github.com/Syonix/aioWiserByFeller): candidate client library, listed by Feller. Its detailed coverage has not yet been audited.

## Version and evidence notes

- The live documentation index observed during research lists **6.0.47** and **5.1.31**. Search-engine snippets returned older 6.x versions, so the live index and raw specification were preferred.
- REST endpoint names were checked against the published **6.0.47** specification.
- The official tutorial is useful for the core workflow, but does not establish all newer product or event capabilities.
- No hardware testing, firmware update, network discovery, or account claim has been performed.
- No supported entity mapping is inferred solely from a product's marketing capabilities.

## Open questions for the actual installation

| Question | How to resolve it |
| --- | --- |
| Which gateway generation and firmware are installed? | Inspect article number and `GET /api/info` |
| Which loads, sensors, and HVAC groups actually exist? | Read documented resource collections with a paired account |
| Are names, rooms, and scenes account-specific? | Compare claimed account behavior; review account clone/sync documentation before changing anything |
| How are DALI color and tunable-white capabilities represented? | Inspect the matching firmware schema and real redacted load records |
| What are the correct cover position/tilt conversions? | Check schema limits and perform safe physical tests |
| Which HVAC modes and target fields are supported? | Review group states/configuration and matching firmware schemas |
| How are weather measurements associated with sensor resources? | Inspect sensor records and weather-group bindings |
| Which resources publish WebSocket events? | Inspect current library behavior and observe actual event messages |
| What reconnection/heartbeat behavior is required? | Test idle periods, gateway restart, and interrupted connectivity |
| Is HTTPS/WSS supported on the installed firmware? | Check gateway documentation and configuration without assuming support |
| How stable are resource IDs? | Compare restarts and controlled configuration changes |
| Does the existing integration cover all required products? | Audit its current code and test against the installation |

## Maintaining these notes

When extending the research:

1. Add a source link next to substantive claims.
2. Record the API or firmware version used.
3. Separate documented behavior, hardware observations, and proposed design.
4. Redact credentials and household-specific details from all examples.
5. Keep standard Markdown links and YAML frontmatter so the notes remain usable in both Obsidian and Git viewers.

Return to [Research index](index.md).
