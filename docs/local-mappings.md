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

Open **Configuration**, choose a load, and enter a personal display name, room label, and notes. Choose **Save local mapping**. These labels appear on Home and in its room filter immediately. Room labels are free text: you can organize your home before the installer has finished creating gateway rooms.

Saving, removing, importing, or exporting personal mappings makes no gateway requests. A mapping is your own dashboard organization, not a pending change to be applied to the installation. Changes to the installer's names or rooms do not overwrite your labels.

Mappings use the gateway address plus the load's physical identity (ID, device, channel, type). They survive reloads, disconnect/reconnect, browser changes, and server restarts when using the same database. A missing load or changed identity retains its saved mapping but does not use it automatically.

## Saving on your laptop

Personal mappings are stored in **SQLite** on the computer running the app, by default at `data/wiser.sqlite` relative to the repository. `WISER_DB_PATH=/absolute/path/wiser.sqlite npm start` selects another file. Node.js 22.13+ supplies SQLite without an extra database service. The database stores gateway address, load ID, physical identity, personal name, room label, notes, and update timestamp; credentials and raw gateway responses are never stored. Database files are ignored by Git and created with owner-only permissions on Unix.

Existing localStorage mappings migrate when that gateway is opened in the original browser. Existing database entries win; browser entries are cleared only after successful import. Migration failure retains the browser copy. Clearing browser site data after migration no longer deletes your mappings. Use a consistent gateway address: switching between its IP and hostname creates a separate mapping scope.

**Export mappings** downloads a versioned JSON file to your laptop. Keep this file as a portable backup. **Import mappings** validates the file's gateway and fields, adds missing entries, and keeps existing entries. If you want to replace a local entry, remove that entry before importing. Import does not alter the gateway.

Failed database writes show an error and are not presented as saved. Device controls remain independent. For a complete database backup, stop the server and copy `data/wiser.sqlite`; restore it while the server is stopped. JSON exports are portable, per-gateway backups. Files contain household labels and notes, so keep them private. Do not put credentials in personal notes.

Only personal mappings are persisted so far. Discovered device inventory and live state are not cached, so editing a real installation in the UI still requires connecting. This is the next offline-configuration milestone.

## Real gateway changes, separately

Under the selected load, expand **Change gateway metadata…**. This separate form starts with gateway values, not personal mappings. Edit the gateway name or choose an existing gateway room, then choose **Review gateway change**. Only **Apply this change to gateway** sends the listed fields.

Local mappings remain unchanged after applying gateway metadata. Custom personal room labels do not create gateway rooms.

The backend checks the current connection scope, the discovered physical identity, and the expected original values before sending PATCH. Stale tabs and detected installer changes are rejected. The preflight is not atomic: the gateway does not offer conditional updates, so another client can still change a value between read and write.

This release does not change device commissioning, DALI groups, calibration, wiring settings, scenes, or HVAC configuration. Leave the gateway section closed while installer configuration is unfinished.

## Sample home

**Explore sample home** loads clearly labeled fictional data without contacting a gateway. Controls simulate state changes. Its mappings are stored separately from real installations; real gateway changes are disabled.

See [dashboard operation](dashboard.md) and the [visual concepts](ui-concepts.html).
