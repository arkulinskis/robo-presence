from anvil import *

from ._anvil_designer import CmdBoxTemplate
from ... import rp


class CmdBox(CmdBoxTemplate):
    """A command line with Copy (the toast says "<what> to the clipboard")."""

    def __init__(self, **properties):
        self._what = "Command"
        self._prompt = True
        super().__init__(**properties)

    @property
    def command(self):
        return self.cmd_label.text

    @command.setter
    def command(self, v):
        self.cmd_label.text = v or ""

    @property
    def what(self):
        return self._what

    @what.setter
    def what(self, v):
        self._what = v or "Command"

    @property
    def prompt(self):
        return self._prompt

    @prompt.setter
    def prompt(self, v):
        self._prompt = bool(v)
        self.prompt_part.visible = self._prompt
        self.code.classes["wrap"] = not self._prompt

    @handle("copy_button", "click")
    def copy_button_click(self, **event_args):
        rp.copy(self.cmd_label.text, self._what)
