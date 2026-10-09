"""Authenticated machine API only. No browser or commissioning endpoints."""
import asyncio
import json
import aiohttp
from .model import base_url, snapshot


class AuthError(Exception):
    """Credential rejected."""


class ApiError(Exception):
    """Request failed without exposing response content."""


class WorkspaceApi:
    def __init__(self, session, url, token):
        self.session = session
        self.url = base_url(url)
        self.headers = {"Authorization": f"Bearer {token}"}

    async def request(self, method, path, payload=None):
        try:
            async with asyncio.timeout(40):
                async with self.session.request(method, self.url + path, headers=self.headers,
                                                json=payload, allow_redirects=False) as response:
                    if response.status == 401:
                        raise AuthError("Workspace credential rejected")
                    if not 200 <= response.status < 300:
                        raise ApiError(f"Workspace request failed (HTTP {response.status})")
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

    async def target(self, load_id, scope, identity, target):
        result = await self.request("PUT", f"/api/integration/v1/loads/{load_id}/target",
                                    {"scope": scope, "identity": identity, "target": target})
        if not isinstance(result, dict) or result.get("accepted") is not True:
            raise ApiError("Workspace did not confirm command acceptance")
