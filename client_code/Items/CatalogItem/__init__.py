from anvil import *

from ._anvil_designer import CatalogItemTemplate


class CatalogItem(CatalogItemTemplate):
    """A part you can add (RP.CATALOG): item = {index, icon, name, text}. Raises x-add on its panel."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.icon.classes.add("ic-" + (self.item.get("icon") or "plug"))

    def pick_click(self, event):
        if self.parent is not None:
            self.parent.raise_event("x-add", index=self.item["index"])
