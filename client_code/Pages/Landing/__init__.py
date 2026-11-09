from anvil import *
import anvil.js

from ._anvil_designer import LandingTemplate
from ... import state

# The app's video on the Addanapp YouTube channel (APP_MAKER/youtube/manifest.json), shown in the Watch section.
YT_VIDEO = "-c7CiXm_WjE"


class Landing(LandingTemplate):
    """#landing (Persuade; also "About" for members): the promise with the live-cockpit hero art, the Watch section
    (the YouTube video), how it works, "your robot tells the cockpit what it has", features, questions. Static copy
    lives in the template; members get "Open your garage" instead of "Start your garage"."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        if state.me():
            state.set_attr(self.hero_cta, "href", "#garage")
            anvil.js.get_dom_node(self.hero_cta).innerHTML = '<i class="ic ic-robot"></i>Open your garage'
            state.set_attr(self.band_cta, "href", "#garage")
            anvil.js.get_dom_node(self.band_cta).textContent = "Open your garage"
        self.dom_nodes["yt_cover"].addEventListener("click", self._play)

    def _play(self, event):
        """Swap the video's cover for YouTube's player (privacy-enhanced); nothing loads from YouTube before this click."""
        self.dom_nodes["yt_frame"].innerHTML = (
            '<iframe src="https://www.youtube-nocookie.com/embed/' + YT_VIDEO + '?autoplay=1&rel=0&playsinline=1" '
            'title="Robo Presence video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen '
            'referrerpolicy="strict-origin-when-cross-origin"></iframe>')
