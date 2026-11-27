import anvil.server
from anvil import *

from ._anvil_designer import LifetimeSalesTemplate
from ... import lifetime, state

WORDS = {"held": "held, to review", "paid": "paid", "granted": "free (given)", "cancelled": "cancelled",
         "expired": "hold expired", "refunded": "refunded", "disputed": "DISPUTED", "revoked": "taken back"}
ACTIONS = {"held": [("Capture", "capture", "btn-primary"), ("Cancel", "cancel", "btn-danger")],
           "paid": [("Refund", "refund", "btn-ghost")], "granted": [("Take back", "revoke", "btn-ghost")]}


class LifetimeSales(LifetimeSalesTemplate):
    """Admin: is the gate on, the switches, every purchase with Capture / Cancel / Refund, and free access by email.
    Open it from the Admin page: alert(LifetimeSales(), buttons=[], role="app-dialog", large=True)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.load()

    def load(self):
        d = state.call("admin_lifetime")
        if not d:
            return
        s = d["settings"]
        if not d["key_set"]:
            self.gate_label.text = "Gate off: everything is free. Add the App Secret stripe_secret_key to switch it on."
        elif s["off"]:
            self.gate_label.text = "Gate off by your switch: everything is free."
        else:
            self.gate_label.text = "Gate ON%s: paid features need lifetime access." % (" (Stripe TEST mode)" if d["test_mode"] else "")
        self.setup_label.text = ("Webhook: %s. Stripe -> Developers -> Webhooks -> %s" % (
            "set" if d["webhook_set"] else "not set (optional; App Secret stripe_webhook_secret)", d["webhook_url"]))
        self.off_box.checked = bool(s["off"])
        self.capture_box.checked = s["unlock"] == "capture"
        c = d["counts"]
        self.counts_label.text = "%d to review, %d paid, %d given free, %d cancelled or expired, %d refunded, %d disputed." % (
            c["held"], c["paid"], c["granted"], c["cancelled"] + c["expired"], c["refunded"], c["disputed"])
        self.rows_panel.clear()
        for r in d["rows"]:
            self.rows_panel.add_component(self._row(r))
        self.empty_label.visible = not d["rows"]

    def _row(self, r):
        line = FlowPanel()
        bits = [r["email"] or "(no email)", WORDS.get(r["status"], r["status"])]
        if r["amount"]:
            bits.append("%.2f %s" % (r["amount"], r["currency"]))
        if r["days_left"] is not None:
            bits.append("%d day%s left to capture" % (r["days_left"], "" if r["days_left"] == 1 else "s"))
        bits.append((r["created"] or "")[:10])
        if r["note"]:
            bits.append(r["note"])
        line.add_component(Label(text="  ·  ".join(bits), bold=r["status"] in ("held", "disputed")))
        for text, action, role in ACTIONS.get(r["status"], []) + [("Check Stripe", "sync", "btn-ghost")] * bool(r["payment_intent"]):
            b = Button(text=text, role=["btn", role])
            b.add_event_handler("click", lambda a=action, rid=r["id"], btn=b, **e: self.act(rid, a, btn))
            line.add_component(b)
        return line

    def act(self, row_id, action, button=None):
        if action in ("cancel", "refund") and getattr(self, "_armed", None) != (row_id, action):
            self._armed = (row_id, action)   # second click confirms (no pop-up on top of this dialog)
            if button is not None:
                button.text = "Sure? Click again" + (" (buyer loses access, not charged)" if action == "cancel"
                                                     else " (refund in Stripe)")
            return
        self._armed = None
        if state.call("admin_lifetime_action", row_id, action):
            state.toast({"capture": "Captured: the money is yours.", "cancel": "Hold cancelled.",
                         "refund": "Refunded.", "revoke": "Access taken back.", "sync": "Checked with Stripe."}[action], "ok")
        lifetime.reset()
        self.load()

    @handle("off_box", "change")
    def off_box_change(self, **event_args):
        state.call("admin_lifetime_settings", {"off": self.off_box.checked})
        lifetime.reset()
        self.load()

    @handle("capture_box", "change")
    def capture_box_change(self, **event_args):
        state.call("admin_lifetime_settings", {"unlock": "capture" if self.capture_box.checked else "hold"})
        self.load()

    @handle("grant_button", "click")
    def grant_button_click(self, **event_args):
        r = anvil.server.call("admin_lifetime_grant", self.grant_box.text or "")
        if not r.get("ok"):
            self.message.text, self.message.visible = r.get("error"), True
            return
        self.message.visible = False
        self.grant_box.text = ""
        state.toast("Lifetime access given.", "ok")
        self.load()

    @handle("close_button", "click")
    def close_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)
