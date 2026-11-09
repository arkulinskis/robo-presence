"""Server tests against the strict mock of Anvil (tools/testing/mock).

    python tools/testing/test_server.py          -> prints ALL OK, or the first failure

call(name, ...) runs a server function the way the browser does: by name, with require_user enforced,
and the reply must be JSON (a datetime or a row in a reply fails here, like it would break the page).
Add tests for every new server function: the happy path, bad input, and someone who isn't allowed.
"""
import datetime as dt
import importlib
import json
import os
import pathlib
import shutil
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
PROJECT = HERE.parents[1]
_tmp = pathlib.Path(tempfile.mkdtemp())
shutil.copytree(PROJECT / "server_code", _tmp / "app")
(_tmp / "app" / "__init__.py").write_text("")
os.environ["ANVIL_APP_YAML"] = str(PROJECT / "anvil.yaml")  # the mock's tables follow the app's own schema
sys.path[:0] = [str(HERE / "mock"), str(_tmp)]
import anvil.server  # noqa: E402
import anvil.users  # noqa: E402
from anvil.tables import app_tables as T  # noqa: E402

M = {p.stem: importlib.import_module("app." + p.stem) for p in sorted((PROJECT / "server_code").glob("*.py"))}
now = dt.datetime.now(dt.timezone.utc)


def call(name, *args):
    r = anvil.server.call(name, *args)
    json.dumps(r)  # strict: must be JSON-able
    return r


def as_user(row):
    anvil.users.CURRENT[0] = row
    anvil.server.session.use(row.get_id() if row is not None else None)


def denied(name, *args):
    try:
        call(name, *args)
    except anvil.server.PermissionDenied:
        return True
    return False


def ok(r, msg=""):
    assert isinstance(r, dict) and r.get("ok"), (msg, r)
    return r


def bad(r, msg=""):
    assert isinstance(r, dict) and r.get("ok") is False and r.get("error"), (msg, r)
    return r


def person(email, name=None, **kw):
    return T.users.add_row(email=email, enabled=True, signed_up=now, display_name=name, **kw)


# ---------------------------------------------------------------------------------- accounts
admin = person("arkulinskis@gmail.com", "The Admin")
ana = person("ana@example.com", "Ana")
bob = person("bob@example.com")

as_user(None)
assert call("get_me") is None
assert denied("update_profile", "X")
as_user(admin)
assert call("get_me")["is_admin"] is True, "ADMIN_EMAILS become admins on first sign-in"
as_user(ana)
me = call("get_me")
assert me["name"] == "Ana" and me["is_admin"] is False
assert ana["last_seen"] is not None
as_user(bob)
assert call("get_me")["name"] == "Bob", "a name comes from the email when none is set"
bad(call("update_profile", " x "))
assert ok(call("update_profile", "  Bob   Stone "))["me"]["name"] == "Bob Stone"

# ---------------------------------------------------------------------------------- feedback
as_user(None)
bad(call("submit_feedback", "bug", "hi"))
ok(call("submit_feedback", "bug", "The button is broken", "guest@example.com", {"page": "#home", "evil": "x" * 9999}))
fb = T.feedback.search()[0]
assert fb["name"] == "Guest" and fb["email"] == "guest@example.com" and "evil" not in fb["context"] and fb["status"] == "new"
for i in range(4):
    ok(call("submit_feedback", "idea", "Idea number %d" % i))
bad(call("submit_feedback", "idea", "One too many this hour"), "rate limit")
as_user(ana)
ok(call("submit_feedback", "nonsense-kind", "Signed-in feedback"))
assert T.feedback.get(message="Signed-in feedback")["kind"] == "other"
assert denied("list_feedback")
as_user(admin)
lst = call("list_feedback")
assert lst["counts"]["new"] == 6 and len(lst["items"]) == 6
fid = lst["items"][0]["id"]
ok(call("set_feedback_status", fid, "done", "Fixed it"))
assert call("list_feedback", "done")["items"][0]["note"] == "Fixed it"
bad(call("set_feedback_status", fid, "weird"))
bad(call("set_feedback_status", "nope", "done"))
ok(call("delete_feedback", fid))
assert len(call("list_feedback")["items"]) == 5

# ---------------------------------------------------------------------------------- admin
as_user(ana)
for fn, args in [("admin_overview", ()), ("list_users", ()), ("set_admin", (bob.get_id(), True)), ("demo_load", ()), ("demo_remove", ())]:
    assert denied(fn, *args), fn
as_user(admin)
ov = call("admin_overview")
assert ov["users"] == 3 and ov["admins"] == 1 and ov["feedback_new"] == 5 and ov["robots"] == 0
assert len(call("list_users")["users"]) == 3 and len(call("list_users", "bob")["users"]) == 1
ok(call("set_admin", bob.get_id(), True))
assert bob["is_admin"] is True
bad(call("set_admin", admin.get_id(), False), "can't remove your own admin")
ok(call("set_enabled", bob.get_id(), False))
assert bob["enabled"] is False
bad(call("set_enabled", admin.get_id(), False))
ok(call("set_enabled", bob.get_id(), True))
ok(call("set_admin", bob.get_id(), False))
assert bob["is_admin"] is False

# ---------------------------------------------------------------------------------- robots: garage, demo, create
def endpoint(path, body=None, **query):
    """Call an http_endpoint the way the robot does: JSON body, reply = (status, dict or text)."""
    anvil.server.request.body = json.dumps(body) if body is not None else None
    r = anvil.server.ENDPOINTS[path](**query)
    if isinstance(r, anvil.server.HttpResponse):
        try:
            return r.status, json.loads(r.body)
        except (ValueError, TypeError):
            return r.status, r.body
    return 200, r


SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n"
as_user(None)
assert denied("get_garage")
as_user(ana)
g = call("get_garage")
assert M["DemoData"].state() == "loaded", "demo loads on the first garage visit"
assert [x["name"] for x in g["showroom"]] == ["Sprocket", "Dusty", "Biscuit"] and g["mine"] == [] and g["shared"] == []
assert all(x["role"] == "demo" and not x["online"] for x in g["showroom"])
dusty = g["showroom"][1]
assert "slider" in dusty["controls"] and dusty["battery"] is not None, "Dusty has a claw and a battery reading"
demo_r = ok(call("get_robot", dusty["id"]))["robot"]
assert demo_r["can_edit"] is False and "install" not in demo_r and "shares" not in demo_r and demo_r["events"]
bad(call("update_robot", dusty["id"], {"name": "Mine now"}), "nobody edits a showroom robot")
bad(call("drive_offer", dusty["id"], SDP), "showroom robots never get a real connection")
dopen = ok(call("drive_open", dusty["id"]))
assert dopen["role"] == "demo" and dopen["robot"]["demo"] and dopen["ice_servers"]

bad(call("create_robot", " "))
rob = ok(call("create_robot", "Pip", "pi", "olive"))["robot"]
rid = rob["id"]
assert rob["role"] == "owner" and rob["color"] == "olive" and rob["install"]["code"] and len(rob["install"]["code"]) == 9
assert "install?c=" in rob["install"]["cmd"] and "| sudo bash" in rob["install"]["cmd"]
assert rob["manifest"]["preview"] is True and {c["id"] for c in rob["manifest"]["controls"]} >= {"drive", "pan", "tilt", "lights"}
assert not rob["online"] and not rob["paired"]
assert [x["name"] for x in call("get_garage")["mine"]] == ["Pip"]
as_user(bob)
bad(call("get_robot", rid), "strangers can't see Ana's robot")
bad(call("update_robot", rid, {"name": "Bob's"}))
bad(call("save_config", rid, rob["config"]))
bad(call("new_install_code", rid))
bad(call("delete_robot", rid))
bad(call("tab_claim", rid))
bad(call("drive_open", rid))
as_user(None)
bad(call("drive_open", rid), "signed out, no pass: no drive")

# ---------------------------------------------------------------------------------- the parts config
as_user(ana)
ok(call("update_robot", rid, {"name": "Pip the Bold", "color": "red", "notes": "Kitchen patrol"}))
cfg = json.loads(json.dumps(rob["config"]))
cfg["parts"].append({"id": "claw", "type": "slider", "driver": "pwm", "label": "Claw", "min": 0, "max": 100, "pins": {"pin": 22}})
saved = ok(call("save_config", rid, cfg))
assert saved["robot"]["config_rev"] == 2 and any(c["id"] == "claw" and c["type"] == "slider" for c in saved["robot"]["manifest"]["controls"])
dup = json.loads(json.dumps(cfg))
dup["parts"].append({"id": "claw2", "type": "toggle", "driver": "gpio", "pins": {"pin": 22}})
r_bad = call("save_config", rid, dup)
assert r_bad["ok"] is False and any("both use GPIO 22" in x for x in r_bad["problems"]), r_bad
same_id = json.loads(json.dumps(cfg))
same_id["parts"].append({"id": "claw", "type": "button", "driver": "sim"})
bad(call("save_config", rid, same_id), "ids are unique")
two = json.loads(json.dumps(cfg))
two["parts"].append({"id": "wheels2", "type": "drive", "driver": "sim"})
bad(call("save_config", rid, two), "one set of wheels")
nopin = json.loads(json.dumps(cfg))
nopin["parts"][1]["pins"] = {}
bad(call("save_config", rid, nopin), "a GPIO servo needs its pin")
badpin = json.loads(json.dumps(cfg))
badpin["parts"][1]["pins"] = {"pin": 40}
bad(call("save_config", rid, badpin), "BCM pins stop at 27")
weird = {"parts": [{"id": "Bad Id!", "type": "servo"}, {"id": "x", "type": "laser"}]}
assert len(ok(call("check_config", rid, weird))["problems"]) == 2
chk = ok(call("check_config", rid, {"parts": [{"id": "sda", "type": "toggle", "driver": "gpio", "pins": {"pin": 2}}]}))
assert chk["problems"] == [] and "I2C" in chk["notes"][0] and chk["manifest"]["controls"][0]["type"] == "toggle"
plug = ok(call("check_config", rid, {"parts": [{"id": "claw", "type": "custom", "driver": "plugin", "options": {"ui": "slider", "plugin": "my_claw"}}]}))
assert plug["problems"] == [] and plug["manifest"]["controls"][0]["type"] == "slider" and plug["manifest"]["controls"][0]["plugin"] == "my_claw"
bad(call("save_config", rid, {"parts": [{"id": "claw", "type": "custom", "driver": "plugin", "options": {"plugin": "rm -rf"}}]}))
ard = ok(call("check_config", rid, {"parts": [{"id": "pan", "type": "servo", "driver": "arduino", "pins": {"pin": "a0"}},
                                            {"id": "tilt", "type": "servo", "driver": "arduino", "pins": {"pin": "A0"}}]}))
assert any("Arduino pin A0" in x for x in ard["problems"])
assert ok(call("reset_config", rid, "pi_arduino"))["robot"]["config"]["board"] == "pi_arduino"
assert ok(call("reset_config", rid, "pi"))["robot"]["config_rev"] == 4
ok(call("save_config", rid, cfg))

# ---------------------------------------------------------------------------------- pairing + the robot's API
ok(call("new_install_code", rid))
code = call("get_robot", rid)["robot"]["install"]["code"]
st, script = endpoint("/install", c=code)
assert st == 200 and "install.sh" in script and code.replace("-", "") in script and "/_/api" in script and "codeload.github.com" in script
st, script = endpoint("/install", c="ZZZZ-ZZZZ")
assert "isn't known" in script and "exit 1" in script
st, script = endpoint("/install", c="AB")
assert "isn't complete" in script
st, script = endpoint("/install")
assert "RP_CODE=''" in script, "no code = update an already paired robot"
st, r = endpoint("/bot/claim", {"code": "WWWW-WWWW"})
assert st == 404 and not r["ok"]
st, r = endpoint("/bot/claim", {"code": code.lower(), "info": {"host": "pip", "version": "1.0.0"}})
assert st == 200 and r["ok"] and r["robot_id"] == rid and len(r["token"]) > 20, r
tok = r["token"]
st, r = endpoint("/bot/claim", {"code": code})
assert st == 404, "a code works once"
assert endpoint("/bot/hello", {"token": "nope" * 6})[0] == 401
man = {"protocol": 1, "name": "Pip", "camera": {"width": 640, "height": 480, "fps": 24, "source": "test"},
       "controls": [{"id": "drive", "type": "drive", "label": "Wheels", "max_speed": 0.8},
                    {"id": "pan", "type": "servo", "min": -80, "max": 80, "home": 0, "group": "head", "axis": "x"},
                    {"id": "zap", "type": "laser-beam", "label": "From a newer robot"}, {"id": "BAD ID", "type": "x"}],
       "sensors": [{"id": "cpu_temp", "type": "gauge", "unit": "°C", "min": 30, "max": 85}],
       "problems": [{"id": "tilt", "text": "GPIO 19 is busy"}]}
st, h = endpoint("/bot/hello", {"token": tok, "manifest": man, "info": {"version": "1.0.0", "host": "pip", "model": "Pi 4" * 50}})
assert st == 200 and h["config_rev"] == 5 and h["config"]["parts"] and h["ice_servers"][0]["urls"], h
rd = call("get_robot", rid)["robot"]
assert rd["online"] and rd["reported"] and len(rd["manifest"]["controls"]) == 3 and rd["manifest"]["problems"][0]["id"] == "tilt"
assert len(rd["info"]["model"]) <= 80 and any(e["kind"] == "online" for e in rd["events"]) and any(e["kind"] == "paired" for e in rd["events"])
st, pl = endpoint("/bot/poll", {"token": tok, "telemetry": {"cpu_temp": 48.5, "x" * 50: "y" * 500}, "sessions": [], "config_rev": 5})
assert st == 200 and pl["offers"] == [] and "config" not in pl and pl["next_ms"] == 600, "someone is looking: poll fast"
st, pl = endpoint("/bot/poll", {"token": tok, "config_rev": 2})
assert pl["config"]["rev"] == 5, "an old config gets the new one"
tel = call("robot_status", rid)["telemetry"]
assert tel["cpu_temp"] == 48.5 and all(len(k) <= 24 and (not isinstance(v, str) or len(v) <= 60) for k, v in tel.items())

# ---------------------------------------------------------------------------------- driving: offer -> robot -> answer
d = ok(call("drive_open", rid))
assert d["role"] == "owner" and d["robot"]["online"] and d["robot"]["manifest"]["controls"]
bad(call("drive_offer", rid, "not an sdp"))
o = ok(call("drive_offer", rid, SDP))
sid, secret = o["session_id"], o["secret"]
assert ok(call("drive_poll", sid, secret))["state"] == "waiting"
bad(call("drive_poll", sid, "wrong-secret"))
st, pl = endpoint("/bot/poll", {"token": tok, "sessions": []})
assert len(pl["offers"]) == 1 and pl["offers"][0]["session"] == sid and pl["offers"][0]["sdp"] == SDP and pl["offers"][0]["role"] == "owner"
assert pl["ice_servers"], "offers come with the ICE servers"
assert endpoint("/bot/poll", {"token": tok})[1]["offers"] == [], "an offer is delivered once"
assert endpoint("/bot/answer", {"token": tok, "session": sid, "sdp": "nope"})[0] == 400
assert endpoint("/bot/answer", {"token": tok, "session": "zzz", "sdp": SDP})[0] == 404
assert endpoint("/bot/answer", {"token": tok, "session": sid, "sdp": SDP + "a=answer\r\n"})[1]["ok"]
pr = ok(call("drive_poll", sid, secret))
assert pr["state"] == "answered" and pr["answer"].endswith("a=answer\r\n")
assert endpoint("/bot/poll", {"token": tok, "sessions": [sid]})[1]["ended"] == []
ok(call("drive_end", sid, secret, {"duration_s": 125, "rtt_ms": 61.4, "fps": 29, "kbps": 1500, "evil": "x"}))
assert endpoint("/bot/poll", {"token": tok, "sessions": [sid]})[1]["ended"] == [sid], "the robot hears the pilot left"
sess = call("get_robot", rid)["robot"]["sessions"][0]
assert sess["duration_s"] == 125 and sess["rtt_ms"] == 61.4 and sess["state"] == "ended"
assert any(e["kind"] == "drive" and "2 min" in e["text"] for e in call("get_robot", rid)["robot"]["events"])
o2 = ok(call("drive_offer", rid, SDP))
assert endpoint("/bot/poll", {"token": tok})[1]["offers"][0]["session"] == o2["session_id"]
endpoint("/bot/answer", {"token": tok, "session": o2["session_id"], "reject": "Two pilots already"})
assert call("drive_poll", o2["session_id"], o2["secret"])["state"] == "rejected"
st, ev = endpoint("/bot/event", {"token": tok, "kind": "stop", "text": "Watchdog stopped the wheels"})
assert ev["ok"] and any(e["text"] == "Watchdog stopped the wheels" and e["kind"] == "stop" for e in call("get_robot", rid)["robot"]["events"])
endpoint("/bot/event", {"token": tok, "kind": "offline", "text": "Shutting down"})
assert not call("robot_status", rid)["online"], "an offline event marks it offline right away"
bad(call("drive_offer", rid, SDP), "can't offer to an offline robot")
endpoint("/bot/poll", {"token": tok})

# ---------------------------------------------------------------------------------- sharing: pilots, viewers, guest passes
bad(call("share_add", rid, "not-an-email"))
bad(call("share_add", rid, "ana@example.com"), "not with yourself")
bad(call("share_add", rid, "bob@example.com", "boss"))
ok(call("share_add", rid, "BOB@example.com", "viewer"))
ok(call("share_add", rid, "carol@example.com", "pilot"))
shares = call("get_robot", rid)["robot"]["shares"]
assert len(shares) == 2 and {s["email"] for s in shares} == {"bob@example.com", "carol@example.com"}
assert [s for s in shares if s["email"] == "bob@example.com"][0]["joined"] is True
as_user(bob)
g = call("get_garage")
assert [x["name"] for x in g["shared"]] == ["Pip the Bold"] and g["shared"][0]["role"] == "viewer"
rb = ok(call("get_robot", rid))["robot"]
assert rb["can_edit"] is False and "install" not in rb and rb["sessions"] == [], "viewers don't see others' drive history"
assert ok(call("drive_open", rid))["role"] == "viewer"
ok(call("drive_offer", rid, SDP))
bad(call("share_add", rid, "x@example.com"), "viewers can't share")
carol = person("carol@example.com", "Carol")
as_user(carol)
assert call("get_garage")["shared"][0]["role"] == "pilot", "an invitation waits for the account"
as_user(ana)
share_bob = [s for s in call("get_robot", rid)["robot"]["shares"] if s["email"] == "bob@example.com"][0]
as_user(bob)
bad(call("share_remove", share_bob["id"]))
as_user(ana)
ok(call("share_remove", share_bob["id"]))
as_user(bob)
bad(call("get_robot", rid), "unshared")
as_user(ana)
bad(call("pass_create", rid, "Grandma", "admin", 24))
bad(call("pass_create", rid, "Grandma", "pilot", 5))
pc = ok(call("pass_create", rid, "Grandma", "pilot", 4))
ptok = pc["token"]
assert pc["robot"]["passes"][0]["label"] == "Grandma" and pc["robot"]["passes"][0]["active"]
as_user(None)
pi = ok(call("pass_info", ptok))
assert pi["role"] == "pilot" and pi["robot"]["name"] == "Pip the Bold"
bad(call("pass_info", "nope-nope-nope"))
gd = ok(call("drive_open", None, ptok))
assert gd["guest"] and gd["role"] == "pilot" and gd["pilot"] == "Grandma"
go = ok(call("drive_offer", None, SDP, ptok, "Grandma Lin"))
offers = endpoint("/bot/poll", {"token": tok})[1]["offers"]
assert any(x["pilot"] == "Grandma Lin" and x["role"] == "pilot" for x in offers)
gsid = go["session_id"]
endpoint("/bot/answer", {"token": tok, "session": gsid, "sdp": SDP})
as_user(ana)
pid = call("get_robot", rid)["robot"]["passes"][0]["id"]
assert call("get_robot", rid)["robot"]["passes"][0]["uses"] == 1
as_user(bob)
bad(call("pass_revoke", pid))
as_user(ana)
ok(call("pass_revoke", pid))
assert endpoint("/bot/poll", {"token": tok, "sessions": [gsid]})[1]["ended"] == [gsid], "revoking a pass ends its drive"
as_user(None)
bad(call("pass_info", ptok), "a revoked pass stops working")
bad(call("drive_open", None, ptok))

# ---------------------------------------------------------------------------------- robot mode in a browser, unpairing, deleting
as_user(ana)
tc = ok(call("tab_claim", rid))
st, h = endpoint("/bot/hello", {"token": tc["token"], "manifest": man, "info": {"version": "web-1"}})
assert st == 200 and h["robot_id"] == rid
assert call("get_robot", rid)["robot"]["install"]["tab_paired"]
ok(call("unpair_robot", rid))
assert endpoint("/bot/poll", {"token": tok})[0] == 401 and endpoint("/bot/poll", {"token": tc["token"]})[0] == 401
assert not call("get_robot", rid)["robot"]["paired"]
for i in range(9):
    ok(call("create_robot", "Spare %d" % i, "browser"))
bad(call("create_robot", "One too many"), "10 robots each")

# ---------------------------------------------------------------------------------- admin: robots + network
as_user(ana)
for fn, args in [("admin_robots", ()), ("get_network", ()), ("set_network", ({},))]:
    assert denied(fn, *args), fn
as_user(admin)
ar = call("admin_robots")["robots"]
assert len(ar) == 13 and any(x["name"] == "Pip the Bold" and x["email"] == "ana@example.com" for x in ar)
assert all(x["email"] == "" for x in ar if x["demo"])
net = call("get_network")
assert net["ice_servers"][0]["urls"][0].startswith("stun:")
bad(call("set_network", {"ice_servers": [{"urls": "http://evil"}]}))
bad(call("set_network", {"ice_servers": net["ice_servers"], "source": "http://insecure"}))
bad(call("set_network", {"ice_servers": net["ice_servers"], "poll_fast_ms": 10}))
ok(call("set_network", {"ice_servers": net["ice_servers"] + [{"urls": "turn:turn.example.com:3478", "username": "u", "credential": "p"}],
                        "poll_fast_ms": 500, "poll_idle_ms": 4000}))
assert len(M["Robots"].network()["ice_servers"]) == 2 and M["Robots"].network()["poll_idle_ms"] == 4000
assert call("admin_overview")["robots"] == 10

# ---------------------------------------------------------------------------------- demo data on and off
as_user(admin)
ok(call("demo_remove"))
assert M["DemoData"].state() == "removed" and not T.robots.search(is_demo=True) and not T.users.search(is_demo=True)
assert len(T.robots.search()) == 10, "removing demo data keeps real robots"
as_user(ana)
assert call("get_garage")["showroom"] == [], "removed demo data doesn't come back by itself"
as_user(admin)
ok(call("demo_load"))
ok(call("demo_load"))
assert len(T.robots.search(is_demo=True)) == 3, "reloading replaces the demo instead of doubling it"
as_user(ana)
ok(call("delete_robot", rid))
assert call("get_robot", rid)["ok"] is False and not [s for s in T.sessions.search() if s["robot"] is None]
assert len(call("get_garage")["mine"]) == 9

# ---------------------------------------------------------------------------------- Cloudflare TURN relay
import anvil.secrets as _sec  # noqa: E402
import anvil.http as _http  # noqa: E402
R = M["Robots"]
T.app_settings.get(key="turn_cache") and T.app_settings.get(key="turn_cache").delete()
assert R.turn_servers() == ([], "not set") and R.ice_servers() == R.network()["ice_servers"], "no secrets: STUN only"
T.app_settings.get(key="turn_cache").delete()
_sec.SECRETS.update(cf_turn_key_id=" KEY ", cf_turn_api_token="TOK")
_http.REPLIES["https://rtc.live.cloudflare.com/"] = {"iceServers": [{"urls": ["stun:stun.cloudflare.com:3478", "turn:turn.cloudflare.com:3478?transport=udp",
                                                                       "turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:5349?transport=tcp"],
                                                              "username": "u", "credential": "c"}]}
n_calls = len(_http.CALLS)
ice = R.ice_servers()
relay = ice[-1]
assert relay["username"] == "u" and len(relay["urls"]) == 3 and not [u for u in relay["urls"] if ":53?" in u], ice
assert _http.CALLS[-1]["url"].endswith("/keys/KEY/credentials/generate-ice-servers"), "key id is trimmed"
assert _http.CALLS[-1]["headers"]["Authorization"] == "Bearer TOK"
R.ice_servers(); assert len(_http.CALLS) == n_calls + 1, "relay login is cached, not fetched on every poll"
_sec.SECRETS.pop("cf_turn_key_id"); _sec.SECRETS.pop("cf_turn_api_token"); _http.REPLIES.pop("https://rtc.live.cloudflare.com/")
T.app_settings.get(key="turn_cache").delete()

# ---------------------------------------------------------------------------------- Privacy & Terms
if "legal_server" in M:
    as_user(ana)
    st = call("legal_state")
    assert st["signedIn"] and st["accepted_version"] is None
    ok(call("legal_accept", st["version"], "signup"))
    assert ana["legal_source"] == "signup" and call("legal_state")["accepted_version"] == st["version"]

# ---------------------------------------------------------------------------------- every callable is covered by a permission check
# A callable that changes data without require_user / a C.require_* check is a security hole. List the public ones here.
PUBLIC = {"get_me", "submit_feedback", "legal_state", "legal_accept", "pass_info", "drive_open", "drive_offer", "drive_poll",
          "drive_end"}  # the drive_* ones check a guest pass or the signed-in user themselves
for name, (f, need) in sorted(anvil.server.CALLABLES.items()):
    if name in PUBLIC:
        continue
    assert need, "%s is callable by anyone: add require_user=True (or list it in PUBLIC in test_server.py)" % name

print("ALL OK (%d server functions)" % len(anvil.server.CALLABLES))
