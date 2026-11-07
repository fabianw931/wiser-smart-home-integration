"""Exercise the coordinator against minimal Home Assistant stubs (Home Assistant itself is not installed).

The stubs only model the few base-class behaviours the coordinator relies on; they are removed from sys.modules
again right after the import so no other test module sees them.
"""
import asyncio
import importlib
from pathlib import Path
import sys
import types
import unittest
from unittest import mock

PACKAGE = "wiser_coordinator_test"
STUBBED = ["homeassistant", "homeassistant.exceptions", "homeassistant.helpers",
           "homeassistant.helpers.aiohttp_client", "homeassistant.helpers.update_coordinator"]


class ConfigEntryAuthFailed(Exception):
    pass


class HomeAssistantError(Exception):
    pass


class UpdateFailed(Exception):
    pass


class DataUpdateCoordinator:
    def __class_getitem__(cls, item):
        return cls

    def __init__(self, hass, logger, *, name, config_entry, update_interval):
        self.hass, self.config_entry, self.update_interval = hass, config_entry, update_interval
        self.data = None
        self.last_update_success = True
        self.published = []

    async def async_refresh(self):
        try:
            self.data = await self._async_update_data()
            self.last_update_success = True
        except (UpdateFailed, ConfigEntryAuthFailed):
            self.last_update_success = False

    def async_set_updated_data(self, data):
        self.data = data
        self.last_update_success = True
        self.published.append(data)


def load_coordinator():
    stubs = {name: types.ModuleType(name) for name in STUBBED}
    stubs["homeassistant.exceptions"].ConfigEntryAuthFailed = ConfigEntryAuthFailed
    stubs["homeassistant.exceptions"].HomeAssistantError = HomeAssistantError
    stubs["homeassistant.helpers.aiohttp_client"].async_get_clientsession = lambda hass: object()
    stubs["homeassistant.helpers.update_coordinator"].DataUpdateCoordinator = DataUpdateCoordinator
    stubs["homeassistant.helpers.update_coordinator"].UpdateFailed = UpdateFailed
    package = types.ModuleType(PACKAGE)
    package.__path__ = [str(Path(__file__).resolve().parents[1] / "custom_components/wiser_workspace")]
    sys.modules[PACKAGE] = package
    saved = {name: sys.modules.get(name) for name in STUBBED}
    sys.modules.update(stubs)
    try:
        return importlib.import_module(PACKAGE + ".coordinator")
    except ModuleNotFoundError as error:
        if error.name != "aiohttp":
            raise
        return None
    finally:
        for name, module in saved.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


module = load_coordinator()
if module is not None:
    from importlib import import_module
    api_module = import_module(PACKAGE + ".api")


class Entry:
    unique_id = "gateway"
    data = {"host": "10.0.0.2", "port": 3443, "ssl": False, "token": "t" * 32}

    def __init__(self):
        self.reauth = 0
        self.unload = []

    def async_start_reauth(self, hass):
        self.reauth += 1

    def async_create_background_task(self, hass, coro, name):
        return asyncio.ensure_future(coro)

    def async_on_unload(self, callback):
        self.unload.append(callback)


def snapshot(scope="s1", bri=5000, gateway="gateway"):
    return {"version": 1, "gateway": gateway, "scope": scope, "observed_at": "t",
            "entities": [{"id": 1, "identity": "a" * 64, "unused": False, "type": "dim", "state": {"bri": bri}}],
            "sensors": [], "buttons": [{"id": None, "identity": "c" * 64, "device": "0000a98f", "channel": 0}]}


def load_event(bri, scope="s1", load_id=1):
    return {"type": "load", "scope": scope, "id": load_id, "state": {"bri": bri}}


class FakeApi:
    def __init__(self):
        self.snapshots = []
        self.snapshot_error = None
        self.gate = None
        self.snapshot_calls = 0
        self.sent = []
        self.error = None
        self.streams = []

    async def snapshot(self):
        self.snapshot_calls += 1
        if self.gate is not None:
            await self.gate.wait()
        if self.snapshot_error:
            raise self.snapshot_error
        return self.snapshots.pop(0) if len(self.snapshots) > 1 else self.snapshots[0]

    async def target(self, load_id, scope, identity, target):
        self.sent.append(("target", load_id, scope, identity, target))
        if self.error:
            raise self.error

    async def identify(self, scope, identity):
        self.sent.append(("identify", scope, identity))
        if self.error:
            raise self.error

    async def events(self, idle_timeout):
        step = self.streams.pop(0)
        if isinstance(step, Exception):
            raise step
        for event in step:
            yield event


@unittest.skipIf(module is None, "Coordinator tests require aiohttp (uv run --with aiohttp)")
class CoordinatorTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.entry = Entry()
        self.coordinator = module.WorkspaceCoordinator(object(), self.entry)
        self.api = self.coordinator.api = FakeApi()
        self.api.snapshots = [snapshot()]
        await self.coordinator.async_refresh()

    async def test_builds_plain_http_origin_from_the_flow_fields(self):
        self.assertEqual(api_module.WorkspaceApi(object(), "http://10.0.0.2:3443", "t", allow_http=True).url,
                         "http://10.0.0.2:3443")
        self.assertEqual(module.WorkspaceCoordinator(object(), self.entry).api.url, "http://10.0.0.2:3443")

    async def test_load_event_patches_data_copy_on_write(self):
        before = self.coordinator.data
        await self.coordinator.async_handle_event(load_event(0))
        self.assertEqual(self.coordinator.data["entities"][0]["state"], {"bri": 0})
        self.assertEqual(before["entities"][0]["state"], {"bri": 5000})
        self.assertEqual(len(self.coordinator.published), 1)
        self.assertEqual(self.api.snapshot_calls, 1)

    async def test_foreign_scope_unknown_load_and_noop_events_publish_nothing(self):
        for event in (load_event(0, scope="other"), load_event(0, load_id=9), load_event(5000),
                      {"type": "heartbeat", "scope": "s1"}, {"type": "status", "status": "live", "scope": "s1"}):
            await self.coordinator.async_handle_event(event)
        self.assertEqual(self.coordinator.published, [])

    async def test_events_during_a_refresh_are_replayed_on_the_new_snapshot(self):
        self.api.gate = asyncio.Event()
        self.api.snapshots = [snapshot(bri=9000)]  # read before the event happened
        refresh = asyncio.ensure_future(self.coordinator.async_refresh())
        await asyncio.sleep(0)
        await self.coordinator.async_handle_event(load_event(100))
        await self.coordinator.async_handle_event(load_event(200, scope="other"))
        self.assertEqual(self.coordinator.published, [])  # old data is not patched while a snapshot is in flight
        self.api.gate.set()
        await refresh
        self.assertEqual(self.coordinator.data["entities"][0]["state"], {"bri": 100})
        self.assertEqual(self.coordinator._replay, [])
        await self.coordinator.async_handle_event(load_event(300))  # buffer is off again
        self.assertEqual(self.coordinator.data["entities"][0]["state"], {"bri": 300})

    async def test_replay_buffer_cleared_when_the_snapshot_fails(self):
        self.api.snapshot_error = api_module.ApiError("down")
        self.api.gate = asyncio.Event()
        refresh = asyncio.ensure_future(self.coordinator.async_refresh())
        await asyncio.sleep(0)
        await self.coordinator.async_handle_event(load_event(1))
        self.api.gate.set()
        await refresh
        self.assertFalse(self.coordinator.last_update_success)
        self.assertEqual(self.coordinator._replay, [])
        await self.coordinator.async_handle_event(load_event(2))  # stale data is never patched back to "success"
        self.assertFalse(self.coordinator.last_update_success)
        self.assertEqual(self.coordinator.published, [])

    async def test_resync_refreshes_and_other_gateway_is_a_failure(self):
        self.api.snapshots = [snapshot(scope="s2", bri=1)]
        await self.coordinator.async_handle_event({"type": "resync", "scope": "s2"})
        self.assertEqual(self.api.snapshot_calls, 2)
        self.assertEqual(self.coordinator.data["scope"], "s2")
        self.api.snapshots = [snapshot(gateway="someone else")]
        await self.coordinator.async_handle_event({"type": "resync", "scope": "s2"})
        self.assertFalse(self.coordinator.last_update_success)

    async def test_auth_failure_on_snapshot_is_reported_as_auth_failed(self):
        self.api.snapshot_error = api_module.AuthError("no")
        with self.assertRaises(ConfigEntryAuthFailed):
            await self.coordinator._async_update_data()

    async def test_heartbeat_polls_when_pushed_events_postponed_the_timer(self):
        await self.coordinator.async_handle_event({"type": "heartbeat", "scope": "s1"})
        self.assertEqual(self.api.snapshot_calls, 1)
        self.coordinator._snapshot_at -= 31
        await self.coordinator.async_handle_event({"type": "heartbeat", "scope": "s1"})
        self.assertEqual(self.api.snapshot_calls, 2)

    async def test_stream_reconnects_with_capped_backoff_and_resets_after_traffic(self):
        self.api.streams = [api_module.ApiError("down"), api_module.ApiError("down"),
                            [{"type": "heartbeat", "scope": "s1"}], api_module.ApiError("down"), RuntimeError("bug")]
        delays = []

        async def sleep(delay):
            delays.append(delay)
            if len(delays) == 5:
                raise asyncio.CancelledError

        with mock.patch.object(module.asyncio, "sleep", sleep):
            with self.assertRaises(asyncio.CancelledError):
                await self.coordinator.async_run_events()
        self.assertEqual(delays, [1, 2, 1, 2, 4])  # a bug in the stream does not kill the supervisor

    async def test_stream_events_reach_the_data_and_auth_error_starts_reauth(self):
        self.api.streams = [[load_event(0), {"type": "heartbeat", "scope": "s1"}], api_module.AuthError("no")]

        async def sleep(delay):
            pass

        with mock.patch.object(module.asyncio, "sleep", sleep):
            await self.coordinator.async_run_events()  # returns on the auth error
        self.assertEqual(self.coordinator.data["entities"][0]["state"], {"bri": 0})
        self.assertEqual(self.entry.reauth, 1)

    async def test_start_registers_a_background_task_cancelled_on_unload(self):
        self.api.streams = [api_module.ApiError("down")]

        async def sleep(delay):
            # asyncio.sleep is patched globally: only the backoff waits, the test's own sleep(0) yields.
            if delay:
                await asyncio.Event().wait()

        with mock.patch.object(module.asyncio, "sleep", sleep):
            self.coordinator.async_start_events()
            await asyncio.sleep(0)
            task = self.coordinator._events_task
            self.assertFalse(task.done())
            for callback in self.entry.unload:
                callback()
            with self.assertRaises(asyncio.CancelledError):
                await task

    async def test_command_uses_fresh_data_then_refreshes_once(self):
        await self.coordinator.command(1, "a" * 64, {"bri": 0})
        self.assertEqual(self.api.sent, [("target", 1, "s1", "a" * 64, {"bri": 0})])
        self.assertEqual(self.api.snapshot_calls, 2)  # initial + one after sending, no pre-flight

    async def test_command_refreshes_first_when_data_is_stale(self):
        self.coordinator._fresh_at -= 60
        await self.coordinator.command(1, "a" * 64, {"bri": 0})
        self.assertEqual(self.api.snapshot_calls, 3)

    async def test_pushed_events_keep_data_fresh(self):
        self.coordinator._fresh_at -= 60
        await self.coordinator.async_handle_event(load_event(0))
        await self.coordinator.command(1, "a" * 64, {"bri": 5000})
        self.assertEqual(self.api.snapshot_calls, 2)

    async def test_command_target_builder_sees_the_fresh_entity(self):
        seen = []
        await self.coordinator.command(1, "a" * 64, lambda entity: seen.append(entity) or {"bri": 1})
        self.assertEqual(seen[0]["state"], {"bri": 5000})
        self.assertEqual(self.api.sent[0][4], {"bri": 1})

    async def test_empty_target_sends_and_refreshes_nothing(self):
        await self.coordinator.command(1, "a" * 64, lambda entity: {})
        self.assertEqual((self.api.sent, self.api.snapshot_calls), ([], 1))

    async def test_invalid_target_and_changed_identity_are_refused(self):
        def bad(entity):
            raise ValueError("Colour state unavailable")

        with self.assertRaises(HomeAssistantError):
            await self.coordinator.command(1, "a" * 64, bad)
        for load_id, identity in ((1, "b" * 64), (9, "a" * 64)):
            with self.assertRaises(HomeAssistantError):
                await self.coordinator.command(load_id, identity, {"bri": 0})
        self.assertEqual(self.api.sent, [])

    async def test_command_refused_while_unavailable(self):
        self.api.snapshot_error = api_module.ApiError("down")
        self.coordinator._fresh_at -= 60
        with self.assertRaises(HomeAssistantError):
            await self.coordinator.command(1, "a" * 64, {"bri": 0})
        self.assertEqual(self.api.sent, [])

    async def test_command_errors_are_distinguished(self):
        self.api.error = api_module.ControlDisabledError("403")
        with self.assertRaises(HomeAssistantError) as error:
            await self.coordinator.command(1, "a" * 64, {"bri": 0})
        self.assertIn("WISER_INTEGRATION_CONTROL", str(error.exception))
        self.assertEqual(self.api.snapshot_calls, 1)
        self.api.error = api_module.AuthError("401")
        with self.assertRaises(HomeAssistantError):
            await self.coordinator.command(1, "a" * 64, {"bri": 0})
        self.assertEqual(self.entry.reauth, 1)
        self.api.error = api_module.ApiError("timeout")
        with self.assertRaises(HomeAssistantError) as error:
            await self.coordinator.command(1, "a" * 64, {"bri": 0})
        self.assertIn("unconfirmed", str(error.exception))
        self.assertEqual(self.api.snapshot_calls, 2)  # state re-read after an unconfirmed command

    async def test_identify_sends_scope_and_identity_without_refresh(self):
        await self.coordinator.identify("c" * 64)
        self.assertEqual(self.api.sent, [("identify", "s1", "c" * 64)])
        self.assertEqual(self.api.snapshot_calls, 1)
        with self.assertRaises(HomeAssistantError):
            await self.coordinator.identify("d" * 64)
        self.api.error = api_module.ControlDisabledError("403")
        with self.assertRaises(HomeAssistantError) as error:
            await self.coordinator.identify("c" * 64)
        self.assertIn("read-only", str(error.exception))


if __name__ == "__main__":
    unittest.main()
