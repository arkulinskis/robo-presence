from anvil import *
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
