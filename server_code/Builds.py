"""Public build sheets (2026-11-20): makers share how their robot is built, and anyone can copy it.

  #builds          every public build + the showroom robots (anyone, no account)
  #build/<id>      one build: robot picture, brain, camera, parts with drivers and pins, what the pilot gets,
                   the owner's story; "Try it in the simulator" (anyone); "Build one like this" (signed in: copies
                   the parts into a new robot of your own and opens its Install tab)

An owner switches it on in the robot's Overview tab (optional column robots.build_sheet = {"public", "story"}, read
through Robots.sheet_of, so the app works before the Schema Mismatch alert is accepted). A build sheet never shows
camera access, the robot's IP, host name, notes, logs, passes or the owner's email: only the parts and the owner's
display name (never derived from the email).
"""
import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import DemoData, Parts, Robots

BOARD_LABEL = {"pi": "Raspberry Pi", "pi_arduino": "Raspberry Pi + Arduino", "browser": "Phone or laptop"}
DRIVER_LABEL = {"tb6612": "TB6612FNG", "l298n": "L298N", "drv8833": "DRV8833", "arduino": "Arduino", "sim": "simulated",
                "gpio": "Pi GPIO", "pca9685": "PCA9685", "pwm": "Pi PWM", "espeak": "espeak speaker", "plugin": "plugin",
                "cpu_temp": "Pi CPU sensor", "wifi": "Wi-Fi signal", "hcsr04": "HC-SR04"}
MAX_STORY = 1200


def _public(r):
    return r is not None and (bool(r["is_demo"]) or Robots.sheet_of(r)["public"])


def _maker(r):
    u = r["owner"]
    return (u["display_name"] or "").strip() if u is not None and u["display_name"] else "A maker"


def _summary(r):
    cfg = r["config"] or {}
    parts = cfg.get("parts") or []
    sheet = Robots.sheet_of(r)
    story = sheet["story"] or (r["notes"] if r["is_demo"] else "") or ""
    return {"id": r.get_id(), "name": r["name"], "color": r["color"] or "orange", "maker": _maker(r),
            "board": cfg.get("board") or "pi", "board_label": BOARD_LABEL.get(cfg.get("board"), "Raspberry Pi"),
            "parts": len(parts), "types": [p.get("type") for p in parts], "story": C.text(story, 160),
            "demo": bool(r["is_demo"])}


@anvil.server.callable
def builds_list():
    """Public: the build gallery (public builds first, newest first, then the showroom)."""
    DemoData.ensure_loaded()
    mine = []
    for r in app_tables.robots.search(tables.order_by("created", ascending=False), is_demo=False):
        if Robots.sheet_of(r)["public"]:
            mine.append(_summary(r))
        if len(mine) >= 60:
            break
    showroom = [_summary(r) for r in app_tables.robots.search(tables.order_by("created"), is_demo=True)]
    return C.ok(builds=mine + showroom, shared=len(mine))


@anvil.server.callable
def build_get(robot_id):
    """Public: one build sheet (only if its owner made it public, or it's a showroom robot)."""
    r = Robots.get_robot_row(robot_id)
    if not _public(r):
        return C.fail("This build sheet isn't public (or the robot was deleted).")
    cfg = r["config"] or {}
    cam = cfg.get("camera") or {}
    parts = []
    for p in cfg.get("parts") or []:
        pins = p.get("pins") or {}
        parts.append({"id": p.get("id"), "type": p.get("type"), "label": p.get("label") or p.get("id"),
                      "driver": DRIVER_LABEL.get(p.get("driver"), p.get("driver") or ""),
                      "pins": ", ".join("%s %s" % (k.replace("_", " "), v) for k, v in pins.items())})
    out = _summary(r)
    me = C.me()
    out.update(story=C.text(Robots.sheet_of(r)["story"] or (r["notes"] if r["is_demo"] else ""), MAX_STORY, multiline=True),
               camera="%s, %s fps%s%s" % (cam.get("size") or "640x480", cam.get("fps") or 24,
                                          ", microphone" if cam.get("audio") else "",
                                          ", push-to-talk speaker" if cam.get("talk", True) else ""),
               part_list=parts, manifest=Parts.manifest_from_config(cfg, r["name"]),
               mine=bool(me is not None and r["owner"] == me and not r["is_demo"]))
    return C.ok(build=out)


@anvil.server.callable(require_user=True)
def sheet_save(robot_id, public, story=""):
    me, r = Robots.require_owner(robot_id)
    if r is None:
        return C.fail("Only the robot's owner can share its build sheet.")
    value = {"public": bool(public), "story": C.text(story, MAX_STORY, multiline=True)}
    try:
        r["build_sheet"] = value
    except Exception as e:
        print("[build_sheet] can't save: %r" % e)
        from . import HouseRules
        return C.fail(HouseRules.SCHEMA_MSG)
    Robots.add_event(r, "info", "Build sheet is public." if value["public"] else "Build sheet is private.")
    return C.ok(robot=Robots.detail(r, "owner"))


@anvil.server.callable(require_user=True)
def build_clone(robot_id, name=None):
    """Copy a public build's parts into a new robot of your own (it opens on its Install tab)."""
    me = C.require_user()
    r = Robots.get_robot_row(robot_id)
    if not _public(r):
        return C.fail("This build sheet isn't public any more.")
    if len(app_tables.robots.search(owner=me, is_demo=False)) >= Robots.MAX_ROBOTS:
        return C.fail("That's %d robots already. Delete one first." % Robots.MAX_ROBOTS)
    if C.rate_limited("create_robot", 10, 3600):
        return C.fail("That's a lot of new robots in one hour. Try again later.")
    name = C.text(name, 40) or ("My " + (r["name"] or "robot"))[:40]
    if len(name) < 2:
        return C.fail("Give your robot a name (at least 2 characters).")
    cfg = r["config"] or {}
    new = Robots.new_robot_row(me, name, cfg.get("board") or "pi", r["color"] or "orange", config=cfg,
                               note="Robot created from the build sheet of %s by %s." % (r["name"], _maker(r)))
    return C.ok(robot={"id": new.get_id(), "name": new["name"]})
