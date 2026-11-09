"""The robot's side of the server: HTTP endpoints under <app>/_/api/ (the robot is not a browser, so no Anvil session).

  GET  /install?c=CODE   the bootstrap installer: `curl -fsSL '<api>/install?c=CODE' | sudo bash`
                         (downloads robot/ from GitHub and runs robot/install.sh, which claims the code)
  POST /bot/claim        {code, info}                     -> {token, robot_id, name}       (install code -> token, once)
  POST /bot/hello        {token, manifest, info}          -> {config, config_rev, ice_servers, poll_ms, name}
  POST /bot/poll         {token, telemetry, sessions, manifest?, config_rev}
                                                          -> {offers: [...], ended: [...], config?, next_ms}
  POST /bot/answer       {token, session, sdp}  or  {token, session, reject: "reason"}
  POST /bot/event        {token, kind, text}

Bodies are JSON (sent as text/plain from browsers so there is no CORS preflight). A wrong token answers 401,
which tells the robot it has been unpaired. Robot mode in a browser tab (web/pages/bot.html) uses the same API.
"""
import datetime as dt
import json

import anvil.server
from anvil.tables import app_tables

from . import common as C
from . import Parts, Robots

MAX_BODY = 60000
EVENT_KINDS = ("info", "warn", "error", "stop", "online", "offline", "drive", "config", "paired")
KEEP_EVENTS = 200


def _body():
    req = anvil.server.request
    b = getattr(req, "body", None)
    if b is None:
        return {}
    if hasattr(b, "get_bytes"):
        b = b.get_bytes()
    if isinstance(b, bytes):
        b = b.decode("utf-8", "replace")
    if not b or len(b) > MAX_BODY:
        return {}
    try:
        v = json.loads(b)
    except ValueError:
        return {}
    return v if isinstance(v, dict) else {}


def _reply(data, status=200):
    return anvil.server.HttpResponse(status, json.dumps(data), headers={
        "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})


def _robot(body):
    tok = body.get("token")
    if not isinstance(tok, str) or len(tok) < 16:
        return None, None
    h = Robots.hash_token(tok)
    r = app_tables.robots.get(token_hash=h)
    if r is not None:
        return r, "pi"
    r = app_tables.robots.get(tab_token_hash=h)
    return (r, "tab") if r is not None else (None, None)


def _denied():
    return _reply({"ok": False, "error": "This robot isn't paired any more. Make a new install code in the robot's Install tab.",
                   "unpaired": True}, 401)


def _clean_info(info, source):
    info = info if isinstance(info, dict) else {}
    out = {k: C.text(info.get(k), 80) for k in ("version", "model", "host", "platform", "python", "ip", "camera")}
    out["source"] = source
    out["started"] = C.iso(C.now())
    return out


def _clean_tel(tel):
    out = {}
    if not isinstance(tel, dict):
        return out
    for k, v in list(tel.items())[:40]:
        k = C.text(k, 24)
        if isinstance(v, bool) or v is None:
            out[k] = v
        elif isinstance(v, (int, float)):
            out[k] = round(float(v), 3) if v == v else None
        else:
            out[k] = C.text(v, 60)
    return out


def _came_online(r):
    was = Robots.is_online(r)
    r["last_seen"] = C.now()
    if not was:
        Robots.add_event(r, "online", "%s is online." % r["name"])
        _trim_events(r)


def _trim_events(r):
    rows = list(app_tables.events.search(robot=r))
    if len(rows) > KEEP_EVENTS:
        rows.sort(key=lambda e: C.iso(e["at"]) or "")
        for e in rows[:len(rows) - KEEP_EVENTS]:
            e.delete()


def _next_ms(r):
    n = Robots.network()
    wanted = r["wanted_until"]
    fast = wanted is not None and C.iso(wanted) > C.iso(C.now())
    return n["poll_fast_ms"] if fast else n["poll_idle_ms"]


@anvil.server.http_endpoint("/bot/claim", methods=["POST"])
def bot_claim(**q):
    b = _body()
    code = Robots.norm_code(b.get("code"))
    if len(code) != 8:
        return _reply({"ok": False, "error": "That install code isn't complete. It looks like ABCD-2345."}, 400)
    r = app_tables.robots.get(install_code=code)
    if r is None or r["is_demo"]:
        return _reply({"ok": False, "error": "That install code isn't known. Make a new one in the robot's Install tab."}, 404)
    if not r["install_code_expires"] or C.iso(r["install_code_expires"]) < C.iso(C.now()):
        return _reply({"ok": False, "error": "That install code has expired. Make a new one in the robot's Install tab."}, 410)
    tok = Robots.new_token()
    r.update(token_hash=Robots.hash_token(tok), install_code=None, install_code_expires=None, paired_at=C.now(),
             info=_clean_info(b.get("info"), "pi"))
    Robots.add_event(r, "paired", "Paired with %s." % (C.text((b.get("info") or {}).get("host"), 40) or "a robot"))
    return _reply({"ok": True, "token": tok, "robot_id": r.get_id(), "name": r["name"]})


@anvil.server.http_endpoint("/bot/hello", methods=["POST"])
def bot_hello(**q):
    b = _body()
    r, source = _robot(b)
    if r is None:
        return _denied()
    m = Parts.clean_manifest(b.get("manifest"))
    if m is not None:
        r["manifest"] = m
    r["info"] = _clean_info(b.get("info"), source)
    _came_online(r)
    n = Robots.network()
    return _reply({"ok": True, "robot_id": r.get_id(), "name": r["name"], "config": r["config"], "config_rev": r["config_rev"] or 1,
                   "ice_servers": Robots.ice_servers(), "poll_ms": _next_ms(r)})


@anvil.server.http_endpoint("/bot/poll", methods=["POST"])
def bot_poll(**q):
    b = _body()
    r, source = _robot(b)
    if r is None:
        return _denied()
    _came_online(r)
    if isinstance(b.get("telemetry"), dict):
        r["telemetry"] = _clean_tel(b["telemetry"])
    if b.get("manifest") is not None:
        m = Parts.clean_manifest(b.get("manifest"))
        if m is not None:
            r["manifest"] = m
    offers = []
    stamp = C.now()
    for state in ("waiting",):
        for s in app_tables.sessions.search(robot=r, state=state):
            age = (stamp - s["created"]).total_seconds() if s["created"] else 999
            if age > 40:
                s["state"] = "timeout"
                continue
            s["state"] = "delivered"
            offers.append({"session": s.get_id(), "sdp": s["offer"], "role": s["role"], "pilot": s["pilot_name"] or "Someone"})
    ended = []
    for sid in (b.get("sessions") if isinstance(b.get("sessions"), list) else [])[:12]:
        s = C.row_by_id(app_tables.sessions, sid)
        if s is None or s["robot"] != r or s["state"] in ("ended", "timeout", "rejected"):
            ended.append(sid)
        elif s["guest_pass"] is not None and C.iso(s["guest_pass"]["expires"]) < C.iso(stamp):
            s["state"] = "ended"
            ended.append(sid)  # a guest pass ran out mid-drive
    out = {"ok": True, "offers": offers, "ended": ended, "next_ms": _next_ms(r), "config_rev": r["config_rev"] or 1,
           "ice_servers": Robots.ice_servers() if offers else None}
    try:
        have = int(b.get("config_rev") or 0)
    except (TypeError, ValueError):
        have = 0
    if have != (r["config_rev"] or 1):
        out["config"] = r["config"]
    return _reply(out)


@anvil.server.http_endpoint("/bot/answer", methods=["POST"])
def bot_answer(**q):
    b = _body()
    r, source = _robot(b)
    if r is None:
        return _denied()
    s = C.row_by_id(app_tables.sessions, b.get("session"))
    if s is None or s["robot"] != r:
        return _reply({"ok": False, "error": "Unknown session."}, 404)
    if s["state"] not in ("waiting", "delivered"):
        return _reply({"ok": False, "error": "That pilot has gone."}, 410)
    if b.get("reject"):
        s.update(state="rejected", stats=dict(s["stats"] or {}, reason=C.text(b.get("reject"), 160)))
        return _reply({"ok": True})
    sdp = b.get("sdp")
    if not isinstance(sdp, str) or "v=0" not in sdp[:20] or len(sdp) > 30000:
        return _reply({"ok": False, "error": "Not an SDP answer."}, 400)
    s.update(answer=sdp, state="answered", answered_at=C.now())
    return _reply({"ok": True})


@anvil.server.http_endpoint("/bot/event", methods=["POST"])
def bot_event(**q):
    b = _body()
    r, source = _robot(b)
    if r is None:
        return _denied()
    kind = b.get("kind") if b.get("kind") in EVENT_KINDS else "info"
    Robots.add_event(r, kind, C.text(b.get("text"), 300) or kind)
    if kind == "offline":
        r["last_seen"] = C.now() - dt.timedelta(seconds=Robots.ONLINE_S + 1)
    _trim_events(r)
    return _reply({"ok": True})


INSTALL = r"""#!/usr/bin/env bash
# Robo Presence: robot installer (bootstrap). It downloads the robot code and runs robot/install.sh.
# Read the full installer first if you like: https://github.com/arkulinskis/robo-presence/blob/master/robot/install.sh
set -euo pipefail
RP_SERVER='__SERVER__'
RP_CODE='__CODE__'
RP_SOURCE='__SOURCE__'
if [ "$(id -u)" -ne 0 ]; then
  echo "Please run it with sudo:  curl -fsSL '$RP_SERVER/install?c=$RP_CODE' | sudo bash"; exit 1
fi
command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "==> Downloading the Robo Presence robot code"
curl -fsSL "$RP_SOURCE" | tar -xz -C "$TMP"
SRC="$(find "$TMP" -maxdepth 2 -type d -name robot | head -n1)"
[ -n "$SRC" ] || { echo "Couldn't find the robot code in the download."; exit 1; }
bash "$SRC/install.sh" --server "$RP_SERVER" --code "$RP_CODE" --source "$SRC"
"""

INSTALL_FAIL = """#!/usr/bin/env bash
echo ""
echo "  Robo Presence: __MSG__"
echo ""
exit 1
"""


@anvil.server.http_endpoint("/install")
def install_script(c=None, **q):
    """The one-line installer. Without a code it updates a robot that is already paired."""
    code = Robots.norm_code(c)
    if c and len(code) == 8:
        r = app_tables.robots.get(install_code=code)
        msg = None
        if r is None:
            msg = "that install code isn't known. Make a new one in the robot's Install tab."
        elif not r["install_code_expires"] or C.iso(r["install_code_expires"]) < C.iso(C.now()):
            msg = "that install code has expired. Make a new one in the robot's Install tab."
        if msg:
            return anvil.server.HttpResponse(200, INSTALL_FAIL.replace("__MSG__", msg), headers={"Content-Type": "text/plain"})
    elif c:
        return anvil.server.HttpResponse(200, INSTALL_FAIL.replace("__MSG__", "that install code isn't complete (it looks like ABCD-2345)."),
                                         headers={"Content-Type": "text/plain"})
    script = INSTALL.replace("__SERVER__", anvil.server.get_api_origin()).replace("__CODE__", code if c else "") \
        .replace("__SOURCE__", Robots.network()["source"])
    return anvil.server.HttpResponse(200, script, headers={"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"})
