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
