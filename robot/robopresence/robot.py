"""The robot core: builds the parts from the config, answers the cockpit's messages, keeps everything safe.

Cockpit -> robot (JSON over the WebRTC data channels; "rp-fast" is unordered and lossy, "rp" is reliable)
  {"t":"hello","client":"cockpit/1"}             -> manifest + state + who drives
  {"t":"drive","x":-1..1,"y":-1..1,"s":seq}      wheels (sent 20 times a second while held; older seq ignored)
  {"t":"set","id":"pan","v":30,"s":seq}          servo / slider / toggle
  {"t":"press","id":"horn","down":true}          button down / up
  {"t":"say","id":"voice","text":"Hello"}        speak
  {"t":"stop"}                                    emergency stop (anyone, viewers too)
  {"t":"home"}                                    servos and sliders back to their home value
  {"t":"seat"}                                    "let me drive" (owners and pilots)
  {"t":"ping","n":1,"ts":...}                    -> {"t":"pong",...} (the cockpit measures the round trip)
Robot -> cockpit
  {"t":"manifest",...}  {"t":"state","values":{...},"seat":{...}}  {"t":"tel","sensors":{...},"values":{...}}
  {"t":"pong",...}  {"t":"log","level":"info|warn|stop","text":"..."}

Safety: the wheels stop when no drive message arrives for watchdog_ms (Wi-Fi dropout), when the driver
disconnects, on emergency stop, and (with a distance sensor's stop_at) forward driving pauses near obstacles.
"""
import asyncio
import json
import logging
import platform
import socket
import time

from . import __version__, parts as P

log = logging.getLogger("robopresence")
SENSOR_TYPES = ("gauge", "distance")


def model_name():
    try:
        with open("/proc/device-tree/model") as f:
            return f.read().strip("\x00 \n")
    except OSError:
        return platform.machine() + " " + platform.system()


def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.0.2.1", 80))  # no packet is sent; this just picks the outgoing interface
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return ""


class Robot:
    def __init__(self, sim=False, notify=None):
        self.sim = sim
        self.notify = notify or (lambda kind, text: None)  # -> server event log
        self.parts, self.config, self.name = [], {}, "Robot"
        self.sessions = []
        self.driver = None
        self.arduino = None
        self._arduino_users = []
        self.last_drive = 0.0
        self.last_seq = {}
        self.manifest_rev = 0
        self.camera_desc = ""
        self.stopped_by_watchdog = False
        self._state_dirty = False

    # ------------------------------------------------------------------------------- building
    def build(self, config, name=None):
        self.close_parts()
        self.config = config or {}
        self.name = name or self.name
        self._arduino_users = []
        self.parts = [P.make(spec, self, sim=self.sim) for spec in self.config.get("parts") or []]
        for p in self.parts:
            if p.error:
                continue
            try:
                p.start()
            except Exception as e:
                p.error = str(e)[:150] or type(e).__name__
                log.warning("Part %s (%s, %s) didn't start: %s", p.id, p.type, p.driver, p.error)
        if self._arduino_users and not self.sim:
            self._open_arduino()
        for p in self.parts:
            if p.type not in SENSOR_TYPES and not p.error:
                p.home()
        self.manifest_rev += 1
        ok = [p.id for p in self.parts if not p.error]
        bad = [p.id for p in self.parts if p.error]
        log.info("Parts ready: %s%s", ", ".join(ok) or "none", ("; not working: " + ", ".join(bad)) if bad else "")
        m = self.manifest()
        if self.sessions:  # pilots already connected get the new parts at once (the cockpit redraws its controls)
            self.broadcast(dict(m, t="manifest"))
            self.broadcast({"t": "state", "values": self.state_values(), "seat": self.seat()})
        return m

    def need_arduino(self, part):
        self._arduino_users.append(part)

    def _open_arduino(self):
        from .arduino import Arduino
        a = self.config.get("arduino") or {}
        try:
            if self.arduino is None:
                self.arduino = Arduino(a.get("port", "auto"), int(a.get("baud") or 115200))
            have = {p.get("id") for p in self.arduino.parts}
            for part in self._arduino_users:
                if part.id not in have:
                    part.error = "the Arduino sketch has no part called '%s' (update its CONFIG block and upload it again)" % part.id
            known = {p.id for p in self.parts}
            extra = [p for p in self.arduino.parts if p.get("id") and p.get("id") not in known]
            for spec in extra:  # parts the Arduino has that the config doesn't: add them, so the cockpit shows them
                spec = dict(spec, driver="arduino", label=spec.get("label") or spec["id"].replace("_", " ").capitalize())
                if spec.get("type") in ("servo", "slider", "toggle", "button", "gauge", "distance"):
                    part = P.make(spec, self)
                    part.start()
                    self.parts.append(part)
            if extra:
                self.note("info", "The Arduino reports parts that aren't in the config: %s." % ", ".join(s["id"] for s in extra))
            log.info("Arduino %s on %s: %s", self.arduino.name, self.arduino.port, ", ".join(p.get("id", "?") for p in self.arduino.parts))
        except Exception as e:
            for part in self._arduino_users:
                part.error = "Arduino: %s" % str(e)[:140]
            log.warning("Arduino not available: %s", e)

    def arduino_send(self, line):
        if self.arduino is not None:
            self.arduino.send(line)

    def arduino_value(self, pid):
        return self.arduino.values.get(pid) if self.arduino is not None else None

    def close_parts(self):
        for p in self.parts:
            try:
                p.safe()
                p.close()
            except Exception:
                pass
        if self.arduino is not None:
            self.arduino.close()
            self.arduino = None
        self.parts = []

    # ------------------------------------------------------------------------------- what the cockpit sees
    def manifest(self):
        cam = self.config.get("camera") or {}
        try:
            w, h = (cam.get("size") or "640x480").split("x")
        except ValueError:
            w, h = 640, 480
        m = {"protocol": 1, "name": self.name, "version": __version__, "model": model_name(),
             "camera": {"width": int(w), "height": int(h), "fps": int(cam.get("fps") or 24),
                        "source": self.camera_desc or cam.get("source", "auto"), "audio": bool(cam.get("audio"))},
             "controls": [], "sensors": [], "problems": []}
        for p in self.parts:
            d = p.describe()
            (m["sensors"] if p.type in SENSOR_TYPES else m["controls"]).append(d)
            if p.error:
                m["problems"].append({"id": p.id, "text": p.error})
        return m

    def info(self):
        return {"version": __version__, "model": model_name(), "host": socket.gethostname(),
                "platform": "%s %s %s" % (platform.system(), platform.release(), platform.machine()),
                "python": platform.python_version(), "ip": local_ip(), "camera": self.camera_desc}

    def part(self, pid):
        for p in self.parts:
            if p.id == pid:
                return p
        return None

    def part_of_type(self, typ):
        for p in self.parts:
            if p.type == typ and not p.error:
                return p
        return None

    def forward_limit(self):
        for p in self.parts:
            if p.type == "distance" and not p.error and P.num(p.spec.get("stop_at")) > 0:
                v = p.read() if p.driver != "sim" else getattr(p, "v", None)
                if isinstance(v, (int, float)) and v < P.num(p.spec.get("stop_at")):
                    return True
        return False

    def distance_label(self):
        p = self.part_of_type("distance")
        return p.spec.get("label", "Distance") if p else "Distance"

    def state_values(self):
        out = {}
        for p in self.parts:
            if p.type in SENSOR_TYPES or p.error:
                continue
            v = p.state()
            out[p.id] = round(v, 1) if isinstance(v, float) else v
        return out

    def readings(self):
        out = {}
        for p in self.parts:
            if p.type in SENSOR_TYPES and not p.error:
                try:
                    out[p.id] = p.read()
                except Exception:
                    out[p.id] = None
        return out

    # ------------------------------------------------------------------------------- sessions and messages
    def seat(self):
        d = self.driver
        return {"driver": d.id if d else None, "name": d.pilot if d else None}

    def join(self, session):
        self.sessions.append(session)
        if session.role != "viewer" and (self.driver is None or session.role == "owner"):
            self._give_seat(session)

    def leave(self, session):
        if session in self.sessions:
            self.sessions.remove(session)
        if self.driver is session:
            self.driver = None
            self.all_safe()
            nxt = next((s for s in self.sessions if s.role != "viewer"), None)
            if nxt:
                self._give_seat(nxt)
            else:
                self.broadcast({"t": "state", "values": self.state_values(), "seat": self.seat()})

    def _give_seat(self, session):
        if self.driver is not session:
            self.all_safe(keep_servos=True)
        self.driver = session
        self.last_seq = {}
        self.broadcast({"t": "state", "values": self.state_values(), "seat": self.seat()})
        self.broadcast({"t": "log", "level": "info", "text": "%s is driving." % session.pilot})

    def broadcast(self, msg):
        text = json.dumps(msg)
        for s in list(self.sessions):
            s.send_text(text)

    def note(self, level, text):
        log.info(text)
        self.broadcast({"t": "log", "level": level, "text": text})
        if level in ("warn", "stop", "error"):
            self.notify(level if level != "error" else "warn", text)

    def all_safe(self, keep_servos=True):
        for p in self.parts:
            try:
                p.safe()
            except Exception:
                pass

    def handle(self, session, raw):
        try:
            msg = json.loads(raw)
        except (ValueError, TypeError):
            return
        if not isinstance(msg, dict):
            return
        t = msg.get("t")
        if t == "ping":
            session.send({"t": "pong", "n": msg.get("n"), "ts": msg.get("ts"), "robot_ms": int(time.time() * 1000)})
            return
        if t == "hello":
            session.send(dict(self.manifest(), t="manifest"))
            session.send({"t": "state", "values": self.state_values(), "seat": self.seat(), "you": session.id})
            return
        if t == "stop":
            self.all_safe()
            self.note("stop", "Emergency stop pressed by %s." % session.pilot)
            return
        if session.role == "viewer":
            return
        if t == "seat":
            if self.driver is None or session.role == "owner" or self.driver.role != "owner":
                self._give_seat(session)
            else:
                session.send({"t": "log", "level": "warn", "text": "%s (the owner) is driving." % self.driver.pilot})
            return
        if session is not self.driver:
            return
        seq = msg.get("s")
        key = (t, msg.get("id"))
        if isinstance(seq, int):
            if seq <= self.last_seq.get(key, -1):
                return  # an older message overtaken by a newer one (the fast channel is unordered)
            self.last_seq[key] = seq
        if t == "drive":
            d = self.part_of_type("drive")
            if d is not None:
                d.drive(msg.get("x"), msg.get("y"))
                self.last_drive = time.monotonic()
                self.stopped_by_watchdog = False
            return
        if t == "home":
            for q in self.parts:
                if not q.error:
                    q.home()
            self._state_dirty = True
            return
        p = self.part(msg.get("id"))
        if p is None or p.error:
            return
        if t == "set":
            p.set(msg.get("v"))
        elif t == "press":
            p.press(bool(msg.get("down")))
        elif t == "say":
            p.say(msg.get("text"))
            self.broadcast({"t": "log", "level": "info", "text": "%s: “%s”" % (p.spec.get("label") or "Voice", str(msg.get("text"))[:120])})
        self._state_dirty = True

    # ------------------------------------------------------------------------------- the control loop
    async def run(self):
        """50 Hz: move servos and wheels smoothly, watchdog. 1 Hz: telemetry to every pilot."""
        last, last_tel, last_state = time.monotonic(), 0.0, 0.0
        self._state_dirty = False
        while True:
            await asyncio.sleep(0.02)
            now = time.monotonic()
            dt, last = now - last, now
            wd = int((self.config.get("safety") or {}).get("watchdog_ms") or 500) / 1000.0
            d = self.part_of_type("drive")
            if d is not None and d.target != (0.0, 0.0) and now - self.last_drive > wd:
                d.safe()
                if not self.stopped_by_watchdog:
                    self.stopped_by_watchdog = True
                    self.note("stop", "Wheels stopped: no signal from the pilot for %.1f s." % wd)
            for p in self.parts:
                if not p.error:
                    try:
                        before = p.state()
                        p.tick(dt)
                        if p.state() != before:
                            self._state_dirty = True  # still moving: keep the cockpit in step
                    except Exception as e:
                        p.error = str(e)[:150]
                        log.warning("Part %s failed: %s", p.id, e)
            if self.sessions and self._state_dirty and now - last_state > 0.1:
                last_state, self._state_dirty = now, False
                self.broadcast({"t": "state", "values": self.state_values(), "seat": self.seat()})
            if self.sessions and now - last_tel > 1.0:
                last_tel = now
                self.broadcast({"t": "tel", "sensors": self.readings(), "values": self.state_values()})
