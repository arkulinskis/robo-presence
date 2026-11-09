/* Smoke test (tools/ui_test.py runs it at 1280 px and at 390 px): every page address opens without errors, is not
   empty and doesn't scroll sideways. Signed out: landing, guide, the simulator cockpit, sign in / up. As a new member:
   garage, New robot, the robot page's five tabs (Parts: add a part, Sharing: make a guest pass), the simulator with the
   robot's parts, robot mode, a showroom robot, profile. Signed out again: the guest pass page. As admin: every Admin tab.
   Python/JS errors are caught by ui_test.py from the browser log. Resolves to {ok, log}. */
(async function () {
  const log = [], bad = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, what, ms) {
    const end = Date.now() + (ms || 20000);
    while (Date.now() < end) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(150); }
    throw new Error('timed out waiting for: ' + what);
  }
  const $ = (s) => document.querySelector(s), $$ = (s) => Array.from(document.querySelectorAll(s));
  const errs = [];
  window.addEventListener('error', (e) => errs.push(String(e.message || e)));
  function type(input, value) {
    input.focus(); input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function button(re, root) { return $$((root || '') + ' button').find((b) => re.test(b.textContent) && b.offsetParent !== null); }
  async function open(hash, expect, opts) {
    opts = opts || {};
    if (location.hash !== hash) window.UI_READY = false;
    location.hash = hash;
    await until(() => window.UI_READY && (opts.landed ? opts.landed() : location.hash === hash), hash, 40000);
    await sleep(opts.wait || 700);
    const main = opts.root ? $(opts.root) : $('.ui-main');
    const text = main ? main.innerText.trim() : '';
    const w = document.documentElement.scrollWidth, vw = screen.width <= 500 ? screen.width : window.innerWidth;
    const problems = [];
    if (text.length < 30) problems.push('empty page');
    if (expect && !new RegExp(expect.source, 'i').test(text)) problems.push('missing ' + expect);
    if (w > vw + 1) {
      const wide = $$('body *').filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > vw + 1; })
        .slice(0, 3).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).split(' ').slice(0, 2).join('.'));
      problems.push('scrolls sideways (' + w + ' > ' + vw + ') ' + wide.join(' '));
    }
    if (errs.length) problems.push('errors: ' + errs.splice(0).join(' / '));
    if (problems.length) bad.push(hash + ': ' + problems.join('; '));
    log.push((problems.length ? 'BAD  ' : 'ok   ') + hash);
  }
  async function signUp(name, email, password) {
    location.hash = '#auth/signup';
    await until(() => window.UI_READY && $$('.au-card input').length >= 3, 'sign-up form');
    await sleep(400);
    const inputs = $$('.au-card input[type=text], .au-card input[type=email], .au-card input[type=password]');
    type(inputs[0], name); type(inputs[1], email); type(inputs[2], password);
    const tick = $('.au-card input[type=checkbox]'); if (tick && !tick.checked) tick.click();
    button(/Create account/, '.au-card .anvil-role-btn-block').click();
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      if (location.hash.indexOf('#garage') === 0 && window.UI_READY) return true;
      const msg = $('.au-card .anvil-role-msg-error');
      if (msg && msg.offsetParent !== null && msg.textContent.trim()) { log.push('sign-up said: ' + msg.textContent.trim()); return false; }
      await sleep(200);
    }
    log.push('sign-up: still on ' + location.hash);
    return false;
  }
  async function signIn(email, password) {
    location.hash = '#auth';
    await until(() => window.UI_READY && $$('.au-card input[type=password]').length, 'sign-in form');
    await sleep(400);
    type($('.au-card input[type=email]'), email); type($('.au-card input[type=password]'), password);
    button(/Sign in/, '.au-card .anvil-role-btn-block').click();
    await until(() => location.hash.indexOf('#garage') === 0 && window.UI_READY, 'signed in as ' + email, 30000);
  }
  async function signOut() {
    location.hash = '#profile';
    await until(() => window.UI_READY && location.hash === '#profile' && button(/Sign out/, '.pf-links'), 'profile');
    await sleep(300);
    button(/Sign out/, '.pf-links').click();
    await until(() => {
      const a = $('.anvil-role-avatar button');
      return location.hash === '#landing' && window.UI_READY && (!a || a.offsetParent === null);
    }, 'signed out');
    await sleep(500);
  }
  try {
    // ---- signed out
    await open('#landing', /Drive it from anywhere/);
    if (!$('.lp-hart .rp-art')) bad.push('#landing: no robot picture in the hero');
    if (!$('[data-prepsto-open]') || !/arkvital\.com/.test(document.body.innerText) || !/addanapp\.com/.test(document.body.innerText)) bad.push('footer links missing');
    await open('#guide', /From parts bin to driving/);
    await open('#guide/arduino', /Arduino/);
    await open('#drive', /STOP/, { root: '.dv-page', wait: 2500 });
    if (!$('.ck video, .ck canvas')) bad.push('#drive: no simulator picture');
    await open('#auth', /Sign in/);
    await open('#auth/signup', /Create account/);

    // ---- a new member
    const ok = await signUp('Smoke Tester', 'smoke' + Date.now() + '@example.com', 'Rp-' + Math.random().toString(36).slice(2) + '-Kq7');
    if (!ok) throw new Error('sign-up failed');
    await open('#garage', /Showroom/);
    const showroom = $$('.gr-card').map((a) => a.getAttribute('href')).filter(Boolean);
    button(/New robot/).click();
    await until(() => button(/Build it/), 'new robot dialog', 15000);
    type($('.nr-dialog input[type=text], .nr-dialog input:not([type])'), 'Smokey');
    button(/Build it/).click();
    await until(() => /^#robot\/.+\/install$/.test(location.hash) && window.UI_READY, 'new robot install tab', 30000);
    const id = decodeURIComponent(location.hash.split('/')[1]);
    const rh = '#robot/' + encodeURIComponent(id);
    await open(rh + '/install', /Install the robot code/);
    if (!/curl -fsSL/.test($('.ui-main').innerText)) bad.push('install: no install command');
    await open(rh + '/overview', /What its parts describe|reports/);
    await open(rh + '/parts', /What the pilot gets/);
    const nParts = $$('.pb-part').length;
    const add = $$('.pb-cat').find((b) => /Switch/.test(b.textContent));
    if (add) { add.click(); await sleep(900); if ($$('.pb-part').length !== nParts + 1) bad.push('parts: Add a part did not add a card'); }
    else bad.push('parts: no catalog');
    if (!$('.rb-pins svg')) bad.push('parts: no pin map');
    button(/Save parts/).click();
    await sleep(2500);
    await open(rh + '/sharing', /Guest passes/);
    button(/^\s*Make\s*$/).click();
    await until(() => /#drive\/pass\//.test(($('.rb-pass') || {}).innerText || ''), 'the new guest link', 20000);
    const passLink = ($('.rb-pass .anvil-role-cmd-text') || {}).innerText || '';
    const token = (passLink.split('#drive/pass/')[1] || '').trim();
    await open(rh + '/log', /Robot log/);
    await open('#drive/sim/' + encodeURIComponent(id), /STOP/, { root: '.dv-page', wait: 2000 });
    await open('#bot/' + encodeURIComponent(id), /This device is Smokey/);
    if (showroom.length) {
      await open(showroom[showroom.length - 1], /Built by/);
      await open(showroom[showroom.length - 1].replace('#robot/', '#drive/'), /STOP/, { root: '.dv-page', wait: 2000 });
    } else bad.push('garage: no showroom robots');
    await open('#profile', /Your name/);
    await open('#landing', /Open your garage/);
    await signOut();

    // ---- a guest with a pass
    if (token) await open('#drive/pass/' + token, /Smokey/, { root: '.dv-page' });
    else bad.push('sharing: no guest pass token');

    // ---- admin (ADMIN_EMAILS in Accounts.py): sign up the first time, sign in after that
    const adminPw = 'Rp-smoke-adm-93Kx-7q';
    if (!(await signUp('Admin Tester', 'arkulinskis@gmail.com', adminPw))) await signIn('arkulinskis@gmail.com', adminPw);
    for (const t of ['overview', 'robots', 'feedback', 'users', 'demo', 'network']) await open('#admin/' + t, /Admin/);
    if (!/stun:/.test(($('.ad-net textarea') || {}).value || '')) bad.push('#admin/network: no ICE servers');
    await signOut();
    log.push(bad.length ? 'PROBLEMS: ' + bad.join(' | ') : 'PASSED');
    return { ok: !bad.length, log: log };
  } catch (e) {
    log.push(String(e && e.message || e));
    if (bad.length) log.push('PROBLEMS: ' + bad.join(' | '));
    return { ok: false, log: log };
  }
})();
