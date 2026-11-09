from anvil import *

from ._anvil_designer import LogLineTemplate


class LogLine(LogLineTemplate):
    """A line of robot mode's log: item = {text, level}; warnings and stops are red."""

    def __init__(self, **properties):
        super().__init__(**properties)
        if self.item.get("level") in ("warn", "stop"):
            self.label.role = ["bt-line", "bt-warn"]
