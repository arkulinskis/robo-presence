from anvil import *

from ._anvil_designer import SimMiniTemplate
from ... import rp


class SimMini(SimMiniTemplate):
    """RP.miniSim(box) while shown; stopped when the page goes."""

    def __init__(self, **properties):
        self._mini = None
        super().__init__(**properties)

    @handle("", "show")
    def form_show(self, **event_args):
        self.stop()
        try:
            self._mini = rp.RP.miniSim(self.dom_nodes["box"])
        except Exception as e:
            print("mini simulator: %r" % e)

    @handle("", "hide")
    def form_hide(self, **event_args):
        self.stop()

    def stop(self):
        if self._mini is not None:
            m, self._mini = self._mini, None
            m.stop()
