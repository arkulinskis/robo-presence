from anvil import *

from ._anvil_designer import ChipTemplate


class Chip(ChipTemplate):
    """A small parts chip: item = {icon, text}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.icon.classes.add("ic-" + (self.item.get("icon") or "chip"))
