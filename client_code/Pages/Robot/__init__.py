from anvil import *
import anvil.server
from anvil.js import window

from ._anvil_designer import RobotTemplate
from ... import router, rp, state

TABS = ["overview", "parts", "install", "sharing", "log"]
OWNER_ONLY = ("install", "sharing")


class Robot(RobotTemplate):
    """#robot/<id>/<tab> (Operate): one robot. The hero (picture, status, parts chips, Drive) and five tabs, each its
    own Form in client_code/Tabs: overview, parts (the builder), install, sharing, log. Owners edit; pilots and viewers
    see status and drive; showroom robots are read-only. While open it polls robot_status every 3 s (the lamp, the
    gauges, and "is it online yet?" on the Install tab)."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.R = rp.loose(None)
        self.waiting = False
        self._poll = None
        self.tab = args[1] if len(args) > 1 and args[1] in TABS else "overview"
        self.main.visible = False
        self.missing.visible = False
        d = anvil.server.call("get_robot", args[0] if args else "")
        if not d.get("ok"):
            self.missing.visible = True
            self.missing_text.text = d.get("error") or ""
            return
        self.R = d["robot"]
        if not self.owner() and self.tab in OWNER_ONLY:
            self.tab = "overview"
        self.waiting = self.tab == "install" and not self.R.get("online")
        self.main.visible = True
        state.heading(self.name_title, 1)
        self.draw()
        if not self.R.get("demo"):
            self._poll = window.setInterval(self._tick, 3000)

    def owner(self):
        return bool(self.R and self.R.get("role") == "owner")

    def tabs(self):
        return {"overview": self.overview, "parts": self.parts, "install": self.install, "sharing": self.sharing, "log": self.log}

    def set_robot(self, robot):
        """After an action: the server's fresh robot, redrawn."""
        self.R = robot
        self.draw()

    def draw(self):
        self.draw_hero()
        R, tabs = self.R, self.tabs()
        links = {"overview": self.tab_overview, "parts": self.tab_parts, "install": self.tab_install,
                 "sharing": self.tab_sharing, "log": self.tab_log}
        for name in TABS:
            links[name].visible = self.owner() or name not in OWNER_ONLY
            links[name].classes["on"] = name == self.tab
            state.set_attr(links[name], "href", router.href("robot", R["id"], name))
            if name == self.tab:
                state.set_attr(links[name], "aria-current", "page")
            tabs[name].visible = name == self.tab
        tabs[self.tab].show_robot(self)

    def draw_hero(self):
        R = self.R
        demo, online = bool(R.get("demo")), bool(R.get("online"))
        self.art.show_robot(R.get("color"), eyes_on=online or demo, pan=14, tilt=6)
        self.lamp.show_robot(R)
        self.board_badge.text = rp.BOARDS.get(R.get("board"), "Robot")
        self.role_badge.visible = R.get("role") not in ("owner", "demo") and not demo
        self.role_badge.text = R.get("role") or ""
        self.owner_badge.visible = demo
        self.owner_badge.text = "Built by %s" % (R.get("owner") or "")
        self.name_title.text = R["name"]
        self.notes_label.text = R.get("notes") or ""
        self.notes_label.visible = bool(R.get("notes"))
        self.chips.items = [{"icon": rp.type_icon(c.get("type"), c.get("id")), "text": c.get("label") or c.get("id")}
                            for c in (R.get("manifest") or {}).get("controls") or []]
        viewer = R.get("role") == "viewer"
        state.set_attr(self.drive_link, "href", router.href("drive", R["id"]))
        self.drive_text.text = "Drive it (simulator)" if demo else ("Watch" if viewer else "Drive")
        self.drive_icon.classes["ic-eye"] = viewer and not demo
        self.drive_icon.classes["ic-joystick"] = not (viewer and not demo)
        state.set_attr(self.sim_link, "href", router.href("drive", "sim", R["id"]))
        self.bot_link.visible = self.owner()
        state.set_attr(self.bot_link, "href", router.href("bot", R["id"]))

    def drive_click(self, event):
        R = self.R
        if R and not R.get("online") and not R.get("demo"):
            event.preventDefault()
            state.toast(R["name"] + " is offline. Switch it on (or finish the Install steps) first.", "error")

    # ---- live status
    def _tick(self):
        if self.R is None or window.document.hidden:
            return
        s = state.call_quiet("robot_status", self.R["id"])
        if not s or not isinstance(s, dict) or s.get("ok") is False:
            return
        R = self.R
        was = R.get("online")
        R["online"], R["last_seen"], R["telemetry"], R["paired"] = s.get("online"), s.get("last_seen"), s.get("telemetry"), s.get("paired")
        if s.get("reported"):
            R["manifest"], R["reported"] = s.get("manifest"), True
        if was != s.get("online") or (self.tab == "install" and s.get("online") and self.waiting):
            if s.get("online") and not was and (self.tab == "install" or self.waiting):
                state.toast(R["name"] + " is online!", "ok")
                rp.RP.beep(660, 90)
                window.setTimeout(lambda: rp.RP.beep(990, 140), 110)
                self.waiting = False
            if self.tab == "parts" and self.parts.dirty:
                self.lamp.show_robot(R)
            else:
                self.draw()
        elif self.tab == "overview":
            self.overview.show_gauges(R)

    def leave(self):
        if self._poll is not None:
            window.clearInterval(self._poll)
            self._poll = None
        self.parts.leave()
