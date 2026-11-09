from anvil import *

from ._anvil_designer import GarageTemplate
from ... import state


class Garage(GarageTemplate):
    """#garage (Operate): the home page after signing in. Your robots, robots shared with you, the simulator card (a
    live miniature), the showroom (demo robots everyone can try), and New robot."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        state.heading(self.title, 1)
        d: dict = state.call("get_garage") or {"mine": [], "shared": [], "showroom": [], "max": 12}
        mine = d["mine"]
        first = ((state.me() or {}).get("name") or "").split(" ")[0]
        self.title.text = "Your robots" if mine else "Hello, %s" % first
        self.lead.text = (state.plural(len(mine), "robot") + " in your garage. Open one to drive it, change its parts or install it."
                          if mine else "Build your first robot: pick its brain, then install it with one command.")
        self.mine_panel.items = mine
        self.new_tile.visible = len(mine) < d["max"]
        self.new_tile_title.text = "Add a robot" if mine else "Build your first robot"
        self.shared_panel.items = d["shared"]
        self.shared_part.visible = bool(d["shared"])
        self.showroom_panel.items = d["showroom"]
        self.showroom_part.visible = bool(d["showroom"])

    def _new(self):
        from ...Dialogs.NewRobot import NewRobot
        alert(NewRobot(), buttons=[], role="app-dialog", dismissible=True)

    @handle("new_button", "click")
    def new_button_click(self, **event_args):
        self._new()

    def new_tile_click(self, event):
        self._new()

    def leave(self):
        self.mini.stop()
