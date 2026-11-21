import time

from anvil import *
import anvil.server
from anvil.js import window

from ._anvil_designer import CheckTemplate
from ... import rp, state


class Check(CheckTemplate):
    """#check (anyone): the connection check. Will driving work from this network?
    Tests from this browser: WebRTC and H.264 support, the round trip to the server (3 pings), STUN (is there a public
    address, and is the router's NAT easy or strict/symmetric), and the relay (TURN; signed-in people only, since
    relay logins cost money). Then one plain verdict and the fixes. The ICE gathering is the JS engine RP.netCheck
    (rp-link.js); the servers come from Drive.net_check_info. Linked from the cockpit's "No connection" screen and
    the guide."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.report = ""
        state.live(self.progress)
        state.live(self.verdict_title)

    @handle("run_button", "click")
    def run_button_click(self, **event_args):
        self.run_button.enabled = False
        self.copy_button.visible = False
        self.rows_panel.items = []
        self.verdict_title.text = "Checking..."
        self.verdict_text.text = ""
        try:
            self._run()
        except Exception as e:
            self.verdict_title.text = "The check didn't finish"
            self.verdict_text.text = "Something went wrong (%s). Reload the page and try again." % (str(e)[:120] or "unknown error")
        self.progress.text = ""
        self.run_button.enabled = True
        self.run_button.text = "Check again"

    def _run(self):
        rows = []
        self.progress.text = "Asking the server..."
        times = []
        info = None
        for i in range(3):
            t = time.time()
            r = anvil.server.call_s("net_check_info") if i == 0 else anvil.server.call_s("net_ping")
            times.append(int((time.time() - t) * 1000))
            if i == 0:
                info = r
        if not info or info.get("ok") is False:
            raise Exception((info or {}).get("error") or "no reply")
        server_ms = sorted(times)[1]
        self.progress.text = "Testing WebRTC and your router (up to 10 seconds)..."
        res = rp.py_value(rp.RP.netCheck(rp.js_value({"stun": info.get("stun") or [], "relay": info.get("relay") or []}))) or {}

        if not res.get("webrtc"):
            rows.append(_row("x", "WebRTC: not available", "This browser can't make live video connections. Use a recent Chrome, Edge, Firefox or Safari.", "bad"))
        else:
            rows.append(_row("check", "WebRTC: supported", "This browser can drive robots.", "good"))
            if res.get("h264") is False:
                rows.append(_row("video", "H.264 video: missing", "Robots send H.264 first; the robot can fall back to VP8, at a higher CPU cost on a Pi.", "warn"))
        lvl = "good" if server_ms < 250 else "warn" if server_ms < 700 else "bad"
        rows.append(_row("clock", "Server round trip: %d ms" % server_ms,
                         "Only the introduction goes through the server, so this mainly affects how fast a drive starts." if lvl != "bad"
                         else "Slow internet here: drives will start slowly and the picture may stutter.", lvl))
        stun_ok = bool(res.get("publicIp"))
        sym = res.get("symmetric")
        if not stun_ok:
            rows.append(_row("signal", "Public address: not found", "STUN servers didn't answer. UDP may be blocked here (some offices, schools and hotels do that).", "bad"))
        elif sym:
            rows.append(_row("shield", "Router: strict (symmetric NAT)", "Your network hands out a new port for every server. Direct connections only work if the robot's network is easy.", "warn"))
        else:
            rows.append(_row("signal", "Router: easy NAT" if sym is False else "Public address: found",
                             "Direct peer-to-peer connections should work from here.", "good"))
        relay = res.get("relay") or {}
        relay_status = info.get("relay_status")
        if relay.get("tried"):
            if relay.get("ok"):
                rows.append(_row("link", "Relay (TURN): reachable over %s" % (relay.get("proto") or "the network"),
                                 "If a direct path fails, drives fall back to the relay automatically.", "good"))
            else:
                rows.append(_row("link", "Relay (TURN): not reachable", "The relay didn't answer from here, so strict networks may fail.", "bad"))
        elif not info.get("signed_in"):
            rows.append(_row("link", "Relay (TURN): " + ("set up" if relay_status == "ok" else "not checked"),
                             "Sign in to test the relay from this network." if relay_status == "ok"
                             else "Sign in to test it. Without a relay, two strict networks can't connect.", "info"))
        else:
            rows.append(_row("link", "Relay (TURN): not set up in this app",
                             "Connections are direct only. Ask the app's admin to add a relay (Admin, Network).", "warn"))
        self.rows_panel.items = rows

        # the verdict
        relay_ok = bool(relay.get("ok"))
        if not res.get("webrtc"):
            title, text = "This browser can't drive", "Open Robo Presence in a recent Chrome, Edge, Firefox or Safari."
        elif not stun_ok and not relay_ok:
            title, text = "Driving will probably fail here", "This network blocks the paths live video needs. Try another Wi-Fi or your phone's hotspot."
        elif sym and not relay_ok:
            title, text = "Works only if the robot's network is easy", ("Your network is strict. A direct connection still works when the robot's Wi-Fi is easy; "
                                                                        "otherwise a relay is needed." + ("" if info.get("signed_in") else " Sign in to test the relay."))
        elif sym or not stun_ok:
            title, text = "Drives will use the relay", "Your network is strict, so video goes through the relay: it works, with a little more delay."
        elif server_ms >= 700:
            title, text = "Works, but slowly", "The path is fine, but this internet connection is slow. Lower the camera size in the Parts tab for smoother video."
        else:
            title, text = "Good to drive", "Direct connections should work from here. If a drive still fails, run this once on the robot's network too."
        self.verdict_title.text = title
        self.verdict_text.text = text
        self.relay_note.visible = False
        self.report = "Robo Presence connection check (%s)\n%s: %s\n" % (str(window.Date().toISOString())[:16].replace("T", " "), title, text) + \
            "\n".join("- %s. %s" % (x["title"], x["text"]) for x in rows) + \
            "\nPublic address: %s · check took %s ms" % (_mask(res.get("publicIp")), res.get("ms"))
        self.copy_button.visible = True

    @handle("copy_button", "click")
    def copy_button_click(self, **event_args):
        rp.copy(self.report, "The report")


def _row(icon, title, text, level):
    return {"icon": icon, "title": title, "text": text, "level": level}


def _mask(ip):
    """203.0.113.x: enough to tell networks apart in a report someone pastes in a forum, not the whole address."""
    if not ip:
        return "none"
    parts = str(ip).split(".")
    return ".".join(parts[:3] + ["x"]) if len(parts) == 4 else "hidden"
