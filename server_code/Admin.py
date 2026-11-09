"""Admin page callables: overview, users (make admin, disable), demo data, robots, network settings. Admins only.
Feedback admin calls live in Feedback.py. Admins see robots' names and status, never their cameras."""
import datetime as dt

import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import DemoData, Feedback, Robots


@anvil.server.callable(require_user=True)
def admin_overview():
    C.require_admin()
    return {"users": len([u for u in app_tables.users.search() if not u["is_demo"]]),
            "admins": len(app_tables.users.search(is_admin=True)),
            "feedback_new": Feedback.new_count(),
            "robots": len(app_tables.robots.search(is_demo=False)),
            "online": len([r for r in app_tables.robots.search(is_demo=False) if Robots.is_online(r)]),
            "sessions_week": len([s for s in app_tables.sessions.search(is_demo=False)
                                  if s["created"] and (C.now() - s["created"]) < dt.timedelta(days=7)]),
            "demo": {"state": DemoData.state(), "counts": DemoData.counts()}}


def _user(u):
    return {"id": u.get_id(), "email": u["email"], "name": C.name_of(u), "is_admin": C.is_admin(u),
            "enabled": u["enabled"] is not False, "joined": C.iso(u["signed_up"]), "last_seen": C.iso(u["last_seen"])}


@anvil.server.callable(require_user=True)
def list_users(query=None):
    C.require_admin()
    query = C.text(query, 80).lower()
    rows = [u for u in app_tables.users.search(tables.order_by("signed_up", ascending=False)) if not u["is_demo"]]
    if query:
        rows = [u for u in rows if query in (u["email"] or "").lower() or query in (u["display_name"] or "").lower()]
    return {"users": [_user(u) for u in rows[:200]], "total": len(rows)}


@anvil.server.callable(require_user=True)
def set_admin(user_id, flag):
    me = C.require_admin()
    u = C.row_by_id(app_tables.users, user_id)
    if u is None:
        return C.fail("That account no longer exists.")
    if u == me and not flag:
        return C.fail("You can't remove your own admin rights.")
    u["is_admin"] = bool(flag)
    return C.ok(user=_user(u))


@anvil.server.callable(require_user=True)
def set_enabled(user_id, flag):
    me = C.require_admin()
    u = C.row_by_id(app_tables.users, user_id)
    if u is None:
        return C.fail("That account no longer exists.")
    if u == me:
        return C.fail("You can't disable your own account.")
    u["enabled"] = bool(flag)
    return C.ok(user=_user(u))


@anvil.server.callable(require_user=True)
def demo_load():
    C.require_admin()
    DemoData.load()
    return C.ok(demo={"state": DemoData.state(), "counts": DemoData.counts()})


@anvil.server.callable(require_user=True)
def demo_remove():
    C.require_admin()
    DemoData.remove()
    return C.ok(demo={"state": DemoData.state(), "counts": DemoData.counts()})


@anvil.server.callable(require_user=True)
def admin_robots():
    C.require_admin()
    out = []
    for r in app_tables.robots.search(tables.order_by("created", ascending=False)):
        info = r["info"] or {}
        out.append({"id": r.get_id(), "name": r["name"], "owner": C.name_of(r["owner"]),
                    "email": r["owner"]["email"] if r["owner"] is not None and not r["is_demo"] else "",
                    "online": Robots.is_online(r), "last_seen": C.iso(r["last_seen"]), "demo": bool(r["is_demo"]),
                    "version": C.text(info.get("version"), 20), "model": C.text(info.get("model"), 60),
                    "parts": len((r["config"] or {}).get("parts") or []), "board": (r["config"] or {}).get("board", "pi"),
                    "sessions": len(app_tables.sessions.search(robot=r))})
    return {"robots": out}


def _clean_ice(servers):
    out = []
    for s in servers if isinstance(servers, list) else []:
        if not isinstance(s, dict):
            continue
        urls = s.get("urls")
        urls = [urls] if isinstance(urls, str) else urls if isinstance(urls, list) else []
        urls = [C.text(u, 200) for u in urls if isinstance(u, str) and u.strip().startswith(("stun:", "turn:", "turns:"))][:4]
        if not urls:
            continue
        e = {"urls": urls}
        if s.get("username"):
            e["username"] = C.text(s.get("username"), 120)
        if s.get("credential"):
            e["credential"] = C.text(s.get("credential"), 200)
        out.append(e)
    return out[:6]


@anvil.server.callable(require_user=True)
def get_network():
    C.require_admin()
    n = Robots.network()
    return dict(n, default_source=Robots.DEFAULT_SOURCE, default_ice=Robots.DEFAULT_ICE, relay=Robots.turn_servers()[1])


@anvil.server.callable(require_user=True)
def set_network(settings):
    C.require_admin()
    settings = settings if isinstance(settings, dict) else {}
    ice = _clean_ice(settings.get("ice_servers"))
    if not ice:
        return C.fail("Keep at least one STUN or TURN server (urls start with stun:, turn: or turns:).")
    src = C.text(settings.get("source"), 300)
    if src and not src.startswith("https://"):
        return C.fail("The robot code source must be an https:// link to a .tar.gz.")
    try:
        fast = int(settings.get("poll_fast_ms") or 600)
        idle = int(settings.get("poll_idle_ms") or 2500)
    except (TypeError, ValueError):
        return C.fail("Poll times are numbers of milliseconds.")
    if not (300 <= fast <= 5000 and 1000 <= idle <= 30000):
        return C.fail("Fast polling goes from 300 to 5,000 ms, idle from 1,000 to 30,000 ms.")
    C.set_setting("network", {"ice_servers": ice, "source": src or Robots.DEFAULT_SOURCE, "poll_fast_ms": fast, "poll_idle_ms": idle})
    return C.ok(network=get_network())
