"""Run without installing Home Assistant: python -m unittest discover -s test -p '*_test.py'."""
import asyncio
import importlib.util
import json
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
        result = model.snapshot(value)
        self.assertEqual(result["entities"], value["entities"])
        self.assertEqual((result["sensors"], result["buttons"]), ([], []))  # older apps omit both
        self.assertNotIn("sensors", value)
        value["entities"].append(value["entities"][0].copy())
        with self.assertRaises(ValueError):
            model.snapshot(value)

    def test_snapshot_keeps_valid_sensors_and_buttons_and_drops_malformed_ones(self):
        sensor = {"id": 1, "identity": "b" * 64, "type": "temperature", "unit": "\u2103", "value": 20}
        button = {"id": None, "identity": "c" * 64, "device": "0000a98f", "channel": 1, "registered": False}
        value = {"version": 1, "gateway": "host", "scope": "s", "entities": [],
                 "sensors": [sensor, sensor, {"id": 2, "identity": "bad"}, {"id": "x", "identity": "d" * 64}, 5],
                 "buttons": [button, {**button}, {"identity": "short"}, None]}
        result = model.snapshot(value)
        self.assertEqual(result["sensors"], [sensor])
        self.assertEqual(result["buttons"], [button])
        for junk in ("nope", {}, 5, None):
            result = model.snapshot({**value, "sensors": junk, "buttons": junk})
            self.assertEqual((result["sensors"], result["buttons"]), ([], []))

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

    def test_button_names(self):
        self.assertEqual(model.button_name({"name": " Hall ", "device": "0000a98f", "channel": 1}), "Hall")
        self.assertEqual(model.button_name({"device": "0000a98f", "channel": 1}), "Wiser button 0000a98f channel 1")

    def test_http_only_when_explicitly_allowed(self):
        self.assertEqual(model.base_url("http://192.168.1.5:3443", allow_http=True), "http://192.168.1.5:3443")
        self.assertEqual(model.base_url("https://192.168.1.5:3443", allow_http=True), "https://192.168.1.5:3443")
        with self.assertRaises(ValueError):
            model.base_url("http://192.168.1.5:3443")
        for value in ("http://u:p@h", "http://h/api", "http://h?x=1", "http://h#x", "http://h:0", "ftp://h", "http://h:70000", "http://"):
            with self.assertRaises(ValueError):
                model.base_url(value, allow_http=True)

    def test_build_url_from_flow_fields(self):
        self.assertEqual(model.build_url("192.168.1.5", 3443, False), "http://192.168.1.5:3443")
        self.assertEqual(model.build_url(" Wiser.Local ", 3443.0, True), "https://wiser.local:3443")
        self.assertEqual(model.build_url("[::1]", 8443, False), "http://[::1]:8443")
        self.assertEqual(model.build_url("fd00:0::5", 1, True), "https://[fd00::5]:1")
        for use_ssl in (None, 0, "yes"):
            with self.assertRaises(ValueError):
                model.build_url("192.168.1.5", 3443, use_ssl)

    def test_host_validation(self):
        for host in ("192.168.1.5", "app", "my-app.example.org", "a" * 63 + ".example", "::1", "2001:db8::1"):
            self.assertIsInstance(model.validate_host(host), str)
        self.assertEqual(model.validate_host(" App \n"), "app")  # surrounding whitespace from pasting is trimmed
        self.assertEqual(model.validate_host("[2001:DB8::1]"), "2001:db8::1")
        for host in ("", "  ", None, 5, "http://app", "app:3443", "app/path", "app?x", "app#x", "user@app", "u:p@app",
                     "a b", "ap\np", "app\x00", "-app", "app-", "a..b", ".app", "app_x", "app%eth0", "fe80::1%eth0",
                     "[app]", "[::1", "0.0.0.0", "::", "224.0.0.1", "1.2.3", "999.1.1.1", "a" * 64 + ".example", "x" * 254,
                     "\u00e4pp.example"):
            with self.assertRaises(ValueError, msg=repr(host)):
                model.validate_host(host)

    def test_port_validation(self):
        self.assertEqual([model.validate_port(v) for v in (1, 3443, 65535, 3443.0)], [1, 3443, 65535, 3443])
        for value in (0, 65536, -1, True, False, None, "3443", 3443.5, float("nan"), float("inf")):
            with self.assertRaises(ValueError, msg=repr(value)):
                model.validate_port(value)

    def test_token_validation_is_header_safe(self):
        self.assertEqual(model.validate_token("  abc_DEF-123  "), "abc_DEF-123")
        for value in ("", "   ", None, 5, "a b", "a\nb", "a\r\nX: y", "t\u00f6ken", "x" * 513):
            with self.assertRaises(ValueError, msg=repr(value)):
                model.validate_token(value)

    def test_event_lines(self):
        self.assertEqual(model.parse_event_line(b'{"type":"load","scope":"s","id":1,"state":{"bri":5}}\n')["id"], 1)
        self.assertEqual(model.parse_event_line('{"type":"heartbeat","scope":"s"}')["type"], "heartbeat")
        for line in (b"", b"\n", b"not json", b"[]", b"5", b"null", b'{"type":"load"}', b'{"scope":"s"}',
                     b'{"type":5,"scope":"s"}', b'{"type":"x","scope":5}', b"\xff\xfe", b"[" * 100000):
            self.assertIsNone(model.parse_event_line(line), msg=repr(line[:20]))

    def snapshot_with_loads(self):
        return {"version": 1, "gateway": "g", "scope": "s1", "observed_at": "t", "sensors": [], "buttons": [],
                "entities": [{"id": 1, "identity": "a" * 64, "type": "dali", "state": {"bri": 5000, "ct": 3000}},
                             {"id": 2, "identity": "b" * 64, "type": "motor", "state": {"level": 0}}]}

    def test_apply_event_merges_partial_state_copy_on_write(self):
        import copy
        original = self.snapshot_with_loads()
        before = copy.deepcopy(original)
        result = model.apply_event(original, {"type": "load", "scope": "s1", "id": 1, "state": {"bri": 0}})
        self.assertEqual(original, before)  # input untouched
        self.assertIsNot(result, original)
        self.assertEqual(result["entities"][0]["state"], {"bri": 0, "ct": 3000})  # partial merge keeps ct
        self.assertIs(result["entities"][1], original["entities"][1])  # other loads shared, not copied
        self.assertIsNot(result["entities"][0]["state"], original["entities"][0]["state"])
        self.assertEqual({k: v for k, v in result.items() if k != "entities"},
                         {k: v for k, v in original.items() if k != "entities"})

    def test_apply_event_adds_fields_and_drops_nulls(self):
        original = self.snapshot_with_loads()
        result = model.apply_event(original, {"type": "load", "scope": "s1", "id": 1, "state": {"red": 1, "ct": None}})
        self.assertEqual(result["entities"][0]["state"], {"bri": 5000, "red": 1})
        missing = model.apply_event({**original, "entities": [{"id": 1, "identity": "a" * 64}]},
                                    {"type": "load", "scope": "s1", "id": 1, "state": {"bri": 100}})
        self.assertEqual(missing["entities"][0]["state"], {"bri": 100})  # no previous state at all

    def test_apply_event_ignores_what_it_cannot_trust(self):
        original = self.snapshot_with_loads()
        ok = {"type": "load", "scope": "s1", "id": 1, "state": {"bri": 0}}
        for event in ({**ok, "scope": "other"}, {**ok, "scope": None}, {**ok, "id": 99}, {**ok, "id": "1"},
                      {**ok, "id": True}, {**ok, "type": "status"}, {**ok, "state": []}, {**ok, "state": None},
                      {**ok, "state": {}}, {**ok, "state": {"bri": 5000}},  # no change
                      {**ok, "state": {"bri": "0"}}, {**ok, "state": {"bri": True}}, {**ok, "state": {"bri": 10001}},
                      {**ok, "state": {"bri": 1.5}}, {**ok, "state": {"ct": 999}}, {**ok, "state": {"red": 256}},
                      {**ok, "state": {"bogus": 1}}, {**ok, "state": {"white": None}},  # dropping an absent field
                      None, "x", {}):
            self.assertIsNone(model.apply_event(original, event), msg=repr(event))
        self.assertIsNone(model.apply_event(None, ok))

    def test_apply_event_applies_valid_fields_next_to_invalid_ones(self):
        original = self.snapshot_with_loads()
        result = model.apply_event(original, {"type": "load", "scope": "s1", "id": 1,
                                              "state": {"bri": 0, "ct": "warm", "bogus": 5, "red": 999}})
        self.assertEqual(result["entities"][0]["state"], {"bri": 0, "ct": 3000})

    def test_apply_event_is_idempotent_and_ordered(self):
        snap = self.snapshot_with_loads()
        for bri in (100, 200, 300):
            snap = model.apply_event(snap, {"type": "load", "scope": "s1", "id": 1, "state": {"bri": bri}})
        self.assertEqual(snap["entities"][0]["state"]["bri"], 300)
        self.assertIsNone(model.apply_event(snap, {"type": "load", "scope": "s1", "id": 1, "state": {"bri": 300}}))

    def test_backoff_schedule(self):
        self.assertEqual([model.backoff_delay(n) for n in range(9)], [1, 2, 4, 8, 16, 32, 60, 60, 60])
        self.assertEqual(model.backoff_delay(-5), 1)
        self.assertEqual(model.backoff_delay(10 ** 6), 60)
        self.assertEqual(model.backoff_delay(2, base=0.5, cap=1.5), 1.5)


@unittest.skipIf(aiohttp is None, "Transport tests require uv run --with aiohttp")
class TransportTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.mode = "snapshot"
        self.calls = []
        self.bodies = []

        async def handler(request):
            self.calls.append((request.method, request.path, request.headers.get("Authorization")))
            self.bodies.append(await request.read())
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
            if self.mode.startswith("events"):
                if self.mode == "events_wrong_type":
                    return web.json_response({})
                response = web.StreamResponse(headers={"Content-Type": "application/x-ndjson"})
                await response.prepare(request)
                if self.mode == "events_silent":
                    await asyncio.sleep(1)
                elif self.mode == "events_long_line":
                    await response.write(b"x" * 200000 + b"\n")
                else:
                    await response.write(b'{"type":"heartbeat","scope":"fresh"}\n')
                    await response.write(b'not json\n{"type":"load","scope":"fresh","id":1,"state":{"bri":0}}\n')
                    await response.write(b'{"type":"resync","scope":"fresh"}\n{"type":"status"')  # cut off mid-line
                try:
                    await response.write_eof()
                except ConnectionResetError:  # the client already hung up (line limit, idle timeout)
                    pass
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

    async def test_identify_posts_scope_and_identity(self):
        self.mode = "accepted"
        await self.api.identify("fresh", "c" * 64)
        self.assertEqual(self.calls, [("PUT", "/api/integration/v1/buttons/identify", "Bearer test-token")])
        self.assertEqual(json.loads(self.bodies[0]), {"scope": "fresh", "identity": "c" * 64})
        self.mode = "rejected"
        with self.assertRaises(transport.ApiError):
            await self.api.identify("fresh", "c" * 64)

    async def test_control_disabled_is_its_own_error_and_not_a_credential_problem(self):
        self.mode = "403"
        with self.assertRaises(transport.ControlDisabledError):
            await self.api.identify("fresh", "c" * 64)
        self.assertTrue(issubclass(transport.ControlDisabledError, transport.ApiError))

    async def test_events_yield_valid_lines_and_end_cleanly(self):
        self.mode = "events"
        events = [event async for event in self.api.events()]
        self.assertEqual([event["type"] for event in events], ["heartbeat", "load", "resync"])  # garbage and the cut-off line skipped
        self.assertEqual(self.calls[-1], ("GET", "/api/integration/v1/events", "Bearer test-token"))

    async def test_events_errors(self):
        for mode, error in (("401", transport.AuthError), ("403", transport.ApiError), ("redirect", transport.ApiError),
                            ("events_wrong_type", transport.ApiError), ("events_long_line", transport.ApiError)):
            self.mode = mode
            with self.assertRaises(error, msg=mode):
                async for _ in self.api.events():
                    pass

    async def test_silent_stream_is_a_dead_link(self):
        self.mode = "events_silent"
        with self.assertRaises(transport.ApiError):
            async for _ in self.api.events(idle_timeout=0.2):
                pass

    async def test_http_origin_for_the_lan_listener(self):
        client = transport.WorkspaceApi(self.session, self.origin, "test-token", allow_http=True)
        self.assertEqual((await client.snapshot())["scope"], "fresh")
        with self.assertRaises(ValueError):
            transport.WorkspaceApi(self.session, self.origin, "test-token")


if __name__ == "__main__":
    unittest.main()
