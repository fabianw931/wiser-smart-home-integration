# Native Home Assistant integration

This repository now includes an initial custom integration in `custom_components/wiser_workspace`. It has not been installed or runtime-tested on a Home Assistant VM. No HA configuration or gateway configuration was changed during development.

## Install on Home Assistant OS

1. Prepare the workspace's dedicated HTTPS machine-only endpoint. Do not expose its browser port. HA must reach this endpoint and trust its certificate; the integration never disables TLS verification or follows redirects. Keep the workspace connected to the same gateway hostname/address.
2. Copy the entire `custom_components/wiser_workspace` directory into HA's `/config/custom_components/wiser_workspace`, using your existing file transfer/editor access. Preserve any other custom integrations. Restart Home Assistant.
3. In Settings → Devices & services → Add integration, select **Wiser Workspace**. Enter the HTTPS origin, such as `https://workspace.example:3443`, and the separate integration token. Paths, URL credentials, query strings, and fragments are rejected. The connected gateway snapshot is validated before saving.
4. Start with API control disabled. Verify names, room attributes, brightness and cover direction. Disconnect the workspace and confirm entities become unavailable. Reconnect and check recovery.
5. Enable machine API control only for a supervised physical test. Try a harmless light first. Verify accepted commands against the subsequent reported state. Test blinds only after confirming direction and travel safety. The integration installs no schedules or automations.

HA stores the integration token in its standard config-entry storage under `/config/.storage`; this is not application-level encrypted storage. Protect HA access and backups. Never share that file or screenshots containing credentials. A rejected token prompts credential replacement through HA's reauthentication flow. A control-disabled 403 is a command failure, not a request to replace valid credentials.

## Behavior and limits

One coordinator polls fresh snapshots every ten seconds. Missing, invalid, or failed state reads make entities unavailable. On/off loads use only 0/10000; dim and supported DALI loads expose brightness. DALI tunable white and RGB channels initially expose brightness only: native color-temperature units and full HA color semantics still need hardware verification. Unknown types/subtypes and unused loads are skipped.

Motor covers invert native level: Wiser 0 (open) becomes HA 100 (open); Wiser 10000 (closed) becomes HA 0. There is no stop, tilt, inferred movement state, or commissioning support. A room is exposed as `wiser_room`, not automatically assigned as an HA area.

Entity unique IDs use the API's stable physical identity hash, which includes gateway and load identity. Commands obtain a fresh snapshot scope but retain the entity's original identity. Missing or replaced hardware is refused; no automatic rebinding occurs. Gateway-address aliases also change identity. To discover intentionally added/replaced hardware, review it first and reload the integration; old entities remain unavailable until you deliberately remove them from HA. Discovery occurs at integration setup, not continuously.

Commands are never optimistic. An accepted request triggers a fresh reported-state read; it does not prove physical movement. After a timeout, inspect refreshed state before retrying. Configuration/commissioning endpoints are never used.

## Validation

Pure unit conversions, URL restrictions, capability filtering, and snapshot identities are covered by `test/ha_adapter_test.py`, without requiring HA. Python compilation checks syntax only. Full config-flow, coordinator, entity-registry, TLS, and physical command verification still requires your running HA instance.

The implementation follows HA's primary documentation for [coordinated polling](https://developers.home-assistant.io/docs/integration_fetching_data/), [config flows](https://developers.home-assistant.io/docs/core/integration/config_flow/), [authentication failures](https://developers.home-assistant.io/docs/integration_setup_failures/), [light color modes](https://developers.home-assistant.io/docs/core/entity/light/), and [cover entities](https://developers.home-assistant.io/docs/core/entity/cover/).
