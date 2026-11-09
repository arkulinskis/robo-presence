from anvil import *

from ._anvil_designer import LogTemplate


class Log(LogTemplate):
    """The Log tab: drives (who, when, how long, round trip, video) and the robot's own events."""

    def __init__(self, **properties):
        super().__init__(**properties)

    def show_robot(self, page):
        R = page.R
        self.sessions_panel.items = R.get("sessions") or []
        self.sessions_part.visible = bool(R.get("sessions"))
        self.no_sessions.visible = not R.get("sessions")
        self.events_panel.items = R.get("events") or []
        self.no_events.visible = not R.get("events")
