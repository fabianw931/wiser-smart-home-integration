"""Test adapter HTTP error handling without importing the HA runtime."""
import importlib
from pathlib import Path
import sys
import types
import unittest

package = types.ModuleType("workspace_transport_test")
package.__path__ = [str(Path(__file__).resolve().parents[1] / "custom_components/wiser_workspace")]
sys.modules[package.__name__] = package
api = importlib.import_module("workspace_transport_test.api")


class Response:
    def __init__(self, status=200, body=b'{"accepted":true}', declared_length=None):
        self.status = status
        self.body = body
        self.content_type = "application/json"
        self.content_length = declared_length
        self.content = self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def iter_chunked(self, size):
        yield self.body


class Session:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def request(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self.response


class TransportTest(unittest.IsolatedAsyncioTestCase):
    async def test_auth_redirect_and_malformed_response(self):
        for response, error in [(Response(401), api.AuthError), (Response(403), api.ApiError),
                                (Response(302), api.ApiError), (Response(body=b'not json'), api.ApiError),
                                (Response(declared_length=2097153), api.ApiError),
                                (Response(body=b'x' * 2097153), api.ApiError)]:
            session = Session(response)
            client = api.WorkspaceApi(session, "https://workspace.example:3443", "synthetic-token")
            with self.assertRaises(error):
                await client.request("GET", "/api/integration/v1/snapshot")
            self.assertFalse(session.calls[0][1]["allow_redirects"])

    async def test_target_requires_acceptance_and_preserves_identity(self):
        session = Session(Response())
        client = api.WorkspaceApi(session, "https://workspace.example:3443", "synthetic-token")
        await client.target(1, "scope", "a" * 64, {"bri": 2500})
        self.assertEqual(session.calls[0][1]["json"], {"scope": "scope", "identity": "a" * 64, "target": {"bri": 2500}})
        for body in (b'{}', b'{"accepted":false}', b'[]'):
            session.response = Response(body=body)
            with self.assertRaises(api.ApiError):
                await client.target(1, "scope", "a" * 64, {"bri": 0})
