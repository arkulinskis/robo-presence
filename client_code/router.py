"""Page addresses: #name/arg1/arg2 -> a page Form (open_form), with sign-in rules. Same addresses as the JavaScript
version, so links people shared (guest passes, robot pages) keep working.

Links in templates are plain <a href="#garage">; code calls router.go("robot", id, "parts").

    PAGES[name] = (who may open it, browser-tab title)   who: None = anyone, "guest" = signed out only, "user", "admin"
    NAV = the main menu (header + phone tab bar): (page, label, icon, who). Guests see Test drive and Guide too.
New page: add it to PAGES, to _form() and (if it belongs in the menu) to NAV.
"""
import anvil
import anvil.js
from anvil.js import window

from . import state

PAGES = {
    "landing": (None, "Build a robot, drive it from anywhere"),
    "auth": ("guest", "Sign in"),
    "garage": ("user", "Garage"),
    "robot": ("user", "Robot"),
    "drive": (None, "Drive"),
    "bot": ("user", "Robot mode"),
    "guide": (None, "Build guide"),
    "profile": ("user", "Your profile"),
    "admin": ("admin", "Admin"),
}
NAV = [("garage", "Garage", "robot", "user"), ("drive", "Test drive", "joystick", None), ("guide", "Guide", "book", None)]
APP_NAME = "Robo Presence"
_r: dict = {"after": "", "listening": False, "page": None}


def _form(name):
    """The page's Form class (imported when first needed, so start-up stays quick)."""
    if name == "landing":
        from .Pages.Landing import Landing
        return Landing
    if name == "auth":
        from .Pages.Auth import Auth
        return Auth
    if name == "garage":
        from .Pages.Garage import Garage
        return Garage
    if name == "robot":
        from .Pages.Robot import Robot
        return Robot
    if name == "drive":
        from .Pages.Drive import Drive
        return Drive
    if name == "bot":
        from .Pages.Bot import Bot
        return Bot
    if name == "guide":
        from .Pages.Guide import Guide
        return Guide
    if name == "profile":
        from .Pages.Profile import Profile
        return Profile
    from .Pages.Admin import Admin
    return Admin


def nav_links(page):
    """The menu for the header and the phone tab bar (guests get Test drive and Guide)."""
    me = state.me()
    return [{"page": p, "label": label, "icon": icon, "on": p == page}
            for p, label, icon, who in NAV if who is None or me]


def parse(hash_text):
    h = (hash_text or "").lstrip("#").lstrip("!").lstrip("/").split("?")[0]
    parts = [window.decodeURIComponent(p) for p in h.split("/") if p]
    return (parts[0] if parts else ""), parts[1:]


def href(name, *args):
    """'#name/arg1/arg2' with every part URL-encoded (row ids contain brackets and commas)."""
    return "#" + "/".join([name] + [window.encodeURIComponent(str(a)) for a in args if a not in (None, "")])


def home_page():
    return "garage" if state.me() else "landing"


def show():
    """Open the page for the current address."""
    name, args = parse(window.location.hash)
    if name not in PAGES:
        name, args = home_page(), []
    who = PAGES[name][0]
    if who == "guest" and state.me():
        name, args = "garage", []
    elif who in ("user", "admin") and not state.me():
        _r["after"] = window.location.hash
        name, args = "auth", []
    elif who == "admin" and not state.is_admin():
        state.toast("That page is for admins only.", "error")
        name, args = "garage", []
    elif name == "drive" and args and args[0] not in ("sim", "pass") and not state.me():
        _r["after"] = window.location.hash  # a live robot needs an account (or a guest pass)
        name, args = "auth", []
    old = _r["page"]
    if old is not None and hasattr(old, "leave"):
        try:
            old.leave()  # stop timers, cameras and WebRTC links of the page being left
        except Exception as e:
            print("leave failed: %r" % e)
    window.document.title = PAGES[name][1] + " · " + APP_NAME
    window.UI_READY = False
    page = _form(name)(args=args)
    _r["page"] = page
    anvil.open_form(page)
    shell = getattr(page, "layout", None)
    if shell is not None and hasattr(shell, "refresh"):
        shell.refresh(name)  # Anvil reuses the layout between pages: tell it who is signed in and which page is open
    window.scrollTo(0, 0)
    if not getattr(page, "waits", False):
        window.UI_READY = True  # tests and screenshots wait for this (engine pages set it once they're ready)


def go(name, *args):
    """Go to a page. Same address again = reload the page."""
    target = href(name, *args)
    if window.location.hash == target:
        show()
    else:
        window.location.hash = target


def replace(name, *args):
    """Change the address without opening anything (a page that switches its own view)."""
    window.history.replaceState(None, "", href(name, *args))


def after_sign_in():
    """Where to go once someone signs in: the page they were heading for, or the garage."""
    target = _r["after"]
    _r["after"] = ""
    if target and target != window.location.hash:
        window.location.hash = target
    else:
        go("garage")


def remember_after(target):
    _r["after"] = target


def _on_hash(event):
    show()


def start():
    if not _r["listening"]:
        window.addEventListener("hashchange", anvil.js.report_exceptions(_on_hash))
        _r["listening"] = True
    show()
