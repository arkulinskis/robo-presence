"""Lifetime access: one $34 payment unlocks the paid features for good (APP_MAKER money round, 2026-11-27).

SAME FILE IN EVERY APP (APP_MAKER/template-forms/server_code/Lifetime.py, copied by tools/lifetime_rollout.py).
What differs per app lives in lifetime_config.py (name, the free and paid lists, fair-use caps).

Switching on
    The gate is OFF, and everything is free, until the App Secret `stripe_secret_key` holds a Stripe key
    (sk_live_..., sk_test_... or a restricted rk_... key). Add it in the Anvil editor (App Secrets) and the gate is on.
    Admin -> Lifetime sales has a switch to keep the app free even with the key in place.

Paying (no card details ever touch the app)
    lifetime_checkout() asks Stripe for a Checkout Session ($34, one payment, card) and sends the buyer there.
    The card is only AUTHORISED (capture_method=manual): Stripe holds the money for up to 7 days.
    Back in the app (#lifetime/<session id>) lifetime_confirm() asks Stripe what happened and records it, so the
    webhook is optional. The buyer has access while the hold is "pending review" (setting unlock="hold"; choose
    "capture" to unlock only after you capture).
    Admin -> Lifetime sales: Capture (takes the money), Cancel (releases the hold, removes access), Refund, Give free.
    A hold you never capture expires after 7 days: Stripe cancels it and access ends (the list shows days left).

Webhook (optional, recommended): Stripe -> <app address>/_/api/lifetime/stripe, signing secret in the App Secret
    `stripe_webhook_secret`. Events: checkout.session.completed, payment_intent.succeeded, payment_intent.canceled,
    charge.refunded, charge.dispute.created.

Server-side checks in other modules:
    from . import Lifetime
    if not Lifetime.unlocked(user): return C.fail(Lifetime.LOCKED_MESSAGE)
    Lifetime.within_cap(user, "scans", used_this_month)   # fair-use caps from lifetime_config.CAPS
"""
import datetime as dt
import hashlib
import hmac
import json
import re
import time
import urllib.parse

import anvil.server
import anvil.users
from anvil.tables import app_tables


class C(object):
    """The few helpers this module needs, kept inside it so it works in apps without common.py.
    Settings live in the app_settings table (key string, value simpleObject), as in the template."""

    @staticmethod
    def now():
        return dt.datetime.now(dt.timezone.utc)

    @staticmethod
    def iso(v):
        if isinstance(v, dt.datetime):
            return (v if v.tzinfo else v.replace(tzinfo=dt.timezone.utc)).astimezone(dt.timezone.utc).isoformat()
        return v

    @staticmethod
    def text(value, limit=200):
        return re.sub(r"\s+", " ", "" if value is None else str(value)).strip()[:limit]

    @staticmethod
    def fail(message):
        return {"ok": False, "error": message}

    @staticmethod
    def ok(**data):
        data["ok"] = True
        return data

    @staticmethod
    def is_admin(user):
        try:
            return bool(user is not None and user["is_admin"])
        except Exception:
            return False

    @staticmethod
    def require_user():
        u = anvil.users.get_user()
        if u is None:
            raise anvil.server.PermissionDenied("Please sign in first.")
        return u

    @staticmethod
    def require_admin():
        u = C.require_user()
        if not C.is_admin(u):
            raise anvil.server.PermissionDenied("Only admins can do that.")
        return u

    @staticmethod
    def get_setting(key):
        row = app_tables.app_settings.get(key=key)
        return None if row is None else row["value"]

    @staticmethod
    def set_setting(key, value):
        row = app_tables.app_settings.get(key=key)
        if row is None:
            app_tables.app_settings.add_row(key=key, value=value)
        else:
            row["value"] = value


try:
    from . import lifetime_config as CFG
except ImportError:   # an app that has the module but not its config yet: generic wording
    CFG = None

API = "https://api.stripe.com/v1/"
SETTING = "lifetime"
DEFAULTS = {"off": False, "unlock": "hold", "capture": "manual", "price": 34, "currency": "usd"}
UNLOCKS = {"hold": ("held", "paid", "granted"), "capture": ("paid", "granted")}
HOLD_DAYS = 7          # Stripe keeps an online card authorisation for 7 days
TOLERANCE = 300        # webhook timestamp window, as Stripe recommends
LOCKED_MESSAGE = "This is part of lifetime access. Get it once and it is yours for good."


# ------------------------------------------------------------------------------------------------ config + switch
def cfg(name, default):
    return getattr(CFG, name, default) if CFG is not None else default


def app_name():
    return cfg("APP_NAME", "this app")


def _secret(name):
    try:
        import anvil.secrets
        return str(anvil.secrets.get_secret(name) or "").strip()
    except Exception:   # no such secret yet (or secrets service missing): treated as not set
        return ""


def stripe_key():
    k = _secret("stripe_secret_key")
    return k if re.match(r"^(sk|rk)_(live|test)_\w+", k) else ""


def settings():
    s = dict(DEFAULTS)
    saved = C.get_setting(SETTING) or {}
    if isinstance(saved, dict):
        s.update({k: v for k, v in saved.items() if k in DEFAULTS})
    if s["unlock"] not in UNLOCKS:
        s["unlock"] = "hold"
    if s["capture"] not in ("manual", "automatic"):
        s["capture"] = "manual"
    return s


def gate_on(s=None):
    """True only when a Stripe key is in App Secrets and the admin hasn't switched the gate off."""
    s = s or settings()
    return bool(stripe_key()) and not s["off"]


def test_mode():
    return "_test_" in stripe_key()


# ------------------------------------------------------------------------------------------------ who has it
def purchase_of(user):
    """The person's most recent purchase row (any status), or None."""
    if user is None:
        return None
    rows = sorted(app_tables.lifetime_purchases.search(user=user), key=lambda r: r["created"] or C.now(), reverse=True)
    return rows[0] if rows else None


def _active(row, s):
    if row is None or row["status"] not in UNLOCKS[s["unlock"]]:
        return False
    if row["status"] == "held" and row["created"] and C.now() - _aware(row["created"]) > dt.timedelta(days=HOLD_DAYS + 1):
        _sync(row)   # the hold should have been captured or expired by now: ask Stripe once
        return row["status"] in UNLOCKS[s["unlock"]]
    return True


def unlocked(user=None, s=None):
    """May this person use the paid features? Always True while the gate is off; admins always."""
    s = s or settings()
    if not gate_on(s):
        return True
    user = user if user is not None else anvil.users.get_user()
    if user is None:
        return False
    if C.is_admin(user):
        return True
    return any(_active(r, s) for r in app_tables.lifetime_purchases.search(user=user))


def within_cap(user, name, used):
    """Fair-use caps (lifetime_config.CAPS = {"scans": 20}): True while `used` this month is under the cap.
    No cap, or the gate off, means no limit. Free users get FREE_CAPS (default 0 = paid only)."""
    if not gate_on():
        return True
    caps = cfg("CAPS", {}) if unlocked(user) else cfg("FREE_CAPS", {})
    cap = caps.get(name)
    return cap is None or used < cap


@anvil.server.callable
def lifetime_status():
    """What the page needs to draw locks and the offer. JSON only."""
    s = settings()
    user = anvil.users.get_user()
    on = gate_on(s)
    row = purchase_of(user) if on else None
    has = unlocked(user, s)
    if not on:
        state = "free"
    elif user is None:
        state = "signed_out"
    elif row is not None and row["status"] == "held" and has:
        state = "pending"
    elif has:
        state = "owned"
    else:
        state = "locked"
    out = {"gate": on, "unlocked": has, "state": state, "price": s["price"], "currency": s["currency"].upper(),
           "name": app_name(), "paid": list(cfg("PAID", [])), "free": list(cfg("FREE", [])),
           "caps": dict(cfg("CAPS", {})), "test_mode": on and test_mode(),
           "status": row["status"] if row is not None else None, "admin": C.is_admin(user)}
    if on and C.is_admin(user):
        out["to_review"] = len(app_tables.lifetime_purchases.search(status="held"))
    return out


# ------------------------------------------------------------------------------------------------ Stripe calls
def _stripe(path, fields=None, method="POST"):
    import anvil.http
    body = urllib.parse.urlencode([(k, v) for k, v in (fields or []) if v not in ("", None)])
    url = API + path + ("?" + body if method == "GET" and body else "")
    return anvil.http.request(url, method=method, data=None if method == "GET" else body, json=True,
                              headers={"Authorization": "Bearer " + stripe_key(),
                                       "Content-Type": "application/x-www-form-urlencoded"})


def user_ref(user):
    """Row id [123,4567] -> '123_4567' (client_reference_id allows letters, digits, - and _)."""
    return re.sub(r"[^0-9]+", "_", user.get_id()).strip("_")


def user_from_ref(ref):
    m = re.fullmatch(r"(\d+)_(\d+)", ref or "")
    if not m:
        return None
    try:
        return app_tables.users.get_by_id("[%s,%s]" % m.groups())
    except Exception:
        return None


@anvil.server.callable(require_user=True)
def lifetime_checkout():
    """{url}: the Stripe Checkout page for lifetime access."""
    me = C.require_user()
    s = settings()
    if not gate_on(s):
        return C.fail("Everything is free right now, so there is nothing to buy.")
    if unlocked(me, s):
        return C.fail("You already have lifetime access.")
    origin = (anvil.server.get_app_origin() or "").rstrip("/")
    fields = [("mode", "payment"),
              ("success_url", origin + "/#lifetime/{CHECKOUT_SESSION_ID}"),
              ("cancel_url", origin + "/#lifetime-cancelled"),
              ("client_reference_id", user_ref(me)),
              ("customer_email", me["email"] or ""),
              ("payment_method_types[0]", "card"),
              ("line_items[0][quantity]", "1"),
              ("line_items[0][price_data][currency]", s["currency"]),
              ("line_items[0][price_data][unit_amount]", str(int(round(float(s["price"]) * 100)))),
              ("line_items[0][price_data][product_data][name]", "%s: lifetime access" % app_name()),
              ("line_items[0][price_data][product_data][description]",
               "One payment, every paid feature, for the life of the product."),
              ("payment_intent_data[capture_method]", s["capture"]),
              ("payment_intent_data[description]", "%s lifetime access" % app_name()),
              ("payment_intent_data[metadata][lifetime]", "1"),
              ("payment_intent_data[metadata][user]", user_ref(me)),
              ("metadata[lifetime]", "1"),
              ("allow_promotion_codes", "true")]
    try:
        r = _stripe("checkout/sessions", fields)
    except Exception as e:
        print("Lifetime checkout failed: %r" % (e,))
        return C.fail("We couldn't reach the payment page. Please try again in a minute.")
    url = str(r.get("url") or "") if isinstance(r, dict) else ""
    return C.ok(url=url) if url.startswith("https://") else C.fail("We couldn't reach the payment page.")


def _status_from_intent(pi):
    st = (pi or {}).get("status")
    return {"requires_capture": "held", "succeeded": "paid", "canceled": "cancelled"}.get(st, "")


def _record(session, pi):
    """Create or update the purchase row for one completed Checkout Session. Returns the row (or None)."""
    sid = C.text(session.get("id"), 120)
    if not sid or session.get("status") != "complete":
        return None
    status = _status_from_intent(pi) or ("paid" if session.get("payment_status") == "paid" else "")
    if not status:
        return None
    row = app_tables.lifetime_purchases.get(session=sid)
    if row is not None:
        if row["status"] in ("held", "paid") and status != row["status"]:
            row.update(status=status, updated=C.now())
        return row
    user = user_from_ref(C.text(session.get("client_reference_id"), 80))
    email = C.text(((session.get("customer_details") or {}).get("email")) or session.get("customer_email"), 200).lower()
    if user is None and email:
        user = app_tables.users.get(email=email)
    amount = session.get("amount_total") if isinstance(session.get("amount_total"), int) else None
    return app_tables.lifetime_purchases.add_row(
        user=user, email=email, status=status, amount=amount, currency=C.text(session.get("currency"), 8).upper(),
        session=sid, payment_intent=C.text((pi or {}).get("id") or session.get("payment_intent"), 120) or None,
        created=C.now(), updated=C.now(), note=None)


@anvil.server.callable
def lifetime_confirm(session_id):
    """The buyer is back from Stripe: look the session up and record it. Works without the webhook."""
    sid = C.text(session_id, 120)
    if not re.fullmatch(r"cs_(live|test)_\w+", sid) or not stripe_key():
        return C.fail("That payment link isn't valid.")
    try:
        session = _stripe("checkout/sessions/" + sid, [("expand[]", "payment_intent")], method="GET")
    except Exception as e:
        print("Lifetime confirm failed: %r" % (e,))
        return C.fail("We couldn't check the payment yet. Refresh in a minute.")
    pi = session.get("payment_intent") if isinstance(session.get("payment_intent"), dict) else None
    row = _record(session, pi)
    if row is None:
        return C.fail("Stripe hasn't confirmed this payment. If you were charged, it will show up soon.")
    return C.ok(status=row["status"], unlocked=row["status"] in UNLOCKS[settings()["unlock"]])


def _sync(row):
    """Refresh one row from its PaymentIntent (holds that expired, captures made in the Stripe dashboard)."""
    if not row["payment_intent"] or not stripe_key():
        return row
    try:
        pi = _stripe("payment_intents/" + row["payment_intent"], method="GET")
    except Exception as e:
        print("Lifetime sync failed: %r" % (e,))
        return row
    status = _status_from_intent(pi)
    if status == "cancelled" and row["status"] == "held":
        status = "expired" if (pi.get("cancellation_reason") or "") == "automatic" else "cancelled"
    if status and status != row["status"] and row["status"] in ("held", "paid"):
        row.update(status=status, updated=C.now())
    return row


# ------------------------------------------------------------------------------------------------ webhook
def verify(raw, header, secret, now=None):
    """Stripe-Signature: t=<time>,v1=<hex>; True if a v1 matches HMAC-SHA256(secret, '<t>.<body>') and t is recent."""
    if not header or not secret:
        return False
    parts = {}
    for kv in str(header).split(","):
        k, _, v = kv.strip().partition("=")
        parts.setdefault(k, []).append(v)
    try:
        t = int((parts.get("t") or ["0"])[0])
    except ValueError:
        return False
    if abs((now or time.time()) - t) > TOLERANCE:
        return False
    expected = hmac.new(secret.encode("utf-8"), str(t).encode("utf-8") + b"." + raw, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, v) for v in parts.get("v1", []))


def handle_event(event):
    kind = event.get("type")
    obj = (event.get("data") or {}).get("object") or {}
    if kind in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        if (obj.get("metadata") or {}).get("lifetime") != "1":
            return "not ours"
        pi = None
        if obj.get("payment_intent") and stripe_key():
            try:
                pi = _stripe("payment_intents/" + str(obj["payment_intent"]), method="GET")
            except Exception:
                pi = None
        return "recorded" if _record(obj, pi) is not None else "waiting"
    intent = C.text(obj.get("payment_intent") if kind.startswith("charge.") else obj.get("id"), 120)
    row = app_tables.lifetime_purchases.get(payment_intent=intent) if intent else None
    if row is None:
        return "unknown"
    new = {"payment_intent.succeeded": "paid", "charge.dispute.created": "disputed"}.get(kind)
    if kind == "payment_intent.canceled":
        new = "expired" if obj.get("cancellation_reason") == "automatic" else "cancelled"
    if kind == "charge.refunded":
        new = "refunded" if obj.get("refunded") else None
    if new and row["status"] != new:
        row.update(status=new, updated=C.now())
        return new
    return "no change"


@anvil.server.http_endpoint("/lifetime/stripe", methods=["POST"])
def lifetime_webhook(**kw):
    b = anvil.server.request.body
    if b is None:
        raw = b""
    elif hasattr(b, "get_bytes"):
        raw = getattr(b, "get_bytes")()
    else:
        raw = b.encode("utf-8") if isinstance(b, str) else bytes(b)
    headers = {str(k).lower(): v for k, v in (anvil.server.request.headers or {}).items()}
    secret = _secret("stripe_webhook_secret")

    def reply(status, data):
        return anvil.server.HttpResponse(status, json.dumps(data), headers={"Content-Type": "application/json"})
    if not secret:
        return reply(503, {"error": "stripe_webhook_secret isn't set in App Secrets"})
    if not verify(raw, headers.get("stripe-signature"), secret):
        return reply(400, {"error": "bad signature"})
    try:
        event = json.loads(raw.decode("utf-8"))
    except ValueError:
        return reply(400, {"error": "bad json"})
    return reply(200, {"received": True, "result": handle_event(event)})


# ------------------------------------------------------------------------------------------------ admin
def _aware(v):
    return v if v.tzinfo else v.replace(tzinfo=dt.timezone.utc)


def _row(r):
    days_left = None
    if r["status"] == "held" and r["created"]:
        days_left = max(0, HOLD_DAYS - (C.now() - _aware(r["created"])).days)
    return {"id": r.get_id(), "email": r["email"] or (r["user"]["email"] if r["user"] else ""),
            "status": r["status"], "amount": (r["amount"] or 0) / 100.0, "currency": r["currency"] or "",
            "created": C.iso(r["created"]), "days_left": days_left, "note": r["note"] or "",
            "payment_intent": r["payment_intent"] or ""}


@anvil.server.callable(require_user=True)
def admin_lifetime():
    C.require_admin()
    s = settings()
    rows = sorted(app_tables.lifetime_purchases.search(), key=lambda r: r["created"] or C.now(), reverse=True)
    return {"settings": s, "key_set": bool(stripe_key()), "test_mode": test_mode(),
            "webhook_set": bool(_secret("stripe_webhook_secret")), "gate": gate_on(s),
            "webhook_url": (anvil.server.get_app_origin() or "").rstrip("/") + "/_/api/lifetime/stripe",
            "rows": [_row(r) for r in rows[:300]],
            "counts": {k: len([r for r in rows if r["status"] == k]) for k in
                       ("held", "paid", "granted", "cancelled", "expired", "refunded", "disputed")}}


@anvil.server.callable(require_user=True)
def admin_lifetime_settings(changes):
    C.require_admin()
    s = settings()
    for k, v in (changes or {}).items():
        if k == "off":
            s["off"] = bool(v)
        elif k == "unlock" and v in UNLOCKS:
            s["unlock"] = v
        elif k == "capture" and v in ("manual", "automatic"):
            s["capture"] = v
    C.set_setting(SETTING, s)
    return C.ok(settings=s, gate=gate_on(s))


def _get(row_id):
    try:
        return app_tables.lifetime_purchases.get_by_id(row_id)
    except Exception:
        return None


@anvil.server.callable(require_user=True)
def admin_lifetime_action(row_id, action):
    """capture | cancel | refund | revoke | sync on one purchase."""
    C.require_admin()
    r = _get(row_id)
    if r is None:
        return C.fail("That purchase is gone.")
    pi = r["payment_intent"]
    try:
        if action == "capture":
            if r["status"] != "held" or not pi:
                return C.fail("Only a held payment can be captured.")
            got = _stripe("payment_intents/%s/capture" % pi)
            r.update(status="paid" if got.get("status") == "succeeded" else r["status"], updated=C.now())
        elif action == "cancel":
            if r["status"] != "held" or not pi:
                return C.fail("Only a held payment can be cancelled. Use Refund for a captured one.")
            _stripe("payment_intents/%s/cancel" % pi, [("cancellation_reason", "fraudulent")])
            r.update(status="cancelled", updated=C.now())
        elif action == "refund":
            if r["status"] != "paid" or not pi:
                return C.fail("Only a captured payment can be refunded.")
            _stripe("refunds", [("payment_intent", pi)])
            r.update(status="refunded", updated=C.now())
        elif action == "revoke":
            if r["status"] != "granted":
                return C.fail("Only free access you gave can be taken back here.")
            r.update(status="revoked", updated=C.now())
        elif action == "sync":
            _sync(r)
        else:
            return C.fail("Unknown action.")
    except Exception as e:
        print("Lifetime %s failed: %r" % (action, e))
        return C.fail("Stripe said no: %s" % (getattr(e, "content", None) or e,))
    return C.ok(row=_row(r))


@anvil.server.callable(require_user=True)
def admin_lifetime_grant(email, note=""):
    """Give lifetime access for free (a friend, a reviewer, a support case)."""
    C.require_admin()
    email = C.text(email, 200).lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", email, re.I):
        return C.fail("That doesn't look like an email address.")
    user = app_tables.users.get(email=email)
    if user is None:
        return C.fail("Nobody with that email has an account yet. Ask them to sign up first.")
    row = app_tables.lifetime_purchases.add_row(user=user, email=email, status="granted", amount=0, currency="",
                                                session=None, payment_intent=None, created=C.now(),
                                                updated=C.now(), note=C.text(note, 300) or "Given by admin")
    return C.ok(row=_row(row))
