"""Robots: the garage, one robot's details, editing, the hardware config, pairing (install codes + tokens).

Who may do what with a robot (role):
  owner   everything (edit, pair, share, drive, delete)
  pilot   drive it and see its status (someone the owner invited by email, or a guest pass with the pilot role)
  viewer  watch the video only
  demo    the showroom robots everyone can look at; "driving" one runs the simulator with its parts
Admins see a list of robots (names, owners, online) in Admin, but never get camera access: a robot can be in someone's home.
"""
import datetime as dt
import hashlib
import secrets

import anvil.http
import anvil.secrets
import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import DemoData, Parts

ONLINE_S = 15            # a robot that called in during the last 15 seconds is online
CODE_HOURS = 24          # install codes work for a day
MAX_ROBOTS = 10
COLORS = ["orange", "olive", "yellow", "blue", "red", "steel"]
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I
DEFAULT_ICE = [{"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}]
DEFAULT_SOURCE = "https://codeload.github.com/arkulinskis/robo-presence/tar.gz/refs/heads/master"


def hash_token(t):
    return hashlib.sha256(("rp1:" + str(t)).encode("utf-8")).hexdigest()


def new_token(n=24):
    return secrets.token_urlsafe(n)


def new_code():
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))


def norm_code(code):
    return "".join(ch for ch in str(code or "").upper() if ch in CODE_ALPHABET)[:8]


def pretty_code(code):
    return code[:4] + "-" + code[4:] if code and len(code) == 8 else code


def network():
    """The app-wide connection settings (Admin -> Network)."""
    n = C.get_setting("network") or {}
    return {"ice_servers": n.get("ice_servers") or DEFAULT_ICE, "poll_fast_ms": int(n.get("poll_fast_ms") or 600),
            "poll_idle_ms": int(n.get("poll_idle_ms") or 2500), "source": n.get("source") or DEFAULT_SOURCE}


# Cloudflare Realtime TURN: the app secrets cf_turn_key_id + cf_turn_api_token (Cloudflare dashboard > Realtime > TURN)
# buy relay logins that last 24 h. They are cached for 12 h in app_settings ("turn_cache"), so robots and pilots share
# one login. Without the secrets, connections are direct only (STUN), which fails on strict networks such as 5G.
TURN_TTL_S = 86400
TURN_REUSE_S = 12 * 3600
TURN_RETRY_S = 120


def _fetch_turn():
    try:
        key_id = anvil.secrets.get_secret("cf_turn_key_id")
        token = anvil.secrets.get_secret("cf_turn_api_token")
    except Exception:
        return None, "not set"
    try:
        r = anvil.http.request(
            "https://rtc.live.cloudflare.com/v1/turn/keys/%s/credentials/generate-ice-servers" % key_id.strip(),
            method="POST", json=True, data={"ttl": TURN_TTL_S}, timeout=8,
            headers={"Authorization": "Bearer " + token.strip()})
    except Exception as e:
        print("[ice] Cloudflare TURN request failed:", repr(e)[:300])
        return None, "failed"
    servers = r.get("iceServers") if isinstance(r, dict) else None
    servers = [servers] if isinstance(servers, dict) else servers if isinstance(servers, list) else []
    out = []
    for s in servers:
        if not isinstance(s, dict):
            continue
        urls = s.get("urls")
        urls = [urls] if isinstance(urls, str) else urls if isinstance(urls, list) else []
        # Browsers balk at port 53 (DNS) relay addresses; leave those out.
        urls = [u for u in urls if isinstance(u, str) and ":53?" not in u and not u.endswith(":53")]
        if urls:
            out.append(dict(s, urls=urls))
    return (out, "ok") if out else (None, "failed")


def turn_servers():
    """(Cloudflare relay ICE servers or [], status: ok | not set | failed)."""
    stamp = C.now()
    cache = C.get_setting("turn_cache") or {}
    if cache.get("until") and cache["until"] > C.iso(stamp):
        return cache.get("servers") or [], cache.get("status") or "failed"
    servers, status = _fetch_turn()
    wait = TURN_REUSE_S if servers else TURN_RETRY_S
    C.set_setting("turn_cache", {"servers": servers or [], "status": status,
                                 "until": C.iso(stamp + dt.timedelta(seconds=wait))})
    return servers or [], status


def ice_servers():
    """What pilots and robots get: the Admin -> Network list plus the Cloudflare relay (when its secrets are set)."""
    return list(network()["ice_servers"]) + turn_servers()[0]


def is_online(r):
    seen = r["last_seen"]
    if seen is None:
        return False
    if seen.tzinfo is None:
        seen = seen.replace(tzinfo=dt.timezone.utc)
    return (C.now() - seen).total_seconds() < ONLINE_S


def email_of(u):
    return (u["email"] or "").strip().lower() if u is not None else ""


def link_shares(user):
    """Invitations sent to this person's email before they had an account become theirs."""
    em = email_of(user)
    if not em:
        return
    for s in app_tables.shares.search(email=em, user=None):
        s["user"] = user


def role_for(r, user):
    if r is None:
        return None
    if r["is_demo"]:
        return "demo" if user is not None else None
    if user is None:
        return None
    if r["owner"] == user:
        return "owner"
    s = app_tables.shares.get(robot=r, user=user)
    if s is not None:
        return s["role"] if s["role"] in ("pilot", "viewer") else "viewer"
    return None


def get_robot_row(robot_id):
    return C.row_by_id(app_tables.robots, robot_id)


def require_owner(robot_id):
    me = C.require_user()
    r = get_robot_row(robot_id)
    if r is None or r["is_demo"] or r["owner"] != me:
        return me, None
    return me, r


def reported_manifest(r):
    """What the robot said it has; else what its config describes (marked preview)."""
    m = r["manifest"]
    if m and isinstance(m, dict) and (m.get("controls") or m.get("sensors")):
        return m
    return Parts.manifest_from_config(r["config"], r["name"])


def add_event(r, kind, text, demo=False, at=None):
    app_tables.events.add_row(robot=r, kind=kind, text=C.text(text, 300), at=at or C.now(), is_demo=bool(demo))


def card(r, role):
    m = reported_manifest(r)
    tel = r["telemetry"] or {}
    battery = None
    for s in m.get("sensors", []):
        if s.get("unit") == "V" and isinstance(tel.get(s["id"]), (int, float)):
            lo, hi = s.get("min", 6), s.get("max", 8.4)
            battery = max(0, min(100, round(100 * (tel[s["id"]] - lo) / ((hi - lo) or 1))))
    info = r["info"] or {}
    return {"id": r.get_id(), "name": r["name"], "color": r["color"] or "orange", "role": role, "demo": bool(r["is_demo"]),
            "online": is_online(r), "last_seen": C.iso(r["last_seen"]), "paired": bool(r["token_hash"] or r["tab_token_hash"]),
            "board": (r["config"] or {}).get("board", "pi"), "model": C.text(info.get("model"), 60),
            "controls": [c["type"] for c in m.get("controls", [])], "sensors": len(m.get("sensors", [])),
            "battery": battery, "owner": C.name_of(r["owner"]) if role != "owner" else None, "notes": r["notes"] or ""}


@anvil.server.callable(require_user=True)
def get_garage():
    me = C.require_user()
    DemoData.ensure_loaded()
    link_shares(me)
    mine = [card(r, "owner") for r in app_tables.robots.search(tables.order_by("created"), owner=me, is_demo=False)]
    shared = []
    for s in app_tables.shares.search(user=me):
        if s["robot"] is not None and not s["robot"]["is_demo"]:
            shared.append(card(s["robot"], s["role"]))
    showroom = [card(r, "demo") for r in app_tables.robots.search(tables.order_by("created"), is_demo=True)]
    return {"mine": mine, "shared": shared, "showroom": showroom, "max": MAX_ROBOTS}


def _session(s):
    st = s["stats"] or {}
    return {"id": s.get_id(), "pilot": s["pilot_name"] or (C.name_of(s["user"]) if s["user"] else "Guest"),
            "role": s["role"], "state": s["state"], "created": C.iso(s["created"]), "ended": C.iso(s["ended_at"]),
            "duration_s": st.get("duration_s"), "rtt_ms": st.get("rtt_ms"), "fps": st.get("fps"), "kbps": st.get("kbps"),
            "guest": s["guest_pass"] is not None}


def install_cmd(code):
    return "curl -fsSL '%s/install?c=%s' | sudo bash" % (anvil.server.get_api_origin(), code)


def detail(r, role):
    me = C.me()
    owner = role == "owner"
    out = card(r, role)
    m = reported_manifest(r)
    info = r["info"] or {}
    out.update({
        "can_edit": owner, "config": r["config"], "config_rev": r["config_rev"] or 1, "manifest": m,
        "reported": bool(r["manifest"]), "telemetry": r["telemetry"] or {},
        "info": {k: C.text(info.get(k), 80) for k in ("version", "model", "host", "platform", "python", "ip", "camera", "started")},
        "pin_notes": Parts.pin_warnings(r["config"]) if owner else [],
        "events": [{"kind": e["kind"], "text": e["text"], "at": C.iso(e["at"])}
                   for e in app_tables.events.search(tables.order_by("at", ascending=False), robot=r)[:60]],
        "sessions": [_session(s) for s in app_tables.sessions.search(tables.order_by("created", ascending=False), robot=r)[:40]
                     if owner or (me is not None and s["user"] == me)],
        "api_origin": anvil.server.get_api_origin(),
    })
    if owner:
        code = r["install_code"]
        exp = r["install_code_expires"]
        valid = bool(code and exp and C.iso(exp) > C.iso(C.now()))
        out["install"] = {"code": pretty_code(code) if valid else None, "expires": C.iso(exp) if valid else None,
                          "cmd": install_cmd(code) if valid else None, "update_cmd": install_cmd("").replace("?c=", ""),
                          "paired_at": C.iso(r["paired_at"]), "pi_paired": bool(r["token_hash"]),
                          "tab_paired": bool(r["tab_token_hash"])}
        out["shares"] = [{"id": s.get_id(), "email": s["email"], "role": s["role"], "joined": s["user"] is not None,
                          "name": C.name_of(s["user"]) if s["user"] else None}
                         for s in app_tables.shares.search(robot=r)]
        out["passes"] = [{"id": p.get_id(), "label": p["label"], "role": p["role"], "expires": C.iso(p["expires"]),
                          "uses": p["uses"] or 0, "last_used": C.iso(p["last_used"]),
                          "active": C.iso(p["expires"]) > C.iso(C.now())}
                         for p in app_tables.passes.search(tables.order_by("created", ascending=False), robot=r)]
    return out


@anvil.server.callable(require_user=True)
def get_robot(robot_id):
    me = C.require_user()
    link_shares(me)
    r = get_robot_row(robot_id)
    role = role_for(r, me)
    if role is None:
        return C.fail("That robot isn't in your garage.")
    r["wanted_until"] = C.now() + dt.timedelta(seconds=60) if role in ("owner", "pilot") and not r["is_demo"] else r["wanted_until"]
    return C.ok(robot=detail(r, role))


@anvil.server.callable(require_user=True)
def robot_status(robot_id):
    """Light polling for the robot page and the install tab (no spinner on the client)."""
    me = C.require_user()
    r = get_robot_row(robot_id)
    role = role_for(r, me)
    if role is None:
        return C.fail("That robot isn't in your garage.")
    if role in ("owner", "pilot") and not r["is_demo"]:
        r["wanted_until"] = C.now() + dt.timedelta(seconds=60)
    info = r["info"] or {}
    return C.ok(online=is_online(r), last_seen=C.iso(r["last_seen"]), telemetry=r["telemetry"] or {},
                paired=bool(r["token_hash"] or r["tab_token_hash"]), version=C.text(info.get("version"), 20),
                manifest=reported_manifest(r), reported=bool(r["manifest"]))


@anvil.server.callable(require_user=True)
def create_robot(name, preset="pi", color="orange"):
    me = C.require_user()
    name = C.text(name, 40)
    if len(name) < 2:
        return C.fail("Give your robot a name (at least 2 characters).")
    if len(app_tables.robots.search(owner=me, is_demo=False)) >= MAX_ROBOTS:
        return C.fail("That's %d robots already. Delete one first." % MAX_ROBOTS)
    if C.rate_limited("create_robot", 10, 3600):
        return C.fail("That's a lot of new robots in one hour. Try again later.")
    preset = preset if preset in Parts.BOARDS else "pi"
    cfg = Parts.clean(Parts.preset(preset, name))[0]
    cfg["rev"] = 1
    r = app_tables.robots.add_row(owner=me, name=name, color=color if color in COLORS else "orange", notes="", preset=preset,
                                  config=cfg, config_rev=1, manifest=None, info={}, telemetry={}, created=C.now(),
                                  install_code=new_code(), install_code_expires=C.now() + dt.timedelta(hours=CODE_HOURS),
                                  is_demo=False)
    add_event(r, "info", "Robot created with the %s setup." % {"pi": "Raspberry Pi", "pi_arduino": "Pi + Arduino",
                                                                "browser": "phone or laptop"}[preset])
    return C.ok(robot=detail(r, "owner"))


@anvil.server.callable(require_user=True)
def update_robot(robot_id, fields):
    me, r = require_owner(robot_id)
    if r is None:
        return C.fail("Only the robot's owner can change it.")
    fields = fields if isinstance(fields, dict) else {}
    if "name" in fields:
        name = C.text(fields.get("name"), 40)
        if len(name) < 2:
            return C.fail("Give your robot a name (at least 2 characters).")
        r["name"] = name
    if fields.get("color") in COLORS:
        r["color"] = fields["color"]
    if "notes" in fields:
        r["notes"] = C.text(fields.get("notes"), 500, multiline=True)
    return C.ok(robot=detail(r, "owner"))


@anvil.server.callable(require_user=True)
def save_config(robot_id, config):
    me, r = require_owner(robot_id)
    if r is None:
        return C.fail("Only the robot's owner can change its parts.")
    cfg, problems = Parts.clean(config)
    if problems:
        return {"ok": False, "error": problems[0], "problems": problems}
    rev = int(r["config_rev"] or 1) + 1
    cfg["rev"] = rev
    r["config"], r["config_rev"] = cfg, rev
    add_event(r, "config", "Parts saved (version %d): %s." % (rev, ", ".join(p["label"] for p in cfg["parts"]) or "no parts"))
    return C.ok(robot=detail(r, "owner"), notes=Parts.pin_warnings(cfg))


@anvil.server.callable(require_user=True)
def check_config(robot_id, config):
    """Validate without saving (the Parts tab shows problems as you type)."""
    me, r = require_owner(robot_id)
    if r is None:
        return C.fail("Only the robot's owner can change its parts.")
    cfg, problems = Parts.clean(config)
    return C.ok(problems=problems, notes=Parts.pin_warnings(cfg) if cfg else [],
                manifest=Parts.manifest_from_config(cfg, r["name"]) if cfg else None)


@anvil.server.callable(require_user=True)
def reset_config(robot_id, preset):
    me, r = require_owner(robot_id)
    if r is None:
        return C.fail("Only the robot's owner can change its parts.")
    preset = preset if preset in Parts.BOARDS else "pi"
    rev = int(r["config_rev"] or 1) + 1
    cfg = Parts.clean(Parts.preset(preset, r["name"]))[0]
    cfg["rev"] = rev
    r.update(config=cfg, config_rev=rev, preset=preset)
    add_event(r, "config", "Parts reset to the %s starting setup." % preset)
    return C.ok(robot=detail(r, "owner"))


@anvil.server.callable(require_user=True)
def new_install_code(robot_id):
    me, r = require_owner(robot_id)
    if r is None:
        return C.fail("Only the robot's owner can pair it.")
    if C.rate_limited("install_code", 20, 3600):
        return C.fail("Too many new codes this hour. Try again later.")
    r.update(install_code=new_code(), install_code_expires=C.now() + dt.timedelta(hours=CODE_HOURS))
    return C.ok(robot=detail(r, "owner"))


@anvil.server.callable(require_user=True)
def unpair_robot(robot_id):
    me, r = require_owner(robot_id)
    if r is None:
        return C.fail("Only the robot's owner can unpair it.")
    r.update(token_hash=None, tab_token_hash=None, last_seen=None)
    add_event(r, "warn", "Unpaired. The robot needs a new install code to call in again.")
    for state in ("waiting", "delivered", "answered"):
        for s in app_tables.sessions.search(robot=r, state=state):
            s["state"] = "ended"
    return C.ok(robot=detail(r, "owner"))


@anvil.server.callable(require_user=True)
def tab_claim(robot_id):
    """Robot mode in this browser (web/pages/bot.html): a token for the bot API, without an install code."""
    me, r = require_owner(robot_id)
    if r is None:
        return C.fail("Only the robot's owner can run it in this browser.")
    tok = new_token()
    r["tab_token_hash"] = hash_token(tok)
    add_event(r, "info", "This robot is running in a browser tab (robot mode).")
    return C.ok(token=tok, robot_id=r.get_id(), name=r["name"])


@anvil.server.callable(require_user=True)
def delete_robot(robot_id):
    me, r = require_owner(robot_id)
    if r is None:
        return C.fail("Only the robot's owner can delete it.")
    delete_robot_rows(r)
    return C.ok()


def delete_robot_rows(r):
    for t in (app_tables.events, app_tables.sessions, app_tables.shares):
        for x in t.search(robot=r):
            x.delete()
    for x in app_tables.passes.search(robot=r):
        x.delete()
    r.delete()
