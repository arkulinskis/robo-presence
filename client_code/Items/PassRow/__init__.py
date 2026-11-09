from anvil import *

from ._anvil_designer import PassRowTemplate
from ... import rp, state


class PassRow(PassRowTemplate):
    """A guest pass: item = {id, label, role, expires, uses, last_used, active}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        p = self.item
        last = ", last " + state.ago(p["last_used"]) if p.get("last_used") else ""
        self.sub.text = "%s · used %d×%s" % ("watch" if p.get("role") == "viewer" else "drive", p.get("uses") or 0, last)
        if p.get("active"):
            self.until.text = "until " + rp.fmt_dt(p.get("expires"))
            self.until.role = ["badge", "badge-good"]
        else:
            self.until.text = "ended"
        self.revoke_button.visible = bool(p.get("active"))
        state.set_control_attr(self.revoke_button, "aria-label", "Revoke the pass for %s" % (p.get("label") or "this guest"))

    @handle("revoke_button", "click")
    def revoke_button_click(self, **event_args):
        if confirm("The link stops working at once, and anyone using it is disconnected.", title="Revoke this pass?",
                   buttons=[("Cancel", False), ("Revoke", True)], role="app-dialog"):
            d = state.call("pass_revoke", self.item["id"])
            if d and self.parent is not None:
                self.parent.raise_event("x-changed", robot=d["robot"])
