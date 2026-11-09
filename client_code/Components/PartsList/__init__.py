from anvil import *

from ._anvil_designer import PartsListTemplate
from ... import rp


class PartsList(PartsListTemplate):
    """The part cards. The config dict handed to set() is copied into JS; read() gives the parts back as Python."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self._cfg = rp.js_value({"board": "pi", "parts": []})
        hooks = rp.js_value({})
        hooks["changed"] = self._changed
        self._ed = rp.RP.partsEditor(self.dom_nodes["host"], hooks)

    def _changed(self, *args):
        self.raise_event("changed")

    def set(self, board, parts):
        self._cfg = rp.js_value({"board": board, "parts": parts or []})
        self._ed.set(self._cfg)

    def read(self):
        return rp.py_value(self._ed.read())

    def add(self, index):
        self._ed.add(index)

    def mark(self, problems):
        self._ed.mark(rp.js_value(problems or []))
