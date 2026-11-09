from anvil import *

from ._anvil_designer import RobotArtTemplate
from ... import rp


class RobotArt(RobotArtTemplate):
    """The robot picture (RP.robotArt). Every property redraws it."""

    def __init__(self, **properties):
        self._o = {"color": "orange", "pan": 0, "tilt": 0, "eyes_on": True, "lights": False, "arms": True, "small": False}
        self._ready = False
        super().__init__(**properties)
        self._ready = True
        self._draw()

    def _draw(self):
        if not self._ready:
            return
        o = self._o
        self.dom_nodes["box"].innerHTML = rp.art(o["color"], pan=o["pan"] or 0, tilt=o["tilt"] or 0,
                                                 eyes="on" if o["eyes_on"] else "off", lights=bool(o["lights"]),
                                                 arms=bool(o["arms"]), small=bool(o["small"]))

    def show_robot(self, color, **opts):
        """Set several properties at once: show_robot("olive", pan=12, eyes_on=False)."""
        self._o["color"] = color or "orange"
        self._o.update(opts)
        self._draw()

    def _set(self, k, v):
        self._o[k] = v
        self._draw()

    @property
    def color(self):
        return self._o["color"]

    @color.setter
    def color(self, v):
        self._set("color", v or "orange")

    @property
    def pan(self):
        return self._o["pan"]

    @pan.setter
    def pan(self, v):
        self._set("pan", v or 0)

    @property
    def tilt(self):
        return self._o["tilt"]

    @tilt.setter
    def tilt(self, v):
        self._set("tilt", v or 0)

    @property
    def eyes_on(self):
        return self._o["eyes_on"]

    @eyes_on.setter
    def eyes_on(self, v):
        self._set("eyes_on", bool(v))

    @property
    def lights(self):
        return self._o["lights"]

    @lights.setter
    def lights(self, v):
        self._set("lights", bool(v))

    @property
    def arms(self):
        return self._o["arms"]

    @arms.setter
    def arms(self, v):
        self._set("arms", bool(v))

    @property
    def small(self):
        return self._o["small"]

    @small.setter
    def small(self, v):
        self._set("small", bool(v))
