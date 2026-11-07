"""Snapshot coordinator: pushed load events are the primary path, snapshots the fallback and resync."""
import asyncio
from contextlib import aclosing
from datetime import timedelta
import logging
import time

from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import ApiError, AuthError, ControlDisabledError, WorkspaceApi
from .const import (CONF_HOST, CONF_PORT, CONF_SSL, CONF_TOKEN, DOMAIN, EVENT_IDLE_TIMEOUT, FRESH_SECONDS,
                    POLL_INTERVAL)
from .model import apply_event, backoff_delay, build_url, valid_state

_LOGGER = logging.getLogger(__name__)
CONTROL_DISABLED = ("The Wiser app is read-only; set WISER_INTEGRATION_CONTROL=1 in its .env and restart it "
                    "to allow commands")


class WorkspaceCoordinator(DataUpdateCoordinator[dict]):
    def __init__(self, hass, entry):
        super().__init__(hass, _LOGGER, name=DOMAIN, config_entry=entry,
                         update_interval=timedelta(seconds=POLL_INTERVAL))
        self.entry = entry
        use_ssl = entry.data[CONF_SSL]
        self.api = WorkspaceApi(async_get_clientsession(hass),
                                build_url(entry.data[CONF_HOST], entry.data[CONF_PORT], use_ssl),
                                entry.data[CONF_TOKEN], allow_http=not use_ssl)
        self._events_task = None
        # Load events that arrive while a snapshot request is in flight; replayed on top of that snapshot.
        self._replay = []
        self._inflight = 0
        self._fresh_at = None
        self._snapshot_at = None

    # -- snapshots -------------------------------------------------------------------------------------------

    async def _async_update_data(self):
        self._inflight += 1
        start = len(self._replay)
        # Attempt time, success or not: a failing snapshot must not be retried on every event.
        self._snapshot_at = time.monotonic()
        try:
            try:
                data = await self.api.snapshot()
            except AuthError as err:
                raise ConfigEntryAuthFailed("Workspace credential rejected") from err
            except ApiError as err:
                raise UpdateFailed("Workspace snapshot unavailable") from err
            if data["gateway"] != self.entry.unique_id:
                raise UpdateFailed("Workspace gateway identity changed")
            for event in self._replay[start:]:
                patched = apply_event(data, event)
                if patched is not None:
                    data = patched
        finally:
            self._inflight -= 1
            if not self._inflight:
                self._replay.clear()
        self._fresh_at = time.monotonic()
        return data

    # -- events ----------------------------------------------------------------------------------------------

    def async_start_events(self):
        """Run the events stream in the background for the lifetime of the config entry."""
        self._events_task = self.entry.async_create_background_task(
            self.hass, self.async_run_events(), name=f"{DOMAIN} events")
        self.entry.async_on_unload(self._async_stop_events)

    def _async_stop_events(self):
        if self._events_task is not None:
            self._events_task.cancel()
            self._events_task = None

    async def async_run_events(self):
        attempt = 0
        while True:
            try:
                async with aclosing(self.api.events(EVENT_IDLE_TIMEOUT)) as events:
                    async for event in events:
                        attempt = 0
                        await self.async_handle_event(event)
                _LOGGER.debug("Workspace event stream ended")
            except AuthError:
                self.entry.async_start_reauth(self.hass)
                return
            except ApiError as err:
                _LOGGER.debug("Workspace event stream unavailable: %s", err)
            except Exception:  # noqa: BLE001 - the supervisor must survive; the poll still works
                _LOGGER.exception("Unexpected workspace event stream failure")
            await asyncio.sleep(backoff_delay(attempt))
            attempt += 1

    async def async_handle_event(self, event):
        kind = event.get("type")
        if kind == "load":
            self._apply_load_event(event)
        elif kind == "resync":
            await self.async_refresh()
            return
        # status and heartbeat events carry no state; they only prove the link is alive.
        if self._snapshot_at is None or time.monotonic() - self._snapshot_at >= POLL_INTERVAL:
            # Applied load events postpone the coordinator's timer, but sensors only change in snapshots.
            await self.async_refresh()

    def _apply_load_event(self, event):
        if self._inflight:
            self._replay.append(event)
            return
        if self.data is None or not self.last_update_success:
            return
        patched = apply_event(self.data, event)
        if patched is not None:
            self._fresh_at = time.monotonic()
            self.async_set_updated_data(patched)

    # -- commands --------------------------------------------------------------------------------------------

    async def _async_ensure_fresh(self):
        if (not self.last_update_success or self.data is None or self._fresh_at is None
                or time.monotonic() - self._fresh_at > FRESH_SECONDS):
            await self.async_refresh()
        if not self.last_update_success or self.data is None:
            raise HomeAssistantError("Workspace state unavailable; command not sent")

    async def _async_send(self, send):
        try:
            await send()
        except AuthError as err:
            self.entry.async_start_reauth(self.hass)
            raise HomeAssistantError("Workspace credential rejected") from err
        except ControlDisabledError as err:
            raise HomeAssistantError(CONTROL_DISABLED) from err

    async def command(self, load_id, identity, target):
        """Send a native target to one load.

        `target` is a dict, or a callable receiving the fresh entity and returning the dict (an empty dict
        sends nothing). The load must still carry the identity the entity was created with.
        """
        await self._async_ensure_fresh()
        entity = next((e for e in self.data["entities"] if e["id"] == load_id), None)
        if entity is None or entity["identity"] != identity or not valid_state(entity):
            raise HomeAssistantError("Load identity changed or unavailable; command not sent")
        if callable(target):
            try:
                target = target(entity)
            except ValueError as err:
                raise HomeAssistantError(str(err)) from err
        if not target:
            return
        scope = self.data["scope"]
        try:
            await self._async_send(lambda: self.api.target(load_id, scope, identity, target))
        except ApiError as err:
            await self.async_refresh()
            raise HomeAssistantError("Command unconfirmed; inspect refreshed state before retrying") from err
        await self.async_refresh()

    async def identify(self, identity):
        """Flash the LED of one button; nothing changes in the reported state, so no refresh follows."""
        await self._async_ensure_fresh()
        if not any(button["identity"] == identity for button in self.data["buttons"]):
            raise HomeAssistantError("Button no longer reported; identify not sent")
        scope = self.data["scope"]
        try:
            await self._async_send(lambda: self.api.identify(scope, identity))
        except ApiError as err:
            raise HomeAssistantError("Identify unconfirmed") from err
