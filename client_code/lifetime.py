"""Lifetime access on the page side (server: Lifetime.py; same file in every app).

    lifetime.status(refresh=False)   the server's lifetime_status() (cached): gate, unlocked, state, price, paid, free
    lifetime.unlocked()              True when the paid features may be used (always True while the gate is off)
    lifetime.gate_on()               True once a Stripe key is set (show prices / lock icons only then)
    lifetime.gate("Clean export")    True if unlocked; otherwise shows the offer (naming that feature) and returns False
    lifetime.offer(feature=None)     shows the offer dialog (e.g. from a "Lifetime access" link in the menu)
    lifetime.handle_return()         call once at start-up, before router.start(): finishes #lifetime/<session> etc.
    lifetime.badge()                 "" while unlocked or the gate is off, "Lifetime" otherwise (for button labels)

Typical use in a Form:
    from ... import lifetime
    if not lifetime.gate("HD export"):
        return
The server must check too (Lifetime.unlocked(user)); the page check gives a friendly offer, not security.
"""
import anvil.server
from anvil.js import window

from . import state

_s = {"status": None, "who": None}


def _who():
    """Who the cached status belongs to: a sign-in or sign-out (state.me() changes) refetches it on its own."""
    try:
        m = state.me()
        return (m or {}).get("id") or (m or {}).get("email") if m else None
    except Exception:
        return None


def status(refresh=False):
    who = _who()
    if refresh or _s["status"] is None or who != _s["who"]:
        _s["who"] = who
        try:
            _s["status"] = anvil.server.call("lifetime_status")
        except Exception as e:   # never block the app because of the gate
            print("lifetime_status failed: %r" % (e,))
            _s["status"] = {"gate": False, "unlocked": True, "state": "free", "paid": [], "free": []}
    return _s["status"]


def reset():
    """Forget the cached status (after sign in / sign out)."""
    _s["status"] = None


def unlocked():
    return bool(status().get("unlocked"))


def gate_on():
    return bool(status().get("gate"))


def badge():
    return "Lifetime" if gate_on() and not unlocked() else ""


def offer(feature=None):
    from anvil import alert
    from .Dialogs.LifetimeOffer import LifetimeOffer
    alert(LifetimeOffer(feature=feature), buttons=[], role="app-dialog")


def gate(feature=None):
    if unlocked():
        return True
    offer(feature)
    return False


def _is_admin():
    try:
        return bool((state.me() or {}).get("is_admin"))
    except Exception:
        return False


def handle_return():
    """After Stripe: #lifetime/cs_... records the purchase; #lifetime-cancelled says nothing was charged.
    For admins, a reminder when purchases wait for review."""
    h = str(window.location.hash or "")
    if h.startswith("#lifetime/"):
        sid = h[len("#lifetime/"):].split("?")[0]
        r = anvil.server.call("lifetime_confirm", sid)
        if r.get("ok"):
            if r.get("status") == "paid":
                msg = "Thank you! Lifetime access is on."
            elif r.get("unlocked"):
                msg = "Thank you! Lifetime access is on while we check the payment (usually within a day)."
            else:
                msg = "Thank you! Access opens as soon as we have checked the payment."
            state.toast(msg, "ok")
        else:
            state.toast(r.get("error") or "We couldn't check the payment yet.", "error")
        window.history.replaceState(None, "", "#")
        status(refresh=True)
    elif h.startswith("#lifetime-cancelled"):
        state.toast("No payment was taken.")
        window.history.replaceState(None, "", "#")
    elif _is_admin():   # only admins pay for this extra server call at start-up
        n = status().get("to_review") or 0
        if n:
            state.toast("%d lifetime purchase%s to review (Admin, Lifetime sales)." % (n, "" if n == 1 else "s"))
