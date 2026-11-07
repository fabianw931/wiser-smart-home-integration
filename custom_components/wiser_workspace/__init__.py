"""Set up the Wiser Workspace integration (events stream with a snapshot fallback)."""
from homeassistant.const import Platform
from .coordinator import WorkspaceCoordinator

PLATFORMS = [Platform.LIGHT, Platform.COVER, Platform.SENSOR, Platform.BINARY_SENSOR, Platform.BUTTON]


async def async_setup_entry(hass, entry):
    coordinator = WorkspaceCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    coordinator.async_start_events()
    return True


async def async_unload_entry(hass, entry):
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
