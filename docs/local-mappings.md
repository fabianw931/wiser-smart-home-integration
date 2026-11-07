---
title: Personal mappings and gateway configuration
aliases:
  - Local configuration
tags:
  - wiser
  - dashboard
  - configuration
type: guide
status: software-tested-hardware-untested
---

# Personal mappings and gateway configuration

Personal configuration and device control are independent. Connected lights and blinds respond to their controls normally. There is no preview mode that disables real device interaction.

## Your own names, rooms, and notes

Open **Settings → Names & notes**, choose a load, and enter a personal display name, room label, and notes. Choose **Save local mapping**. These labels appear on Home and in its room filter immediately. Room labels are free text: you can organize your home before the installer has finished creating gateway rooms.

On **Home**, open **More** on any device and use its **Name & room** section to edit the same personal name, room, and notes without navigating away. Saving moves the device to its personal room group immediately. Cancel leaves labels unchanged; a failed save retains your input for retry. The dashboard defaults to room groups, with device-type and flat-list alternatives under **Group devices by**. These groups organize the dashboard; they do not create gateway rooms or DALI groups.

Saving, removing, importing, or exporting personal mappings, floors, and pins makes no gateway requests. A mapping is your own dashboard organization, not a pending change to be applied to the installation. Changes to the installer's names or rooms do not overwrite your labels.

Mappings use the gateway address plus the load's physical identity (ID, device, channel, type). They survive reloads, disconnect/reconnect, browser changes, and server restarts when using the same database. A missing load or changed identity retains its saved mapping but does not use it automatically.

## Saving on your laptop

Personal mappings are stored in **SQLite** on the computer running the app, by default at `data/wiser.sqlite` relative to the repository. `WISER_DB_PATH=/absolute/path/wiser.sqlite npm start` selects another file. Node.js 22.13+ supplies SQLite without an extra database service. The database stores gateway address, load ID, physical identity, personal name, room label, notes, and update timestamp; credentials and raw gateway responses are never stored. Database files are ignored by Git and created with owner-only permissions on Unix.

Existing localStorage mappings migrate when that gateway is opened in the original browser. Existing database entries win; browser entries are cleared only after successful import. Migration failure retains the browser copy. Clearing browser site data after migration no longer deletes your mappings. Use a consistent gateway address: switching between its IP and hostname creates a separate mapping scope.

## Backup: export and import everything

**Settings → Backup → Export configuration** downloads one versioned JSON file, `wiser-configuration-<gateway>-<YYYY-MM-DD>.json`, for the connected gateway (or the sample home):

```json
{
  "version": 2,
  "kind": "wiser-workspace-configuration",
  "gateway": "192.168.1.10",
  "exported_at": "2026-03-04T10:20:30.000Z",
  "mappings": { "1": { "identity": "…", "name": "Entrance pendant", "room": "Studio", "notes": "" } },
  "layout": { "floors": [{ "name": "Ground floor", "rooms": ["Studio"] }], "favorites": { "loads": [2], "rooms": ["Studio"] } },
  "devices": [{ "id": 1, "type": "onoff", "sub_type": null, "device": "0000a98f", "channel": 0,
    "gateway_name": "Hall light", "gateway_room": "Hall", "personal_name": "Entrance pendant", "personal_room": "Studio", "unused": false }]
}
```

- **Included:** personal names, room labels and notes (`mappings`), floors with their room order and pinned devices and rooms (`layout`).
- **Reference only:** `devices` lists every device the app currently knows with the name and room *the gateway itself* reports (`gateway_name`, `gateway_room`, taken before personal names are applied) next to your personal name and room. It helps you match your labels to the real installation, for example when sending the file to an installer. It is ignored on import and never stored, and whatever it contains cannot make an import fail.
- **Not included:** gateway configuration, device states, credentials, tokens, session scope, other gateways' data, and raw gateway responses.

**Import configuration** reads a file, checks it, and shows a preview such as *Will add 3 personal names, 1 floor, 2 pinned items; 4 entries already exist and are kept.* Nothing is saved until you choose **Apply**; **Cancel** discards the file. Files for another gateway, files over 1 MB, malformed or unknown fields (a version 2 file may not carry extra top-level fields such as a token), and invalid mappings or layouts are rejected with a message and change nothing. Version 1 files (mappings only, from earlier releases) are still accepted.

Merge rules (existing data always wins; to replace something, remove it first):

- **Personal names:** only ids that have no entry yet are added.
- **Floors:** a floor whose name does not exist yet (case-insensitive) is added; within an existing floor, only rooms that are not placed on any floor yet are appended. A room already placed anywhere stays where it is. If a merge would exceed a limit (20 floors, 200 rooms per floor, 200 pins, 1000 names) the import is rejected before anything is written.
- **Pins:** devices and rooms are united; nothing is unpinned.

Apply writes the personal names first and then the floors and pins, both through the same local routes used by the editors (`POST /api/local/mappings/import`, `PUT /api/local/layout`). They are two writes, not one transaction: if the second fails, the message states exactly what was imported (for example the names) and what was not (floors and pins); choosing the file again adds only what is missing. Importing the same file twice changes nothing the second time. The sample home's illustrative layout is not saved data, so it is neither exported nor merged; the sample home otherwise uses its own saved scope (`sample-home`). Restoring never writes to the gateway.

Failed database writes show an error and are not presented as saved. Device controls remain independent. For a complete database backup, stop the server and copy `data/wiser.sqlite`; restore it while the server is stopped. JSON exports are portable, per-gateway backups. Files contain household labels and notes, so keep them private. Do not put credentials in personal notes.

Only personal mappings, floors, and pins are persisted so far. Discovered device inventory and live state are not cached, so editing a real installation in the UI still requires connecting. This is the next offline-configuration milestone.

## Real gateway changes, separately

Under the selected load, expand **Change gateway metadata…**. This separate form starts with gateway values, not personal mappings. Edit the gateway name or choose an existing gateway room, then choose **Review gateway change**. Only **Apply this change to gateway** sends the listed fields.

Local mappings remain unchanged after applying gateway metadata. Custom personal room labels do not create gateway rooms.

The backend checks the current connection scope, the discovered physical identity, and the expected original values before sending PATCH. Stale tabs and detected installer changes are rejected. The preflight is not atomic: the gateway does not offer conditional updates, so another client can still change a value between read and write.

This release does not change device commissioning, DALI groups, calibration, wiring settings, scenes, or HVAC configuration. Leave the gateway section closed while installer configuration is unfinished.

## Sample home

**Explore sample home** loads clearly labeled fictional data without contacting a gateway. Controls simulate state changes. Its mappings are stored separately from real installations; real gateway changes are disabled.

See [dashboard operation](dashboard.md) and the [visual concepts](ui-concepts.html).
