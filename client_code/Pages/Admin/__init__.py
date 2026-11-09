import json

from anvil import *

from ._anvil_designer import AdminTemplate
from ... import state

TABS = ["overview", "robots", "network", "feedback", "users", "demo"]


class Admin(AdminTemplate):
    """#admin/<tab>: overview numbers, every robot, the network settings (ICE servers, check-in speeds, robot code
    download), the old feedback inbox, users (admin / active switches) and the demo data.
    Each tab is its own address, so the browser's back button works."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.tab = args[0] if args and args[0] in TABS else "overview"
        self._filter = "new"
        parts = {"overview": self.overview_part, "robots": self.robots_part, "network": self.network_part, "feedback": self.feedback_part,
                 "users": self.users_part, "demo": self.demo_part}
        tabs = {"overview": self.tab_overview, "robots": self.tab_robots, "network": self.tab_network, "feedback": self.tab_feedback,
                "users": self.tab_users, "demo": self.tab_demo}
        for name in TABS:
            parts[name].visible = name == self.tab
            tabs[name].classes["on"] = name == self.tab
        self.feedback_panel.add_event_handler("x-changed", self._feedback_changed)
        getattr(self, "_" + self.tab)()

    # ---- overview
    def _overview(self):
        d = state.call("admin_overview")
        self.s_users.text, self.s_admins.text = str(d["users"]), str(d["admins"])
        self.s_admins_label.text = "admin" if d["admins"] == 1 else "admins"
        self.s_feedback.text = str(d["feedback_new"])
        self.s_robots.text, self.s_online.text, self.s_drives.text = str(d["robots"]), str(d["online"]), str(d["sessions_week"])
        self.s_robots_label.text = "robot" if d["robots"] == 1 else "robots"
        self.demo_line.text = "Demo data is %s (%d demo people). Manage it in the Demo data tab." % (
            d["demo"]["state"], d["demo"]["counts"].get("users", 0))

    # ---- robots
    def _robots(self):
        d = state.call("admin_robots") or {"robots": []}
        self.robots_panel.items = d["robots"]
        self.robots_list.visible = bool(d["robots"])
        self.no_robots.visible = not d["robots"]

    # ---- network
    def _network(self):
        n = state.call("get_network")
        if not n:
            return
        self._net = n
        self.ice_box.text = json.dumps(n["ice_servers"], indent=2)
        self.fast_box.text = str(n["poll_fast_ms"])
        self.idle_box.text = str(n["poll_idle_ms"])
        self.source_box.text = n["source"]
        for box, label in ((self.ice_box, "ICE servers"), (self.fast_box, "Check-in while driving (ms)"),
                           (self.idle_box, "Check-in when idle (ms)"), (self.source_box, "Robot code download")):
            state.set_control_attr(box, "aria-label", label)

    @handle("net_reset", "click")
    def net_reset_click(self, **event_args):
        n = self._net
        self.ice_box.text = json.dumps(n["default_ice"], indent=2)
        self.fast_box.text, self.idle_box.text = "600", "2500"
        self.source_box.text = n["default_source"]

    @handle("net_save", "click")
    def net_save_click(self, **event_args):
        try:
            ice = json.loads(self.ice_box.text or "[]")
        except ValueError:
            state.toast("The ICE servers aren't valid JSON.", "error")
            return
        try:
            fast, idle = int(float(self.fast_box.text or 600)), int(float(self.idle_box.text or 2500))
        except ValueError:
            state.toast("The check-in times must be numbers.", "error")
            return
        if state.call("set_network", {"ice_servers": ice, "poll_fast_ms": fast, "poll_idle_ms": idle, "source": self.source_box.text or ""}):
            state.toast("Saved. Robots pick it up on their next check-in.", "ok")

    # ---- feedback
    def _feedback(self):
        d = state.call("list_feedback", None)
        self._fb = d
        items = [i for i in d["items"] if self._filter == "all" or i["status"] == self._filter]
        self.feedback_panel.items = items
        self.no_feedback.visible = not items
        labels = {"new": "New", "read": "Read", "done": "Done", "all": "All"}
        for key, el in (("new", self.f_new), ("read", self.f_read), ("done", self.f_done), ("all", self.f_all)):
            n = len(d["items"]) if key == "all" else d["counts"].get(key, 0)
            el.text = "%s (%d)" % (labels[key], n)
            el.role = ["seg", "on"] if key == self._filter else ["seg"]

    def _set_filter(self, value):
        self._filter = value
        self._feedback()

    @handle("f_new", "click")
    def f_new_click(self, **event_args):
        self._set_filter("new")

    @handle("f_read", "click")
    def f_read_click(self, **event_args):
        self._set_filter("read")

    @handle("f_done", "click")
    def f_done_click(self, **event_args):
        self._set_filter("done")

    @handle("f_all", "click")
    def f_all_click(self, **event_args):
        self._set_filter("all")

    def _feedback_changed(self, **event_args):
        self._feedback()

    # ---- users
    def _users(self, query=None):
        d = state.call("list_users", query or None)
        self.users_panel.items = d["users"]
        self.users_count.text = state.plural(d["total"], "person", "people")

    @handle("search_box", "pressed_enter")
    def search_box_pressed_enter(self, **event_args):
        self._users(self.search_box.text)

    @handle("search_button", "click")
    def search_button_click(self, **event_args):
        self._users(self.search_box.text)

    # ---- demo data
    def _demo(self):
        d = state.call("admin_overview")["demo"]
        counts = ", ".join("%s %s" % (v, k) for k, v in d["counts"].items())
        self.demo_status.text = "Status: %s · %s" % (d["state"], counts)
        self.demo_load_button.text = "Reload demo data" if d["state"] == "loaded" else "Load demo data"

    @handle("demo_load_button", "click")
    def demo_load_button_click(self, **event_args):
        if confirm("Demo people and content are added (any old demo rows are replaced).", title="Load the demo data?",
                   buttons=[("Cancel", False), ("Load", True)], role="app-dialog"):
            if state.call("demo_load"):
                state.toast("Done", "ok")
                self._demo()

    @handle("demo_remove_button", "click")
    def demo_remove_button_click(self, **event_args):
        if confirm("Every demo row is deleted. Real data stays.", title="Remove the demo data?",
                   buttons=[("Cancel", False), ("Remove", True)], role="app-dialog"):
            if state.call("demo_remove"):
                state.toast("Done", "ok")
                self._demo()
