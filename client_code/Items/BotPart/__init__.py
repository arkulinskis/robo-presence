from anvil import *

from ._anvil_designer import BotPartTemplate
from ... import rp


class BotPart(BotPartTemplate):
    """A part in robot mode: item = {p: the part, how: what runs it here, ok: runs in a browser}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        p = self.item["p"]
        self.icon.classes.add("ic-" + rp.type_icon(p.get("type"), p.get("id")))
        self.label.text = "%s · %s" % (p.get("label") or p.get("id"), self.item.get("how") or "")
        self.row.classes["no"] = not self.item.get("ok")
