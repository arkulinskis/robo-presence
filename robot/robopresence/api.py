"""The robot's calls to the Robo Presence server (server_code/BotApi.py): plain HTTPS + JSON, standard library only."""
import asyncio
import json
import urllib.error
import urllib.request

from . import __version__


class Unpaired(Exception):
    """The server doesn't know this robot's token any more (unpaired in the website)."""


class ApiError(Exception):
    pass


class Api:
    def __init__(self, server, token=None):
        self.server = server.rstrip("/")
        self.token = token

    def post_sync(self, path, body, timeout=15):
        data = json.dumps(dict(body, token=self.token) if self.token else body).encode("utf-8")
        req = urllib.request.Request(self.server + path, data=data, method="POST",
                                     headers={"Content-Type": "application/json", "User-Agent": "robopresence/" + __version__})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read().decode("utf-8") or "{}")
            except ValueError:
                payload = {}
            if e.code == 401:
                raise Unpaired(payload.get("error") or "unpaired")
            raise ApiError(payload.get("error") or "HTTP %d" % e.code)
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise ApiError(str(getattr(e, "reason", e)))

    async def post(self, path, body, timeout=15):
        return await asyncio.to_thread(self.post_sync, path, body, timeout)

    async def event(self, kind, text):
        try:
            await self.post("/bot/event", {"kind": kind, "text": text}, timeout=8)
        except Exception:
            pass
