from anvil import *

from ._anvil_designer import SessionRowTemplate
from ... import rp


class SessionRow(SessionRowTemplate):
    """A drive: item = Robots._session (pilot, role, state, created, duration_s, rtt_ms, fps, kbps, guest)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        s = self.item
        self.sub.text = (s.get("role") or "") + (" · guest pass" if s.get("guest") else "") + (" · " + s["state"] if s.get("state") != "ended" else "")
        self.when.text = rp.fmt_dt(s.get("created"))
        self.how_long.text = rp.dur(s.get("duration_s"))
        self.rtt.text = "%d ms" % round(s["rtt_ms"]) if s.get("rtt_ms") is not None else "–"
        fps = s.get("fps")
        self.video.text = ("%d fps" % round(fps) + (" · %d kbps" % round(s["kbps"]) if s.get("kbps") else "")) if fps else "–"
