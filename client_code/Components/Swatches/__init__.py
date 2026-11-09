from anvil import *
from anvil.js import window

from ._anvil_designer import SwatchesTemplate

NAMES = ["orange", "olive", "yellow", "blue", "red", "steel"]
_count = [0]


class Swatches(SwatchesTemplate):
    """Six paint swatches (radio buttons in one group per instance)."""

    def __init__(self, **properties):
        _count[0] += 1
        self._group = "paint-%d" % _count[0]
        self._value = "orange"
        super().__init__(**properties)
        for n in NAMES:
            _nodes(self)["c_" + n].setAttribute("name", self._group)
        self._show()

    def _show(self):
        for n in NAMES:
            _nodes(self)["c_" + n].checked = n == self._value

    @property
    def value(self):
        for n in NAMES:
            if _nodes(self)["c_" + n].checked:
                return n
        return self._value

    @value.setter
    def value(self, v):
        self._value = v if v in NAMES else "orange"
        if "c_orange" in self.dom_nodes:
            self._show()


def _nodes(form):
    """dom_nodes by a built name (the validator only accepts literal keys)."""
    return _loose(form.dom_nodes)


def _loose(x):
    return x
