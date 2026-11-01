"""Demo content, so the app never looks empty: three showroom robots built by fictional people, with their
drive history and robot log. Every signed-in person sees them in the garage's Showroom; "driving" one runs the
simulator with that robot's parts. Loaded automatically the first time anyone opens the garage, removed or
reloaded from Admin -> Demo data. Removing it is remembered: it doesn't come back.

Demo users have is_demo=True and @example.com emails; they can't sign in (no password). Every demo row
is flagged is_demo=True, so remove() deletes exactly what load() added.
"""
import datetime as dt
import hashlib

from anvil.tables import app_tables

from . import common as C
from . import Parts

DEMO_USERS = [
    ("Ines Ozola", "ines.demo@example.com"),
    ("Theo Martin", "theo.demo@example.com"),
    ("Maya Chen", "maya.demo@example.com"),
]
# Tables that hold demo rows (each has an is_demo column). Children before parents.
DEMO_TABLES = ["events", "sessions", "passes", "shares", "robots"]


def _rand(seed, lo, hi):
    """A steady pseudo-random number (the same every load), so the demo looks the same for everyone."""
    h = int(hashlib.md5(str(seed).encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return lo + (hi - lo) * h


def _sprocket():
    return Parts.preset("pi", "Sprocket")


def _dusty():
    cfg = Parts.preset("pi_arduino", "Dusty")
    cfg["parts"].insert(5, {"id": "claw", "type": "slider", "driver": "arduino", "label": "Claw", "min": 0, "max": 100, "home": 0,
                            "unit": "%", "key": "c", "pins": {"pin": "11"}})
    cfg["parts"][3]["label"] = "Floodlight"
    return Parts.clean(cfg)[0]


def _biscuit():
    cfg = Parts.preset("pi", "Biscuit")
    parts = []
    for p in cfg["parts"]:
        if p["id"] == "drive":
            p = {"id": "drive", "type": "drive", "driver": "drv8833", "label": "Wheels", "max_speed": 0.55,
                 "pins": {"left_in1": 17, "left_in2": 27, "right_in1": 23, "right_in2": 24}}
        elif p["id"] in ("pan", "tilt"):
            p = dict(p, driver="pca9685", channel=0 if p["id"] == "pan" else 1, address=0x40)
            p.pop("pins", None)
        elif p["id"] == "voice":
            p = dict(p, phrases=["Hi Grandma!", "Can you show me the garden?", "I'm coming to the kitchen", "Bye for now!"])
        elif p["id"] == "horn":
            p = dict(p, label="Doorbell chime")
        parts.append(p)
    cfg["parts"] = parts
    return Parts.clean(cfg)[0]


ROBOTS = [
    # (owner index, name, colour, notes, config builder, model, camera, last seen hours ago, telemetry)
    (0, "Sprocket", "orange", "Patrols the pottery studio at night and checks the kiln is off.", _sprocket,
     "Raspberry Pi 4 Model B Rev 1.5", "Camera Module 3 (imx708)", 49, {"cpu_temp": 51.2, "wifi": 78, "distance": 64}),
    (1, "Dusty", "olive", "Garden scout on tank tracks. An Arduino Nano runs the motors; the claw picks up pine cones.", _dusty,
     "Raspberry Pi Zero 2 W Rev 1.0", "USB webcam (C270)", 5, {"cpu_temp": 47.0, "wifi": 64, "distance": 120, "battery": 7.62}),
    (2, "Biscuit", "yellow", "Lets the grandkids visit from Toronto. Pan-tilt HAT, soft headlights, says hello out loud.", _biscuit,
     "Raspberry Pi 5 Model B Rev 1.0", "Camera Module 3 Wide (imx708_wide)", 26, {"cpu_temp": 55.8, "wifi": 88, "distance": 210}),
]

PILOTS = {
    "Sprocket": [("Ines Ozola", "owner"), ("Ines Ozola", "owner"), ("Kai (guest pass)", "pilot"), ("Ines Ozola", "owner")],
    "Dusty": [("Theo Martin", "owner"), ("Theo Martin", "owner"), ("Ruby (guest pass)", "pilot"), ("Ruby (guest pass)", "viewer")],
    "Biscuit": [("Grandma Lin", "pilot"), ("Maya Chen", "owner"), ("Grandma Lin", "pilot"), ("Uncle Dev (guest pass)", "pilot")],
}

EVENTS = {
    "Sprocket": [(330, "paired", "Paired with sprocket."),
                 (329, "config", "Parts saved (version 2): Wheels, Look left / right, Look up / down, Headlights, Beep, Speak, Bumper sonar, CPU, Wi-Fi."),
                 (200, "stop", "Wheels stopped: no signal from the pilot for 0.5 s (Wi-Fi dropout)."),
                 (120, "warn", "Bumper sonar: something 18 cm ahead, forward drive paused."),
                 (52, "online", "Sprocket is online."), (49, "offline", "Sprocket went offline (shutting down).")],
    "Dusty": [(400, "paired", "Paired with dusty."),
              (390, "info", "The Arduino reports: drive, pan, tilt, lights, horn, claw, battery, distance."),
              (150, "warn", "Battery low: 6.6 V. Time to head home."), (30, "stop", "Emergency stop pressed by Theo Martin."),
              (6, "online", "Dusty is online."), (5, "offline", "Dusty went offline.")],
    "Biscuit": [(500, "paired", "Paired with biscuit."), (480, "info", "Shared with grandma.demo@example.com as pilot."),
                (300, "info", "Guest pass 'Sunday call' made (pilot, 4 h)."),
                (28, "online", "Biscuit is online."), (26, "offline", "Biscuit went offline.")],
}


def state():
    return C.get_setting("demo", "never")  # "never" | "loaded" | "removed"


def ensure_loaded():
    """Call from the app's main data callables: loads the demo once, unless an admin removed it."""
    if state() == "never":
        load()


def load():
    remove(remember=False)
    now = C.now()
    users = []
    for name, email in DEMO_USERS:
        u = app_tables.users.get(email=email) or app_tables.users.add_row(email=email, enabled=False)
        u.update(display_name=name, is_demo=True, signed_up=now - dt.timedelta(days=30))
        users.append(u)
    for i, (who, name, color, notes, build, model, camera, seen_h, tel) in enumerate(ROBOTS):
        cfg = build()
        cfg["rev"] = 2
        man = Parts.manifest_from_config(cfg, name)
        man["preview"] = False
        man["camera"]["source"] = "picamera2" if "Camera Module" in camera else "v4l2"
        r = app_tables.robots.add_row(
            owner=users[who], name=name, color=color, notes=notes, preset=cfg["board"], config=cfg, config_rev=2, manifest=man,
            info={"version": "1.0.0", "model": model, "host": name.lower(), "platform": "Debian 12 (bookworm) aarch64",
                  "python": "3.11.2", "ip": "192.168.1.%d" % (40 + i), "camera": camera, "source": "pi"},
            telemetry=tel, last_seen=now - dt.timedelta(hours=seen_h), token_hash="demo-" + name,
            created=now - dt.timedelta(days=21 - i), paired_at=now - dt.timedelta(days=20 - i), is_demo=True)
        for hours, kind, text in EVENTS[name]:
            app_tables.events.add_row(robot=r, kind=kind, text=text, at=now - dt.timedelta(hours=hours), is_demo=True)
        pilots = PILOTS[name]
        for k in range(9):
            pilot, role = pilots[k % len(pilots)]
            start = now - dt.timedelta(hours=seen_h + 6 + k * _rand(name + str(k), 14, 34))
            dur = round(_rand(name + "d" + str(k), 90, 1500))
            st = {"duration_s": dur, "rtt_ms": round(_rand(name + "r" + str(k), 38, 140)), "fps": round(_rand(name + "f" + str(k), 22, 30)),
                  "kbps": round(_rand(name + "k" + str(k), 700, 2300)), "width": 640, "height": 480}
            app_tables.sessions.add_row(robot=r, user=users[who] if role == "owner" else None, pilot_name=pilot, role=role,
                                        state="ended", created=start, ended_at=start + dt.timedelta(seconds=dur), stats=st,
                                        is_demo=True)
        if name == "Biscuit":
            app_tables.shares.add_row(robot=r, email="grandma.demo@example.com", user=None, role="pilot",
                                      created=now - dt.timedelta(days=19), is_demo=True)
            app_tables.passes.add_row(robot=r, token_hash="demo-pass-biscuit", label="Sunday call", role="pilot",
                                      created=now - dt.timedelta(days=12), expires=now - dt.timedelta(days=12, hours=-4),
                                      uses=2, last_used=now - dt.timedelta(days=12, hours=-1), is_demo=True)
    C.set_setting("demo", "loaded")
    return counts()


def remove(remember=True):
    for name in DEMO_TABLES:
        for r in getattr(app_tables, name).search(is_demo=True):
            r.delete()
    for u in app_tables.users.search(is_demo=True):
        u.delete()
    if remember:
        C.set_setting("demo", "removed")
    return counts()


def counts():
    out = {"users": len(app_tables.users.search(is_demo=True))}
    for name in DEMO_TABLES:
        out[name] = len(getattr(app_tables, name).search(is_demo=True))
    return out
