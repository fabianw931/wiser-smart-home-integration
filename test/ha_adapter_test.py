"""Run without installing Home Assistant: python -m unittest discover -s test -p '*_test.py'."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
try:
    import aiohttp
    from aiohttp import web
except ImportError:
    aiohttp = None

spec = importlib.util.spec_from_file_location("wiser_model", Path(__file__).resolve().parents[1] / "custom_components/wiser_workspace/model.py")
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)

# Load just the transport and pure model, never the HA-dependent package initializer.
if aiohttp is not None:
    package = types.ModuleType("wiser_transport_test")
    package.__path__ = [str(Path(__file__).resolve().parents[1] / "custom_components/wiser_workspace")]
    sys.modules[package.__name__] = package
    sys.modules[package.__name__ + ".model"] = model
    api_spec = importlib.util.spec_from_file_location(package.__name__ + ".api", Path(package.__path__[0]) / "api.py")
    transport = importlib.util.module_from_spec(api_spec)
    sys.modules[api_spec.name] = transport
    api_spec.loader.exec_module(transport)


class AdapterTest(unittest.TestCase):
    def test_labels_prefer_personal_names_and_keep_gateway_originals(self):
        found = model.labels({"id": 4, "name": " Reading lamp ", "room": "Study", "gateway_name": "Load 4", "gateway_room": "Room 2"})
        self.assertEqual(found, {"name": "Reading lamp", "room": "Study", "gateway_name": "Load 4", "gateway_room": "Room 2"})
        # An older snapshot without gateway_* still yields a usable name.
        self.assertEqual(model.labels({"id": 5, "name": "Hall"})["gateway_name"], None)
        self.assertEqual(model.labels({"id": 6, "name": "  ", "gateway_name": "Original"})["name"], "Original")
        self.assertEqual(model.labels({"id": 7, "name": None, "room": ""})["name"], "Wiser load 7")
        self.assertIsNone(model.labels({"id": 7, "room": ""})["room"])

    def test_brightness_endpoints_and_nonzero(self):
        self.assertEqual([model.brightness(x) for x in (0, 1, 5000, 10000)], [0, 1, 128, 255])
        self.assertEqual(model.target_brightness(255), 10000)
        for value in (None, True, -1, 10001, 3.5, "0"):
            self.assertIsNone(model.brightness(value))

    def test_cover_direction_and_roundtrip(self):
        self.assertEqual([model.position(x) for x in (0, 2500, 10000)], [100, 75, 0])
        for value in range(101):
            self.assertEqual(model.position(model.target_position(value)), value)
        for value in (None, True, -1, 10001):
            self.assertIsNone(model.position(value))

    def test_url_never_leaks_credentials_or_downgrades_tls(self):
        self.assertEqual(model.base_url("https://ha.example:8443/"), "https://ha.example:8443")
        for value in ("http://127.0.0.1", "https://u:p@example", "https://example/api", "https://example?token=x", "https://example#x", "https://example:bad", " https://example", "https://exam\nple", "https://example\x00"):
            with self.assertRaises(ValueError):
                model.base_url(value)

    def test_discovery_is_conservative(self):
        self.assertEqual(model.platform({"unused": False, "type": "dali", "sub_type": "tw"}), "light")
        self.assertIsNone(model.platform({"unused": False, "type": "dali", "sub_type": "unknown"}))
        self.assertIsNone(model.platform({"unused": True, "type": "motor"}))

    def test_snapshot_identity_and_duplicates(self):
        value = {"version": 1, "gateway": "host", "scope": "session", "entities": [{"id": 1, "identity": "a" * 64}]}
        self.assertIs(model.snapshot(value), value)
        value["entities"].append(value["entities"][0].copy())
        with self.assertRaises(ValueError):
            model.snapshot(value)

    def test_missing_or_invalid_state_refuses_control(self):
        entity = {"unused": False, "type": "onoff", "state": {"bri": 0}}
        self.assertTrue(model.valid_state(entity))
        for state in (None, {}, {"bri": True}, {"bri": 50}):
            entity["state"] = state
            self.assertFalse(model.valid_state(entity))


    def test_colour_kinds_and_ranges(self):
        self.assertEqual(model.colour_kind({"unused": False, "type": "dali", "sub_type": "tw"}), "ct")
        self.assertEqual(model.colour_kind({"unused": False, "type": "dali", "sub_type": "rgb"}), "rgbw")
        for entity in ({"unused": False, "type": "dali", "sub_type": ""}, {"unused": False, "type": "dim"},
                       {"unused": True, "type": "dali", "sub_type": "tw"}, {"unused": False, "type": "dali", "sub_type": "x"}):
            self.assertIsNone(model.colour_kind(entity))
        self.assertEqual([model.kelvin(x) for x in (1000, 4200, 20000)], [1000, 4200, 20000])
        for value in (None, True, 999, 20001, 4200.0, "4200"):
            self.assertIsNone(model.kelvin(value))
        self.assertEqual(model.rgbw({"red": 1, "green": 2, "blue": 3, "white": 255}), (1, 2, 3, 255))
        for state in (None, {}, {"red": 1, "green": 2, "blue": 3}, {"red": 1, "green": 2, "blue": 3, "white": 256},
                      {"red": True, "green": 2, "blue": 3, "white": 0}):
            self.assertIsNone(model.rgbw(state))
        self.assertTrue(model.TW_MIN_KELVIN >= 1000 and model.TW_MAX_KELVIN <= 20000)

    def test_turn_on_sends_only_what_the_user_changed(self):
        tw = {"unused": False, "type": "dali", "sub_type": "tw", "state": {"bri": 5000, "ct": 3000}}
        rgb = {"unused": False, "type": "dali", "sub_type": "rgb",
               "state": {"bri": 5000, "red": 10, "green": 20, "blue": 30, "white": 40}}
        # Plain turn-on of a lit load changes nothing; of an unlit one it means full brightness.
        self.assertEqual(model.turn_on_target(tw), {})
        self.assertEqual(model.turn_on_target({**tw, "state": {"bri": 0, "ct": 3000}}), {"bri": 10000})
        self.assertEqual(model.turn_on_target(tw, brightness_value=255), {"bri": 10000})
        self.assertEqual(model.turn_on_target(tw, kelvin_value=4200), {"ct": 4200})
        self.assertEqual(model.turn_on_target(tw, kelvin_value=3000), {})
        self.assertEqual(model.turn_on_target(tw, brightness_value=128, kelvin_value=2700), {"bri": 5020, "ct": 2700})
        self.assertEqual(model.turn_on_target(rgb, rgbw_value=(10, 99, 30, 0)), {"green": 99, "white": 0})
        self.assertEqual(model.turn_on_target(rgb, rgbw_value=(10, 20, 30, 40)), {})
        self.assertEqual(model.turn_on_target(rgb, brightness_value=1, rgbw_value=[255, 20, 30, 40]), {"bri": 39, "red": 255})
        # Brightness-only operation never needs colour state.
        bare = {"unused": False, "type": "dali", "sub_type": "tw", "state": {"bri": 100}}
        self.assertEqual(model.turn_on_target(bare, brightness_value=10), {"bri": 392})
        with self.assertRaises(ValueError):
            model.turn_on_target(bare, kelvin_value=4000)
        with self.assertRaises(ValueError):
            model.turn_on_target({**rgb, "state": {"bri": 1, "red": 1}}, rgbw_value=(1, 2, 3, 4))
        for kwargs in ({"kelvin_value": 999}, {"kelvin_value": True}, {"rgbw_value": (1, 2, 3)}, {"rgbw_value": (1, 2, 3, 256)},
                       {"brightness_value": 256}):
            with self.assertRaises(ValueError):
                model.turn_on_target(tw if "kelvin_value" in kwargs else rgb, **kwargs)
        with self.assertRaises(ValueError):  # wrong colour capability
            model.turn_on_target(tw, rgbw_value=(1, 2, 3, 4))
        with self.assertRaises(ValueError):
            model.turn_on_target(rgb, kelvin_value=3000)
        with self.assertRaises(ValueError):  # unusable brightness
            model.turn_on_target({**tw, "state": {"ct": 3000}})
        onoff = {"unused": False, "type": "onoff", "state": {"bri": 0}}
        self.assertEqual(model.turn_on_target(onoff, brightness_value=3), {"bri": 10000})
        self.assertEqual(model.turn_on_target({**onoff, "state": {"bri": 10000}}), {})

    def test_sensor_mapping_uses_documented_units_only(self):
        temperature = {"type": "temperature", "unit": "\u2103", "value": 0}
        self.assertEqual(model.sensor_spec(temperature), {"platform": "sensor", "device_class": "temperature", "unit": "\u00b0C"})
        self.assertEqual(model.sensor_spec({"type": "temperature", "unit": "\u00b0C"})["unit"], "\u00b0C")
        self.assertEqual(model.sensor_spec({"type": "illuminance", "unit": "lux"})["unit"], "lx")
        self.assertEqual(model.sensor_spec({"type": "wind", "unit": "m/s"})["device_class"], "wind_speed")
        self.assertEqual(model.sensor_spec({"type": "rain", "unit": "bool"})["platform"], "binary_sensor")
        for sensor in ({"type": "temperature", "unit": "K"}, {"type": "wind", "unit": "km/h"}, {"type": "temperature"},
                       {"type": "humidity", "unit": "%"}, {"type": "rain", "unit": "mm"}, {"unit": "lux"}, {"type": "wind", "unit": None}):
            self.assertIsNone(model.sensor_spec(sensor))

    def test_sensor_values_keep_zero_and_false_but_never_guess(self):
        self.assertEqual(model.sensor_value({"type": "temperature", "unit": "\u2103", "value": 0}), 0)
        self.assertEqual(model.sensor_value({"type": "temperature", "unit": "\u2103", "value": -4.5}), -4.5)
        self.assertEqual(model.sensor_value({"type": "wind", "unit": "m/s", "value": 0}), 0)
        self.assertIs(model.sensor_value({"type": "rain", "unit": "bool", "value": False}), False)
        self.assertIs(model.sensor_value({"type": "hail", "unit": "bool", "value": 0}), False)
        self.assertIs(model.sensor_value({"type": "hail", "unit": "bool", "value": 1}), True)
        for sensor in ({"type": "temperature", "unit": "\u2103"}, {"type": "temperature", "unit": "\u2103", "value": "19"},
                       {"type": "temperature", "unit": "\u2103", "value": True}, {"type": "temperature", "unit": "\u2103", "value": float("nan")},
                       {"type": "wind", "unit": "m/s", "value": -1}, {"type": "illuminance", "unit": "lux", "value": -5},
                       {"type": "rain", "unit": "bool", "value": 2}, {"type": "rain", "unit": "bool", "value": "yes"},
                       {"type": "rain", "unit": "bool"}, {"type": "pressure", "unit": "hPa", "value": 1000}):
            self.assertIsNone(model.sensor_value(sensor))

    def test_sensor_names_and_physical_devices(self):
        self.assertEqual(model.sensor_name({"name": " Terrace "}), "Terrace")
        self.assertEqual(model.sensor_name({"id": 3, "type": "wind", "device": "00000124"}), "Wiser wind 00000124")
        self.assertEqual(model.physical_device({"device": "0000a98f"}), "0000a98f")
        for value in (None, "", "not hex!", 5, "x" * 65):
            self.assertIsNone(model.physical_device({"device": value}))
        self.assertTrue(model.identifiable_button({"device": "0000a98f", "channel": 0}))
        for button in ({"device": "0000a98f", "channel": -1}, {"device": "0000a98f", "channel": True}, {"device": "?", "channel": 0}, {"channel": 1}):
            self.assertFalse(model.identifiable_button(button))


@unittest.skipIf(aiohttp is None, "Transport tests require uv run --with aiohttp")
class TransportTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.mode = "snapshot"
        self.calls = []

        async def handler(request):
            self.calls.append((request.method, request.path, request.headers.get("Authorization")))
            if self.mode == "401":
                return web.Response(status=401, text="secret upstream response")
            if self.mode == "403":
                return web.Response(status=403, text="secret upstream response")
            if self.mode == "redirect":
                return web.Response(status=302, headers={"Location": self.origin + "/redirected"})
            if self.mode == "invalid_json":
                return web.Response(text="not json", content_type="application/json")
            if self.mode == "oversized":
                return web.Response(body=b"x" * (2 * 1024 * 1024 + 1), content_type="application/json")
            if self.mode == "chunked_oversized":
                response = web.StreamResponse(headers={"Content-Type": "application/json"})
                await response.prepare(request)
                for _ in range(33):
                    await response.write(b"x" * 65536)
                await response.write_eof()
                return response
            if self.mode == "accepted":
                return web.json_response({"accepted": True})
            if self.mode == "rejected":
                return web.json_response({"accepted": False})
            if self.mode == "invalid_snapshot":
                return web.json_response({"version": 1})
            return web.json_response({"version": 1, "gateway": "gateway", "scope": "fresh", "entities": []})

        app = web.Application()
        app.router.add_route("*", "/{tail:.*}", handler)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.origin = "http://127.0.0.1:" + str(site._server.sockets[0].getsockname()[1])
        self.session = aiohttp.ClientSession()
        origin = self.origin
        session = self.session

        class LoopbackTransport:
            def request(self, method, url, **kwargs):
                # Only tests replace the validated HTTPS origin with a synthetic HTTP server.
                return session.request(method, url.replace("https://workspace.example", origin, 1), **kwargs)

        self.api = transport.WorkspaceApi(LoopbackTransport(), "https://workspace.example", "test-token")

    async def asyncTearDown(self):
        await self.session.close()
        await self.runner.cleanup()

    async def test_snapshot_and_bearer_header(self):
        result = await self.api.snapshot()
        self.assertEqual(result["scope"], "fresh")
        self.assertEqual(self.calls, [("GET", "/api/integration/v1/snapshot", "Bearer test-token")])

    async def test_auth_and_control_disabled_are_distinct(self):
        self.mode = "401"
        with self.assertRaises(transport.AuthError):
            await self.api.snapshot()
        self.mode = "403"
        with self.assertRaises(transport.ApiError) as error:
            await self.api.snapshot()
        self.assertNotIn("secret", str(error.exception))

    async def test_redirect_never_followed(self):
        self.mode = "redirect"
        with self.assertRaises(transport.ApiError):
            await self.api.snapshot()
        self.assertEqual(len(self.calls), 1)

    async def test_invalid_and_oversized_responses(self):
        for mode in ("invalid_json", "invalid_snapshot", "oversized", "chunked_oversized"):
            self.mode = mode
            with self.assertRaises(transport.ApiError):
                await self.api.snapshot()

    async def test_target_requires_explicit_acceptance(self):
        for mode in ("rejected", "snapshot"):
            self.mode = mode
            with self.assertRaises(transport.ApiError):
                await self.api.target(1, "scope", "a" * 64, {"bri": 0})
        self.mode = "accepted"
        await self.api.target(1, "scope", "a" * 64, {"bri": 0})


if __name__ == "__main__":
    unittest.main()
