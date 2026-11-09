from anvil import *

from ._anvil_designer import InstallTemplate
from ... import router, rp, state


class Install(InstallTemplate):
    """The Install tab (owner): flash, ssh, the one-line install with a live "waiting for the robot" box, the Arduino
    sketch (its CONFIG block filled from the parts by RP.sketch), wire and test. Step numbers follow the steps shown."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.page = rp.loose(None)

    def show_robot(self, page):
        self.page = page
        R = page.R
        cfg = R.get("config") or {}
        I = R.get("install") or {}
        name = R["name"]
        host = rp.slug(name)
        browser = R.get("board") == "browser"
        ard = any(p.get("driver") == "arduino" for p in cfg.get("parts") or []) or R.get("board") == "pi_arduino"
        self.step_browser.visible = browser
        state.set_attr(self.bot_link, "href", router.href("bot", R["id"]))
        self.host_label.text = host
        self.ssh_cmd.command = "ssh <user>@%s.local" % host
        code = I.get("code")
        self.with_code.visible = bool(code)
        self.paired_part.visible = not code and bool(I.get("pi_paired"))
        self.no_code.visible = not code and not I.get("pi_paired")
        self.new_card_line.visible = self.paired_part.visible
        self.wait_box.visible = bool(code) or bool(I.get("pi_paired"))
        if code:
            self.code_text.text = ("Paste this into the Pi. It installs everything (a few minutes the first time), pairs the robot with your "
                                   "account and starts it. The code %s works once, until %s." % (code, rp.fmt_dt(I.get("expires"))))
            self.install_cmd.command = I.get("cmd") or ""
        if self.paired_part.visible:
            since = " (since %s)" % rp.fmt_date(I["paired_at"]) if I.get("paired_at") else ""
            self.paired_text.text = "%s is paired%s. To update its code later, run this on the robot:" % (name, since)
        online = bool(R.get("online"))
        self.wait_box.classes["ok"] = online
        self.wait_art.show_robot(R.get("color"), eyes_on=online, arms=False, small=True)
        self.wait_title.text = ("%s is online." % name) if online else ("Waiting for %s to call in…" % name)
        self.wait_text.text = ("It called in %s." % state.ago(R.get("last_seen"))) if online else "This turns green by itself when the install finishes."
        self.wait_drive.visible = online
        state.set_attr(self.wait_drive, "href", router.href("drive", R["id"]))
        self.step_arduino.visible = ard
        state.set_attr(self.parts_link, "href", router.href("robot", R["id"], "parts"))
        n = 0
        for step, label in ((self.step_browser, self.n_browser), (None, self.n_flash), (None, self.n_ssh), (None, self.n_install),
                            (self.step_arduino, self.n_arduino), (None, self.n_wire)):
            if step is None or step.visible:
                n += 1
                label.text = str(n)
        if ard:
            try:
                self.dom_nodes["sketch"].textContent = self._sketch()  # RP.sketch fetches the template once (a JS promise, awaited)
            except Exception as e:
                self.dom_nodes["sketch"].textContent = "The sketch didn't load (%s)." % e

    def _sketch(self):
        R = self.page.R
        return str(rp.RP.sketch(rp.js_value(R.get("config") or {}), R["name"]))

    def _new_code(self):
        d = state.call("new_install_code", self.page.R["id"])
        if d:
            self.page.waiting = True
            self.page.set_robot(d["robot"])
            state.toast("New install code: " + (d["robot"].get("install") or {}).get("code", ""), "ok")

    @handle("newcode_button", "click")
    def newcode_button_click(self, **event_args):
        self._new_code()

    @handle("newcard_button", "click")
    def newcard_button_click(self, **event_args):
        self._new_code()

    @handle("makecode_button", "click")
    def makecode_button_click(self, **event_args):
        self._new_code()

    @handle("copysketch_button", "click")
    def copysketch_button_click(self, **event_args):
        rp.copy(self._sketch(), "Sketch")

    @handle("dlsketch_button", "click")
    def dlsketch_button_click(self, **event_args):
        rp.RP.download("robopresence_bridge.ino", self._sketch())
