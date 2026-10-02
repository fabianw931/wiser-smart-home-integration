---
title: Wiser resources and entity mapping
aliases:
  - Entity model
  - Endpoint reference
tags:
  - wiser
  - api
  - entities
type: reference
status: documented-with-proposed-mappings
---

# Wiser resources and entity mapping

## There is no single generic entity endpoint

The API separates **physical devices** from their **loads**, **sensors**, and **buttons**. One physical device can therefore produce multiple integration entities.

Rooms and automation objects provide additional organization and behavior. Do not create one entity per device and assume it captures every channel.

## Discovery and proposed mapping

The endpoint names below are present in OpenAPI **6.0.47**. Availability on older gateways must be checked separately.

| API resource | Read endpoint | Meaning | Suggested integration representation |
| --- | --- | --- | --- |
| Gateway information | `GET /api/info` | Gateway and component information | Integration/device metadata |
| Devices | `GET /api/devices` | Basic physical-device records | Device registry, not necessarily a controllable entity |
| Rooms | `GET /api/rooms` | Room descriptions | Areas / room metadata |
| Loads | `GET /api/loads` | Controllable output channels | Light, switch, or cover depending on type and installation |
| Load states | `GET /api/loads/state` | Current state of all loads | State initialization and refresh |
| Sensors | `GET /api/sensors` | Sensor records and properties | Sensor or binary sensor according to documented measurement type |
| Buttons | `GET /api/buttons` | Button records and properties | Event entities or automation triggers where event support is confirmed |
| Managed buttons | `GET /api/buttons/managed` | Managed subset of buttons | Additional discovery context; do not treat all button collections as interchangeable |
| SmartButtons | `GET /api/smartbuttons` | SmartButton objects associated with jobs | Scene/automation triggers after resolving their job references |
| HVAC groups | `GET /api/hvacgroups` | Heating groups | Room-level climate entity, subject to group capabilities |
| HVAC states | `GET /api/hvacgroups/state` | Current heating-group states | Climate state initialization and refresh |
| Weather groups | `GET /api/westgroups` | Weather-station groups associated with loads and protection behavior | Configuration/automation context, not a replacement for individual weather measurements |
| Scenes | `GET /api/scenes` | Scene records | Scene entities after resolving execution behavior |
| Jobs | `GET /api/jobs` | Stored actions, target states, controls, and scripts | Executable action backing scenes and controls |
| Group controls | `GET /api/groupctrls` | Group-control objects | Group/automation context |
| Timers and schedulers | `GET /api/timers`, `GET /api/schedulers` | Time-based automation objects | Optional automation management; not required for basic entity control |

These mappings are design recommendations, not a statement that an existing integration implements every row.

## Core load types

The official loads tutorial documents:

| Load type | State/control fields | Typical entity |
| --- | --- | --- |
| `onoff` | `bri` | On/off light or switch |
| `dim` | `bri` | Dimmable light |
| `motor` | `level`, `tilt`, `moving` | Cover / blind |

Brightness examples use the scale **0–10000**: `0` is off and `10000` is fully on. Convert this deliberately if the target platform uses percentages or 0–255.

The official motor tutorial's level convention is **0 = open** and **10000 = closed**; motor tilt is a **step count, not degrees**. Verify installation orientation and actual behavior before controlling a real blind. Do not infer tilt degrees or assume that target-platform stop semantics are interchangeable.

The product portfolio includes DALI DT8 color-capable hardware. This tutorial's three basic types are not sufficient evidence for the exact color-control schema on current firmware.

## Read and control endpoints

| Operation | Endpoint |
| --- | --- |
| Read one load | `GET /api/loads/{id}` |
| Read one load state | `GET /api/loads/{id}/state` |
| Set an explicit target | `PUT /api/loads/{id}/target_state` |
| Simulate a load button event | `PUT /api/loads/{id}/ctrl` |
| Read one sensor | `GET /api/sensors/{id}` |
| Set HVAC target | `PUT /api/hvacgroups/{id}/target_state` |
| Run a job's stored load targets | `GET /api/jobs/{id}/run` |
| Trigger the whole job | `GET /api/jobs/{id}/trigger` |

`run` and `trigger` are **not equivalent**: the specification describes `run` as sending the job's load target states, while `trigger` triggers the whole job. Jobs can also include flags, button controls, and scripts.

The specification lists scene CRUD endpoints, but not a generic `POST /api/scenes/{id}/activate`. Resolve the scene/job relationship instead of inventing an activation URL.

Although the API also provides `PUT /api/loads/{id}/state`, use the documented **target-state** workflow for ordinary desired-state control.

## Metadata and identity

The tutorial's load records include `id`, `type`, `name`, `device`, `channel`, and `unused`.

Suggested implementation rules:

- Keep device and channel relationships; a two-channel product is not one controllable output.
- Scope entity identifiers to the gateway rather than assuming load IDs are globally unique.
- Use human-readable names as labels, never as the sole stable identifier.
- Preserve room associations where available.
- Decide explicitly how to handle `unused` channels rather than exposing everything by default.
- Treat sensor units, range conversions, and supported features as schema-driven—not inferred from a product name.
- Check whether user-specific configuration affects names, rooms, scenes, and visibility.

## Sources

- [OpenAPI 6.0.47 specification](https://github.com/Feller-AG/wiser-api/blob/main/docs/6.0.47/ugateway_openapi_domain_public.yaml)
- [Official load discovery and control tutorial](https://github.com/Feller-AG/wiser-tutorial/blob/main/doc/api_loads.md)

Related: [Products](products.md) · [API overview](api-overview.md) · [Integration options](integration-options.md)
