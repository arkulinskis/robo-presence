from anvil import *
import anvil.js
from anvil.js import window

from ._anvil_designer import GuideTemplate
from ... import router, state

SECTIONS = ["build", "pi", "install", "arduino", "parts", "connection", "protocol", "trouble"]


class Guide(GuideTemplate):
    """#guide/<section> (Read): the build guide, open to everyone. Build, Pi set-up, install, Arduino, new parts,
    connection (WebRTC, STUN/TURN), protocol, troubleshooting. The copy is static HTML in the template; the side list
    marks the open section and scrolls to it (the address follows, so a section can be linked)."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.sec = args[0] if args and args[0] in SECTIONS else None
        if state.me():
            state.set_attr(self.cta, "href", "#garage")
            anvil.js.get_dom_node(self.cta).innerHTML = '<i class="ic ic-robot"></i>Your garage'
        self._mark(self.sec or "build")
        if self.sec:
            window.setTimeout(self._scroll_first, 30)

    def _toc(self):
        return {s: getattr(self, "toc_" + s) for s in SECTIONS}

    def _mark(self, sec):
        for name, link in self._toc().items():
            link.classes["on"] = name == sec

    def _scroll_first(self):
        el = _nodes(self)["sec_" + (self.sec or "build")]
        if el:
            el.scrollIntoView()

    def toc_click(self, event):
        a = event.currentTarget
        sec = str(a.getAttribute("data-sec"))
        event.preventDefault()
        _nodes(self)["sec_" + sec].scrollIntoView({"behavior": "smooth"})
        self._mark(sec)
        router.replace("guide", sec)


def _nodes(form):
    """dom_nodes by a built name (the validator only accepts literal keys)."""
    return _loose(form.dom_nodes)


def _loose(x):
    return x
