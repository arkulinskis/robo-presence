"""Tests for the $34 lifetime gate (server_code/Lifetime.py). Same file in every app (tools/lifetime_rollout.py).

    python tools/testing/test_lifetime.py      -> prints ALL OK, or the first failure

Self-contained: only the users, app_settings and lifetime_purchases tables; Stripe is faked (no network).
"""
import datetime as dt
import hashlib
import hmac
import importlib
import json
import os
import pathlib
import shutil
import sys
import tempfile
import time
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
PROJECT = HERE.parents[1]
_tmp = pathlib.Path(tempfile.mkdtemp())
shutil.copytree(PROJECT / "server_code", _tmp / "app")
(_tmp / "app" / "__init__.py").write_text("")
os.environ["ANVIL_APP_YAML"] = str(PROJECT / "anvil.yaml")
sys.path[:0] = [str(HERE / "mock"), str(_tmp)]
import anvil.http  # noqa: E402
import anvil.secrets  # noqa: E402
import anvil.server  # noqa: E402
import anvil.users  # noqa: E402
from anvil.tables import app_tables as T  # noqa: E402

L = importlib.import_module("app.Lifetime")
now = dt.datetime.now(dt.timezone.utc)
STRIPE = {"pi": {}}   # payment intent id -> status


def fake_stripe(url, method, data):
    path = url.split("/v1/", 1)[1]
    form = dict(urllib.parse.parse_qsl(data or ""))
    if path.startswith("checkout/sessions") and method == "POST":
        STRIPE["last_checkout"] = form
        return {"id": "cs_test_abc", "url": "https://checkout.stripe.com/c/pay/cs_test_abc"}
    if path.startswith("checkout/sessions/"):
        sid = path.split("/")[2].split("?")[0]
        pi_id = "pi_" + sid[-3:]
        return {"id": sid, "status": "complete", "payment_status": "unpaid", "amount_total": 3400, "currency": "usd",
                "client_reference_id": STRIPE["ref"], "customer_details": {"email": "buyer@example.com"},
                "payment_intent": {"id": pi_id, "status": STRIPE["pi"].get(pi_id, "requires_capture")},
                "metadata": {"lifetime": "1"}}
    if path.endswith("/capture"):
        pi_id = path.split("/")[1]
        STRIPE["pi"][pi_id] = "succeeded"
        return {"id": pi_id, "status": "succeeded"}
    if path.endswith("/cancel"):
        pi_id = path.split("/")[1]
        STRIPE["pi"][pi_id] = "canceled"
        return {"id": pi_id, "status": "canceled", "cancellation_reason": form.get("cancellation_reason")}
    if path.startswith("payment_intents/"):
        pi_id = path.split("/")[1].split("?")[0]
        st = STRIPE["pi"].get(pi_id, "requires_capture")
        return {"id": pi_id, "status": st, "cancellation_reason": "automatic" if st == "canceled" else None}
    if path.startswith("refunds"):
        return {"id": "re_1", "status": "succeeded"}
    raise anvil.http.HttpError(404, "unknown fake path " + path)


anvil.http.REPLIES["https://api.stripe.com/v1/"] = fake_stripe


def as_user(row):
    anvil.users.CURRENT[0] = row
    if hasattr(anvil.server.session, "use"):
        anvil.server.session.use(row.get_id() if row is not None else None)


def person(email, admin=False):
    return T.users.add_row(email=email, enabled=True, is_admin=admin)


def check(cond, what):
    if not cond:
        raise AssertionError(what)


def sign(body, secret, t=None):
    t = int(t or time.time())
    v = hmac.new(secret.encode(), str(t).encode() + b"." + body, hashlib.sha256).hexdigest()
    return "t=%d,v1=%s" % (t, v)


def main():
    buyer, admin = person("buyer@example.com"), person("boss@example.com", admin=True)
    anvil.secrets.SECRETS.clear()

    # 1. no Stripe key: free for everyone, nothing to buy
    as_user(buyer)
    s = L.lifetime_status()
    json.dumps(s)
    check(s["gate"] is False and s["unlocked"] is True and s["state"] == "free", "free before the key: %r" % s)
    check(L.lifetime_checkout()["ok"] is False, "no checkout while free")
    anvil.secrets.SECRETS["stripe_secret_key"] = "not-a-key"
    check(L.gate_on() is False, "a malformed key keeps the gate off")

    # 2. key set: buyer locked, admin unlocked, guests locked
    anvil.secrets.SECRETS["stripe_secret_key"] = "sk_test_123"
    check(L.lifetime_status()["state"] == "locked" and not L.unlocked(buyer), "buyer locked with the key")
    check(L.unlocked(admin), "admins always unlocked")
    as_user(None)
    check(L.lifetime_status()["state"] == "signed_out", "guest sees signed_out")
    as_user(buyer)

    # 3. checkout: $34, manual capture, card, the buyer's ref
    r = L.lifetime_checkout()
    check(r["ok"] and r["url"].startswith("https://checkout.stripe.com"), "checkout url: %r" % r)
    f = STRIPE["last_checkout"]
    check(f["line_items[0][price_data][unit_amount]"] == "3400", "34 dollars")
    check(f["payment_intent_data[capture_method]"] == "manual", "manual capture by default")
    check(f["success_url"].endswith("/#lifetime/{CHECKOUT_SESSION_ID}"), "success url")
    STRIPE["ref"] = f["client_reference_id"]
    check(L.user_from_ref(STRIPE["ref"]) == buyer, "ref maps back to the buyer")

    # 4. back from Stripe: held = unlocked + pending; "capture" mode keeps it locked until captured
    check(L.lifetime_confirm("bogus")["ok"] is False, "bad session id refused")
    c = L.lifetime_confirm("cs_test_abc")
    check(c["ok"] and c["status"] == "held" and c["unlocked"], "held after checkout: %r" % c)
    check(L.lifetime_confirm("cs_test_abc")["ok"] and len(T.lifetime_purchases.search()) == 1, "confirm is idempotent")
    check(L.lifetime_status()["state"] == "pending", "pending state")
    check(L.lifetime_checkout()["ok"] is False, "can't buy twice")
    as_user(admin)
    L.admin_lifetime_settings({"unlock": "capture"})
    check(not L.unlocked(buyer), "capture mode: held is not enough")
    check(L.lifetime_status()["to_review"] == 1, "admin sees one to review")

    # 5. admin captures -> paid -> unlocked in either mode
    d = L.admin_lifetime()
    json.dumps(d)
    row = d["rows"][0]
    check(row["status"] == "held" and row["days_left"] == 7, "admin row: %r" % row)
    check(L.admin_lifetime_action(row["id"], "capture")["ok"], "capture ok")
    check(T.lifetime_purchases.search()[0]["status"] == "paid" and L.unlocked(buyer), "paid unlocks")
    L.admin_lifetime_settings({"unlock": "hold"})

    # 6. webhook: bad signature refused; refund locks
    anvil.secrets.SECRETS["stripe_webhook_secret"] = "whsec_x"
    ev = json.dumps({"type": "charge.refunded", "data": {"object": {"payment_intent": "pi_abc", "refunded": True}}}).encode()
    check(L.verify(ev, sign(ev, "whsec_x"), "whsec_x"), "good signature")
    check(not L.verify(ev, sign(ev, "wrong"), "whsec_x"), "bad signature")
    check(not L.verify(ev, sign(ev, "whsec_x", time.time() - 1000), "whsec_x"), "old signature")
    check(L.handle_event(json.loads(ev)) == "refunded" and not L.unlocked(buyer), "refund locks")

    # 7. a second purchase whose hold expires; cancel by admin; dispute
    T.lifetime_purchases.delete_all_rows()
    STRIPE["pi"].clear()
    as_user(buyer)
    L.lifetime_confirm("cs_test_xyz")
    as_user(admin)
    rid = L.admin_lifetime()["rows"][0]["id"]
    check(L.admin_lifetime_action(rid, "refund")["ok"] is False, "a held payment can't be refunded")
    check(L.admin_lifetime_action(rid, "cancel")["ok"] and not L.unlocked(buyer), "cancel removes access")
    T.lifetime_purchases.delete_all_rows()
    as_user(buyer)
    L.lifetime_confirm("cs_test_old")
    T.lifetime_purchases.search()[0]["created"] = now - dt.timedelta(days=9)
    STRIPE["pi"]["pi_old"] = "canceled"
    check(not L.unlocked(buyer) and T.lifetime_purchases.search()[0]["status"] == "expired", "expired hold re-checked")
    evd = {"type": "charge.dispute.created", "data": {"object": {"payment_intent": "pi_old"}}}
    T.lifetime_purchases.search()[0]["status"] = "paid"
    check(L.handle_event(evd) == "disputed" and not L.unlocked(buyer), "a dispute locks")

    # 8. free access by email; revoke; the off switch; caps
    as_user(admin)
    check(L.admin_lifetime_grant("nobody@example.com")["ok"] is False, "grant needs an account")
    g = L.admin_lifetime_grant("buyer@example.com", "friend")
    check(g["ok"] and L.unlocked(buyer), "granted unlocks")
    check(L.admin_lifetime_action(g["row"]["id"], "revoke")["ok"] and not L.unlocked(buyer), "revoke locks")
    check(L.within_cap(buyer, "__no_such_cap__", 999), "no cap configured = no limit")
    L.admin_lifetime_settings({"off": True})
    check(not L.gate_on() and L.unlocked(buyer), "off switch frees everything")
    as_user(buyer)
    try:
        L.admin_lifetime()
        check(False, "non-admin must be refused")
    except anvil.server.PermissionDenied:
        pass
    print("lifetime: ALL OK")


if __name__ == "__main__":
    main()
