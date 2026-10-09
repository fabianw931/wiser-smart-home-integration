"""Set up the Wiser Workspace polling integration."""
import logging
from datetime import timedelta
from homeassistant.const import Platform
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from .api import WorkspaceApi, AuthError, ApiError
from .const import CONF_URL, CONF_TOKEN, DOMAIN
from .model import valid_state

PLATFORMS = [Platform.LIGHT, Platform.COVER]


class WorkspaceCoordinator(DataUpdateCoordinator[dict]):
    def __init__(self, hass, entry):
        super().__init__(hass, logging.getLogger(__name__), name=DOMAIN,
                         config_entry=entry, update_interval=timedelta(seconds=10))
        self.entry = entry
        self.api = WorkspaceApi(async_get_clientsession(hass), entry.data[CONF_URL], entry.data[CONF_TOKEN])

    async def _async_update_data(self):
        try:
            data = await self.api.snapshot()
            if data["gateway"] != self.entry.unique_id:
                raise UpdateFailed("Workspace gateway identity changed")
            return data
        except AuthError as err:
            raise ConfigEntryAuthFailed("Workspace credential rejected") from err
        except ApiError as err:
            raise UpdateFailed("Workspace snapshot unavailable") from err

    async def command(self, load_id, identity, target):
        # Fresh scope is allowed; adopting a new physical identity is never allowed.
        await self.async_refresh()
        if not self.last_update_success:
            raise HomeAssistantError("Workspace state unavailable; command not sent")
        entity = next((e for e in self.data["entities"] if e["id"] == load_id), None)
        if entity is None or entity["identity"] != identity or not valid_state(entity):
            raise HomeAssistantError("Load identity changed or unavailable; command not sent")
        try:
            await self.api.target(load_id, self.data["scope"], identity, target)
        except AuthError as err:
            self.entry.async_start_reauth(self.hass)
            raise HomeAssistantError("Workspace credential rejected") from err
        except ApiError as err:
            await self.async_refresh()
            raise HomeAssistantError("Command unconfirmed; inspect refreshed state before retrying") from err
        await self.async_refresh()


async def async_setup_entry(hass, entry):
    coordinator = WorkspaceCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass, entry):
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
