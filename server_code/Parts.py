"""Robot hardware configs: part types, drivers, presets, validation, and the manifest a config describes.

A robot's config (robots.config) is edited in the website's Parts tab and downloaded by the robot on start
(and again whenever config_rev changes). The robot builds its parts from it and reports back a manifest:
what actually works. The cockpit draws its controls from that manifest, so a new part shows up by itself.

The same field names are used by the robot code (robot/robopresence/parts.py) and the cockpit (web/pages/_rp.html).
Keep the three in step when adding a part type.
"""
import copy
import re

PROTOCOL = 1

# type -> kind (control/sensor), the drivers that can run it, and the cockpit control it becomes.
TYPES = {
    "drive": {"kind": "control", "drivers": ["tb6612", "l298n", "drv8833", "arduino", "sim"], "label": "Wheels"},
    "servo": {"kind": "control", "drivers": ["gpio", "pca9685", "arduino", "sim"], "label": "Servo"},
    "slider": {"kind": "control", "drivers": ["pwm", "arduino", "sim"], "label": "Slider"},
    "toggle": {"kind": "control", "drivers": ["gpio", "arduino", "sim"], "label": "Switch"},
    "button": {"kind": "control", "drivers": ["gpio", "arduino", "sim"], "label": "Button"},
    "say": {"kind": "control", "drivers": ["espeak", "sim"], "label": "Voice"},
    "custom": {"kind": "control", "drivers": ["plugin"], "label": "Plugin part"},
    "gauge": {"kind": "sensor", "drivers": ["cpu_temp", "wifi", "arduino", "sim"], "label": "Gauge"},
    "distance": {"kind": "sensor", "drivers": ["hcsr04", "arduino", "sim"], "label": "Distance"},
}
# The cockpit control a "custom" (plugin) part can ask for.
CUSTOM_UI = ["slider", "toggle", "button", "say"]

# Pins each driver needs. Raspberry Pi drivers use BCM GPIO numbers; Arduino parts use Arduino pin names ("9", "A0").
PIN_FIELDS = {
    "tb6612": ["left_in1", "left_in2", "left_pwm", "right_in1", "right_in2", "right_pwm", "standby"],
    "l298n": ["left_in1", "left_in2", "left_pwm", "right_in1", "right_in2", "right_pwm"],
    "drv8833": ["left_in1", "left_in2", "right_in1", "right_in2"],
    "gpio": ["pin"],
    "pwm": ["pin"],
    "hcsr04": ["trigger", "echo"],
    "arduino": [],  # set per type below
}
ARDUINO_PINS = {
    "drive": ["left_in1", "left_in2", "left_pwm", "right_in1", "right_in2", "right_pwm", "standby"],
    "servo": ["pin"], "slider": ["pin"], "toggle": ["pin"], "button": ["pin"], "gauge": ["pin"],
    "distance": ["trigger", "echo"],
}
OPTIONAL_PINS = {"standby"}
PI_DRIVERS = {"tb6612", "l298n", "drv8833", "gpio", "pwm", "hcsr04"}
CAMERA_SOURCES = ["auto", "picamera", "usb", "test"]
CAMERA_SIZES = ["320x240", "640x480", "960x540", "1280x720"]
CODECS = ["h264", "vp8"]
BOARDS = ["pi", "pi_arduino", "browser"]
SPECIAL_PINS = {2: "I2C SDA", 3: "I2C SCL", 14: "UART TX", 15: "UART RX"}
MAX_PARTS = 24
ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,23}$")
ARDUINO_PIN_RE = re.compile(r"^(A[0-7]|[0-9]{1,2})$")
GAUGE_DEFAULTS = {
    "cpu_temp": {"label": "CPU", "unit": "°C", "min": 30, "max": 85, "warn": 75},
    "wifi": {"label": "Wi-Fi", "unit": "%", "min": 0, "max": 100, "warn": 30, "low_is_bad": True},
    "arduino": {"label": "Battery", "unit": "V", "min": 6.0, "max": 8.4, "warn": 6.6, "low_is_bad": True},
    "sim": {"label": "Battery", "unit": "V", "min": 6.0, "max": 8.4, "warn": 6.6, "low_is_bad": True},
}


def _num(v, lo, hi, default):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if f != f:  # NaN
        return default
    return max(lo, min(hi, f))


def _int_or_none(v):
    if v in (None, ""):
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return "bad"


def _txt(v, n):
    s = "" if v is None else re.sub(r"\s+", " ", str(v)).strip()
    return s[:n]


# ------------------------------------------------------------------------------------------- presets
def preset(name, robot_name="Robot"):
    """A starting config. 'pi': everything wired to the Pi. 'pi_arduino': an Arduino runs the motors and servos.
    'browser': a phone or laptop on the robot is its brain (web/pages/bot.html), with simulated or Arduino parts."""
    cam = {"source": "auto", "size": "640x480", "fps": 24, "flip": False, "codec": "h264", "audio": False}
    safety = {"watchdog_ms": 500, "max_sessions": 3}
    pi_sensors = [
        {"id": "cpu_temp", "type": "gauge", "driver": "cpu_temp", "label": "CPU"},
        {"id": "wifi", "type": "gauge", "driver": "wifi", "label": "Wi-Fi"},
    ]
    if name == "pi_arduino":
        parts = [
            {"id": "drive", "type": "drive", "driver": "arduino", "label": "Wheels", "max_speed": 0.8,
             "pins": {"left_in1": "7", "left_in2": "8", "left_pwm": "5", "right_in1": "4", "right_in2": "12", "right_pwm": "6",
                      "standby": "A2"}},
            {"id": "pan", "type": "servo", "driver": "arduino", "label": "Look left / right", "min": -80, "max": 80, "home": 0,
             "group": "head", "axis": "x", "pins": {"pin": "9"}},
            {"id": "tilt", "type": "servo", "driver": "arduino", "label": "Look up / down", "min": -35, "max": 55, "home": 10,
             "group": "head", "axis": "y", "pins": {"pin": "10"}},
            {"id": "lights", "type": "toggle", "driver": "arduino", "label": "Headlights", "key": "l", "pins": {"pin": "2"}},
            {"id": "horn", "type": "button", "driver": "arduino", "label": "Beep", "key": "b", "pins": {"pin": "3"}},
            {"id": "voice", "type": "say", "driver": "espeak", "label": "Speak"},
            {"id": "battery", "type": "gauge", "driver": "arduino", "label": "Battery", "unit": "V", "min": 6.0, "max": 8.4,
             "warn": 6.6, "low_is_bad": True, "factor": 3.0, "pins": {"pin": "A0"}},
            {"id": "distance", "type": "distance", "driver": "arduino", "label": "Bumper sonar", "max": 200, "warn": 25,
             "pins": {"trigger": "A4", "echo": "A5"}},
        ] + pi_sensors
        board = "pi_arduino"
    elif name == "browser":
        cam = dict(cam, source="test")
        parts = [
            {"id": "drive", "type": "drive", "driver": "sim", "label": "Wheels", "max_speed": 0.8},
            {"id": "pan", "type": "servo", "driver": "sim", "label": "Look left / right", "min": -80, "max": 80, "home": 0,
             "group": "head", "axis": "x"},
            {"id": "tilt", "type": "servo", "driver": "sim", "label": "Look up / down", "min": -35, "max": 55, "home": 10,
             "group": "head", "axis": "y"},
            {"id": "lights", "type": "toggle", "driver": "sim", "label": "Headlights", "key": "l"},
            {"id": "horn", "type": "button", "driver": "sim", "label": "Beep", "key": "b"},
            {"id": "voice", "type": "say", "driver": "sim", "label": "Speak"},
            {"id": "battery", "type": "gauge", "driver": "sim", "label": "Battery", "unit": "V", "min": 6.0, "max": 8.4, "warn": 6.6,
             "low_is_bad": True},
            {"id": "distance", "type": "distance", "driver": "sim", "label": "Bumper sonar", "max": 200, "warn": 25},
        ]
        board = "browser"
    else:
        parts = [
            {"id": "drive", "type": "drive", "driver": "tb6612", "label": "Wheels", "max_speed": 0.8,
             "pins": {"left_in1": 17, "left_in2": 27, "left_pwm": 12, "right_in1": 23, "right_in2": 24, "right_pwm": 13,
                      "standby": 25}},
            {"id": "pan", "type": "servo", "driver": "gpio", "label": "Look left / right", "min": -80, "max": 80, "home": 0,
             "group": "head", "axis": "x", "pins": {"pin": 18}},
            {"id": "tilt", "type": "servo", "driver": "gpio", "label": "Look up / down", "min": -35, "max": 55, "home": 10,
             "group": "head", "axis": "y", "pins": {"pin": 19}},
            {"id": "lights", "type": "toggle", "driver": "gpio", "label": "Headlights", "key": "l", "pins": {"pin": 16}},
            {"id": "horn", "type": "button", "driver": "gpio", "label": "Beep", "key": "b", "pins": {"pin": 26}},
            {"id": "voice", "type": "say", "driver": "espeak", "label": "Speak"},
            {"id": "distance", "type": "distance", "driver": "hcsr04", "label": "Bumper sonar", "max": 200, "warn": 25,
             "pins": {"trigger": 5, "echo": 6}},
        ] + pi_sensors
        board = "pi"
    return {"rev": 1, "board": board, "camera": cam, "arduino": {"port": "auto", "baud": 115200}, "safety": safety,
            "parts": copy.deepcopy(parts)}


# ------------------------------------------------------------------------------------------- validation
def clean(config):
    """(clean config, list of problems). Problems are sentences the Parts tab shows; a config with problems isn't saved."""
    problems = []
    if not isinstance(config, dict):
        return None, ["The config isn't readable."]
    out = {}
    out["board"] = config.get("board") if config.get("board") in BOARDS else "pi"
    cam = config.get("camera") if isinstance(config.get("camera"), dict) else {}
    out["camera"] = {
        "source": cam.get("source") if cam.get("source") in CAMERA_SOURCES else "auto",
        "size": cam.get("size") if cam.get("size") in CAMERA_SIZES else "640x480",
        "fps": int(_num(cam.get("fps"), 5, 30, 24)),
        "flip": bool(cam.get("flip")),
        "codec": cam.get("codec") if cam.get("codec") in CODECS else "h264",
        "audio": bool(cam.get("audio")),
        "device": _txt(cam.get("device"), 60) or "/dev/video0",
    }
    ard = config.get("arduino") if isinstance(config.get("arduino"), dict) else {}
    baud = int(_num(ard.get("baud"), 9600, 1000000, 115200))
    out["arduino"] = {"port": _txt(ard.get("port"), 60) or "auto", "baud": baud}
    saf = config.get("safety") if isinstance(config.get("safety"), dict) else {}
    out["safety"] = {"watchdog_ms": int(_num(saf.get("watchdog_ms"), 200, 3000, 500)),
                     "max_sessions": int(_num(saf.get("max_sessions"), 1, 6, 3))}
    parts_in = config.get("parts") if isinstance(config.get("parts"), list) else []
    if len(parts_in) > MAX_PARTS:
        problems.append("A robot can have at most %d parts." % MAX_PARTS)
        parts_in = parts_in[:MAX_PARTS]
    seen, used_pins, parts, drives = set(), {}, [], 0
    for i, p in enumerate(parts_in):
        if not isinstance(p, dict):
            continue
        pid = _txt(p.get("id"), 24).lower()
        name = "Part %d" % (i + 1) if not pid else "'%s'" % pid
        typ = p.get("type")
        if typ not in TYPES:
            problems.append("%s has an unknown type." % name)
            continue
        if not ID_RE.match(pid):
            problems.append("%s: the id must start with a letter and use only a-z, 0-9 and _ (24 characters at most)." % name)
            continue
        if pid in seen:
            problems.append("Two parts are called '%s'. Each id must be unique." % pid)
            continue
        seen.add(pid)
        drivers = TYPES[typ]["drivers"]
        drv = p.get("driver") if p.get("driver") in drivers else drivers[0]
        q: dict = {"id": pid, "type": typ, "driver": drv, "label": _txt(p.get("label"), 40) or TYPES[typ]["label"]}
        key = _txt(p.get("key"), 1).lower()
        if key and re.match(r"^[a-z0-9]$", key) and key not in "wasdh":
            q["key"] = key
        if typ == "drive":
            drives += 1
            q["max_speed"] = round(_num(p.get("max_speed"), 0.1, 1, 0.8), 2)
            q["turn"] = round(_num(p.get("turn"), 0.2, 1, 0.7), 2)
            q["trim"] = round(_num(p.get("trim"), -0.3, 0.3, 0), 2)
            q["invert_left"], q["invert_right"] = bool(p.get("invert_left")), bool(p.get("invert_right"))
        if typ in ("servo",):
            lo, hi = _num(p.get("min"), -90, 90, -80), _num(p.get("max"), -90, 90, 80)
            if lo >= hi:
                problems.append("%s: the smallest angle must be below the largest." % name)
                lo, hi = -80, 80
            q.update(min=round(lo), max=round(hi), home=round(_num(p.get("home"), lo, hi, 0)), invert=bool(p.get("invert")),
                     speed=round(_num(p.get("speed"), 20, 720, 240)))
            q["group"] = _txt(p.get("group"), 16).lower()
            q["axis"] = p.get("axis") if p.get("axis") in ("x", "y") else ""
            if drv == "pca9685":
                q["channel"] = int(_num(p.get("channel"), 0, 15, 0))
                q["address"] = int(_num(p.get("address"), 0x40, 0x7F, 0x40))
            q["pulse_min"] = round(_num(p.get("pulse_min"), 0.3, 1.2, 0.5), 2)
            q["pulse_max"] = round(_num(p.get("pulse_max"), 1.8, 2.8, 2.5), 2)
        if typ == "slider":
            q.update(min=round(_num(p.get("min"), -1000, 1000, 0)), max=round(_num(p.get("max"), -1000, 1000, 100)),
                     unit=_txt(p.get("unit"), 6) or "%")
            if q["min"] >= q["max"]:
                problems.append("%s: the smallest value must be below the largest." % name)
                q["min"], q["max"] = 0, 100
            q["home"] = round(_num(p.get("home"), q["min"], q["max"], q["min"]))
            q["output"] = p.get("output") if p.get("output") in ("servo", "pwm") else "pwm"
        if typ == "button":
            q["pulse_ms"] = int(_num(p.get("pulse_ms"), 0, 5000, 0))
        if typ == "toggle":
            q["active_low"] = bool(p.get("active_low"))
        if typ == "say":
            q["voice"] = _txt(p.get("voice"), 20) or "en"
            ph = p.get("phrases") if isinstance(p.get("phrases"), list) else []
            q["phrases"] = [_txt(x, 60) for x in ph if _txt(x, 60)][:8]
        if typ == "gauge":
            d = GAUGE_DEFAULTS.get(drv, GAUGE_DEFAULTS["sim"])
            q["unit"] = _txt(p.get("unit"), 6) or d["unit"]
            q["min"] = _num(p.get("min"), -1e6, 1e6, d["min"])
            q["max"] = _num(p.get("max"), -1e6, 1e6, d["max"])
            q["warn"] = _num(p.get("warn"), -1e6, 1e6, d["warn"])
            q["low_is_bad"] = bool(p.get("low_is_bad", d.get("low_is_bad", False)))
            if drv == "arduino":
                q["factor"] = round(_num(p.get("factor"), 0.01, 100, 1), 3)
        if typ == "distance":
            q["max"] = round(_num(p.get("max"), 20, 400, 200))
            q["warn"] = round(_num(p.get("warn"), 0, 200, 25))
            q["stop_at"] = round(_num(p.get("stop_at"), 0, 100, 0))
        if typ == "custom":
            opts = p.get("options") if isinstance(p.get("options"), dict) else {}
            ui = opts.get("ui") if opts.get("ui") in CUSTOM_UI else "button"
            plugin = _txt(opts.get("plugin"), 40)
            if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", plugin or ""):
                problems.append("%s: name the plugin (a Python file name in the robot's plugins folder, like my_claw)." % name)
            q["options"] = {"ui": ui, "plugin": plugin,
                            "min": _num(opts.get("min"), -1e6, 1e6, 0), "max": _num(opts.get("max"), -1e6, 1e6, 100),
                            "settings": _txt(opts.get("settings"), 300)}
        # pins
        fields = ARDUINO_PINS.get(typ, []) if drv == "arduino" else PIN_FIELDS.get(drv, [])
        pins_in = p.get("pins") if isinstance(p.get("pins"), dict) else {}
        pins = {}
        for f in fields:
            v = pins_in.get(f)
            if drv == "arduino":
                v = _txt(v, 4).upper()
                if not v:
                    if f not in OPTIONAL_PINS:
                        problems.append("%s: choose the Arduino pin for %s." % (name, f.replace("_", " ")))
                    continue
                if not ARDUINO_PIN_RE.match(v):
                    problems.append("%s: %s isn't an Arduino pin (use 2-13 or A0-A7)." % (name, v))
                    continue
                pins[f] = v
                key2 = "A:" + v
            else:
                n = _int_or_none(v)
                if n is None:
                    if f not in OPTIONAL_PINS:
                        problems.append("%s: choose the GPIO pin for %s." % (name, f.replace("_", " ")))
                    continue
                if n == "bad" or not 0 <= n <= 27:
                    problems.append("%s: GPIO pins go from 0 to 27 (BCM numbers)." % name)
                    continue
                pins[f] = n
                key2 = "P:%d" % n
            if key2 in used_pins:
                problems.append("%s and %s both use %s %s." % (used_pins[key2], name,
                                                              "Arduino pin" if drv == "arduino" else "GPIO", v))
            used_pins[key2] = name
        if fields:
            q["pins"] = pins
        parts.append(q)
    if drives > 1:
        problems.append("A robot can only have one set of wheels.")
    if out["board"] == "pi" and any(p["driver"] == "arduino" for p in parts):
        out["board"] = "pi_arduino"
    out["parts"] = parts
    return out, problems


def pin_warnings(config):
    """Gentle notes (not errors) about pins with a second job on the Pi."""
    notes = []
    for p in (config or {}).get("parts", []):
        if p.get("driver") in PI_DRIVERS:
            for f, n in (p.get("pins") or {}).items():
                if n in SPECIAL_PINS:
                    notes.append("'%s' uses GPIO %d, which is also %s. Fine if you don't use that." % (p["id"], n, SPECIAL_PINS[n]))
    return notes


# ------------------------------------------------------------------------------------------- manifest
def describe(part):
    """The manifest entry for one part (the robot code builds the same entry; keep them in step)."""
    typ = part["type"]
    d = {"id": part["id"], "type": typ, "label": part.get("label") or TYPES[typ]["label"]}
    if part.get("key"):
        d["key"] = part["key"]
    if typ == "drive":
        d["max_speed"] = part.get("max_speed", 0.8)
    elif typ == "servo":
        d.update(min=part.get("min", -80), max=part.get("max", 80), home=part.get("home", 0), unit="°",
                 group=part.get("group", ""), axis=part.get("axis", ""))
    elif typ == "slider":
        d.update(min=part.get("min", 0), max=part.get("max", 100), home=part.get("home", 0), unit=part.get("unit", "%"))
    elif typ == "say":
        d["phrases"] = part.get("phrases") or []
    elif typ == "gauge":
        d.update(unit=part.get("unit", ""), min=part.get("min", 0), max=part.get("max", 100), warn=part.get("warn"),
                 low_is_bad=bool(part.get("low_is_bad")))
    elif typ == "distance":
        d.update(unit="cm", max=part.get("max", 200), warn=part.get("warn", 25))
    elif typ == "custom":
        o = part.get("options") or {}
        d["type"] = o.get("ui", "button")
        d["plugin"] = o.get("plugin", "")
        if d["type"] == "slider":
            d.update(min=o.get("min", 0), max=o.get("max", 100), home=o.get("min", 0), unit="")
    return d


def manifest_from_config(config, name="Robot"):
    """What the cockpit would show if the robot reports every part working. Used while the robot is offline."""
    config = config or {}
    cam = config.get("camera") or {}
    w, h = (cam.get("size") or "640x480").split("x")
    out = {"protocol": PROTOCOL, "name": name, "preview": True,
           "camera": {"width": int(w), "height": int(h), "fps": cam.get("fps", 24), "source": cam.get("source", "auto")},
           "controls": [], "sensors": [], "problems": []}
    for p in config.get("parts") or []:
        if p.get("type") not in TYPES:
            continue
        (out["sensors"] if TYPES[p["type"]]["kind"] == "sensor" else out["controls"]).append(describe(p))
    return out


def clean_manifest(m):
    """A manifest reported by a robot, cut down to what the cockpit understands (and a sane size)."""
    if not isinstance(m, dict):
        return None
    out = {"protocol": int(_num(m.get("protocol"), 0, 99, PROTOCOL)), "name": _txt(m.get("name"), 40)}
    cam = m.get("camera") if isinstance(m.get("camera"), dict) else {}
    out["camera"] = {"width": int(_num(cam.get("width"), 0, 4096, 0)), "height": int(_num(cam.get("height"), 0, 4096, 0)),
                     "fps": int(_num(cam.get("fps"), 0, 120, 0)), "source": _txt(cam.get("source"), 30),
                     "audio": bool(cam.get("audio"))}
    for key in ("controls", "sensors"):
        items = []
        for c in (m.get(key) if isinstance(m.get(key), list) else [])[:MAX_PARTS + 8]:
            if not isinstance(c, dict) or not ID_RE.match(_txt(c.get("id"), 24)):
                continue
            e = {"id": _txt(c.get("id"), 24), "type": _txt(c.get("type"), 20) or "button", "label": _txt(c.get("label"), 40)}
            for k in ("min", "max", "home", "warn", "max_speed"):
                if isinstance(c.get(k), (int, float)) and not isinstance(c.get(k), bool):
                    e[k] = c[k]
            for k in ("unit", "group", "axis", "key", "plugin", "from"):
                if c.get(k):
                    e[k] = _txt(c.get(k), 16)
            if c.get("low_is_bad"):
                e["low_is_bad"] = True
            if isinstance(c.get("phrases"), list):
                e["phrases"] = [_txt(x, 60) for x in c["phrases"]][:8]
            if isinstance(c.get("options"), list):
                e["options"] = [_txt(x, 30) for x in c["options"]][:12]
            if c.get("error"):
                e["error"] = _txt(c.get("error"), 160)
            items.append(e)
        out[key] = items
    probs = m.get("problems") if isinstance(m.get("problems"), list) else []
    out["problems"] = [{"id": _txt(p.get("id"), 24), "text": _txt(p.get("text"), 200)} for p in probs if isinstance(p, dict)][:20]
    return out
