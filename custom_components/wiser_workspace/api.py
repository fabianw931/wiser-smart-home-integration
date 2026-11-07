"""Authenticated machine API only. No browser or commissioning endpoints."""
import asyncio
import json
import aiohttp
from aiohttp import http_exceptions
from .const import EVENT_IDLE_TIMEOUT
from .model import base_url, parse_event_line, snapshot


class AuthError(Exception):
    """Credential rejected."""


class ApiError(Exception):
    """Request failed without exposing response content."""


class ControlDisabledError(ApiError):
    """The app is read-only (HTTP 403): WISER_INTEGRATION_CONTROL is not enabled there."""


EVENT_LINE_LIMIT = 64 * 1024


def _check_status(status):
    if status == 401:
        raise AuthError("Workspace credential rejected")
    if status == 403:
        raise ControlDisabledError("Workspace control is disabled")
    if not 200 <= status < 300:
        raise ApiError(f"Workspace request failed (HTTP {status})")


class WorkspaceApi:
    def __init__(self, session, url, token, allow_http=False):
        """`allow_http` must only be true for an origin the config flow built with HTTPS switched off."""
        self.session = session
        self.url = base_url(url, allow_http=allow_http)
        self.headers = {"Authorization": f"Bearer {token}"}

    async def request(self, method, path, payload=None):
        try:
            async with asyncio.timeout(40):
                async with self.session.request(method, self.url + path, headers=self.headers,
                                                json=payload, allow_redirects=False) as response:
                    _check_status(response.status)
                    if response.content_type != "application/json":
                        raise ApiError("Workspace response is not JSON")
                    limit = 2 * 1024 * 1024
                    if response.content_length is not None and response.content_length > limit:
                        raise ApiError("Workspace response exceeds size limit")
                    body = bytearray()
                    async for chunk in response.content.iter_chunked(65536):
                        body.extend(chunk)
                        if len(body) > limit:
                            raise ApiError("Workspace response exceeds size limit")
                    return json.loads(body)
        except (aiohttp.ClientError, TimeoutError, ValueError) as err:
            raise ApiError("Workspace unavailable or invalid response") from err

    async def snapshot(self):
        try:
            return snapshot(await self.request("GET", "/api/integration/v1/snapshot"))
        except ValueError as err:
            raise ApiError("Invalid workspace snapshot") from err

    async def _accepted(self, method, path, payload):
        result = await self.request(method, path, payload)
        if not isinstance(result, dict) or result.get("accepted") is not True:
            raise ApiError("Workspace did not confirm command acceptance")

    async def target(self, load_id, scope, identity, target):
        await self._accepted("PUT", f"/api/integration/v1/loads/{load_id}/target",
                             {"scope": scope, "identity": identity, "target": target})

    async def identify(self, scope, identity):
        """Flash a button's LED for about two seconds."""
        await self._accepted("PUT", "/api/integration/v1/buttons/identify", {"scope": scope, "identity": identity})

    async def events(self, idle_timeout=EVENT_IDLE_TIMEOUT):
        """Yield event dicts from the long-lived NDJSON stream until it ends.

        Raises AuthError/ApiError when the connection fails or nothing (not even a heartbeat) arrives within
        `idle_timeout` seconds. Malformed lines are skipped. A clean end of the stream just returns.
        """
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=15, sock_read=idle_timeout)
        try:
            async with self.session.request("GET", self.url + "/api/integration/v1/events", headers=self.headers,
                                            allow_redirects=False, timeout=timeout) as response:
                _check_status(response.status)
                if response.content_type != "application/x-ndjson":
                    raise ApiError("Workspace event stream has an unexpected content type")
                while True:
                    async with asyncio.timeout(idle_timeout):
                        line = await response.content.readline()
                    if not line:
                        return
                    if len(line) > EVENT_LINE_LIMIT:
                        raise ApiError("Workspace event line exceeds size limit")
                    event = parse_event_line(line)
                    if event is not None:
                        yield event
        except (aiohttp.ClientError, http_exceptions.HttpProcessingError, TimeoutError, ValueError) as err:
            raise ApiError("Workspace event stream unavailable or invalid") from err
