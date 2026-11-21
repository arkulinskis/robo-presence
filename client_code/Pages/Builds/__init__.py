from anvil import *
import anvil.server

from ._anvil_designer import BuildsTemplate
from ... import state


class Builds(BuildsTemplate):
    """#builds (anyone): the gallery of public build sheets (Builds.builds_list) plus the showroom robots."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        d = anvil.server.call("builds_list")
        builds = d.get("builds") if isinstance(d, dict) and d.get("ok") else []
        self.builds_panel.items = builds or []
        self.loading.text = "" if builds else "No public builds yet. Be the first: share yours from your robot's Overview tab."
        self.loading.visible = not builds
        state.live(self.loading)
