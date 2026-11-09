from anvil import *
import anvil.server

from ._anvil_designer import DriveTemplate
from ... import router, rp, state

SIM = {"id": None, "name": "Garage simulator", "color": "orange", "manifest": None}


class Drive(DriveTemplate):
    """The cockpit, full screen (no app frame).
        #drive                  the simulator with the standard parts (anyone, no account)
        #drive/sim/<robot id>   the simulator with that robot's parts ("try my parts before I build them")
        #drive/<robot id>       a real robot, live over WebRTC (owner, pilot or viewer); showroom robots run the simulator
        #drive/pass/<token>     a guest pass: no account needed, asks the guest's name first
    The cockpit itself is the JavaScript engine (Components/Cockpit -> RP.openCockpit)."""

    waits = True  # the cockpit sets UI_READY once it has connected (router.show)

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.guest_part.visible = False
        self.args = list(args)
        self.me = state.me()
        self.back, self.back_label = ("#garage", "Garage") if self.me else ("#landing", "Home")
        self.cockpit.add_event_handler("ready", self._ready)
        self.token = None

    @handle("", "show")
    def form_show(self, **event_args):
        if getattr(self, "_started", False):
            return
        self._started = True
        a = self.args
        if not a:
            self._sim(SIM)
        elif a[0] == "pass" and len(a) > 1:
            self._guest(a[1])
        elif a[0] == "sim" and len(a) > 1:
            r = None
            if self.me:
                d = anvil.server.call("get_robot", a[1])
                r = d.get("robot") if d.get("ok") else None
            self._sim({"id": r["id"], "name": r["name"], "color": r["color"], "manifest": r["manifest"]} if r else SIM)
        else:
            d = anvil.server.call("drive_open", a[0])
            if not d.get("ok"):
                state.toast(d.get("error") or "That robot can't be driven.", "error")
                router.go("garage")
                return
            self._live(d, None, None)

    def _ready(self, **event_args):
        pass

    def _sim(self, robot, mode="sim"):
        name = robot.get("name") or "SIM"
        self.cockpit.start({
            "robot": robot, "mode": mode, "role": "owner",
            "back": ("#robot/" + robot["id"]) if robot.get("id") else self.back,
            "backLabel": robot["name"] if robot.get("id") else self.back_label,
            "sim": {"manifest": robot.get("manifest"), "pilot": (self.me or {}).get("name") or "You",
                    "label": name.upper()[:12] + " CAM"}})

    def _live(self, d, token, pilot):
        r = d["robot"]
        if r.get("demo"):
            self._sim({"id": None, "name": r["name"], "color": r["color"], "manifest": r["manifest"]}, "demo")
            return
        offline = None
        if not r.get("online"):
            offline = (r["name"] + " is offline" + (" (last seen " + state.ago(r["last_seen"]) + ")" if r.get("last_seen") else "")
                       + ". Switch it on and check its Wi-Fi; the page connects as soon as you try again.")
        cam = (r.get("manifest") or {}).get("camera") or {}
        self.cockpit.start({
            "robot": r, "mode": "live", "role": d.get("role"),
            "back": "#landing" if token else "#robot/" + r["id"], "backLabel": "Leave" if token else r["name"],
            "live": {"robotId": None if token else r["id"], "pass": token, "pilot": pilot, "ice": d.get("ice_servers"),
                     "audio": bool(cam.get("audio")), "offline": offline}})

    # ---- guest passes
    def _guest(self, token):
        self.token = token
        self.guest_part.visible = True
        p = anvil.server.call("pass_info", token)
        if not p.get("ok"):
            self.guest_art.show_robot("steel", eyes_on=False, tilt=-30)
            self.guest_title.text = "Pass not valid"
            self.guest_text.text = p.get("error") or ""
            self.guest_form.visible = False
            self._done()
            return
        r = p["robot"]
        viewer = p.get("role") == "viewer"
        self.guest_art.show_robot(r.get("color"), tilt=8)
        self.guest_title.text = r["name"]
        self.guest_text.text = "Guest pass, %s. %s invited you to %s their robot. The pass works until %s." % (
            "watch only" if viewer else "you can drive", r["owner"], "watch through" if viewer else "drive", rp.fmt_dt(p["expires"]))
        self.guest_lamp.show_robot({"online": r.get("online"), "paired": True})
        self.guest_name.text = state.store_get("guest_name", "") or ""
        state.set_control_attr(self.guest_name, "maxlength", 40)
        state.set_control_attr(self.guest_name, "autocomplete", "name")
        self.start_button.text = "Start watching" if viewer else "Start driving"
        self.sim_link.visible = False
        self._done()

    def _done(self):
        from anvil.js import window
        window.UI_READY = True

    @handle("guest_name", "pressed_enter")
    def guest_name_pressed_enter(self, **event_args):
        self.start_button_click()

    @handle("start_button", "click")
    def start_button_click(self, **event_args):
        name = (self.guest_name.text or "").strip()
        if not name:
            state.toast("Please type your name first.", "error")
            return
        state.store_set("guest_name", name)
        d = state.call("drive_open", None, self.token)
        if d:
            self.guest_part.visible = False
            self._live(d, self.token, name)

    def leave(self):
        self.cockpit.destroy()
