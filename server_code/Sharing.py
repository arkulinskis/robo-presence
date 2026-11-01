"""Sharing a robot: invite people by email (pilot = can drive, viewer = watch only), and guest passes:
a link that lets someone without an account drive or watch until it expires. Owners only.
A pass's token is shown once when it is made (only its hash is stored)."""
import datetime as dt
import re

import anvil.server
from anvil.tables import app_tables

from . import common as C
from . import Robots

ROLES = ("pilot", "viewer")
PASS_HOURS = (1, 4, 24, 72, 168)
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@anvil.server.callable(require_user=True)
def share_add(robot_id, email, role="pilot"):
    me, r = Robots.require_owner(robot_id)
    if r is None:
        return C.fail("Only the robot's owner can share it.")
    email = C.text(email, 120).lower()
    if not EMAIL_RE.match(email):
        return C.fail("That doesn't look like an email address.")
    if email == Robots.email_of(me):
        return C.fail("That's you: you already have the keys.")
    if role not in ROLES:
        return C.fail("Choose pilot or viewer.")
    if len(app_tables.shares.search(robot=r)) >= 30:
        return C.fail("A robot can be shared with 30 people at most.")
    if C.rate_limited("share_add", 40, 3600):
        return C.fail("That's a lot of invitations in one hour. Try again later.")
    s = app_tables.shares.get(robot=r, email=email)
    user = app_tables.users.get(email=email)
    if s is None:
        app_tables.shares.add_row(robot=r, email=email, user=user, role=role, created=C.now(), is_demo=False)
    else:
        s["role"] = role
    Robots.add_event(r, "info", "Shared with %s as %s." % (email, role))
    return C.ok(robot=Robots.detail(r, "owner"))


@anvil.server.callable(require_user=True)
def share_remove(share_id):
    me = C.require_user()
    s = C.row_by_id(app_tables.shares, share_id)
    if s is None:
        return C.ok()
    r = s["robot"]
    if r is None or r["owner"] != me:
        return C.fail("Only the robot's owner can change who it is shared with.")
    Robots.add_event(r, "info", "Stopped sharing with %s." % s["email"])
    s.delete()
    return C.ok(robot=Robots.detail(r, "owner"))


@anvil.server.callable(require_user=True)
def pass_create(robot_id, label, role="pilot", hours=24):
    me, r = Robots.require_owner(robot_id)
    if r is None:
        return C.fail("Only the robot's owner can make guest passes.")
    if role not in ROLES:
        return C.fail("Choose pilot or viewer.")
    try:
        hours = int(hours)
    except (TypeError, ValueError):
        hours = 24
    if hours not in PASS_HOURS:
        return C.fail("Choose how long the pass works.")
    label = C.text(label, 40) or "Guest"
    active = [p for p in app_tables.passes.search(robot=r) if C.iso(p["expires"]) > C.iso(C.now())]
    if len(active) >= 10:
        return C.fail("This robot has 10 active passes. Revoke one first.")
    if C.rate_limited("pass_create", 30, 3600):
        return C.fail("That's a lot of passes in one hour. Try again later.")
    tok = Robots.new_token(18)
    app_tables.passes.add_row(robot=r, token_hash=Robots.hash_token(tok), label=label, role=role, created=C.now(),
                              expires=C.now() + dt.timedelta(hours=hours), uses=0, is_demo=False)
    Robots.add_event(r, "info", "Guest pass '%s' made (%s, %d h)." % (label, role, hours))
    return C.ok(token=tok, robot=Robots.detail(r, "owner"))


@anvil.server.callable(require_user=True)
def pass_revoke(pass_id):
    me = C.require_user()
    p = C.row_by_id(app_tables.passes, pass_id)
    if p is None:
        return C.ok()
    r = p["robot"]
    if r is None or r["owner"] != me:
        return C.fail("Only the robot's owner can revoke its passes.")
    p["expires"] = C.now() - dt.timedelta(seconds=1)
    for state in ("waiting", "delivered", "answered"):
        for s in app_tables.sessions.search(guest_pass=p, state=state):
            s["state"] = "ended"
    Robots.add_event(r, "warn", "Guest pass '%s' revoked." % p["label"])
    return C.ok(robot=Robots.detail(r, "owner"))


def pass_row(token):
    if not isinstance(token, str) or not 8 <= len(token) <= 64:
        return None
    p = app_tables.passes.get(token_hash=Robots.hash_token(token))
    if p is None or p["robot"] is None:
        return None
    return p


def pass_valid(p):
    return p is not None and C.iso(p["expires"]) > C.iso(C.now())


@anvil.server.callable
def pass_info(token):
    """Public: what a guest link opens (no account needed)."""
    p = pass_row(token)
    if p is None:
        return C.fail("This guest pass doesn't exist. Ask the robot's owner for a new link.")
    if not pass_valid(p):
        return C.fail("This guest pass has expired. Ask the robot's owner for a new link.")
    r = p["robot"]
    return C.ok(robot={"name": r["name"], "color": r["color"] or "orange", "owner": C.name_of(r["owner"]),
                       "online": Robots.is_online(r)}, role=p["role"], label=p["label"], expires=C.iso(p["expires"]))
