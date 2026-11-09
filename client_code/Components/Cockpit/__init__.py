from anvil import *
from anvil.js import window

from ._anvil_designer import CockpitTemplate
from ... import rp


class Cockpit(CockpitTemplate):
    """RP.openCockpit(host, options) on start(); destroy() stops the link, the keys and the gamepad.
    options = {robot, mode, role, back, backLabel, sim: {...} or live: {...}} (see rp-cockpit.js)."""

    def __init__(self, **properties):
        self._ctl = None
        super().__init__(**properties)

    def start(self, options):
        self.destroy()
        self._ctl = rp.RP.openCockpit(self.dom_nodes["host"], rp.js_value(options))
        self._ctl.ready.then(self._ready, self._ready)

    def _ready(self, *args):
        window.UI_READY = True
        self.raise_event("ready")

    @handle("", "hide")
    def form_hide(self, **event_args):
        self.destroy()

    def destroy(self):
        if self._ctl is not None:
            ctl, self._ctl = self._ctl, None
            ctl.destroy()
