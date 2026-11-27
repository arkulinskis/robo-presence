/* Lifetime gate (local App Server, no Stripe key = gate off): signs in as the ADMIN_EMAILS address, opens
   Admin -> "Lifetime sales", checks it says the gate is off, closes it. Same file in every app (tools/lifetime_rollout.py).
   Resolves to {ok, log}. If the local database already has admin@example.com with another password (from the
   app's own smoke/admin tests), sign-in times out: `docker volume rm <key>-data` (local test data only) and rerun. */
(async function () {
  const log = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, what, ms) {
    const end = Date.now() + (ms || 30000);
    while (Date.now() < end) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(150); }
    throw new Error('timed out waiting for: ' + what);
  }
  const $ = (s) => document.querySelector(s), $$ = (s) => Array.from(document.querySelectorAll(s));
  const ok = (c, m) => { if (!c) throw new Error('FAILED: ' + m); log.push('ok   ' + m); };
  function type(input, value) {
    input.focus(); input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  try {
    if (location.hash !== '#auth') { window.UI_READY = false; location.hash = '#auth'; }
    await until(() => $$('.au-card input').length >= 2, '#auth');
    await sleep(300);
    const inputs = () => $$('.au-card input[type=text], .au-card input[type=email], .au-card input[type=password]').filter((i) => i.offsetParent);
    const pw = 'Rp-smoke-adm-93Kx-7q';
    type(inputs()[0], 'admin@example.com'); type(inputs()[1], pw);
    $$('.anvil-role-btn-block button').find((b) => /Sign in/.test(b.textContent)).click();
    await sleep(3000);
    if (location.hash.indexOf('#auth') === 0 || location.hash === '') {  // no account yet in this local database: create it
      $$('.ui-seg button').find((b) => /Create account/.test(b.textContent)).click();
      await sleep(500);
      const i = inputs(); type(i[0], 'Local Admin'); type(i[1], 'admin@example.com'); type(i[2], pw);
      const tick = $('.au-card input[type=checkbox]'); if (tick && !tick.checked) tick.click();
      $$('.anvil-role-btn-block button').find((b) => /Create account/.test(b.textContent)).click();
    }
    // apps land on different pages after sign-in (#home, #notebook, #books ...): any page but #auth counts
    await until(() => location.hash && location.hash.indexOf('#auth') !== 0 && window.UI_READY, 'signed in as admin', 40000);
    window.UI_READY = false; location.hash = '#admin/overview';
    const btn = await until(() => $$('button').find((b) => /Lifetime sales/.test(b.textContent) && b.offsetParent), 'the Lifetime sales button on #admin', 40000);
    ok(true, 'admin has the Lifetime sales button');
    btn.click();
    await until(() => $('.lifetime-sales') && /Gate off/.test($('.lifetime-sales').textContent), 'Lifetime sales dialog', 30000);
    ok(/No purchases yet|to review/.test($('.lifetime-sales').textContent), 'Lifetime sales: gate off, list drawn');
    $$('.lifetime-sales button').find((b) => /Close/.test(b.textContent)).click();
    await until(() => !$('.lifetime-sales'), 'dialog closes');
    ok(true, 'Lifetime sales closes');
    log.push('PASSED');
    return { ok: true, log };
  } catch (e) {
    log.push(String(e && e.message || e));
    return { ok: false, log };
  }
})();
