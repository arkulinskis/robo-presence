from anvil import *
import anvil.js
from anvil.js import window

from ._anvil_designer import SharingTemplate
from ... import rp, state


class Sharing(SharingTemplate):
    """The Sharing tab (owner): invite pilots and viewers by email, and guest passes (a link that runs out; the new
    link is shown once)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.page = rp.loose(None)
        self.token = None
        self.share_role.items = [("Pilot (drive)", "pilot"), ("Viewer (watch)", "viewer")]
        self.pass_role.items = [("Drive", "pilot"), ("Watch", "viewer")]
        self.hours_box.items = [("1 hour", 1), ("4 hours", 4), ("1 day", 24), ("3 days", 72), ("1 week", 168)]
        self.hours_box.selected_value = 24
        state.set_control_attr(self.email_box, "autocomplete", "email")
        state.set_control_attr(self.label_box, "maxlength", 40)
        for box, label in ((self.share_role, "Role"), (self.pass_role, "Can"), (self.hours_box, "For how long")):
            state.set_control_attr(box, "aria-label", label)
        self.shares_panel.add_event_handler("x-changed", self._changed)
        self.passes_panel.add_event_handler("x-changed", self._changed)
        self.days = set(range(5))
        self.rules_dirty = False
        for box, label in ((self.start_box, "Visits from"), (self.end_box, "Visits until")):
            state.set_control_attr(box, "type", "time")
            state.set_control_attr(box, "aria-label", label)
        self.hours_on.add_event_handler("change", self._rules_changed)
        self.chime_box.add_event_handler("change", self._rules_changed)
        self.start_box.add_event_handler("change", self._rules_changed)
        self.end_box.add_event_handler("change", self._rules_changed)
        for minutes, b in ((30, self.pause30), (120, self.pause120), (480, self.pause480), (-1, self.pause_forever)):
            b.tag = minutes
            b.add_event_handler("click", self._pause_click)

    def show_robot(self, page):
        self.page = page
        R = page.R
        self.invite_text.text = "They see %s in their garage once they sign up or sign in with this email. Pilots drive; viewers watch." % R["name"]
        self.shares_panel.items = R.get("shares") or []
        self.no_shares.visible = not R.get("shares")
        self.passes_panel.items = R.get("passes") or []
        self.new_pass.visible = bool(self.token)
        if self.token:
            loc = window.location
            self.pass_link.command = str(loc.origin) + str(loc.pathname) + "#drive/pass/" + self.token
        self.token = None  # shown once
        self.show_rules(R)

    # ---- house rules (server_code/HouseRules.py)
    def show_rules(self, R):
        H = R.get("house") or {}
        st = R.get("visit_status") or {}
        is_open = st.get("open", True) is not False
        self.house_status.text = "Open for visits" if is_open else (st.get("short") or "Closed")
        self.house_status.role = ["badge", "hr-status", "badge-good" if is_open else "badge-warn"]
        h = H.get("hours") or {}
        if not self.rules_dirty:
            self.hours_on.checked = bool(h.get("on"))
            self.days = set(h.get("days") if h.get("days") is not None else range(5))
            self.start_box.text = h.get("start") or "09:00"
            self.end_box.text = h.get("end") or "20:00"
            self.chime_box.checked = H.get("chime", True) is not False
        self._draw_days()
        tz = str(window.Intl.DateTimeFormat().resolvedOptions().timeZone or "")
        saved = H.get("tz") or ""
        self.tz_note.text = ("Times are in %s." % (saved or tz or "your time zone")) + (
            " Saving switches them to %s (this device)." % tz if saved and tz and saved != tz else "")
        paused = bool(H.get("paused"))
        self.resume_button.visible = paused
        self.pause_text.text = (st.get("reason") or "") if paused else ""
        self.pause_text.visible = paused

    def _day_buttons(self):
        return [self.day0, self.day1, self.day2, self.day3, self.day4, self.day5, self.day6]

    def _draw_days(self):
        on = bool(self.hours_on.checked)
        for i, b in enumerate(self._day_buttons()):
            b.classes["on"] = i in self.days
            node = anvil.js.get_dom_node(b)
            node.setAttribute("aria-pressed", "true" if i in self.days else "false")
            if on:
                node.removeAttribute("disabled")
            else:
                node.setAttribute("disabled", "")
        self.start_box.enabled = on
        self.end_box.enabled = on

    def _rules_changed(self, **event_args):
        self.rules_dirty = True
        self._draw_days()

    def day_click(self, event):
        d = int(str(event.currentTarget.getAttribute("data-v")))
        if d in self.days:
            self.days.discard(d)
        else:
            self.days.add(d)
        self.rules_dirty = True
        self._draw_days()

    @handle("rules_button", "click")
    def rules_button_click(self, **event_args):
        if self.hours_on.checked and not self.days:
            state.toast("Pick at least one visiting day.", "error")
            return
        zone = window.Intl.DateTimeFormat().resolvedOptions()
        rules = {"hours": {"on": bool(self.hours_on.checked), "days": sorted(self.days),
                           "start": (self.start_box.text or "09:00").strip(), "end": (self.end_box.text or "20:00").strip()},
                 "tz": str(zone.timeZone or ""), "tz_offset": -int(window.Date().getTimezoneOffset()),
                 "chime": bool(self.chime_box.checked)}
        d = state.call("rules_save", self.page.R["id"], rules)
        if d:
            self.rules_dirty = False
            self.page.set_robot(d["robot"])
            state.toast("House rules saved.", "ok")

    def _pause_click(self, sender, **event_args):
        d = state.call("rules_pause", self.page.R["id"], sender.tag)
        if d:
            self.page.set_robot(d["robot"])
            n = d.get("ended") or 0
            state.toast("Visits paused." + (" %d visitor%s will be disconnected." % (n, "" if n == 1 else "s") if n else ""), "ok")

    @handle("resume_button", "click")
    def resume_button_click(self, **event_args):
        d = state.call("rules_pause", self.page.R["id"], 0)
        if d:
            self.page.set_robot(d["robot"])
            state.toast("Visits resumed.", "ok")

    def _changed(self, robot, **event_args):
        self.page.set_robot(robot)

    @handle("email_box", "pressed_enter")
    def email_box_pressed_enter(self, **event_args):
        self.invite_button_click()

    @handle("invite_button", "click")
    def invite_button_click(self, **event_args):
        email = (self.email_box.text or "").strip()
        d = state.call("share_add", self.page.R["id"], email, self.share_role.selected_value)
        if d:
            self.email_box.text = ""
            self.page.set_robot(d["robot"])
            state.toast("Invited %s." % email, "ok")

    @handle("make_button", "click")
    def make_button_click(self, **event_args):
        d = state.call("pass_create", self.page.R["id"], self.label_box.text or "", self.pass_role.selected_value, int(self.hours_box.selected_value or 24))
        if d:
            self.label_box.text = ""
            self.token = d.get("token")
            self.page.set_robot(d["robot"])
