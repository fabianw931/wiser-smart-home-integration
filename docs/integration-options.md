---
title: Wiser integration options
aliases:
  - Existing integrations
  - Implementation direction
tags:
  - wiser
  - integration
type: research
status: recommendations-not-implemented
---

# Wiser integration options

## Existing software

| Option | Role | Notes |
| --- | --- | --- |
| [Syonix/ha-wiser-by-feller](https://github.com/Syonix/ha-wiser-by-feller) | Community Home Assistant integration | Supports Wiser by Feller; README describes lights, covers, and scene buttons, discovery, HACS installation, and physical pairing |
| [Syonix/aioWiserByFeller](https://github.com/Syonix/aioWiserByFeller) | Asynchronous Python client | Listed by Feller as an API project; evaluate coverage before writing another low-level client |
| [hansfriedrich/homebridge-feller-wiser](https://github.com/hansfriedrich/homebridge-feller-wiser) | Homebridge integration | Listed in Feller's API repository |
| [ice987987/ioBroker.wiserbyfeller](https://github.com/ice987987/ioBroker.wiserbyfeller) | ioBroker integration | Listed in Feller's API repository |
| Matter gateways/bridges | Expose Wiser through a different interoperability layer | Feller lists partners including Atios WiserPort and plan44 |

These are research leads, not tested endorsements. Confirm maintenance, licensing, gateway compatibility, and exact entity support before adopting them.

## Recommended direction

**For Home Assistant:** evaluate the existing community integration first. Reimplementing pairing, resource discovery, reconnection, and entity conversion is likely unnecessary if its coverage meets the project's needs.

**For a custom application:** evaluate the existing Python client if Python fits the stack. Otherwise, build a small local REST client and add WebSocket updates around a clearly defined resource model.

**For Matter interoperability:** investigate an existing bridge, but verify which Wiser features it exposes. A Matter entity model may omit native configuration or automation details available through REST.

## Suggested custom-client workflow

1. Read gateway information and identify the supported API family.
2. Pair with a unique client username and persist the token in a credential store.
3. Discover devices, loads, rooms, and supported supplementary resources.
4. Read initial states.
5. Connect the authenticated WebSocket and process verified event types.
6. Resynchronize after connection loss.
7. Send explicit target-state commands and observe reported state.
8. Keep commissioning and destructive operations out of the normal entity-control interface.

## Minimum validation before implementation

- Capture redacted discovery/state responses from the actual gateway.
- Confirm identity stability across restarts and recommissioning.
- Check room and scene visibility under the newly claimed account.
- Verify on/off and dimming conversions.
- Verify cover position, tilt, stop, and direction semantics.
- Verify HVAC units and target modes where heating is installed.
- Verify sensor units and weather-station resource associations.
- Confirm event coverage and reconnect behavior on the installed firmware.
- Test authentication failure and account re-claim behavior without disrupting another client.

## Sources

- [Feller API repository: community projects](https://github.com/Feller-AG/wiser-api)
- [Feller integration partners](https://www.feller.ch/de/connected-buildings/wiser-by-feller/integrationen)
- [Home Assistant integration README](https://github.com/Syonix/ha-wiser-by-feller)

Related: [Entity model](entity-model.md) · [Sources and open questions](sources.md)
