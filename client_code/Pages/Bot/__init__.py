from anvil import *
import anvil.server
from anvil.js import window

from ._anvil_designer import BotTemplate
from ... import router, rp, state

CAMS = ["sim", "user", "environment"]


class Bot(BotTemplate):
    """#bot/<robot id> (Operate): robot mode. This browser tab becomes the robot: it calls the same bot API as the
    Python robot (BotApi.py), answers pilots over WebRTC with this device's camera or the simulator's garage, and runs
    the parts (simulated here, "arduino" ones over USB with Web Serial). The engine is RP.BotRunner (rp-bot.js);
    this page draws the camera choice, status, pilots, parts and the log around it."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.cam = "sim"
        self.logs = []
        self.runner = None
        self.main.visible = False
        self.denied.visible = False
        d = anvil.server.call("get_robot", args[0] if args else "")
        if not d.get("ok") or d["robot"].get("role") != "owner":
            self.denied.visible = True
            return
        self.R = d["robot"]
        R = self.R
        self.main.visible = True
        state.set_attr(self.back_link, "href", router.href("robot", R["id"]))
        self.back_label.text = R["name"]
        state.set_attr(self.parts_link, "href", router.href("robot", R["id"], "parts"))
        self.title.text = "This device is " + R["name"]
        state.heading(self.title, 1)
        self.idle_art.show_robot(R.get("color"), eyes_on=False, small=True)
        plan = rp.py_value(rp.RP.botPlan(rp.js_value(R))) or []
        self.parts_panel.items = plan
        self.arduino_box.visible = any(x["p"].get("driver") == "arduino" for x in plan)
        self._show_cam()
        self._status()
        window.RP_BOT = rp.js_value({})
        window.RP_BOT.state = self._state

    def _state(self, *a):
        return self.runner.state() if self.runner is not None else None

    # ---- camera choice
    def cam_click(self, event):
        if self.runner is not None and self.runner.running():
            return
        self.cam = str(event.currentTarget.getAttribute("data-v"))
        self._show_cam()

    def _show_cam(self):
        for c, el in zip(CAMS, [self.cam_sim, self.cam_user, self.cam_environment]):
            el.classes["on"] = c == self.cam

    # ---- the log and the status box
    def _log(self, text, level="info"):
        when = str(window.Date().toLocaleTimeString([], rp.js_value({"hour12": False})))
        self.logs.insert(0, {"text": when + " " + str(text), "level": str(level or "info")})
        self.logs = self.logs[:60]
        self.log_panel.items = self.logs

    def _status(self, *args):
        on = self.runner is not None and self.runner.running()
        self.lamp.show_robot({"online": on, "paired": True})
        self.status_note.text = "Pilots can connect now." if on else ""
        peers = rp.py_value(self.runner.peers()) if self.runner is not None else []
        self.pilots_panel.items = [{"icon": "eye" if p.get("role") == "viewer" else "joystick",
                                    "text": p.get("pilot", "") + (" · driving" if p.get("driving") else "")} for p in peers or []]
        if on and not peers:
            self.status_note.text = "Pilots can connect now. No pilots yet."
        self.start_button.visible = not on
        self.stop_button.visible = on

    def _claim(self, *args):
        d = anvil.server.call("tab_claim", self.R["id"])
        if not d.get("ok"):
            raise Exception(d.get("error") or "This robot can't run here.")
        return rp.js_value({"token": d["token"]})

    # ---- start / stop
    @handle("start_button", "click")
    def start_button_click(self, **event_args):
        opts = rp.js_value({"camera": self.cam, "arduino": bool(self.arduino_box.visible and self.arduino_box.checked)})
        opts["claim"] = self._claim
        opts["onLog"] = self._log
        opts["onChange"] = self._status
        self.runner = rp.RP.BotRunner(rp.js_value(self.R), opts)
        self.start_button.enabled = False
        try:
            self.runner.start()
        except Exception as e:
            msg = str(getattr(e, "message", "") or e)
            self._log(msg, "warn")
            state.toast(msg, "error")
            self.runner = None
            self.start_button.enabled = True
            self._status()
            return
        self.start_button.enabled = True
        self.idle.visible = False
        self.screen_label.text = str(self.runner.label).upper()[:30]
        rp.RP.showStream(self.dom_nodes["screen"], self.runner.stream)
        self._status()
        state.toast(self.R["name"] + " is online in this tab.", "ok")

    @handle("stop_button", "click")
    def stop_button_click(self, **event_args):
        self.stop()

    def stop(self):
        if self.runner is None:
            return
        r, self.runner = self.runner, None
        r.stop()
        rp.RP.showStream(self.dom_nodes["screen"], None)
        self.idle.visible = True
        self.screen_label.text = "CAMERA"
        self._status()

    def leave(self):
        self.stop()
        window.RP_BOT = None
