---
title: Wiser by Feller products
aliases:
  - Product portfolio
  - Gateway generations
tags:
  - wiser
  - hardware
type: research
status: documented
---

# Wiser by Feller products

## System architecture

Wiser by Feller connects installed devices using an additional **K+ control wire**. It is not simply a collection of Wi-Fi or Zigbee accessories.

Feller states that its lighting and blind-control devices are available with or without WLAN. One WLAN-enabled device can connect the installation to the home network. Its gateway function is called the **µGateway** in the API documentation.

The electrician commissions the installation using a magnet or the **Wiser eSetup** app. The **Wiser Home** app is the user-facing control application.

## Product families

| Family | Products and functions described by Feller | Integration relevance |
| --- | --- | --- |
| Switching | 1-channel and 2-channel push switches | Discover controllable on/off loads |
| Dimming | 1-channel and 2-channel universal LED dimmers | Discover brightness-controlled loads |
| DALI lighting | 1-channel DALI dimmer, supporting DT8 tunable-white or RGBW drivers | Hardware supports more than brightness; confirm the installed firmware's API representation before implementing color controls |
| Blinds and shading | 1-channel and 2-channel blind switches for blinds, shutters, and awnings | Discover motor loads with position, tilt, and movement state |
| Auxiliary controls | Additional control points and central/group controls | Distinguish physical buttons from the loads they control |
| Room-temperature control | Room-temperature sensor and heating controller | Read sensors and HVAC groups; expose room-level climate controls |
| Weather station | Wind, rain, outdoor temperature, and light intensity | Expose sensor measurements; understand weather-protection groups separately |
| WLAN gateway function | WLAN-enabled control attachment/device | Entry point for the local REST and WebSocket API |

This is a functional overview, not a complete catalogue of order numbers or design variants.

## Generation A versus Generation B

| Property | Generation A / µGW v1 | Generation B / µGW v2 |
| --- | --- | --- |
| API family | 5.x | 6.x; documented as backward compatible with 5.1 |
| Article-number index | Contains `A`, e.g. `926-3401.1.W.A.F.61` | Contains `B`, e.g. `926-3401.1.W.B.F.61` |
| Installation size | Feller states a 50-device limit for mixed A/B installations | Up to 100 devices in an all-Generation-B installation |
| New heating/weather functionality | Requires the appropriate upgrade described by Feller | Platform used for the newer functionality |

Feller states that existing Generation A installations can be extended with heating and weather functionality by replacing the WLAN control attachment with Generation B. A mixed installation remains limited to 50 devices.

The published upgrade instructions require recommissioning with eSetup and deleting/re-adding the installation in Wiser Home, including recreating user settings. Treat this as a planned hardware migration—not an API-only change.

## Naming warning

**Wiser by Feller** and **Wiser by Schneider Electric** are different platforms despite the related companies and shared Wiser branding. Confirm the gateway product and article number before choosing an integration.

## Sources

- [Feller product/system overview](https://www.feller.ch/de/connected-buildings/wiser-by-feller/digitale-elektroinstallation)
- [Feller Generation B and expansion information](https://www.feller.ch/de/connected-buildings/wiser-by-feller/wiser-news)
- [Official API repository: versions and article numbers](https://github.com/Feller-AG/wiser-api)

Related: [API overview](api-overview.md) · [Entity model](entity-model.md)
