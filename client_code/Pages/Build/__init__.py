from anvil import *
import anvil.server
from anvil.js import window

from ._anvil_designer import BuildTemplate
from ... import router, rp, state


class Build(BuildTemplate):
    """#build/<robot id> (anyone): one public build sheet (Builds.build_get): the robot's picture, maker, story,
    parts with drivers and pins, what the pilot gets, brain and camera. "Try it in the simulator" opens
    #drive/sim/<id> (works for anyone on a public build); "Build one like this" copies the parts into a new robot of
    your own (Builds.build_clone; signed out = sign in first, then back here) and opens its Install tab."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.B = rp.loose(None)
        self.main.visible = False
        self.missing.visible = False
        d = anvil.server.call("build_get", args[0] if args else "")
        if not d.get("ok"):
            self.missing.visible = True
            return
        B = self.B = d["build"]
        self.main.visible = True
        window.document.title = "%s: build sheet · Robo Presence" % B["name"]
        self.art.show_robot(B.get("color"), pan=14, tilt=6, eyes_on=True, arms=True)
        self.title.text = B["name"]
        state.heading(self.title, 1)
        self.sub.text = "%s · built by %s%s" % (B.get("board_label") or "Robot", B.get("maker") or "a maker",
                                                 " · showroom example" if B.get("demo") else "")
        self.story.text = B.get("story") or ""
        self.story.visible = bool(B.get("story"))
        self.parts_panel.items = [{"k": p.get("label") or p.get("id"),
                                   "v": " · ".join([x for x in [p.get("driver"), p.get("pins")] if x])}
                                  for p in B.get("part_list") or []]
        self.gets_panel.items = rp.pilot_gets(B.get("manifest"))
        self.facts_panel.items = [{"k": "Brain", "v": B.get("board_label") or "Raspberry Pi"},
                                  {"k": "Camera", "v": B.get("camera") or ""},
                                  {"k": "Parts", "v": str(B.get("parts") or 0)}]
        state.set_attr(self.sim_link, "href", router.href("drive", "sim", B["id"]))
        self.clone_button.visible = not B.get("mine")
        self.mine_note.visible = bool(B.get("mine"))
        if not state.me():
            self.clone_button.text = "Sign in to build one like this"

    @handle("clone_button", "click")
    def clone_button_click(self, **event_args):
        B = self.B
        if not state.me():
            router.remember_after(router.href("build", B["id"]))
            router.go("auth")
            return
        d = state.call("build_clone", B["id"], "My " + B["name"])
        if d:
            state.toast("%s is in your garage, with the same parts. Next: install it." % d["robot"]["name"], "ok")
            router.go("robot", d["robot"]["id"], "install")

    @handle("share_button", "click")
    def share_button_click(self, **event_args):
        loc = window.location
        rp.copy(str(loc.origin) + str(loc.pathname) + router.href("build", self.B["id"]), "The link")
