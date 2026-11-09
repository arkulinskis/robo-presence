from anvil import *

from ._anvil_designer import EventRowTemplate
from ... import rp, state

EVENT_ICON = {"online": "signal", "offline": "signal", "paired": "link", "config": "wrench", "drive": "joystick", "stop": "stop",
              "warn": "info", "info": "info"}


class EventRow(EventRowTemplate):
    """A robot log line: item = {kind, text, at}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        kind = self.item.get("kind") or "info"
        self.icon.classes.add("ic-" + EVENT_ICON.get(kind, "info"))
        self.row.classes[kind] = True
        self.when.text = state.ago(self.item.get("at"))
        state.set_attr(self.when, "title", rp.fmt_dt(self.item.get("at")))
