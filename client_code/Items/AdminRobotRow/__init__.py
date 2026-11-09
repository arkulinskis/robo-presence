from anvil import *

from ._anvil_designer import AdminRobotRowTemplate
from ... import rp


class AdminRobotRow(AdminRobotRowTemplate):
    """A robot in Admin -> Robots: item = Admin.admin_robots row (no camera access, only names and status)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        r = self.item
        self.demo.visible = bool(r.get("demo"))
        self.sub.text = (r.get("model") or "") + (" · code " + r["version"] if r.get("version") else "")
        self.sub.visible = bool(self.sub.text)
        self.email.visible = bool(r.get("email"))
        self.lamp.show_robot({"online": r.get("online"), "last_seen": r.get("last_seen"), "paired": bool(r.get("last_seen"))})
        self.brain.text = "%s · %d parts" % (rp.BOARDS.get(r.get("board"), r.get("board")), r.get("parts") or 0)
        self.drives.text = str(r.get("sessions") or 0)
