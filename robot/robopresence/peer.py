"""One pilot's WebRTC connection (aiortc). The pilot's browser makes the offer (video + audio to receive, two data
channels); the robot answers with its camera track and talks over the channels. ICE is not trickled: both sides
send complete descriptions, so the server only carries one offer and one answer."""
import asyncio
import json
import logging

log = logging.getLogger("robopresence")


class Session:
    def __init__(self, offer, robot, media, ice_servers, codec="h264"):
        self.id = offer["session"]
        self.role = offer.get("role") or "viewer"
        self.pilot = offer.get("pilot") or "Someone"
        self.offer_sdp = offer["sdp"]
        self.robot, self.media, self.ice, self.codec = robot, media, ice_servers or [], codec
        self.channels = {}
        self.pc = None
        self.closed = asyncio.Event()

    def send_text(self, text):
        for name in ("rp",):
            ch = self.channels.get(name)
            if ch is not None and ch.readyState == "open":
                try:
                    ch.send(text)
                except Exception:
                    pass

    def send(self, msg):
        self.send_text(json.dumps(msg))

    async def answer(self):
        from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection, RTCRtpSender, RTCSessionDescription
        servers = []
        for s in self.ice:
            urls = s.get("urls")
            try:
                servers.append(RTCIceServer(urls=urls, username=s.get("username"), credential=s.get("credential")))
            except Exception:
                pass
        self.pc = pc = RTCPeerConnection(RTCConfiguration(iceServers=servers))

        @pc.on("datachannel")
        def on_channel(ch):
            self.channels[ch.label] = ch

            @ch.on("message")
            def on_message(m):
                if isinstance(m, str):
                    self.robot.handle(self, m)

        @pc.on("connectionstatechange")
        async def on_state():
            log.info("Pilot %s: %s", self.pilot, pc.connectionState)
            if pc.connectionState == "connected":
                self.robot.join(self)
            elif pc.connectionState in ("failed", "closed", "disconnected"):
                if pc.connectionState != "disconnected":
                    await self.close()
                else:
                    asyncio.get_running_loop().call_later(6, lambda: asyncio.ensure_future(self._maybe_close()))

        await pc.setRemoteDescription(RTCSessionDescription(sdp=self.offer_sdp, type="offer"))
        for t in pc.getTransceivers():
            if t.kind == "video" and self.media.get("video") is not None:
                pc.addTrack(self.media["relay"].subscribe(self.media["video"], buffered=False))
                prefer = "video/H264" if self.codec == "h264" else "video/VP8"
                caps = RTCRtpSender.getCapabilities("video").codecs
                first = [c for c in caps if c.mimeType == prefer]
                if first:
                    try:
                        t.setCodecPreferences(first + [c for c in caps if c.mimeType != prefer])
                    except Exception as e:
                        log.info("Codec preference ignored: %s", e)
            elif t.kind == "audio" and self.media.get("audio") is not None:
                pc.addTrack(self.media["relay"].subscribe(self.media["audio"]))
        ans = await pc.createAnswer()
        await pc.setLocalDescription(ans)  # aiortc gathers every ICE candidate here
        return pc.localDescription.sdp

    async def _maybe_close(self):
        if self.pc is not None and self.pc.connectionState == "disconnected":
            await self.close()

    async def close(self):
        if self.closed.is_set():
            return
        self.closed.set()
        self.robot.leave(self)
        if self.pc is not None:
            try:
                await self.pc.close()
            except Exception:
                pass
