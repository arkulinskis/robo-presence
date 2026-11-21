from anvil import *

from ._anvil_designer import BuildCardTemplate
from ... import router, state


class BuildCard(BuildCardTemplate):
    """A build in the #builds gallery: item = Builds._summary (id, name, color, maker, board_label, parts, types, story, demo)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        b = self.item
        state.set_attr(self.card, "href", router.href("build", b["id"]))
        state.set_attr(self.card, "aria-label", "Build sheet: %s" % b["name"])
        self.art.show_robot(b.get("color"), pan=12, tilt=6, eyes_on=True, small=True)
        self.demo_badge.visible = bool(b.get("demo"))
        self.sub_label.text = "%s · by %s" % (b.get("board_label") or "Robot", b.get("maker") or "a maker")
        self.story_label.text = b.get("story") or ""
        self.story_label.visible = bool(b.get("story"))
        types = b.get("types") or []
        chips = [{"icon": "cpu", "text": state.plural(b.get("parts") or 0, "part")}]
        if "drive" in types:
            chips.append({"icon": "wheel", "text": "wheels"})
        servos = len([x for x in types if x == "servo"])
        if servos:
            chips.append({"icon": "servo", "text": state.plural(servos, "servo")})
        sensors = len([x for x in types if x in ("gauge", "distance")])
        if sensors:
            chips.append({"icon": "gauge", "text": state.plural(sensors, "sensor")})
        self.chips.items = chips
