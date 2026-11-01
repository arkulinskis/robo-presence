"""Video for the pilot: a Raspberry Pi camera (picamera2), a USB webcam (V4L2), or a test pattern.
One camera is opened once and shared by every pilot through aiortc's MediaRelay.

camera.source in the config: auto (Pi camera, else USB, else test pattern) | picamera | usb | test
"""
import asyncio
import fractions
import logging
import math
import time

log = logging.getLogger("robopresence")


def _size(cfg):
    try:
        w, h = (cfg.get("size") or "640x480").split("x")
        return int(w), int(h)
    except ValueError:
        return 640, 480


def make_track(cfg, robot):
    """(track, description). Tries the sources in order for 'auto'."""
    cfg = cfg or {}
    src = cfg.get("source") or "auto"
    w, h = _size(cfg)
    fps = int(cfg.get("fps") or 24)
    order = {"auto": ["picamera", "usb", "test"], "picamera": ["picamera", "test"], "usb": ["usb", "test"]}.get(src, ["test"])
    last = None
    for kind in order:
        try:
            if kind == "picamera":
                t = PiCameraTrack(w, h, fps, bool(cfg.get("flip")))
                return t, "picamera2 %dx%d" % (w, h)
            if kind == "usb":
                from aiortc.contrib.media import MediaPlayer
                import os
                dev = cfg.get("device") or "/dev/video0"
                if not os.path.exists(dev):
                    raise RuntimeError("%s doesn't exist" % dev)
                player = MediaPlayer(dev, format="v4l2", options={"video_size": "%dx%d" % (w, h), "framerate": str(fps)})
                if player.video is None:
                    raise RuntimeError("%s has no video" % dev)
                return player.video, "usb %s %dx%d" % (dev, w, h)
            return TestPatternTrack(w, h, fps, robot), "test pattern %dx%d" % (w, h)
        except Exception as e:
            last = e
            log.info("Camera source %s not available: %s", kind, e)
    raise RuntimeError("no camera: %s" % last)


def make_audio(cfg):
    if not (cfg or {}).get("audio"):
        return None
    try:
        from aiortc.contrib.media import MediaPlayer
        p = MediaPlayer("default", format="pulse")
        return p.audio
    except Exception:
        try:
            from aiortc.contrib.media import MediaPlayer
            return MediaPlayer("default", format="alsa").audio
        except Exception as e:
            log.warning("No microphone: %s", e)
            return None


def _track_base():
    from aiortc import VideoStreamTrack
    return VideoStreamTrack


class _Paced:
    """Timestamps at a chosen frame rate (aiortc's VideoStreamTrack is fixed at 30)."""

    def _init_clock(self, fps):
        self._fps = max(5, min(30, fps))
        self._t0 = None
        self._n = 0

    async def _next(self):
        if self._t0 is None:
            self._t0 = self._start = time.time()
        else:
            self._n += 1
            wait = self._t0 + self._n / self._fps - time.time()
            if wait > 0:
                await asyncio.sleep(wait)
            elif wait < -1:  # fell far behind (CPU busy): restart the clock
                self._t0, self._n = time.time(), 0
        due = self._t0 + self._n / self._fps
        return int((due - self._start) * 90000), fractions.Fraction(1, 90000)


class PiCameraTrack(_track_base(), _Paced):
    def __init__(self, w, h, fps, flip=False):
        super().__init__()
        from picamera2 import Picamera2
        self._init_clock(fps)
        self.cam = Picamera2()
        kw = {}
        if flip:
            from libcamera import Transform
            kw["transform"] = Transform(hflip=1, vflip=1)
        conf = self.cam.create_video_configuration(main={"size": (w, h), "format": "RGB888"},
                                                   controls={"FrameRate": float(fps)}, **kw)
        self.cam.configure(conf)
        self.cam.start()

    async def recv(self):
        import av
        pts, tb = await self._next()
        arr = await asyncio.get_running_loop().run_in_executor(None, self.cam.capture_array)
        frame = av.VideoFrame.from_ndarray(arr, format="bgr24")  # picamera2's RGB888 is B, G, R in memory
        frame.pts, frame.time_base = pts, tb
        return frame


class TestPatternTrack(_track_base(), _Paced):
    """A moving picture that shows the robot's state: a crosshair where the head points, wheel bars, lights.
    Good for testing the whole chain without a camera (and the end-to-end test reads it)."""

    def __init__(self, w, h, fps, robot):
        super().__init__()
        import numpy as np
        self.np = np
        self._init_clock(fps)
        self.w, self.h, self.robot = w, h, robot
        y, x = np.mgrid[0:h, 0:w]
        base = np.zeros((h, w, 3), np.uint8)
        base[...] = (34, 38, 28)
        grid = ((x % 40) == 0) | ((y % 40) == 0)
        base[grid] = (60, 66, 48)
        stripe = (((x + y) // 14) % 2 == 0) & (y > h - 18)
        base[stripe] = (226, 97, 30)
        base[(y > h - 18) & ~stripe] = (26, 23, 18)
        self.base = base
        self.t0 = time.time()

    def _box(self, img, x0, y0, x1, y1, color):
        x0, x1 = max(0, int(min(x0, x1))), min(self.w, int(max(x0, x1)))
        y0, y1 = max(0, int(min(y0, y1))), min(self.h, int(max(y0, y1)))
        if x1 > x0 and y1 > y0:
            img[y0:y1, x0:x1] = color

    async def recv(self):
        import av
        pts, tb = await self._next()
        img = self.base.copy()
        w, h, t = self.w, self.h, time.time() - self.t0
        st = self.robot.state_values() if self.robot else {}
        lights = any(v is True for k, v in st.items() if "light" in k)
        if lights:
            img[:h - 18] = (img[:h - 18].astype("uint16") * 2).clip(0, 255).astype("uint8")
        bx = int((math.sin(t * 1.3) * 0.5 + 0.5) * (w - 60))
        self._box(img, bx, 30, bx + 60, 44, (240, 200, 120))  # the moving bar: frames are flowing
        pan, tilt = float(st.get("pan", 0) or 0), float(st.get("tilt", 0) or 0)
        cx, cy = w / 2 + pan / 90.0 * (w / 2 - 20), h / 2 - tilt / 90.0 * (h / 2 - 30)
        self._box(img, cx - 22, cy - 2, cx + 22, cy + 2, (226, 97, 30))
        self._box(img, cx - 2, cy - 22, cx + 2, cy + 22, (226, 97, 30))
        d = st.get("drive") or {}
        for i, v in enumerate((d.get("l", 0), d.get("r", 0))):
            x0 = 20 + i * 24
            mid = h / 2
            self._box(img, x0, mid, x0 + 14, mid - float(v or 0) * (h / 2 - 50), (155, 174, 94))
        frame = av.VideoFrame.from_ndarray(img, format="rgb24")
        frame.pts, frame.time_base = pts, tb
        return frame
