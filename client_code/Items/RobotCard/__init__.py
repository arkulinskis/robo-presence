import re

from anvil import *

from ._anvil_designer import RobotCardTemplate
from ... import router, rp, state


class RobotCard(RobotCardTemplate):
    """A robot in the garage (yours, shared with you, or a showroom robot): item = get_garage's card."""

    def __init__(self, **properties):
        super().__init__(**properties)
        r = self.item
        state.set_attr(self.card, "href", router.href("robot", r["id"]))
        state.set_attr(self.card, "aria-label", "Open %s" % r["name"])
        self.lamp.show_robot(r)
        role = r.get("role")
        self.role_badge.visible = role in ("pilot", "viewer")
        self.role_badge.text = (role or "").capitalize()
        if role == "pilot":
            self.role_badge.role = ["badge", "badge-brand", "gr-role"]
        on = bool(r.get("online"))
        self.art.show_robot(r.get("color"), pan=12 if on else -18, tilt=6 if on else -14, eyes_on=on or bool(r.get("demo")), small=True)
        model = r.get("model") or ""
        if model:
            model = re.sub(r" Rev [\d.]+$", "", model).replace(" Model B", "")
            if model.startswith("Raspberry Pi"):
                model = "Pi" + model[len("Raspberry Pi"):]
        sub = (model or rp.BOARDS.get(r.get("board"), "Robot")) + (" + Arduino" if r.get("board") == "pi_arduino" else "")
        self.sub_label.text = sub + (" · by " + r["owner"] if r.get("owner") else "")
        self.notes_label.text = r.get("notes") or ""
        self.notes_label.visible = bool(r.get("notes") and r.get("demo"))
        controls = r.get("controls") or []
        chips = []
        if "drive" in controls:
            chips.append({"icon": "wheel", "text": "wheels"})
        servos = len([t for t in controls if t == "servo"])
        if servos:
            chips.append({"icon": "servo", "text": state.plural(servos, "servo")})
        extra = len(controls) - (1 if "drive" in controls else 0) - servos
        if extra > 0:
            chips.append({"icon": "plug", "text": "%d more" % extra})
        if r.get("sensors"):
            chips.append({"icon": "gauge", "text": state.plural(r["sensors"], "sensor")})
        if r.get("battery") is not None:
            chips.append({"icon": "battery", "text": "%d%%" % r["battery"]})
        self.chips.items = chips
