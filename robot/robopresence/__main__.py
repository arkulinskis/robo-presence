"""Robo Presence robot program.

    python -m robopresence claim --server https://<app>/_/api --code ABCD-2345    pair with the website (once)
    python -m robopresence run [--sim]          call in, wait for pilots, drive (the systemd service runs this)
    python -m robopresence test [--wheels]      wiggle the servos, flash the switches, read the sensors (and spin the wheels)
    python -m robopresence info                 show the saved pairing and the parts manifest

--config PATH  (default /etc/robopresence/robot.json) holds the server address and this robot's secret token.
The hardware config comes from the website (Parts tab) and is cached next to it (hardware.json), so the parts
work again after a restart even before the robot reaches the server.
"""
import argparse
import asyncio
import json
import logging
import os
import pathlib
import signal
import sys
import time

from . import __version__
from .api import Api, ApiError, Unpaired
from .robot import Robot

log = logging.getLogger("robopresence")
DEFAULT_CONFIG = "/etc/robopresence/robot.json"
SIM_CONFIG = {
    "camera": {"source": "test", "size": "640x480", "fps": 24},
    "safety": {"watchdog_ms": 500, "max_sessions": 3},
    "parts": [
        {"id": "drive", "type": "drive", "driver": "sim", "label": "Wheels", "max_speed": 0.8},
        {"id": "pan", "type": "servo", "driver": "sim", "label": "Look left / right", "min": -80, "max": 80, "home": 0, "group": "head", "axis": "x"},
        {"id": "tilt", "type": "servo", "driver": "sim", "label": "Look up / down", "min": -35, "max": 55, "home": 10, "group": "head", "axis": "y"},
        {"id": "lights", "type": "toggle", "driver": "sim", "label": "Headlights", "key": "l"},
        {"id": "horn", "type": "button", "driver": "sim", "label": "Beep", "key": "b"},
        {"id": "voice", "type": "say", "driver": "sim", "label": "Speak"},
        {"id": "battery", "type": "gauge", "driver": "sim", "label": "Battery", "unit": "V", "min": 6.0, "max": 8.4, "warn": 6.6, "low_is_bad": True},
        {"id": "distance", "type": "distance", "driver": "sim", "label": "Bumper sonar", "max": 200, "warn": 25},
    ],
}
EXIT_UNPAIRED = 3


def read_json(path):
    try:
        return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_json(path, data, private=False):
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    if private:
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
    os.replace(tmp, p)


def cache_path(config_path):
    return str(pathlib.Path(config_path).with_name("hardware.json"))


# ------------------------------------------------------------------------------------------- claim
def cmd_claim(args):
    api = Api(args.server)
    try:
        r = api.post_sync("/bot/claim", {"code": args.code, "info": Robot().info()})
    except ApiError as e:
        print("Pairing failed: %s" % e)
        return 1
    write_json(args.config, {"server": args.server.rstrip("/"), "token": r["token"], "robot_id": r["robot_id"], "name": r["name"],
                             "paired": time.strftime("%Y-%m-%d %H:%M")}, private=True)
    print("Paired as %s. Saved to %s." % (r["name"], args.config))
    return 0


# ------------------------------------------------------------------------------------------- run
class Runner:
    def __init__(self, args):
        self.args = args
        conf = read_json(args.config) or {}
        if not conf.get("token"):
            raise SystemExit("Not paired yet. Run the install command from the robot's Install tab (or: robopresence claim ...).")
        self.api = Api(conf["server"], conf["token"])
        self.name = conf.get("name") or "Robot"
        self.robot = Robot(sim=args.sim, notify=self._notify)
        self.sessions = {}
        self.media = None
        self.camera_key = None
        self.rev = 0
        self.sent_manifest = None
        self.ice = []

    def _notify(self, kind, text):
        try:
            asyncio.get_running_loop().create_task(self.api.event(kind, text))
        except RuntimeError:
            pass

    def _config(self, cfg, name=None):
        if self.args.sim:
            cfg = dict(cfg or {}, parts=(cfg or {}).get("parts") or SIM_CONFIG["parts"],
                       camera=dict((cfg or {}).get("camera") or {}, source="test"))
        self.robot.build(cfg, name or self.name)
        cam = cfg.get("camera") or {}
        key = json.dumps(cam, sort_keys=True)
        if key != self.camera_key:
            self.camera_key = key
            self._camera(cam)

    def _camera(self, cam):
        from aiortc.contrib.media import MediaRelay
        from . import camera
        try:
            video, desc = camera.make_track(cam, self.robot)
        except Exception as e:
            video, desc = None, "none (%s)" % e
            log.warning("No video: %s", e)
        self.robot.camera_desc = desc
        self.media = {"relay": MediaRelay(), "video": video, "audio": camera.make_audio(cam)}
        log.info("Camera: %s", desc)

    async def hello(self):
        delay = 2
        while True:
            try:
                return await self.api.post("/bot/hello", {"manifest": self.robot.manifest(), "info": self.robot.info()})
            except ApiError as e:
                log.warning("Can't reach the server (%s). Trying again in %d s.", e, delay)
                await asyncio.sleep(delay)
                delay = min(30, delay * 2)

    async def start_session(self, offer):
        cam = self.robot.config.get("camera") or {}
        from .peer import Session
        s = Session(offer, self.robot, self.media, self.ice, codec=cam.get("codec") or "h264")
        self.sessions[s.id] = s
        try:
            sdp = await asyncio.wait_for(s.answer(), 25)
            await self.api.post("/bot/answer", {"session": s.id, "sdp": sdp})
            log.info("Answered %s (%s)", s.pilot, s.role)
        except Exception as e:
            log.warning("Couldn't connect %s: %s", s.pilot, e)
            await s.close()
            self.sessions.pop(s.id, None)

    async def main(self):
        cached = read_json(cache_path(self.args.config))
        self._config(cached or (SIM_CONFIG if self.args.sim else {"parts": []}))
        h = await self.hello()
        self.name, self.rev, self.ice = h.get("name") or self.name, h.get("config_rev") or 0, h.get("ice_servers") or []
        if h.get("config"):
            write_json(cache_path(self.args.config), h["config"])
            self._config(h["config"], self.name)
        log.info("%s is online (robot code %s). Waiting for pilots.", self.name, __version__)
        asyncio.get_running_loop().create_task(self.robot.run())
        errors = 0
        while True:
            body = {"telemetry": self.robot.readings(), "sessions": list(self.sessions), "config_rev": self.rev}
            if self.sent_manifest != self.robot.manifest_rev:
                body["manifest"] = self.robot.manifest()
            try:
                r = await self.api.post("/bot/poll", body)
                errors = 0
                if "manifest" in body:
                    self.sent_manifest = self.robot.manifest_rev
            except Unpaired as e:
                log.error("%s", e)
                return EXIT_UNPAIRED
            except ApiError as e:
                errors += 1
                wait = min(30, 2 * errors)
                if errors in (1, 5) or errors % 30 == 0:
                    log.warning("Server unreachable (%s), retrying every %d s", e, wait)
                await asyncio.sleep(wait)
                continue
            if r.get("ice_servers"):
                self.ice = r["ice_servers"]
            if r.get("config"):
                self.rev = r.get("config_rev") or self.rev
                write_json(cache_path(self.args.config), r["config"])
                log.info("New parts config (version %s)", self.rev)
                self._config(r["config"], self.name)
            max_s = int((self.robot.config.get("safety") or {}).get("max_sessions") or 3)
            for offer in r.get("offers") or []:
                live = [s for s in self.sessions.values() if not s.closed.is_set()]
                if len(live) >= max_s:
                    await self.api.post("/bot/answer", {"session": offer["session"],
                                                        "reject": "%s already has %d people connected." % (self.name, len(live))})
                    continue
                asyncio.get_running_loop().create_task(self.start_session(offer))
            for sid in r.get("ended") or []:
                s = self.sessions.pop(sid, None)
                if s is not None:
                    await s.close()
            for sid in [k for k, s in self.sessions.items() if s.closed.is_set()]:
                self.sessions.pop(sid, None)
            await asyncio.sleep(max(0.3, (r.get("next_ms") or 1500) / 1000.0))

    async def shutdown(self):
        for s in list(self.sessions.values()):
            await s.close()
        self.robot.close_parts()
        try:
            await asyncio.wait_for(self.api.event("offline", "%s went offline (shutting down)." % self.name), 4)
        except Exception:
            pass


def cmd_run(args):
    runner = Runner(args)

    async def go():
        loop = asyncio.get_running_loop()
        task = loop.create_task(runner.main())
        if hasattr(signal, "SIGTERM") and sys.platform != "win32":
            for sig in (signal.SIGTERM, signal.SIGINT):
                loop.add_signal_handler(sig, task.cancel)
        try:
            return await task
        except asyncio.CancelledError:
            return 0
        finally:
            await runner.shutdown()

    try:
        return asyncio.run(go()) or 0
    except KeyboardInterrupt:
        return 0


# ------------------------------------------------------------------------------------------- test + info
def cmd_test(args):
    cfg = read_json(cache_path(args.config)) or (SIM_CONFIG if args.sim else None)
    if not cfg:
        print("No parts config yet: start the robot once so it downloads it from the website.")
        return 1
    robot = Robot(sim=args.sim)
    m = robot.build(cfg, "test")
    for p in m["problems"]:
        print("  NOT WORKING  %-10s %s" % (p["id"], p["text"]))

    def run_for(seconds):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            for p in robot.parts:
                if not p.error:
                    p.tick(0.02)
            time.sleep(0.02)

    for p in robot.parts:
        if p.error:
            continue
        if p.type in ("servo", "slider"):
            print("  %-10s sweeping %s .. %s" % (p.id, p.lo, p.hi))
            for v in (p.lo, p.hi, p.home_v):
                p.set(v)
                run_for(1.2)
        elif p.type in ("toggle", "button"):
            print("  %-10s on, then off" % p.id)
            p.set(True) if p.type == "toggle" else p.press(True)
            run_for(0.6)
            p.set(False) if p.type == "toggle" else p.press(False)
            run_for(0.2)
        elif p.type == "say":
            print("  %-10s speaking" % p.id)
            p.say("Robo Presence test. All systems go.")
        elif p.type == "drive" and args.wheels:
            print("  %-10s forward, back, left, right (lift the robot off the floor!)" % p.id)
            for x, y in ((0, 0.5), (0, -0.5), (-0.6, 0), (0.6, 0)):
                p.drive(x, y)
                run_for(0.8)
            p.safe()
        elif p.type == "drive":
            print("  %-10s skipped (add --wheels to spin them, with the robot lifted)" % p.id)
    time.sleep(0.3)
    for k, v in robot.readings().items():
        print("  %-10s reads %s" % (k, v))
    robot.close_parts()
    return 0


def cmd_info(args):
    conf = read_json(args.config) or {}
    print("Robo Presence robot code %s" % __version__)
    print("Config: %s (%s)" % (args.config, "paired as %s with %s" % (conf.get("name"), conf.get("server")) if conf.get("token") else "not paired"))
    cfg = read_json(cache_path(args.config))
    if cfg:
        robot = Robot(sim=True)
        print(json.dumps(robot.build(cfg, conf.get("name")), indent=2))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="robopresence", description="Robo Presence robot")
    ap.add_argument("--config", default=os.environ.get("ROBOPRESENCE_CONFIG", DEFAULT_CONFIG))
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd")
    c = sub.add_parser("claim")
    c.add_argument("--server", required=True)
    c.add_argument("--code", required=True)
    r = sub.add_parser("run")
    r.add_argument("--sim", action="store_true", help="no hardware: simulated parts and a test-pattern camera")
    t = sub.add_parser("test")
    t.add_argument("--wheels", action="store_true")
    t.add_argument("--sim", action="store_true")
    sub.add_parser("info")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        datefmt="%H:%M:%S")
    for noisy in ("aioice", "aiortc"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    fn = {"claim": cmd_claim, "run": cmd_run, "test": cmd_test, "info": cmd_info}.get(args.cmd)
    if fn is None:
        ap.print_help()
        return 2
    return fn(args)


if __name__ == "__main__":
    sys.exit(main())
