"""Drive sessions: the server only introduces the pilot's browser and the robot (WebRTC signalling).

1. drive_open: may this person drive or watch? -> robot name, last manifest, ICE servers.
2. The browser makes a WebRTC offer (video in, two data channels out), waits for its ICE candidates,
   and sends the whole offer with drive_offer -> a session id + a secret (guests have no account).
3. The robot picks the offer up on its next /bot/poll (BotApi.py), answers through /bot/answer.
4. drive_poll returns the answer; the browser and robot then talk directly (peer to peer):
   video robot -> browser, controls browser -> robot. Nothing of the drive itself passes through Anvil.
5. drive_end records the duration and connection stats (shown in the robot's log).
"""
import datetime as dt

import anvil.server
from anvil.tables import app_tables

from . import common as C
from . import Robots, Sharing

OFFER_TTL_S = 40
MAX_SDP = 30000


def _resolve(robot_id, pass_token):
    """(robot row, role, user, pass row) or (None, error message, None, None)."""
    if pass_token:
        p = Sharing.pass_row(pass_token)
        if p is None or not Sharing.pass_valid(p):
            return None, "This guest pass has expired or doesn't exist. Ask the robot's owner for a new link.", None, None
        return p["robot"], p["role"], C.me(), p
    me = C.me()
    if me is None:
        return None, "Please sign in to drive this robot.", None, None
    r = Robots.get_robot_row(robot_id)
    role = Robots.role_for(r, me)
    if role is None:
        return None, "That robot isn't in your garage.", None, None
    return r, role, me, None


@anvil.server.callable
def drive_open(robot_id, pass_token=None):
    r, role, me, p = _resolve(robot_id, pass_token)
    if r is None:
        return C.fail(role)
    if not r["is_demo"]:
        r["wanted_until"] = C.now() + dt.timedelta(seconds=90)  # the robot checks in faster while someone is about to drive
    m = Robots.reported_manifest(r)
    return C.ok(robot={"id": r.get_id(), "name": r["name"], "color": r["color"] or "orange", "online": Robots.is_online(r),
                       "demo": bool(r["is_demo"]), "manifest": m, "reported": bool(r["manifest"]),
                       "owner": C.name_of(r["owner"]), "last_seen": C.iso(r["last_seen"])},
                role=role, ice_servers=Robots.ice_servers(),
                pilot=C.name_of(me) if me is not None else (p["label"] if p is not None else "Guest"),
                guest=p is not None)


@anvil.server.callable
def drive_offer(robot_id, sdp, pass_token=None, pilot_name=None):
    r, role, me, p = _resolve(robot_id, pass_token)
    if r is None:
        return C.fail(role)
    if r["is_demo"]:
        return C.fail("Showroom robots run on the simulator. Open it from the garage.")
    if role not in ("owner", "pilot", "viewer"):
        return C.fail("You can't connect to this robot.")
    if not isinstance(sdp, str) or "v=0" not in sdp[:20] or len(sdp) > MAX_SDP:
        return C.fail("The connection offer wasn't valid. Reload the page and try again.")
    if not Robots.is_online(r):
        return C.fail("%s is offline. Switch it on, or check its Wi-Fi." % r["name"])
    if C.rate_limited("drive_offer", 30, 600):
        return C.fail("Too many connection attempts. Wait a few minutes and try again.")
    stamp = C.now()
    # One waiting offer per person: an older one from the same browser session is dropped.
    old = anvil.server.session.get("rp_waiting")
    if old:
        s_old = C.row_by_id(app_tables.sessions, old)
        if s_old is not None and s_old["state"] in ("waiting", "delivered"):
            s_old["state"] = "ended"
    secret = Robots.new_token(16)
    name = C.text(pilot_name, 40) if p is not None else C.name_of(me)
    s = app_tables.sessions.add_row(robot=r, user=me, guest_pass=p, pilot_name=name or "Guest", role=role,
                                    secret_hash=Robots.hash_token(secret), offer=sdp, answer=None, state="waiting",
                                    created=stamp, stats={}, is_demo=False)
    getattr(anvil.server, "session")["rp_waiting"] = s.get_id()
    if p is not None:
        p.update(uses=(p["uses"] or 0) + 1, last_used=stamp)
    r["wanted_until"] = stamp + dt.timedelta(seconds=90)
    return C.ok(session_id=s.get_id(), secret=secret)


def _own_session(session_id, secret):
    s = C.row_by_id(app_tables.sessions, session_id)
    if s is None or not isinstance(secret, str) or s["secret_hash"] != Robots.hash_token(secret):
        return None
    return s


@anvil.server.callable
def drive_poll(session_id, secret):
    s = _own_session(session_id, secret)
    if s is None:
        return C.fail("That connection is no longer known. Reload the page.")
    age = (C.now() - s["created"]).total_seconds() if s["created"] else 999
    if s["state"] in ("waiting", "delivered") and age > OFFER_TTL_S:
        s["state"] = "timeout"
    if s["state"] == "answered":
        return C.ok(state="answered", answer=s["answer"])
    if s["state"] == "rejected":
        return C.ok(state="rejected", reason=(s["stats"] or {}).get("reason") or "The robot said no.")
    return C.ok(state=s["state"], waited_s=round(age, 1))


def _stat(v, lo, hi):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(max(lo, min(hi, f)), 1) if f == f else None


@anvil.server.callable
def drive_end(session_id, secret, stats=None):
    s = _own_session(session_id, secret)
    if s is None:
        return C.ok()
    st = stats if isinstance(stats, dict) else {}
    clean = {k: _stat(st.get(k), lo, hi) for k, lo, hi in (("duration_s", 0, 86400), ("rtt_ms", 0, 10000), ("fps", 0, 120),
                                                            ("kbps", 0, 100000), ("width", 0, 4096), ("height", 0, 4096))}
    clean = {k: v for k, v in clean.items() if v is not None}
    if s["state"] in ("waiting", "delivered", "answered"):
        s["state"] = "ended"
    s.update(ended_at=C.now(), stats=dict(s["stats"] or {}, **clean), offer=None, answer=None)
    r = s["robot"]
    if r is not None and clean.get("duration_s"):
        mins = clean["duration_s"] / 60.0
        Robots.add_event(r, "drive", "%s %s for %s%s." % (s["pilot_name"] or "Someone", "drove" if s["role"] != "viewer" else "watched",
                                                         ("%d min" % round(mins)) if mins >= 1 else "%d s" % clean["duration_s"],
                                                         (", %d ms round trip" % clean["rtt_ms"]) if clean.get("rtt_ms") else ""))
    return C.ok()
