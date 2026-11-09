from anvil import *

from ._anvil_designer import LampTemplate
from ... import rp


class Lamp(LampTemplate):
    """A status lamp. show_robot(r) picks the colour and words from a robot dict (online, demo, paired, last_seen)."""

    def __init__(self, **properties):
        self._state = "off"
        super().__init__(**properties)

    def show_robot(self, r):
        self.state, self.text = rp.lamp(r)

    @property
    def text(self):
        return self.label.text

    @text.setter
    def text(self, v):
        self.label.text = v or ""

    @property
    def state(self):
        return self._state

    @state.setter
    def state(self, v):
        self._state = v or "off"
        for c in ("on", "off", "demo"):
            self.lamp.classes[c] = c == self._state
