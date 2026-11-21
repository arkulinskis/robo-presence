"""House rules: when other people may visit through a robot (2026-11-20).

A robot often lives in someone's home (a parent's kitchen, a shared flat), so its owner sets:
  - visiting hours: days of the week + from/to, in the owner's time zone (taken from the owner's browser);
  - a privacy pause: "no visits for 30 min / 2 h / 8 h / until I resume";
  - the door chime: a robot in a browser tab (robot mode) plays a ding-dong when someone connects.
Owners always get in. Pilots, viewers and guest passes get a friendly "closed" message from drive_open / drive_offer,
and drives already going are ended on the robot's next check-in when a pause starts or the hours end (BotApi.bot_poll).

Stored in the optional column robots.house_rules (simpleObject). It is read and written through guards, so the live
app keeps working (with no rules) until the owner accepts Anvil's Schema Mismatch alert.
    {"hours": {"on": bool, "days": [0..6] (Monday = 0), "start": "HH:MM", "end": "HH:MM"},
     "tz": "Europe/Riga", "tz_offset": minutes east of UTC, "chime": bool,
     "pause_until": ISO datetime or None, "pause_forever": bool}
"""
import datetime as dt
import re

import anvil.server
from anvil.tables import app_tables

from . import common as C

COL = "house_rules"
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
PAUSES = (0, 30, 120, 480, -1)   # minutes; 0 = resume, -1 = until resumed
TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
SCHEMA_MSG = ("This needs a one-time database update: the app's owner opens it in the Anvil editor and accepts the "
              "Schema Mismatch alert (\"The schema of the source code is correct\").")


def get(r):
    """The robot's rules ({} when none, or while the column doesn't exist yet)."""
    try:
        v = r[COL]
    except Exception:
        return {}
    return v if isinstance(v, dict) else {}


def put(r, rules):
    """Save; False if the database doesn't have the column yet."""
    try:
        r[COL] = rules
        return True
    except Exception as e:
        print("[house_rules] can't save: %r" % e)
        return False


def _hhmm(v, default):
    m = TIME_RE.match(str(v or "").strip())
    return "%02d:%s" % (int(m.group(1)), m.group(2)) if m else default


def clean(raw, old=None):
    raw = raw if isinstance(raw, dict) else {}
    old = old if isinstance(old, dict) else {}
    h = raw.get("hours") if isinstance(raw.get("hours"), dict) else {}
    days = sorted({int(d) for d in (h.get("days") or []) if isinstance(d, (int, float)) and 0 <= int(d) <= 6})
    try:
        off = int(raw.get("tz_offset"))
    except (TypeError, ValueError):
        off = old.get("tz_offset") or 0
    return {"hours": {"on": bool(h.get("on")), "days": days if days or not h.get("on") else list(range(7)),
                      "start": _hhmm(h.get("start"), "09:00"), "end": _hhmm(h.get("end"), "20:00")},
            "tz": C.text(raw.get("tz") or old.get("tz") or "", 60), "tz_offset": max(-840, min(840, off)),
            "chime": raw.get("chime") is not False,
            "pause_until": old.get("pause_until"), "pause_forever": bool(old.get("pause_forever"))}


def _zone(rules):
    """The owner's time zone: the named zone when the server knows it, else the fixed offset from their browser."""
    name = rules.get("tz")
    if name:
        try:
            from zoneinfo import ZoneInfo
            return ZoneInfo(name)
        except Exception:
            pass
    return dt.timezone(dt.timedelta(minutes=rules.get("tz_offset") or 0))


def _local(rules, when=None):
    return (when or C.now()).astimezone(_zone(rules))


def _paused_until(rules):
    """'forever', a datetime in the future, or None."""
    if rules.get("pause_forever"):
        return "forever"
    until = rules.get("pause_until")
    if not until:
        return None
    try:
        t = dt.datetime.fromisoformat(str(until))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return t if t > C.now() else None


def _days_text(days):
    days = sorted(days)
    if days == list(range(7)):
        return "every day"
    if days == list(range(5)):
        return "Monday to Friday"
    if days == [5, 6]:
        return "weekends"
    return ", ".join(DAYS[d] for d in days)


def hours_text(rules):
    h = rules.get("hours") or {}
    return "%s-%s, %s" % (h.get("start", "09:00"), h.get("end", "20:00"), _days_text(h.get("days") or list(range(7))))


def _in_hours(rules, when=None):
    h = rules.get("hours") or {}
    if not h.get("on"):
        return True
    t = _local(rules, when)
    now_m = t.hour * 60 + t.minute
    s = [int(x) for x in h.get("start", "09:00").split(":")]
    e = [int(x) for x in h.get("end", "20:00").split(":")]
    start, end = s[0] * 60 + s[1], e[0] * 60 + e[1]
    days = h.get("days") or list(range(7))
    if start == end:
        return t.weekday() in days
    if start < end:
        return t.weekday() in days and start <= now_m < end
    # overnight (e.g. 20:00-02:00): after the start on a listed day, or before the end on the day after one
    return (now_m >= start and t.weekday() in days) or (now_m < end and (t.weekday() - 1) % 7 in days)


def status(r):
    """{open, paused, reason, short} for anyone who may see the robot. Owners still get in when it's closed."""
    rules = get(r)
    if not rules:
        return {"open": True, "paused": False, "reason": None, "short": None}
    name = r["name"] or "The robot"
    p = _paused_until(rules)
    if p == "forever":
        return {"open": False, "paused": True, "short": "Paused",
                "reason": "%s is taking a private moment: visits are paused until the owner resumes them." % name}
    if p is not None:
        return {"open": False, "paused": True, "short": "Paused until %s" % _local(rules, p).strftime("%H:%M"),
                "reason": "%s is taking a private moment: visits are paused until %s (the owner's time)." % (
                    name, _local(rules, p).strftime("%H:%M"))}
    if not _in_hours(rules):
        return {"open": False, "paused": False, "short": "Closed now",
                "reason": "Visiting hours for %s are %s (the owner's time). It's %s there now." % (
                    name, hours_text(rules), _local(rules).strftime("%H:%M"))}
    return {"open": True, "paused": False, "reason": None, "short": None}


def blocked(r, role):
    """The closed message for this visitor, or None. Owners and showroom robots are never blocked."""
    if role == "owner" or r is None or r["is_demo"]:
        return None
    s = status(r)
    return None if s["open"] else s["reason"]


def view(r):
    """What the owner's House rules card shows."""
    rules = get(r)
    s = status(r)
    p = _paused_until(rules)
    h = rules.get("hours") or {}
    return {"hours": {"on": bool(h.get("on")), "days": h.get("days") if h.get("days") is not None else list(range(5)),
                      "start": h.get("start") or "09:00", "end": h.get("end") or "20:00"},
            "tz": rules.get("tz") or "", "chime": rules.get("chime") is not False,
            "paused": p is not None, "pause_until": C.iso(p) if isinstance(p, dt.datetime) else None,
            "pause_forever": p == "forever", "status": s, "hours_text": hours_text(rules) if h.get("on") else ""}


def end_visits(r):
    """End the drives of everyone but the owner (the robot drops them on its next check-in)."""
    n = 0
    for state in ("waiting", "delivered", "answered"):
        for s in app_tables.sessions.search(robot=r, state=state):
            if s["guest_pass"] is not None or s["user"] != r["owner"]:
                s["state"] = "ended"
                n += 1
    return n


def _owner_robot(robot_id):
    from . import Robots
    return Robots.require_owner(robot_id)


@anvil.server.callable(require_user=True)
def rules_save(robot_id, rules):
    me, r = _owner_robot(robot_id)
    if r is None:
        return C.fail("Only the robot's owner can set its house rules.")
    new = clean(rules, get(r))
    if not put(r, new):
        return C.fail(SCHEMA_MSG)
    from . import Robots
    Robots.add_event(r, "info", ("House rules saved: visiting hours %s." % hours_text(new)) if new["hours"]["on"]
                     else "House rules saved: visits at any time.")
    if new["hours"]["on"] and not _in_hours(new):
        end_visits(r)
    return C.ok(robot=Robots.detail(r, "owner"))


@anvil.server.callable(require_user=True)
def rules_pause(robot_id, minutes):
    """Pause visits (30, 120 or 480 minutes, -1 = until resumed) or resume them (0)."""
    me, r = _owner_robot(robot_id)
    if r is None:
        return C.fail("Only the robot's owner can pause visits.")
    try:
        minutes = int(minutes)
    except (TypeError, ValueError):
        minutes = 30
    if minutes not in PAUSES:
        minutes = 30
    rules = dict(get(r)) or clean({}, {})
    from . import Robots
    if minutes == 0:
        rules.update(pause_until=None, pause_forever=False)
        text = "Visits resumed."
    else:
        rules.update(pause_forever=minutes < 0,
                     pause_until=None if minutes < 0 else C.iso(C.now() + dt.timedelta(minutes=minutes)))
        text = "Privacy pause: no visits %s." % ("until resumed" if minutes < 0 else
                                                 "for %s" % ("%d min" % minutes if minutes < 60 else "%d h" % (minutes // 60)))
    if not put(r, rules):
        return C.fail(SCHEMA_MSG)
    ended = end_visits(r) if minutes != 0 else 0
    Robots.add_event(r, "info", text + (" %d visitor(s) disconnected." % ended if ended else ""))
    return C.ok(robot=Robots.detail(r, "owner"), ended=ended)
