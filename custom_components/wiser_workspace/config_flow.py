"""UI configuration, credential replacement and reconfiguration."""
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from .api import ApiError, AuthError, WorkspaceApi
from .const import CONF_HOST, CONF_PORT, CONF_SSL, CONF_TOKEN, DEFAULT_PORT, DOMAIN
from .model import build_url, validate_host, validate_port, validate_token


def _schema(defaults):
    return vol.Schema({
        vol.Required(CONF_HOST, default=defaults.get(CONF_HOST, vol.UNDEFINED)): str,
        vol.Required(CONF_PORT, default=defaults.get(CONF_PORT, DEFAULT_PORT)): selector.NumberSelector(
            selector.NumberSelectorConfig(min=1, max=65535, step=1, mode=selector.NumberSelectorMode.BOX)),
        vol.Required(CONF_SSL, default=defaults.get(CONF_SSL, False)): bool,
        vol.Required(CONF_TOKEN): selector.TextSelector(
            selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)),
    })


class WorkspaceConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def _async_validate(self, user_input):
        """(errors, entry data, snapshot): the snapshot proves host, port, protocol and token together."""
        try:
            host = validate_host(user_input[CONF_HOST])
            port = validate_port(user_input[CONF_PORT])
            use_ssl = bool(user_input[CONF_SSL])
            url = build_url(host, port, use_ssl)
        except ValueError:
            return {"base": "invalid_url"}, None, None
        try:
            token = validate_token(user_input[CONF_TOKEN])
        except ValueError:
            return {"base": "invalid_auth"}, None, None
        try:
            data = await WorkspaceApi(async_get_clientsession(self.hass), url, token, allow_http=not use_ssl).snapshot()
        except AuthError:
            return {"base": "invalid_auth"}, None, None
        except ApiError:
            return {"base": "cannot_connect"}, None, None
        return {}, {CONF_HOST: host, CONF_PORT: port, CONF_SSL: use_ssl, CONF_TOKEN: token}, data

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input is not None:
            errors, entry_data, data = await self._async_validate(user_input)
            if not errors:
                await self.async_set_unique_id(data["gateway"])
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title="Wiser Workspace", data=entry_data)
        return self.async_show_form(step_id="user", data_schema=_schema(user_input or {}), errors=errors)

    async def _async_update_entry(self, step_id, entry, user_input, reason):
        """Shared by reauth and reconfigure: the endpoint must still serve the entry's gateway."""
        errors = {}
        if user_input is not None:
            errors, entry_data, data = await self._async_validate(user_input)
            if not errors:
                if entry.unique_id != data["gateway"]:
                    return self.async_abort(reason="wrong_gateway")
                return self.async_update_reload_and_abort(entry, data_updates=entry_data, reason=reason)
        return self.async_show_form(step_id=step_id, data_schema=_schema({**entry.data, **(user_input or {})}),
                                    errors=errors)

    async def async_step_reauth(self, entry_data):
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input=None):
        return await self._async_update_entry("reauth_confirm", self._get_reauth_entry(), user_input,
                                              "reauth_successful")

    async def async_step_reconfigure(self, user_input=None):
        return await self._async_update_entry("reconfigure", self._get_reconfigure_entry(), user_input,
                                              "reconfigure_successful")
