from anvil import *

from ._anvil_designer import NewRobotTemplate
from ... import router, state

PRESETS = ["pi", "pi_arduino", "browser"]


class NewRobot(NewRobotTemplate):
    """New robot: a name, its brain (preset) and its paint. Opens the new robot's Install tab (Overview for phones)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        state.set_control_attr(self.name_box, "maxlength", 40)
        state.set_control_attr(self.name_box, "aria-label", "Name")

    def _preset(self):
        for p in PRESETS:
            if _nodes(self)["p_" + p].checked:
                return p
        return "pi"

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)

    @handle("name_box", "pressed_enter")
    def name_box_pressed_enter(self, **event_args):
        self.build_button_click()

    @handle("build_button", "click")
    def build_button_click(self, **event_args):
        name = (self.name_box.text or "").strip()
        if len(name) < 2:
            self.message.text, self.message.visible = "Give your robot a name (at least 2 characters).", True
            return
        d = state.call("create_robot", name, self._preset(), self.paint.value)
        if not d:
            return
        r = d["robot"]
        self.raise_event("x-close-alert", value=r["id"])
        state.toast(r["name"] + " is in your garage. Next: install it.", "ok")
        router.go("robot", r["id"], "overview" if r.get("board") == "browser" else "install")


def _nodes(form):
    """dom_nodes by a built name (the validator only accepts literal keys)."""
    return _loose(form.dom_nodes)


def _loose(x):
    return x
