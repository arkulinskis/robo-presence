import json

from anvil import *
import anvil.server
from anvil.js import window

from ._anvil_designer import PartsTemplate
from ... import router, rp, state

BOARD_TEXT = {"pi": "Every part is wired to the Raspberry Pi's GPIO pins.",
              "pi_arduino": "The Pi streams video; an Arduino over USB runs the parts marked \"Arduino\". It tells the Pi what it has.",
              "browser": "A phone or laptop on the robot runs it from a browser tab (robot mode). Parts are simulated, or run by an Arduino over USB (Chrome)."}
SAVED_MSG = "Saved parts reach the robot within a few seconds, even while it runs."


class Parts(PartsTemplate):
    """The Parts tab (the builder). Owners: brain, camera, the part cards (Components/PartsList, the JavaScript part
    editor), add a part, what the pilot gets, the wiring (RP.pinMap) and Save. Everyone else: what the parts are.
    Every edit is checked by the server (check_config) after a short pause; problems outline the part cards."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.page = rp.loose(None)
        self.cfg = rp.loose(None)
        self.dirty = False
        self._check_t = None
        self.cam_source.items = [("Auto (Pi camera, else USB)", "auto"), ("Raspberry Pi camera", "picamera"), ("USB webcam", "usb"), ("Test pattern", "test")]
        self.cam_size.items = [("320 × 240 (smoothest)", "320x240"), ("640 × 480", "640x480"), ("960 × 540", "960x540"), ("1280 × 720 (Pi 4/5)", "1280x720")]
        self.cam_codec.items = [("H.264 (lighter on the Pi)", "h264"), ("VP8", "vp8")]
        cat = rp.py_value(rp.RP.CATALOG) or []
        self.catalog_panel.items = [{"index": i, "icon": c.get("icon"), "name": c.get("name"), "text": c.get("text")} for i, c in enumerate(cat)]
        self.catalog_panel.add_event_handler("x-add", self._add)
        self.parts_list.add_event_handler("changed", self._changed)
        for box in (self.cam_source, self.cam_size, self.cam_codec):
            box.add_event_handler("change", self._cam_changed)
        for box in (self.cam_flip, self.cam_audio):
            box.add_event_handler("change", self._cam_changed)
        self.cam_fps.add_event_handler("change", self._cam_changed)

    # ---- drawing
    def show_robot(self, page):
        self.page = page
        R = page.R
        owner = page.owner()
        self.readonly_card.visible = not owner
        self.editor.visible = owner
        if not owner:
            self.readonly_text.text = "Only %s can change this robot's parts. Here is what they are:" % (R.get("owner") or "the owner")
            self.readonly_gets.items = rp.pilot_gets(R.get("manifest"))
            self.readonly_sim.visible = bool(R.get("demo"))
            state.set_attr(self.readonly_sim_link, "href", router.href("drive", "sim", R["id"]))
            return
        if self.cfg is None:
            self.cfg = json.loads(json.dumps(R.get("config") or {"parts": []}))
            self.dirty = False
        self._draw_all()

    def _draw_all(self):
        cfg = self.cfg
        board = cfg.get("board") or "pi"
        for b, el in (("pi", self.b_pi), ("pi_arduino", self.b_pi_arduino), ("browser", self.b_browser)):
            el.classes["on"] = b == board
        self.board_text.text = BOARD_TEXT.get(board, BOARD_TEXT["pi"])
        cam = cfg.get("camera") or {}
        self.cam_source.selected_value = cam.get("source") if cam.get("source") in ("auto", "picamera", "usb", "test") else "auto"
        self.cam_size.selected_value = cam.get("size") if cam.get("size") in ("320x240", "640x480", "960x540", "1280x720") else "640x480"
        self.cam_codec.selected_value = cam.get("codec") if cam.get("codec") in ("h264", "vp8") else "h264"
        self.cam_fps.text = str(cam.get("fps") or 24)
        self.cam_flip.checked = bool(cam.get("flip"))
        self.cam_audio.checked = bool(cam.get("audio"))
        for box, label in ((self.cam_source, "Source"), (self.cam_size, "Size"), (self.cam_codec, "Codec"), (self.cam_fps, "Frames per second")):
            state.set_control_attr(box, "aria-label", label)
        self.parts_list.set(board, cfg.get("parts") or [])
        self._side()

    def _side(self, problems=None):
        self.gets_panel.items = rp.pilot_gets(rp.manifest_of_config(self.cfg))
        self.dom_nodes["pins"].innerHTML = rp.RP.pinMap(rp.js_value(self.cfg))
        if problems:
            more = " (+%d more)" % (len(problems) - 1) if len(problems) > 1 else ""
            self.msg.text = problems[0] + more
            self.msg.role = ["rb-msg", "rb-bad"]
        elif problems is not None:
            self.msg.text = "Looks good. Save to send it to the robot." if self.dirty else SAVED_MSG
            self.msg.role = ["rb-msg"]

    def _read(self):
        self.cfg["parts"] = self.parts_list.read() or []
        cam = dict(self.cfg.get("camera") or {})
        try:
            fps = int(float(self.cam_fps.text or 24))
        except ValueError:
            fps = 24
        cam.update({"source": self.cam_source.selected_value, "size": self.cam_size.selected_value, "fps": fps,
                    "codec": self.cam_codec.selected_value, "flip": bool(self.cam_flip.checked), "audio": bool(self.cam_audio.checked)})
        self.cfg["camera"] = cam

    # ---- edits
    def _changed(self, **event_args):
        self._read()
        self.dirty = True
        self._side()
        self._check_soon()

    def _cam_changed(self, **event_args):
        self._changed()

    def _add(self, index, **event_args):
        self.parts_list.add(index)  # raises "changed" itself

    def _check_soon(self):
        if self._check_t is not None:
            window.clearTimeout(self._check_t)
        self._check_t = window.setTimeout(self._check, 350)

    def _check(self):
        self._check_t = None
        if self.page is None or self.cfg is None:
            return
        r = state.call_quiet("check_config", self.page.R["id"], self.cfg)
        if isinstance(r, dict) and "problems" in r:
            self.parts_list.mark(r["problems"])
            self._side(r["problems"])

    def board_click(self, event):
        nb = str(event.currentTarget.getAttribute("data-v"))
        self._read()
        if nb == (self.cfg.get("board") or "pi"):
            return
        name = rp.BOARDS[nb]
        fresh = confirm("Keep your parts and move them to the new brain where they fit, or start from the %s starting set." % name,
                        title="Switch to %s?" % name, buttons=[("Keep my parts", False), ("Start from the starting set", True)],
                        role="app-dialog")
        if fresh:
            d = state.call("reset_config", self.page.R["id"], nb)
            if d:
                self.cfg = rp.loose(None)
                self.page.set_robot(d["robot"])
                state.toast("Parts reset to the %s set." % name, "ok")
            return
        self.cfg["board"] = nb
        self.cfg["parts"] = rp.py_value(rp.RP.moveToBoard(rp.js_value(self.cfg.get("parts") or []), nb)) or []
        self.dirty = True
        self._draw_all()
        self._check_soon()

    @handle("save_button", "click")
    def save_button_click(self, **event_args):
        self._read()
        R = self.page.R
        d = anvil.server.call("save_config", R["id"], self.cfg)
        if isinstance(d, dict) and d.get("ok") is False:
            probs = d.get("problems")
            self._side(probs or [d.get("error") or "That didn't work."])
            if probs:
                self.parts_list.mark(probs)
            state.toast(d.get("error") or "That didn't work.", "error")
            return
        robot = d["robot"]
        self.cfg = rp.loose(None)
        self.dirty = False
        state.toast("Saved (version %s)." % robot.get("config_rev") + (" %s is reloading its parts." % robot["name"] if robot.get("online") else ""), "ok")
        for n in d.get("notes") or []:
            state.toast(n)
        self.page.set_robot(robot)

    @handle("reset_button", "click")
    def reset_button_click(self, **event_args):
        board = (self.cfg or {}).get("board") or "pi"
        if confirm("Your parts go back to the %s starting set." % rp.BOARDS.get(board, "Raspberry Pi"), title="Start over?",
                   buttons=[("Cancel", False), ("Start over", True)], role="app-dialog"):
            d = state.call("reset_config", self.page.R["id"], board)
            if d:
                self.cfg = rp.loose(None)
                self.dirty = False
                self.page.set_robot(d["robot"])

    def leave(self):
        if self._check_t is not None:
            window.clearTimeout(self._check_t)
            self._check_t = None
