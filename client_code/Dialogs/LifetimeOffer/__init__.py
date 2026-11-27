import anvil.server
from anvil import *
from anvil.js import window

from ._anvil_designer import LifetimeOfferTemplate
from ... import lifetime


class LifetimeOffer(LifetimeOfferTemplate):
    """The lifetime offer: price, what is paid and what stays free, and the button to Stripe Checkout. Shows the
    right words for signed-out people (sign in first), buyers waiting for review, and owners."""

    def __init__(self, feature=None, **properties):
        super().__init__(**properties)
        s = lifetime.status(refresh=True)
        self.s = s
        cur = "$" if s.get("currency", "USD") == "USD" else str(s.get("currency", "")) + " "
        price = float(s.get("price", 34))
        self.price_label.text = "%s%s once" % (cur, int(price) if price.is_integer() else "%.2f" % price)
        self.title_label.text = "%s: lifetime access" % s.get("name", "")
        if feature:
            self.feature_label.text, self.feature_label.visible = "%s is part of lifetime access." % feature, True
        self.paid_list.text = "\n".join("+ " + p for p in s.get("paid") or [])
        self.free_list.text = "\n".join("- " + p for p in s.get("free") or [])
        self.free_head.visible = self.free_list.visible = bool(s.get("free"))
        self.test_note.visible = bool(s.get("test_mode"))
        st = s.get("state")
        if st == "signed_out":
            self.buy_button.text = "Sign in to buy"
        elif st == "owned":
            self.buy_button.visible = False
            self.price_note.text = "You have lifetime access. Thank you!"
        elif st == "free":
            self.buy_button.visible = False
            self.price_note.text = "Everything is free right now."
        elif st == "pending":
            self.buy_button.visible = False
            self.price_note.text = "Your purchase is being checked. Everything is unlocked meanwhile."

    @handle("close_button", "click")
    def close_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)

    @handle("buy_button", "click")
    def buy_button_click(self, **event_args):
        if self.s.get("state") == "signed_out":
            self.raise_event("x-close-alert", value=None)
            window.location.hash = "#auth"
            return
        self.buy_button.enabled = False
        self.buy_button.text = "Opening Stripe..."
        r = anvil.server.call("lifetime_checkout")
        if not r.get("ok"):
            self.buy_button.enabled, self.buy_button.text = True, "Get lifetime access"
            self.message.text, self.message.visible = r.get("error") or "That didn't work.", True
            return
        window.location.href = r["url"]
