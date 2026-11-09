from anvil import *

from ._anvil_designer import ShareRowTemplate
from ... import state


class ShareRow(ShareRowTemplate):
    """Someone the robot is shared with: item = {id, email, role, joined, name}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        s = self.item
        self.who.text = s.get("name") or s.get("email") or ""
        self.email.text = s.get("email") or ""
        self.email.visible = bool(s.get("name"))
        self.role_badge.text = s.get("role") or ""
        if s.get("role") == "pilot":
            self.role_badge.role = ["badge", "badge-brand"]
        self.invited.visible = not s.get("joined")
        state.set_control_attr(self.remove_button, "aria-label", "Remove %s" % self.who.text)

    @handle("remove_button", "click")
    def remove_button_click(self, **event_args):
        d = state.call("share_remove", self.item["id"])
        if d and self.parent is not None:
            state.toast("Removed.", "ok")
            self.parent.raise_event("x-changed", robot=d["robot"])
