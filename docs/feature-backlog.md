# Feature ideas and priorities

These are proposals, not implemented features or permission to modify gateway configuration.

## Next: make everyday use easier

1. **Offline installation inventory.** Cache discovered devices in SQLite. Organize names and rooms without a connection; label cached state with its age and disable actual controls while offline.
2. **Favorites and custom ordering.** Pin frequently used lights and rooms. Keep dashboard preferences separate from installer configuration.
3. **Installation checklist.** Mark devices as identified, named, physically tested, or awaiting the installer. Add notes and export a punch list. Never imply software acknowledgement proves physical operation.
4. **Live updates and connection health.** WebSocket state updates, reconnect snapshots, visible last-seen times, and polling fallback.

## Then: richer organization and control

- Floors, zones, and tags alongside rooms, plus an option to hide unused channels without losing diagnostic access.
- Reviewed room-wide lighting actions with per-device outcomes and partial-failure reporting. Keep blinds separate; no implicit all-device movement.
- Favorite brightness/color presets, then scenes and schedules after verifying gateway ownership and firmware support. Explain whether a schedule runs on the gateway or requires this app to remain running.
- Change history and undo for personal mappings; timestamped backups and a restore preview. Gateway changes need a separate audit trail and cannot promise universal undo.
- Compare installer metadata against previous inventory snapshots; flag changed physical identities instead of silently reattaching personal labels.
- Device capability summaries and actionable unavailable-state diagnostics, rather than requiring raw JSON inspection.

## Before household deployment

Authentication, household permissions, encrypted transport, secure credential handling, backup/restore testing, and simultaneous-browser conflict handling. The current localhost service is not ready to expose to a network.
