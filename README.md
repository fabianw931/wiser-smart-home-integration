---
title: Wiser smart home integration
aliases:
  - Wiser research
tags:
  - wiser
  - research
type: project-index
status: research
---

# Wiser smart home integration

Research into **Wiser by Feller** products and the local API available to discover, read, and control their entities.

**Main finding:** Feller provides a documented local REST API and a WebSocket interface through the installation's WLAN-enabled µGateway. Lights and blinds are represented as *loads*. Newer gateways also expose heating, sensors, and weather-related resources.

This repository currently contains documentation, not an implemented integration. Findings are based on public documentation; no physical gateway has been tested.

## Start here

Open [the documentation index](docs/index.md).

```text
README.md
docs/                       ← Open this directory as an Obsidian vault
  index.md                  ← Reading guide and research summary
  products.md               ← Product families and gateway generations
  api-overview.md            ← Local access, versions, authentication, events
  entity-model.md            ← Resource-to-entity mapping and endpoint reference
  getting-started.md         ← Practical discovery and control examples
  integration-options.md    ← Existing integrations and implementation direction
  sources.md                ← Sources, confidence, and outstanding questions
```

## Using the documentation in Obsidian

In Obsidian, choose **Open folder as vault** and select `docs/`. Start with `index.md`.

Every note has YAML frontmatter with a title, aliases, tags, type, and status. Links use standard relative Markdown paths, so they work in Obsidian and repository viewers without plugins. No `.obsidian/` configuration is required or checked in.
