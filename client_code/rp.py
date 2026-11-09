"""Robo Presence's JavaScript engines (theme/assets/rp-*.js, window.RP) seen from Python, and the small robot helpers the
pages share.

The engines: rp-core.js (robot picture, lamps, gauges, manifest split, copy/download), rp-sim.js (RobotCore + the 3D
garage simulator), rp-link.js (WebRTC: the pilot's link and robot mode's host), rp-cockpit.js (the driving screen),
rp-builder.js (part editor cards, pin map, Arduino sketch), rp-bot.js (robot mode). They were written against a small
window.UI (rp-kit.js); their server calls come back here through window.RP_BRIDGE.

    rp.setup()              once at start-up: the server bridge (UI.api in the engines) and RP.host (toast, confirm, go)
    rp.RP                   window.RP itself
    rp.py_value(x)          a JS object/array as plain Python dicts/lists
    rp.js_value(x)          a Python dict/list as a real JS object (to hand to the engines)
    rp.split(manifest)      the manifest sorted into drive / head / other controls / sensors (RP.split in Python)
    rp.pilot_gets(m)        "what the pilot gets": one line per control for the robot page and the Parts tab
"""
import json

import anvil.js
import anvil.server
from anvil import confirm
from anvil.js import window

from . import router, state

RP = window.RP
UI = window.UI

BOARDS = {"pi": "Raspberry Pi", "pi_arduino": "Pi + Arduino", "browser": "Phone or laptop"}
COLORS = [("orange", "#e2611e", "Safety orange"), ("olive", "#6b7a3a", "Olive drab"), ("yellow", "#e9b42c", "Hazard yellow"),
          ("blue", "#3f6f9c", "Workshop blue"), ("red", "#c23b22", "Fire red"), ("steel", "#8a9095", "Bare steel")]
TYPE_ICON = {"drive": "wheel", "servo": "servo", "slider": "slider", "toggle": "toggle", "button": "button", "say": "voice",
             "custom": "plug", "gauge": "gauge", "distance": "distance", "select": "sliders"}


def loose(x):
    """Hands a value over untyped (the validator types `self.x = None` as None for good; Skulpt has no typing)."""
    return x


def py_value(x):
    """JS -> plain Python (dicts, lists, str, numbers). None stays None."""
    if x is None:
        return None
    return json.loads(window.JSON.stringify(x))


def js_value(x):
    """Python -> a real JS object (not a proxy of a Python dict)."""
    return window.JSON.parse(json.dumps(x))


def type_icon(t, part_id=""):
    part_id = part_id or ""
    if "batt" in part_id:
        return "battery"
    if "wifi" in part_id:
        return "wifi"
    if "cpu" in part_id or "temp" in part_id:
        return "cpu"
    return TYPE_ICON.get(t, "chip")


def lamp(r):
    """(css class, text) of a robot's status lamp, like RP.lamp."""
    if r.get("demo"):
        return "demo", "Showroom"
    if r.get("online"):
        return "on", "Online"
    if r.get("paired") is False:
        return "off", "Not paired"
    return "off", "Offline" + (" · " + state.ago(r["last_seen"]) if r.get("last_seen") else "")


def art(color, **opts):
    """The robot picture as SVG text (RP.robotArt)."""
    return str(RP.robotArt(color or "orange", js_value(opts)))


# ---------------------------------------------------------------- manifests (RP.split in Python)
def split(m):
    m = m or {}
    controls = list(m.get("controls") or [])
    sensors = list(m.get("sensors") or [])
    drive = next((c for c in controls if c.get("type") == "drive" and not c.get("error")), None)
    pan = tilt = None
    for c in controls:
        if c.get("type") != "servo" or c.get("error"):
            continue
        if c.get("axis") == "x" and not pan:
            pan = c
        elif c.get("axis") == "y" and not tilt:
            tilt = c
    if not pan and not tilt:  # no axes given: the first two servos named like a head
        for c in controls:
            if c.get("type") != "servo" or c.get("error"):
                continue
            cid = c.get("id") or ""
            if not pan and any(w in cid for w in ("pan", "yaw", "left", "neck")):
                pan = c
            elif not tilt and any(w in cid for w in ("tilt", "pitch", "up", "nod")):
                tilt = c
    others = [c for c in controls if c is not drive and c is not pan and c is not tilt and c.get("type") != "drive"]
    return {"drive": drive, "pan": pan, "tilt": tilt, "others": others, "sensors": sensors, "problems": m.get("problems") or []}


HOW = {"toggle": "Switch", "button": "Hold button", "slider": "Slider", "servo": "Slider", "say": "Voice box", "select": "Choices"}


def pilot_gets(m):
    """[{icon, text, bad}] for "What the pilot gets" (the controls the cockpit draws from this manifest)."""
    s, out = split(m), []
    if s["drive"]:
        out.append({"icon": "joystick", "text": "Joystick, WASD and gamepad for the " + (s["drive"].get("label") or "wheels").lower(), "bad": ""})
    if s["pan"] or s["tilt"]:
        names = ", ".join((x.get("label") or x.get("id") or "") for x in (s["pan"], s["tilt"]) if x)
        out.append({"icon": "eye", "text": "Look pad, arrow keys and drag-the-picture for the head (%s)" % names, "bad": ""})
    for c in s["others"]:
        how = HOW.get(c.get("type"), 'Unknown part type "%s"' % c.get("type"))
        key = " (key %s)" % c["key"].upper() if c.get("key") else ""
        out.append({"icon": type_icon(c.get("type"), c.get("id")), "text": how + ": " + (c.get("label") or c.get("id") or "") + key,
                    "bad": c.get("error") or ""})
    for x in s["sensors"]:
        unit = " (%s)" % x["unit"] if x.get("unit") else ""
        out.append({"icon": type_icon(x.get("type"), x.get("id")), "text": "Gauge: " + (x.get("label") or x.get("id") or "") + unit,
                    "bad": x.get("error") or ""})
    for p in s["problems"]:
        if not any(o["bad"] == p.get("text") for o in out):
            out.append({"icon": "info", "text": "%s: %s" % (p.get("id"), p.get("text")), "bad": p.get("text") or ""})
    for o in out:
        if o["bad"]:
            o["text"] += ": not working (%s)" % o["bad"]
            o["icon"] = "info"
    if not out:
        out.append({"icon": "info", "text": "No parts yet. Add some in the Parts tab.", "bad": ""})
    return out


def manifest_of_config(cfg):
    """The manifest a parts list describes (the Parts tab's preview before saving)."""
    man = {"controls": [], "sensors": []}
    for p in (cfg or {}).get("parts") or []:
        d = dict(p)
        if p.get("type") == "custom":
            d["type"] = (p.get("options") or {}).get("ui") or "button"
        (man["sensors"] if p.get("type") in ("gauge", "distance") else man["controls"]).append(d)
    return man


def fmt_dt(iso):
    """'8 Nov, 21:47' in the browser's own format (UI.fmtDateTime)."""
    return str(UI.fmtDateTime(iso)) if iso else ""


def fmt_date(iso):
    return str(UI.fmtDate(iso)) if iso else ""


def dur(s):
    if s is None:
        return "–"
    s = round(s)
    if s < 60:
        return "%d s" % s
    if s < 3600:
        return "%d min" % round(s / 60.0)
    return "%.1f h" % (s / 3600.0)


def slug(s):
    return str(RP.slug(s or "robot"))


def copy(text, what="Copied"):
    RP.copy(text, what)


# ---------------------------------------------------------------- server calls for the engines (UI.api, UI.apiQuiet)
def _bridge(kind, payload_json):
    """Called from JS. Always returns a JSON string: {"result": ...} or {"error": ...}."""
    p = json.loads(payload_json) if payload_json else {}
    try:
        if kind == "call":
            call = anvil.server.call_s if p.get("quiet") else anvil.server.call
            return json.dumps({"result": call(p["fn"], *(p.get("args") or []))})
        return json.dumps({"error": "Unknown request: %s" % kind})
    except Exception as e:
        kind_of = type(e).__name__  # (some of Anvil's exception classes aren't in the validator's stubs)
        if kind_of == "SessionExpiredError":
            return json.dumps({"error": "Your session expired. Reload the page and sign in again.", "reload": True})
        if kind_of == "AppOfflineError":
            return json.dumps({"error": "You seem to be offline. Check your connection and try again."})
        if kind_of == "PermissionDenied":
            return json.dumps({"error": str(e) or "You don't have access to that.", "denied": True})
        print("bridge %s %s failed: %r" % (kind, p.get("fn", ""), e))
        return json.dumps({"error": "Something went wrong. Please try again.", "detail": repr(e)[:300]})


# ---------------------------------------------------------------- RP.host: what the engines ask Python to show
def _toast(message, kind=""):
    state.toast(message, kind or None)


def _confirm(options_json):
    o = json.loads(options_json or "{}")
    return bool(confirm(o.get("text") or "", title=o.get("title") or "Are you sure?",
                        buttons=[(o.get("cancel") or "Cancel", False), (o.get("ok") or "OK", True)], role="app-dialog"))


def _go(target_hash):
    router.show()


def setup():
    window.RP_BRIDGE = _bridge
    host = js_value({})
    host["toast"] = _toast
    host["confirm"] = _confirm
    host["go"] = _go
    RP.host = host
