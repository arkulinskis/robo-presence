from anvil import *

from ._anvil_designer import GaugeRowTemplate
from ... import rp


class GaugeRow(GaugeRowTemplate):
    """A sensor gauge: item = {s: the sensor's manifest entry, v: its latest value}. Same maths as RP.gauge."""

    def __init__(self, **properties):
        super().__init__(**properties)
        s, v = self.item["s"], self.item.get("v")
        self.icon.classes.add("ic-" + rp.type_icon(s.get("type"), s.get("id")))
        self.name_label.text = s.get("label") or s.get("id") or ""
        js = rp.js_value(s)
        self.value_label.text = str(rp.RP.fmtValue(js, v))
        level = str(rp.RP.sensorLevel(js, v))
        self.gauge.classes["warn"] = level == "warn"
        self.gauge.classes["bad"] = level == "bad"
        lo = s.get("min") if s.get("min") is not None else 0
        hi = s.get("max") if s.get("max") is not None else (200 if s.get("type") == "distance" else 100)
        pct = max(0, min(100, (v - lo) / float((hi - lo) or 1) * 100)) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0
        self.fill.style["width"] = "%d%%" % pct
        self.error_label.text = s.get("error") or ""
        self.error_label.visible = bool(s.get("error"))
