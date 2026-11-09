from anvil import *

from ._anvil_designer import OverviewTemplate
from ... import router, rp, state


class Overview(OverviewTemplate):
    """The robot page's Overview tab: what the robot reports (= what the pilot gets), live sensors, facts, and (owner)
    name, paint, notes, unpair, delete."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.page = rp.loose(None)
        state.set_control_attr(self.name_box, "maxlength", 40)
        state.set_control_attr(self.name_box, "aria-label", "Name")
        state.set_control_attr(self.notes_box, "maxlength", 500)
        state.set_control_attr(self.notes_box, "aria-label", "Notes")

    def show_robot(self, page):
        self.page = page
        R = page.R
        name = R["name"]
        self.reports_title.text = ("What %s reports" % name) if R.get("reported") else "What its parts describe"
        state.heading(self.reports_title, 3)
        self.reports_text.text = ("The robot sends this list each time it starts (and when its parts change), so the cockpit always matches the hardware."
                                  if R.get("reported") else
                                  "The robot hasn't called in yet, so this comes from the Parts tab. Once it runs, it reports what really works.")
        self.gets_panel.items = rp.pilot_gets(R.get("manifest"))
        self.show_gauges(R)
        info = R.get("info") or {}
        m = R.get("manifest") or {}
        status = ("online" if R.get("online") else
                  ("offline" + (", seen " + state.ago(R["last_seen"]) if R.get("last_seen") else "")) if R.get("paired") else "not paired yet")
        facts = [("Status", status), ("Computer", info.get("model")), ("Robot code", info.get("version")), ("Host name", info.get("host")),
                 ("Local IP", info.get("ip")), ("Camera", info.get("camera") or (m.get("camera") or {}).get("source")),
                 ("System", info.get("platform")), ("Parts version", R.get("config_rev")),
                 ("Owner", R.get("owner") or ("you" if page.owner() else ""))]
        self.facts_panel.items = [{"k": k, "v": str(v)} for k, v in facts if v not in (None, "")]
        self.edit_card.visible = page.owner()
        if page.owner():
            self.name_box.text = name
            self.paint.value = R.get("color") or "orange"
            self.notes_box.text = R.get("notes") or ""
            self.unpair_button.enabled = bool(R.get("paired"))

    def show_gauges(self, R):
        sensors = rp.split(R.get("manifest"))["sensors"]
        tel = R.get("telemetry") or {}
        self.sensors_card.visible = bool(sensors)
        self.live_lamp.visible = bool(R.get("online"))
        self.gauges_panel.items = [{"s": s, "v": tel.get(s.get("id"))} for s in sensors]
        self.last_readings.text = ("Last readings, from %s." % state.ago(R.get("last_seen"))) if not R.get("online") and tel else ""
        self.last_readings.visible = bool(self.last_readings.text)

    @handle("save_button", "click")
    def save_button_click(self, **event_args):
        R = self.page.R
        d = state.call("update_robot", R["id"], {"name": self.name_box.text, "color": self.paint.value, "notes": self.notes_box.text})
        if d:
            self.page.set_robot(d["robot"])
            state.toast("Saved.", "ok")

    @handle("unpair_button", "click")
    def unpair_button_click(self, **event_args):
        R = self.page.R
        if confirm("It stops calling in, and needs a new install code (robopresence pair CODE) to come back.",
                   title="Unpair %s?" % R["name"], buttons=[("Cancel", False), ("Unpair", True)], role="app-dialog"):
            d = state.call("unpair_robot", R["id"])
            if d:
                self.page.set_robot(d["robot"])
                state.toast("Unpaired.", "ok")

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        R = self.page.R
        if confirm("Its parts, passes and logs are deleted. The robot itself keeps its code but can't call in any more.",
                   title="Delete %s?" % R["name"], buttons=[("Cancel", False), ("Delete", True)], role="app-dialog"):
            if state.call("delete_robot", R["id"]):
                state.toast("Deleted.", "ok")
                router.go("garage")
