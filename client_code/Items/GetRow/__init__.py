from anvil import *

from ._anvil_designer import GetRowTemplate


class GetRow(GetRowTemplate):
    """One line of "What the pilot gets": item = {icon, text, bad}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.icon.classes.add("ic-" + (self.item.get("icon") or "info"))
        self.row.classes["bad"] = bool(self.item.get("bad"))
