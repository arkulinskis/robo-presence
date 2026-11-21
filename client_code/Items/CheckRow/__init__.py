from anvil import *

from ._anvil_designer import CheckRowTemplate


class CheckRow(CheckRowTemplate):
    """One result on the #check page: item = {icon, title, text, level: good | warn | bad | info}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.icon.classes.add("ic-" + (self.item.get("icon") or "info"))
        self.row.classes.add("nc-" + (self.item.get("level") or "info"))
