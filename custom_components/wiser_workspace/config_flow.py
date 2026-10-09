"""UI configuration and credential replacement."""
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers import selector
from .api import WorkspaceApi, AuthError, ApiError
from .const import DOMAIN, CONF_URL, CONF_TOKEN
from .model import base_url


class WorkspaceConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input is not None:
            try:
                url = base_url(user_input[CONF_URL])
                token = user_input[CONF_TOKEN]
                data = await WorkspaceApi(async_get_clientsession(self.hass), url, token).snapshot()
            except ValueError:
                errors["base"] = "invalid_url"
            except AuthError:
                errors["base"] = "invalid_auth"
            except ApiError:
                errors["base"] = "cannot_connect"
            else:
                await self.async_set_unique_id(data["gateway"])
                if self.source == config_entries.SOURCE_REAUTH:
                    entry = self._get_reauth_entry()
                    if entry.unique_id != data["gateway"]:
                        return self.async_abort(reason="wrong_gateway")
                    return self.async_update_reload_and_abort(entry, data_updates={CONF_URL: url, CONF_TOKEN: token})
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title="Wiser Workspace", data={CONF_URL: url, CONF_TOKEN: token})
        return self.async_show_form(step_id="user", data_schema=vol.Schema({
            vol.Required(CONF_URL): str,
            vol.Required(CONF_TOKEN): selector.TextSelector(selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)),
        }), errors=errors)

    async def async_step_reauth(self, entry_data):
        return await self.async_step_user()
