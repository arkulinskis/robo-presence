/* core.js: the shared front-end engine (window.UI). Same in every app made from APP_MAKER/template;
   app-specific things live in web/app.js (brand, nav, footer) and web/pages/*.html (the pages).

   Pages:   UI.page(name, {title, nav, icon, auth, order, chrome}, mount)
              auth: null (anyone) | 'guest' (signed-out only) | 'user' | 'admin'
              nav: label for the header / phone tab bar (omit to keep it out of the menus)
              mount(view, ctx) draws into `view`; ctx = {args, me, go, api}. Return a Promise (the page
              is "ready" when it resolves) or {ready, destroy}. URLs are #name/arg1/arg2.
   Server:  UI.api(fn, ...args) -> Promise of the server function's return value. A reply of
              {ok: false, error} rejects with that message (shown as a toast unless you .catch it).
            UI.apiQuiet(fn, ...args) is the same without Anvil's loading spinner.
   Auth:    UI.auth('login'|'signup'|'reset'|'logout', {...}) -> Promise of {ok, me, message}
   Helpers: UI.esc, UI.icon, UI.toast, UI.modal, UI.confirm, UI.busy, UI.formData, UI.fmtDate, UI.ago,
            UI.store, UI.setTheme, UI.feedback, UI.go, UI.refresh
   Tests:   window.UI_READY is true when the current page has finished loading. */
(function () {
  'use strict';
  if (window.UI && window.UI.__v) return;
  var UI = window.UI = { __v: 1, pages: {}, me: null, config: { name: 'App', key: 'app', home: 'home', landing: 'landing' } };
  window.UI_READY = false;

  UI.configure = function (cfg) { Object.keys(cfg).forEach(function (k) { UI.config[k] = cfg[k]; }); };

  /* ------------------------------------------------------------------ small helpers */
  UI.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  UI.plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };
  UI.initials = function (name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  };
  UI.fmtDate = function (iso, opts) {
    if (!iso) return '';
    var d = iso.length <= 10 ? new Date(iso + 'T12:00:00') : new Date(iso);
    return d.toLocaleDateString(undefined, opts || { day: 'numeric', month: 'short', year: 'numeric' });
  };
  UI.fmtDateTime = function (iso) {
    return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  };
  UI.ago = function (iso) {
    if (!iso) return '';
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    var steps = [[60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']], n = s / 60;
    for (var i = 0; i < steps.length; i++) {
      if (n < steps[i][0]) { n = Math.floor(n); return UI.plural(n, steps[i][1]) + ' ago'; }
      n = n / steps[i][0];
    }
    return '';
  };
  UI.store = {
    get: function (k, dflt) { try { var v = localStorage.getItem(UI.config.key + '.' + k); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; } },
    set: function (k, v) { try { localStorage.setItem(UI.config.key + '.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  UI.formData = function (form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    });
    return out;
  };
  /* Disable a button while a Promise runs; returns the Promise. */
  UI.busy = function (btn, promise) {
    if (!btn) return promise;
    btn.disabled = true; btn.classList.add('is-busy');
    var done = function () { btn.disabled = false; btn.classList.remove('is-busy'); };
    promise.then(done, done);
    return promise;
  };

  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.7c2.2.6 3.5 2.4 3.5 5.3"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    bug: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 8V5M9 5.5 7.5 4M15 5.5 16.5 4M7 13H3M21 13h-4M7.5 18l-3 2M16.5 18l3 2M7.5 9.5l-3-2M16.5 9.5l3-2"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'
  };
  UI.ICONS = ICONS;
  UI.icon = function (name, cls) {
    return '<svg class="ui-ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.sparkle) + '</svg>';
  };

  /* ------------------------------------------------------------------ toasts, modals */
  UI.toast = function (msg, kind) {
    var box = document.querySelector('.ui-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'ui ui-toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var t = document.createElement('div');
    t.className = 'ui-toast' + (kind ? ' ' + kind : '');
    t.innerHTML = (kind === 'error' ? UI.icon('info') : kind === 'ok' ? UI.icon('check') : '') + '<span>' + UI.esc(msg) + '</span>';
    box.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 300); }, kind === 'error' ? 6500 : 3200);
  };
  UI.modal = function (html, opts) {
    opts = opts || {};
    var prev = document.activeElement;
    var wrap = document.createElement('div');
    wrap.className = 'ui ui-modal-wrap';
    wrap.innerHTML = '<div class="ui-modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
      '<button class="ui-btn ghost icon ui-modal-x" data-close aria-label="Close">' + UI.icon('x') + '</button>' + html + '</div>';
    document.body.appendChild(wrap);
    document.documentElement.classList.add('ui-modal-open');
    function key(e) { if (e.key === 'Escape') close(); }
    function close() {
      if (!wrap.parentNode) return;
      wrap.remove(); document.removeEventListener('keydown', key);
      if (!document.querySelector('.ui-modal-wrap')) document.documentElement.classList.remove('ui-modal-open');
      if (opts.onclose) opts.onclose();
      if (prev && prev.focus) prev.focus();
    }
    document.addEventListener('keydown', key);
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
    var first = wrap.querySelector('input, textarea, select');
    setTimeout(function () { (first || wrap.querySelector('.ui-modal')).focus && (first || wrap.querySelector('.ui-modal')).focus(); }, 30);
    return { el: wrap.querySelector('.ui-modal'), close: close };
  };
  UI.confirm = function (o) {
    o = typeof o === 'string' ? { title: o } : (o || {});
    return new Promise(function (resolve) {
      var answered = false;
      var m = UI.modal('<h2>' + UI.esc(o.title || 'Are you sure?') + '</h2>' + (o.text ? '<p class="muted">' + UI.esc(o.text) + '</p>' : '') +
        '<div class="ui-row end" style="margin-top:20px"><button class="ui-btn ghost" data-close>' + UI.esc(o.cancel || 'Cancel') + '</button>' +
        '<button class="ui-btn ' + (o.danger ? 'danger solid' : 'primary') + '" data-ok>' + UI.esc(o.ok || 'OK') + '</button></div>',
      { onclose: function () { if (!answered) resolve(false); } });
      m.el.querySelector('[data-ok]').onclick = function () { answered = true; m.close(); resolve(true); };
    });
  };

  /* ------------------------------------------------------------------ theme */
  UI.theme = function () { return UI.store.get('theme', 'auto'); };
  UI.applyTheme = function (t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var dark = t === 'dark' || (t !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('ui-dark', !!dark);
  };
  UI.setTheme = function (t) { UI.store.set('theme', t); UI.applyTheme(t); };
  UI.applyTheme(UI.theme());
  if (window.matchMedia) {
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { UI.applyTheme(UI.theme()); }); } catch (e) {}
  }

  /* ------------------------------------------------------------------ server bridge */
  var bridge = null;
  function send(kind, payload) {
    if (!bridge) return Promise.reject(new Error('The app is still starting.'));
    var out;
    try { out = bridge(kind, JSON.stringify(payload || {})); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(out).then(function (r) {
      r = typeof r === 'string' ? JSON.parse(r) : (r || {});
      if (r.error) {
        var err = new Error(r.error); err.uiApi = true; err.denied = !!r.denied;
        if (r.detail) console.error(kind, payload && payload.fn, r.detail);
        if (r.reload) setTimeout(function () { location.reload(); }, 2500);
        throw err;
      }
      return r.result;
    });
  }
  function apiCall(quiet, fn, args) {
    return send('call', { fn: fn, args: args, quiet: quiet }).then(function (res) {
      if (res && typeof res === 'object' && res.ok === false) {
        var err = new Error(res.error || 'That didn\'t work.'); err.uiApi = true; err.expected = true; err.result = res;
        throw err;
      }
      return res;
    });
  }
  UI.api = function (fn) { return apiCall(false, fn, Array.prototype.slice.call(arguments, 1)); };
  UI.apiQuiet = function (fn) { return apiCall(true, fn, Array.prototype.slice.call(arguments, 1)); };
  /* Errors nobody caught become a toast, so a failed action is never silent. */
  window.addEventListener('unhandledrejection', function (e) {
    if (e.reason && e.reason.uiApi) { e.preventDefault(); UI.toast(e.reason.message, 'error'); }
  });

  /* Sign in / up / out. On success it navigates: to where the visitor was heading (UI.after) or home
     after signing in, to the landing page after signing out. */
  UI.auth = function (kind, payload) {
    return send(kind, payload || {}).then(function (r) {
      if (r && r.ok === false) { var err = new Error(r.error); err.uiApi = true; err.expected = true; throw err; }
      if (r && 'me' in r && (r.me || kind === 'logout')) {
        UI.me = r.me || null;
        var target = r.me ? (UI.after || '#' + UI.config.home) : '#' + UI.config.landing;
        UI.after = null;
        if (location.hash === target) route(); else location.hash = target;
      }
      return r;
    });
  };
  /* Update the signed-in user's details (e.g. a new name) and redraw the header, without reloading the page. */
  UI.setMe = function (me) {
    UI.me = me || null;
    if (shellRoot) renderChrome(current.name);
  };

  /* ------------------------------------------------------------------ pages and routing */
  UI.page = function (name, opts, mount) {
    if (typeof opts === 'function') { mount = opts; opts = {}; }
    opts.name = name; opts.mount = mount;
    UI.pages[name] = opts;
  };
  UI.allowed = function (p) {
    if (!p) return false;
    if (p.auth === 'user') return !!UI.me;
    if (p.auth === 'admin') return !!(UI.me && UI.me.is_admin);
    if (p.auth === 'guest') return !UI.me;
    return true;
  };
  UI.navPages = function () {
    return Object.keys(UI.pages).map(function (k) { return UI.pages[k]; })
      .filter(function (p) { return p.nav && UI.allowed(p) && (!p.when || p.when()); })
      .sort(function (a, b) { return (a.order || 50) - (b.order || 50); });
  };
  UI.parseHash = function () {
    var h = (location.hash || '').replace(/^#!?\/?/, '');
    var parts = h.split('?')[0].split('/').filter(function (x) { return x !== ''; }).map(decodeURIComponent);
    return { name: parts[0] || '', args: parts.slice(1) };
  };
  UI.hashFor = function (name) {
    var args = Array.prototype.slice.call(arguments, 1).filter(function (a) { return a != null && a !== ''; });
    return '#' + [name].concat(args.map(encodeURIComponent)).join('/');
  };
  UI.go = function (name) {
    var h = UI.hashFor.apply(null, arguments);
    if (location.hash === h) route(); else location.hash = h;
  };
  UI.refresh = function () { route(); };
  UI.after = null;  // where to go after signing in

  var shellRoot = null, view = null, current = { name: null, destroy: null }, routeSeq = 0;

  function defaultPage() { return UI.me ? UI.config.home : UI.config.landing; }

  function route() {
    var r = UI.parseHash(), name = r.name || defaultPage(), p = UI.pages[name];
    if (!p) { name = defaultPage(); p = UI.pages[name]; r.args = []; }
    if (p.auth === 'guest' && UI.me) { p = UI.pages[UI.config.home]; name = UI.config.home; r.args = []; }
    if ((p.auth === 'user' || p.auth === 'admin') && !UI.me) {
      UI.after = location.hash && location.hash !== '#' ? location.hash : null;
      p = UI.pages.auth; name = 'auth'; r.args = [];
    }
    if (p.auth === 'admin' && !(UI.me && UI.me.is_admin)) {
      UI.toast('That page is for admins only.', 'error');
      p = UI.pages[UI.config.home]; name = UI.config.home; r.args = [];
    }
    var seq = ++routeSeq;
    window.UI_READY = false;
    if (current.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
    current = { name: name, args: r.args, destroy: null };
    if (shellRoot) {
      shellRoot.className = 'ui ui-shell page-' + name + (UI.me ? ' signed-in' : ' signed-out') + (p.chrome === false ? ' no-chrome' : '');
      renderChrome(name);
    }
    // A fresh element for every page, so listeners a page adds to `view` never pile up.
    var fresh = view.cloneNode(false);
    view.parentNode.replaceChild(fresh, view);
    view = fresh;
    window.scrollTo(0, 0);
    document.title = (p.title ? (typeof p.title === 'function' ? p.title(r.args) : p.title) + ' · ' : '') + UI.config.name;
    var ctx = { name: name, args: r.args, me: UI.me, go: UI.go, api: UI.api, page: p };
    var out;
    try { out = p.mount(view, ctx); } catch (e) { console.error(e); out = Promise.reject(e); }
    var ready = out && typeof out.then === 'function' ? out : (out && out.ready) || Promise.resolve();
    if (out && out.destroy) current.destroy = out.destroy;
    Promise.resolve(ready).then(function () { if (seq === routeSeq) window.UI_READY = true; },
      function (e) {
        if (seq !== routeSeq) return;
        console.error(e);
        if (!view.innerHTML) view.innerHTML = '<div class="ui-wrap"><div class="ui-empty">' + UI.icon('info') +
          '<h3>This page didn\'t load</h3><p class="muted">' + UI.esc(e && e.message || 'Something went wrong.') + '</p>' +
          '<button class="ui-btn" onclick="UI.refresh()">Try again</button></div></div>';
        window.UI_READY = true;
      });
  }
  UI.current = function () { return current; };

  /* The shell's parts come from web/app.js: UI.shell = {header(me, active), footer(me), tabbar(me, active)} */
  function renderChrome(active) {
    var S = UI.shell || {};
    var hd = shellRoot.querySelector('[data-ui-header]'), ft = shellRoot.querySelector('[data-ui-footer]'), tb = shellRoot.querySelector('[data-ui-tabbar]');
    if (hd) hd.innerHTML = S.header ? S.header(UI.me, active) : '';
    if (ft) ft.innerHTML = S.footer ? S.footer(UI.me, active) : '';
    if (tb) tb.innerHTML = S.tabbar ? S.tabbar(UI.me, active) : '';
  }
  UI.renderChrome = function () { if (shellRoot) renderChrome(current.name); };

  /* Called by client_code/Main.py (and by the local harness) once the page is up. */
  UI.start = function (node, bridgeFn, bootJson) {
    bridge = bridgeFn;
    var boot = typeof bootJson === 'string' ? JSON.parse(bootJson || '{}') : (bootJson || {});
    UI.me = boot.me || null;
    var host = node && node.matches && node.matches('[data-ui-app]') ? node : (node && node.querySelector('[data-ui-app]')) || node || document.body;
    host.innerHTML = '<div class="ui ui-shell">' +
      '<header class="ui-header" data-ui-header></header>' +
      '<main class="ui-main" data-ui-view></main>' +
      '<footer class="ui-footer" data-ui-footer></footer>' +
      '<nav class="ui-tabbar" data-ui-tabbar aria-label="Main"></nav></div>';
    shellRoot = host.firstChild;
    view = host.querySelector('[data-ui-view]');
    if (UI.shell && UI.shell.wire) UI.shell.wire(shellRoot);
    window.addEventListener('hashchange', route);
    route();
  };

  /* ------------------------------------------------------------------ feedback (footer + menu)
     All feedback goes to Prepsto. The widget tag in head.html (data-prepsto="CODE") slides its panel in;
     any [data-feedback] or [data-prepsto-open] element opens it. If the widget hasn't loaded, the panel opens in a new tab.
     There is no in-app feedback form any more: Admin -> Feedback only lists older messages (and app requests). */
  UI.feedback = function () {
    if (window.Prepsto && window.Prepsto.open) { window.Prepsto.open(); return; }
    var tag = document.querySelector('script[data-prepsto]');
    var code = tag && tag.getAttribute('data-prepsto');
    if (code && code.indexOf('__') !== 0) window.open('https://prepsto.com/#f/' + encodeURIComponent(code), '_blank', 'noopener');
    else UI.toast('Feedback is not set up yet.', 'error');
  };

  /* Shared clicks: [data-go="page/arg"], [data-feedback], [data-theme-set] anywhere in the app. */
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-go],[data-feedback],[data-theme-set]');
    if (!el) return;
    if (el.hasAttribute('data-go')) { e.preventDefault(); UI.go.apply(null, el.getAttribute('data-go').split('/')); }
    else if (el.hasAttribute('data-feedback')) { e.preventDefault(); UI.feedback(el.getAttribute('data-feedback') || null); }
    else if (el.hasAttribute('data-theme-set')) { e.preventDefault(); UI.setTheme(el.getAttribute('data-theme-set')); if (UI.shell && UI.shell.onTheme) UI.shell.onTheme(); }
  });
})();


/* app.js: this app's identity and frame: name, header, footer, phone tab bar.
   Pages live in web/pages/*.html. The engine (window.UI) is web/core.js. */
(function () {
  'use strict';
  UI.configure({
    name: 'Robo Presence',
    key: 'robopresence',          // prefix for this app's browser storage
    tagline: 'Remote eyes and wheels, built in a garage.',   // footer line
    home: 'garage',              // first page after signing in
    landing: 'landing'           // first page for visitors who aren't signed in
  });

  var esc = UI.esc;

  function brand() {
    return '<a class="ui-brand" href="#" data-go="' + (UI.me ? UI.config.home : UI.config.landing) + '" aria-label="' + esc(UI.config.name) + ' home">' +
      '<img src="_/theme/icon.svg" alt="" width="32" height="32"><span>' + esc(UI.config.name) + '</span></a>';
  }

  function themeSwitch() {
    var t = UI.theme();
    return '<div class="ui-seg" role="group" aria-label="Appearance">' + [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
      return '<button type="button" data-theme-set="' + o[0] + '" class="' + (t === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function userMenu(me) {
    return '<div class="ui-menu" data-menu hidden>' +
      '<div class="ui-menu-head"><strong>' + esc(me.name) + '</strong><span class="muted small">' + esc(me.email) + '</span></div>' +
      '<a href="#profile" data-go="profile">' + UI.icon('user') + 'Your profile</a>' +
      (me.is_admin ? '<a href="#admin" data-go="admin">' + UI.icon('shield') + 'Admin</a>' : '') +
      '<div class="ui-menu-block"><span class="small muted">Appearance</span>' + themeSwitch() + '</div>' +
      '<button type="button" data-feedback>' + UI.icon('chat') + 'Submit feedback</button>' +
      '<button type="button" data-lk-open="overview">' + UI.icon('lock') + 'Privacy &amp; Terms</button>' +
      '<button type="button" data-signout>' + UI.icon('logout') + 'Sign out</button></div>';
  }

  UI.shell = {
    header: function (me, active) {
      var nav = UI.navPages();
      return '<div class="ui-header-in">' + brand() +
        '<nav class="ui-nav" aria-label="Main">' + nav.map(function (p) {
          return '<a href="#' + p.name + '" class="' + (p.name === active ? 'on' : '') + '">' + UI.icon(p.icon) + '<span>' + esc(p.nav) + '</span></a>';
        }).join('') + '</nav>' +
        '<div class="ui-header-right">' +
        (me ? '<button type="button" class="ui-avatar-btn" data-menu-toggle aria-label="Your account" aria-haspopup="true">' + esc(UI.initials(me.name)) + '</button>' + userMenu(me)
          : (active === 'auth' ? '' : '<a class="ui-btn ghost" href="#auth" data-go="auth">Sign in</a><a class="ui-btn primary" href="#auth/signup" data-go="auth/signup">Get started</a>')) +
        '</div></div>';
    },
    footer: function (me) {
      return '<div class="ui-footer-in"><div class="ui-footer-brand">' + brand() + '<p class="muted small">' + esc(UI.config.tagline) + '</p></div>' +
        '<div class="ui-footer-links">' +
        '<a href="#landing" data-go="landing">About</a>' +
        '<a href="#guide" data-go="guide">Build guide</a>' +
        '<a href="#drive" data-go="drive">Simulator</a>' +
        '<a href="https://github.com/arkulinskis/robo-presence/tree/master/robot" target="_blank" rel="noopener">Robot code</a>' +
        '<a href="https://prepsto.com/#f/jb924jc" target="_blank" rel="noopener" data-prepsto-open>Submit feedback</a>' +
        '<button type="button" data-lk-open="overview">Privacy &amp; Terms</button>' +
        '</div><p class="ui-footer-legal small muted">© ' + new Date().getFullYear() + ' ' + esc(UI.config.name) + '</p></div>';
    },
    tabbar: function (me, active) {
      var nav = UI.navPages();
      if (!me || nav.length < 2) return '';
      return nav.slice(0, 4).map(function (p) {
        return '<a href="#' + p.name + '" class="' + (p.name === active ? 'on' : '') + '">' + UI.icon(p.icon) + '<span>' + esc(p.nav) + '</span></a>';
      }).join('') + '<a href="#profile" class="' + (active === 'profile' ? 'on' : '') + '">' + UI.icon('user') + '<span>You</span></a>';
    },
    wire: function (root) {
      root.addEventListener('click', function (e) {
        var t = e.target.closest('[data-menu-toggle]');
        var menu = root.querySelector('[data-menu]');
        if (t && menu) { menu.hidden = !menu.hidden; t.setAttribute('aria-expanded', String(!menu.hidden)); return; }
        if (e.target.closest('[data-signout]')) { UI.auth('logout').then(function () { UI.toast('Signed out. See you soon!'); }); }
        if (menu && !menu.hidden && !e.target.closest('[data-menu] .ui-seg')) menu.hidden = true;
      });
      document.addEventListener('keydown', function (e) {
        var menu = root.querySelector('[data-menu]');
        if (e.key === 'Escape' && menu) menu.hidden = true;
      });
    },
    onTheme: function () {  // redraw the menu's Auto/Light/Dark buttons and keep the menu open
      var menu = document.querySelector('[data-menu]'), open = menu && !menu.hidden;
      UI.renderChrome();
      if (open) document.querySelector('[data-menu]').hidden = false;
    }
  };
})();


/* ===== _rp.html ===== */
(function () {
  'use strict';
  var RP = window.RP = window.RP || {};
  var esc = UI.esc;

  /* ---------------------------------------------------------------- icons (added to UI.icon) */
  var MORE = {
    robot: '<rect x="5" y="4" width="14" height="3" rx="1"/><circle cx="8.5" cy="11" r="3"/><circle cx="15.5" cy="11" r="3"/><path d="M11.5 11h1M12 14v3M7 17h10l1.5 4h-13z"/>',
    joystick: '<path d="M12 4v9"/><circle cx="12" cy="4.5" r="2.5"/><path d="M5 16h14l-1.5 5h-11z"/><path d="M8 16v-2h8v2"/>',
    wheel: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3.5v6M12 14.5v6M3.5 12h6M14.5 12h6"/>',
    servo: '<rect x="4" y="9" width="16" height="10" rx="1.5"/><circle cx="9" cy="9" r="3"/><path d="M9 6V3h9"/>',
    slider: '<path d="M4 12h16"/><rect x="11" y="8" width="4" height="8" rx="1"/>',
    toggle: '<rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="16" cy="12" r="3"/>',
    button: '<circle cx="12" cy="13" r="6"/><path d="M6 13v2a6 6 0 0 0 12 0v-2"/>',
    voice: '<path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
    gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-6"/>',
    distance: '<path d="M4 12h16M4 8v8M20 8v8"/><path d="M8 10l-2 2 2 2M16 10l2 2-2 2"/>',
    battery: '<rect x="3" y="7" width="16" height="10" rx="1.5"/><path d="M21 10v4M6 10v4M9 10v4"/>',
    wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
    snapshot: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10"/>',
    gamepad: '<path d="M6 8h12a4 4 0 0 1 3.9 4.8l-.8 4a2.5 2.5 0 0 1-4.3 1.2L14.6 16H9.4l-2.2 2a2.5 2.5 0 0 1-4.3-1.2l-.8-4A4 4 0 0 1 6 8z"/><path d="M8 11v3M6.5 12.5h3"/><circle cx="16" cy="11.5" r=".8"/><circle cx="17.5" cy="13.5" r=".8"/>',
    stop: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M9 9l6 6M15 9l-6 6"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    key: '<circle cx="8" cy="14" r="4"/><path d="M11 11l9-9M16 6l3 3M14 8l2 2"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/>',
    chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-5-5l2.5 2.5-1 2-2 1z"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
    eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    signal: '<path d="M4 20v-3M9 20v-7M14 20V9M19 20V4"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    hex: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><circle cx="12" cy="12" r="3"/>'
  };
  Object.keys(MORE).forEach(function (k) { UI.ICONS[k] = MORE[k]; });

  RP.TYPE_ICON = { drive: 'wheel', servo: 'servo', slider: 'slider', toggle: 'toggle', button: 'button', say: 'voice', custom: 'plug',
    gauge: 'gauge', distance: 'distance', select: 'sliders' };
  RP.typeIcon = function (t, id) {
    if (id && /batt/.test(id)) return 'battery';
    if (id && /wifi/.test(id)) return 'wifi';
    if (id && /cpu|temp/.test(id)) return 'cpu';
    return RP.TYPE_ICON[t] || 'chip';
  };

  /* ---------------------------------------------------------------- robot colours + the robot picture */
  RP.COLORS = {
    orange: { body: '#e2611e', dark: '#a8430f', name: 'Safety orange' },
    olive: { body: '#6b7a3a', dark: '#46521f', name: 'Olive drab' },
    yellow: { body: '#e9b42c', dark: '#a57a10', name: 'Hazard yellow' },
    blue: { body: '#3f6f9c', dark: '#284a6b', name: 'Workshop blue' },
    red: { body: '#c23b22', dark: '#842412', name: 'Fire red' },
    steel: { body: '#8a9095', dark: '#5b6166', name: 'Bare steel' }
  };
  RP.color = function (name) { return RP.COLORS[name] || RP.COLORS.orange; };

  /* A tracked robot with binocular eyes. opts: {pan, tilt (degrees), lights (bool), arms (bool), eyes ('on'|'off'), small} */
  RP.robotArt = function (colorName, opts) {
    opts = opts || {};
    var c = RP.color(colorName), ink = '#1a1712', paper = '#f4eedd';  // a real object: the same colours in light and dark
    var pan = Math.max(-80, Math.min(80, opts.pan || 0)), tilt = Math.max(-40, Math.min(60, opts.tilt || 0));
    var dx = pan / 80 * 9, rot = -tilt * 0.22, eye = opts.eyes === 'off' ? 'var(--c-faint)' : '#f4eedd';
    var glow = opts.lights ? 1 : 0;
    var arms = opts.arms === false ? '' :
      '<g stroke="' + ink + '" stroke-width="5" stroke-linecap="round" fill="none">' +
      '<path d="M70 138 L44 128 L36 108"/><path d="M170 138 L196 128 L204 110"/></g>' +
      '<g fill="' + c.dark + '" stroke="' + ink + '" stroke-width="3"><path d="M30 108 l6 -12 l10 4 l-4 12 z"/><path d="M198 110 l6 -12 l10 4 l-4 12 z"/></g>';
    return '<svg class="rp-art" viewBox="0 0 240 240" role="img" aria-label="A tracked robot with binocular eyes">' +
      (opts.small ? '' : '<ellipse cx="120" cy="222" rx="96" ry="9" fill="var(--c-ink)" opacity=".12"/>') +
      // light beams
      '<g class="eye-glow" opacity="' + glow + '"><path d="M' + (96 + dx) + ' 70 L-10 30 L-10 130 Z" fill="#ffe29a" opacity=".35"/>' +
      '<path d="M' + (144 + dx) + ' 70 L250 30 L250 130 Z" fill="#ffe29a" opacity=".35"/></g>' +
      // treads
      '<rect x="26" y="172" width="188" height="44" rx="22" fill="' + ink + '"/>' +
      '<rect x="34" y="180" width="172" height="28" rx="14" fill="none" stroke="' + paper + '" stroke-width="2" stroke-dasharray="6 6" opacity=".45"/>' +
      [52, 86, 120, 154, 188].map(function (x) { return '<circle cx="' + x + '" cy="194" r="10" fill="' + c.dark + '" stroke="' + paper + '" stroke-width="2.5"/>'; }).join('') +
      arms +
      // body
      '<path d="M62 124 H178 L188 174 H52 Z" fill="' + c.body + '" stroke="' + ink + '" stroke-width="4" stroke-linejoin="round"/>' +
      '<rect x="88" y="136" width="64" height="22" rx="3" fill="' + paper + '" stroke="' + ink + '" stroke-width="3"/>' +
      '<path d="M96 147 h10 M112 147 h6 M124 147 h18" stroke="' + c.body + '" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="70" cy="134" r="2.5" fill="' + ink + '"/><circle cx="170" cy="134" r="2.5" fill="' + ink + '"/>' +
      '<path d="M56 166 H184" stroke="' + ink + '" stroke-width="3"/>' +
      // neck
      '<rect x="112" y="84" width="16" height="42" rx="3" fill="' + c.dark + '" stroke="' + ink + '" stroke-width="3.5"/>' +
      '<circle cx="120" cy="96" r="6" fill="' + paper + '" stroke="' + ink + '" stroke-width="3"/>' +
      // head (pans and tilts)
      '<g transform="translate(' + dx.toFixed(1) + ' 0) rotate(' + rot.toFixed(1) + ' 120 84)">' +
      '<rect x="66" y="34" width="108" height="12" rx="3" fill="' + ink + '"/>' +
      '<rect x="116" y="44" width="8" height="10" fill="' + ink + '"/>' +
      '<circle cx="96" cy="70" r="24" fill="' + ink + '"/><circle cx="144" cy="70" r="24" fill="' + ink + '"/>' +
      '<rect x="96" y="58" width="48" height="24" fill="' + ink + '"/>' +
      '<circle cx="96" cy="70" r="14" fill="' + eye + '"/><circle cx="144" cy="70" r="14" fill="' + eye + '"/>' +
      '<circle cx="' + (96 + dx * 0.45).toFixed(1) + '" cy="' + (70 - tilt * 0.08).toFixed(1) + '" r="6.5" fill="' + ink + '"/>' +
      '<circle cx="' + (144 + dx * 0.45).toFixed(1) + '" cy="' + (70 - tilt * 0.08).toFixed(1) + '" r="6.5" fill="' + ink + '"/>' +
      '<circle cx="91" cy="65" r="2.6" fill="#f4eedd"/><circle cx="139" cy="65" r="2.6" fill="#f4eedd"/>' +
      '<rect x="166" y="22" width="4" height="14" fill="' + ink + '"/><circle cx="168" cy="20" r="4" fill="' + c.body + '" stroke="' + ink + '" stroke-width="2.5"/>' +
      '</g></svg>';
  };

  /* ---------------------------------------------------------------- status */
  RP.lamp = function (r) {
    if (r.demo) return '<span class="rp-lamp demo"><i></i>Showroom</span>';
    if (r.online) return '<span class="rp-lamp on"><i></i>Online</span>';
    return '<span class="rp-lamp off"><i></i>' + (r.paired === false ? 'Not paired' : 'Offline' + (r.last_seen ? ' · ' + esc(UI.ago(r.last_seen)) : '')) + '</span>';
  };
  RP.BOARDS = { pi: 'Raspberry Pi', pi_arduino: 'Pi + Arduino', browser: 'Phone or laptop' };

  /* ---------------------------------------------------------------- manifests */
  /* Sort a manifest into what the cockpit needs: the wheels, the head (a pair of servos in one group with
     axis x and y), the other controls, and the sensors. Unknown types are kept (the cockpit shows them as
     "needs a newer cockpit"), so a robot with new parts never breaks the page. */
  RP.KNOWN = ['drive', 'servo', 'slider', 'toggle', 'button', 'say', 'select'];
  RP.split = function (m) {
    m = m || {};
    var controls = (m.controls || []).slice(), sensors = (m.sensors || []).slice();
    var drive = controls.filter(function (c) { return c.type === 'drive' && !c.error; })[0] || null;
    var pan = null, tilt = null;
    controls.forEach(function (c) {
      if (c.type !== 'servo' || c.error) return;
      if (c.axis === 'x' && !pan) pan = c;
      else if (c.axis === 'y' && !tilt) tilt = c;
    });
    if (!pan && !tilt) {  // no axes given: the first two servos named like a head
      controls.forEach(function (c) {
        if (c.type !== 'servo' || c.error) return;
        if (!pan && /pan|yaw|left|neck/.test(c.id)) pan = c;
        else if (!tilt && /tilt|pitch|up|nod/.test(c.id)) tilt = c;
      });
    }
    var others = controls.filter(function (c) { return c !== drive && c !== pan && c !== tilt && !(c.type === 'drive'); });
    return { drive: drive, pan: pan, tilt: tilt, others: others, sensors: sensors, problems: m.problems || [],
             camera: m.camera || {}, preview: !!m.preview, name: m.name || '' };
  };
  RP.partCount = function (m) { return ((m && m.controls) || []).length + ((m && m.sensors) || []).length; };

  /* ---------------------------------------------------------------- sensors */
  RP.sensorLevel = function (s, v) {
    if (typeof v !== 'number' || s.warn == null) return '';
    if (s.type === 'distance') return v < s.warn ? 'bad' : v < s.warn * 2 ? 'warn' : '';
    if (s.low_is_bad) return v <= s.warn ? 'bad' : v <= s.warn + (s.max - s.warn) * 0.25 ? 'warn' : '';
    return v >= s.warn ? 'bad' : v >= s.warn - (s.warn - (s.min || 0)) * 0.15 ? 'warn' : '';
  };
  RP.fmtValue = function (s, v) {
    if (v == null || v === '') return '–';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v !== 'number') return esc(String(v));
    var unit = s.unit || (s.type === 'distance' ? 'cm' : '');
    var digits = unit === 'V' ? 2 : Math.abs(v) < 10 && unit !== '%' ? 1 : 0;
    return v.toFixed(digits) + (unit ? (unit === '%' || unit === '°C' || unit === '°' ? '' : ' ') + unit : '');
  };
  RP.gauge = function (s, v) {
    var lo = s.min != null ? s.min : 0, hi = s.max != null ? s.max : (s.type === 'distance' ? 200 : 100);
    var pct = typeof v === 'number' ? Math.max(0, Math.min(100, (v - lo) / ((hi - lo) || 1) * 100)) : 0;
    return '<div class="rp-gauge ' + RP.sensorLevel(s, v) + '" data-sensor="' + esc(s.id) + '"><div class="top"><span>' + UI.icon(RP.typeIcon(s.type, s.id)) + ' ' +
      esc(s.label || s.id) + '</span><b>' + RP.fmtValue(s, v) + '</b></div><div class="bar"><i style="width:' + pct.toFixed(0) + '%"></i></div>' +
      (s.error ? '<span class="small" style="color:var(--c-bad)">' + esc(s.error) + '</span>' : '') + '</div>';
  };

  /* ---------------------------------------------------------------- small helpers */
  RP.copy = function (text, what) {
    var done = function () { UI.toast((what || 'Copied') + ' to the clipboard', 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { RP.copyFallback(text); done(); });
    } else { RP.copyFallback(text); done(); }
  };
  RP.copyFallback = function (text) {
    var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) {} t.remove();
  };
  RP.download = function (name, blobOrText, type) {
    var blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: type || 'text/plain' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };
  RP.stamp = function () { var d = new Date(); return d.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-'); };
  RP.slug = function (s) { return String(s || 'robot').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'robot'; };
  RP.dur = function (s) {
    if (s == null) return '–';
    s = Math.round(s);
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.round(s / 60) + ' min';
    return (s / 3600).toFixed(1) + ' h';
  };
  RP.cmdBox = function (cmd, label) {
    return '<div class="rp-cmd"><div class="rp-code"><span class="p">$ </span>' + esc(cmd) + '</div>' +
      '<button class="ui-btn" type="button" data-copy="' + esc(cmd) + '" data-copy-what="' + esc(label || 'Command') + '">' + UI.icon('copy') + 'Copy</button></div>';
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-copy]');
    if (b) { e.preventDefault(); RP.copy(b.getAttribute('data-copy'), b.getAttribute('data-copy-what')); }
  });
  RP.beep = function (freq, ms, vol) {
    try {
      var A = RP._ac || (RP._ac = new (window.AudioContext || window.webkitAudioContext)());
      var o = A.createOscillator(), g = A.createGain();
      o.type = 'square'; o.frequency.value = freq || 880; g.gain.value = vol || 0.04;
      o.connect(g); g.connect(A.destination); o.start(); o.stop(A.currentTime + (ms || 120) / 1000);
    } catch (e) {}
  };
})();

/* ===== _rp_builder.html ===== */
(function () {
  'use strict';
  var RP = window.RP, esc = UI.esc;

  RP.DRIVER_LABEL = { tb6612: 'TB6612FNG on Pi GPIO', l298n: 'L298N on Pi GPIO', drv8833: 'DRV8833 on Pi GPIO', gpio: 'Pi GPIO pin', pwm: 'Pi PWM pin',
    pca9685: 'PCA9685 servo board (I²C)', hcsr04: 'HC-SR04 on Pi GPIO', arduino: 'Arduino', sim: 'Simulated', espeak: 'espeak-ng (speaker on the Pi)',
    cpu_temp: 'Pi CPU temperature', wifi: 'Pi Wi-Fi signal', plugin: 'Python plugin on the robot' };
  RP.DRIVERS = { drive: ['tb6612', 'l298n', 'drv8833', 'arduino', 'sim'], servo: ['gpio', 'pca9685', 'arduino', 'sim'], slider: ['pwm', 'arduino', 'sim'],
    toggle: ['gpio', 'arduino', 'sim'], button: ['gpio', 'arduino', 'sim'], say: ['espeak', 'sim'], custom: ['plugin'],
    gauge: ['cpu_temp', 'wifi', 'arduino', 'sim'], distance: ['hcsr04', 'arduino', 'sim'] };
  RP.PIN_FIELDS = { tb6612: ['left_in1', 'left_in2', 'left_pwm', 'right_in1', 'right_in2', 'right_pwm', 'standby'], l298n: ['left_in1', 'left_in2', 'left_pwm', 'right_in1', 'right_in2', 'right_pwm'],
    drv8833: ['left_in1', 'left_in2', 'right_in1', 'right_in2'], gpio: ['pin'], pwm: ['pin'], hcsr04: ['trigger', 'echo'] };
  RP.ARDUINO_PINS = { drive: ['left_in1', 'left_in2', 'left_pwm', 'right_in1', 'right_in2', 'right_pwm', 'standby'], servo: ['pin'], slider: ['pin'], toggle: ['pin'], button: ['pin'], gauge: ['pin'], distance: ['trigger', 'echo'] };
  var PIN_LABEL = { left_in1: 'Left IN1', left_in2: 'Left IN2', left_pwm: 'Left PWM', right_in1: 'Right IN1', right_in2: 'Right IN2', right_pwm: 'Right PWM', standby: 'Standby (STBY)', pin: 'Pin', trigger: 'Trigger', echo: 'Echo' };
  RP.pinsFor = function (p) { return p.driver === 'arduino' ? (RP.ARDUINO_PINS[p.type] || []) : (RP.PIN_FIELDS[p.driver] || []); };
  RP.driversFor = function (type, board) {
    var all = RP.DRIVERS[type] || [];
    return all.filter(function (d) {
      if (board === 'browser') return d === 'sim' || d === 'arduino' || d === 'plugin';
      if (board === 'pi') return d !== 'arduino' && d !== 'sim' || type === 'custom';
      return d !== 'sim';
    });
  };

  RP.CATALOG = [
    { type: 'drive', icon: 'wheel', name: 'Wheels', text: 'Two motors (or tracks) through a motor driver.', def: { label: 'Wheels', max_speed: 0.8 } },
    { type: 'servo', icon: 'servo', name: 'Servo', text: 'A hobby servo: pan, tilt, an arm joint.', def: { label: 'Servo', min: -80, max: 80, home: 0 } },
    { type: 'slider', icon: 'slider', name: 'Slider', text: 'A value from min to max: a dimmable lamp, a claw, a winch.', def: { label: 'Slider', min: 0, max: 100, home: 0, unit: '%' } },
    { type: 'toggle', icon: 'toggle', name: 'Switch', text: 'On or off: headlights, a laser dot, a fan.', def: { label: 'Switch' } },
    { type: 'button', icon: 'button', name: 'Push button', text: 'On while you hold it: a horn, a buzzer, a doorbell.', def: { label: 'Button' } },
    { type: 'say', icon: 'voice', name: 'Voice', text: 'The robot says out loud what you type.', def: { label: 'Speak', phrases: ['Hello!', 'Coming through'] } },
    { type: 'distance', icon: 'distance', name: 'Distance sensor', text: 'HC-SR04 sonar: how far is the wall? Can pause forward driving.', def: { label: 'Bumper sonar', max: 200, warn: 25 } },
    { type: 'gauge', driver: 'arduino', icon: 'battery', name: 'Battery / analog', text: 'A voltage read by the Arduino through a divider.', def: { label: 'Battery', unit: 'V', min: 6, max: 8.4, warn: 6.6, low_is_bad: true, factor: 3 } },
    { type: 'gauge', driver: 'cpu_temp', icon: 'cpu', name: 'CPU temperature', text: 'How hot the Pi runs.', def: { label: 'CPU' } },
    { type: 'gauge', driver: 'wifi', icon: 'wifi', name: 'Wi-Fi signal', text: 'Know when you\'re driving out of range.', def: { label: 'Wi-Fi' } },
    { type: 'custom', icon: 'plug', name: 'Plugin part', text: 'Anything else: a Python plugin on the robot runs it.', def: { label: 'Claw', options: { ui: 'slider', plugin: 'example_claw', settings: 'pin=22', min: 0, max: 100 } } }
  ];
  RP.newPart = function (cat, board, existing) {
    var base = cat.type === 'gauge' ? (cat.driver === 'arduino' ? 'battery' : cat.driver) : cat.type === 'say' ? 'voice' : cat.type === 'custom' ? 'plugin' : cat.type;
    var id = base, n = 2, ids = existing.map(function (p) { return p.id; });
    while (ids.indexOf(id) >= 0) id = base + n++;
    var drivers = RP.driversFor(cat.type, board);
    var drv = cat.driver && drivers.indexOf(cat.driver) >= 0 ? cat.driver : board === 'browser' && drivers.indexOf('sim') >= 0 ? 'sim' :
      (board === 'pi_arduino' && drivers.indexOf('arduino') >= 0 && cat.type !== 'say' ? 'arduino' : drivers[0]);
    if (cat.driver && drivers.indexOf(cat.driver) < 0) drv = drivers.indexOf('sim') >= 0 ? 'sim' : drivers[0];
    return Object.assign({ id: id, type: cat.type, driver: drv, pins: {} }, JSON.parse(JSON.stringify(cat.def)));
  };

  /* ---------------------------------------------------------------- one part's form */
  function field(label, f, v, attrs) {
    return '<label class="ui-field"><span>' + label + '</span><input data-f="' + f + '" value="' + esc(v == null ? '' : v) + '" ' + (attrs || 'type="number"') + '></label>';
  }
  function check(label, f, v) { return '<label class="ui-check"><input type="checkbox" data-f="' + f + '"' + (v ? ' checked' : '') + '> ' + label + '</label>'; }
  function sel(label, f, v, opts) {
    return '<label class="ui-field"><span>' + label + '</span><select data-f="' + f + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(v) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
  }
  RP.partEditor = function (p, board, i, n) {
    var t = p.type, drivers = RP.driversFor(t, board);
    if (drivers.indexOf(p.driver) < 0) drivers = drivers.concat([p.driver]);
    var b = [];
    b.push(sel('Runs on', 'driver', p.driver, drivers.map(function (d) { return [d, RP.DRIVER_LABEL[d] || d]; })));
    if (['servo', 'slider', 'toggle', 'button'].indexOf(t) >= 0 || t === 'custom') b.push(field('Key <em>(one letter)</em>', 'key', p.key, 'type="text" maxlength="1"'));
    if (t === 'drive') {
      b.push(field('Top speed <em>(0.1–1)</em>', 'max_speed', p.max_speed, 'type="number" min="0.1" max="1" step="0.05"'));
      b.push(field('Turn rate <em>(0.2–1)</em>', 'turn', p.turn != null ? p.turn : 0.7, 'type="number" min="0.2" max="1" step="0.05"'));
      b.push(field('Trim <em>(pulls left/right)</em>', 'trim', p.trim || 0, 'type="number" min="-0.3" max="0.3" step="0.01"'));
      b.push(check('Reverse left motor', 'invert_left', p.invert_left), check('Reverse right motor', 'invert_right', p.invert_right));
    }
    if (t === 'servo') {
      b.push(field('Smallest angle', 'min', p.min, 'type="number" min="-90" max="90"'), field('Largest angle', 'max', p.max, 'type="number" min="-90" max="90"'),
        field('Home angle', 'home', p.home, 'type="number" min="-90" max="90"'), field('Speed <em>(°/s)</em>', 'speed', p.speed || 240, 'type="number" min="20" max="720"'),
        sel('Head axis', 'axis', p.axis || '', [['', 'Not part of the head'], ['x', 'Pan (left / right)'], ['y', 'Tilt (up / down)']]),
        field('Group', 'group', p.group || '', 'type="text" maxlength="16" placeholder="head"'), check('Reverse direction', 'invert', p.invert));
      if (p.driver === 'pca9685') b.push(field('Channel <em>(0–15)</em>', 'channel', p.channel || 0, 'type="number" min="0" max="15"'), field('I²C address', 'address', '0x' + (p.address || 64).toString(16), 'type="text"'));
      if (p.driver !== 'arduino' && p.driver !== 'sim') b.push(field('Pulse min <em>(ms)</em>', 'pulse_min', p.pulse_min || 0.5, 'type="number" min="0.3" max="1.2" step="0.05"'), field('Pulse max <em>(ms)</em>', 'pulse_max', p.pulse_max || 2.5, 'type="number" min="1.8" max="2.8" step="0.05"'));
    }
    if (t === 'slider') {
      b.push(field('Smallest', 'min', p.min, ''), field('Largest', 'max', p.max, ''), field('Home', 'home', p.home, ''), field('Unit', 'unit', p.unit || '%', 'type="text" maxlength="6"'));
      if (p.driver === 'arduino') b.push(sel('Arduino output', 'output', p.output || 'pwm', [['pwm', 'PWM (0–255)'], ['servo', 'Servo (0–180°)']]));
    }
    if (t === 'toggle') b.push(check('Active low (on = 0 V)', 'active_low', p.active_low));
    if (t === 'button') b.push(field('Pulse <em>(ms, 0 = while held)</em>', 'pulse_ms', p.pulse_ms || 0, 'type="number" min="0" max="5000"'));
    if (t === 'say') b.push(field('espeak voice', 'voice', p.voice || 'en', 'type="text" maxlength="20"'),
      '<label class="ui-field pb-wide"><span>Quick phrases <em>(comma separated)</em></span><input data-f="phrases" type="text" value="' + esc((p.phrases || []).join(', ')) + '"></label>');
    if (t === 'gauge') {
      b.push(field('Unit', 'unit', p.unit, 'type="text" maxlength="6"'), field('Lowest', 'min', p.min, 'type="number" step="any"'), field('Highest', 'max', p.max, 'type="number" step="any"'),
        field('Warn at', 'warn', p.warn, 'type="number" step="any"'), check('Low is bad (batteries)', 'low_is_bad', p.low_is_bad));
      if (p.driver === 'arduino') b.push(field('Multiplier <em>(divider)</em>', 'factor', p.factor || 1, 'type="number" step="any" min="0.01"'));
    }
    if (t === 'distance') b.push(field('Range <em>(cm)</em>', 'max', p.max || 200, 'type="number" min="20" max="400"'), field('Warn under <em>(cm)</em>', 'warn', p.warn || 25, 'type="number" min="0" max="200"'),
      field('Pause forward under <em>(cm, 0 = off)</em>', 'stop_at', p.stop_at || 0, 'type="number" min="0" max="100"'));
    if (t === 'custom') {
      var o = p.options || {};
      b.push('<label class="ui-field"><span>Control</span><select data-o="ui">' + ['slider', 'toggle', 'button', 'say'].map(function (u) { return '<option' + (o.ui === u ? ' selected' : '') + '>' + u + '</option>'; }).join('') + '</select></label>',
        '<label class="ui-field"><span>Plugin file <em>(name.py)</em></span><input data-o="plugin" type="text" value="' + esc(o.plugin || '') + '"></label>',
        '<label class="ui-field"><span>Min</span><input data-o="min" type="number" value="' + esc(o.min != null ? o.min : 0) + '"></label>',
        '<label class="ui-field"><span>Max</span><input data-o="max" type="number" value="' + esc(o.max != null ? o.max : 100) + '"></label>',
        '<label class="ui-field pb-wide"><span>Settings for the plugin <em>(free text, e.g. pin=22)</em></span><input data-o="settings" type="text" value="' + esc(o.settings || '') + '"></label>');
    }
    var pins = RP.pinsFor(p);
    if (pins.length) {
      var ard = p.driver === 'arduino';
      b.push('<div class="pb-pins"><b>' + (ard ? 'Arduino pins (2–13, A0–A7)' : 'Pi GPIO (BCM numbers)') + '</b>' + pins.map(function (f) {
        var v = (p.pins || {})[f];
        return '<label class="ui-field"><span>' + PIN_LABEL[f] + (f === 'standby' ? ' <em>(optional)</em>' : '') + '</span><input data-pin="' + f + '" value="' + esc(v == null ? '' : v) + '" ' +
          (ard ? 'type="text" maxlength="3" placeholder="9"' : 'type="number" min="0" max="27" placeholder="17"') + '></label>';
      }).join('') + (p.type === 'distance' && !ard ? '<p class="small muted pb-wide" style="margin:0">The HC-SR04\'s echo pin gives 5 V: put a divider (1 kΩ + 2 kΩ) between it and the Pi.</p>' : '') + '</div>');
    }
    if (p.driver === 'pca9685') b.push('<p class="small muted pb-wide" style="margin:0">PCA9685 boards (most pan-tilt HATs) use I²C: GPIO 2 (SDA) and GPIO 3 (SCL). Turn I²C on with <code>sudo raspi-config</code> → Interface options.</p>');
    var cat = RP.CATALOG.filter(function (c) { return c.type === t && (!c.driver || c.driver === p.driver); })[0] || {};
    return '<article class="ui-card pb-part" data-part="' + i + '" data-type="' + t + '" data-id="' + esc(p.id) + '"><header><span class="ic">' + UI.icon(cat.icon || RP.typeIcon(t, p.id)) + '</span>' +
      '<input data-f="label" type="text" maxlength="40" value="' + esc(p.label || '') + '" aria-label="Name in the cockpit">' +
      '<span class="pb-id">id <input data-f="id" type="text" maxlength="24" value="' + esc(p.id) + '" style="width:110px;min-height:32px;padding:4px 8px;font:500 .8rem var(--font-mono)" aria-label="Part id"></span>' +
      '<span class="pb-tools"><button type="button" class="ui-btn ghost icon sm" data-move="-1" aria-label="Move up"' + (i ? '' : ' disabled') + '>↑</button>' +
      '<button type="button" class="ui-btn ghost icon sm" data-move="1" aria-label="Move down"' + (i < n - 1 ? '' : ' disabled') + '>↓</button>' +
      '<button type="button" class="ui-btn ghost icon sm danger" data-remove aria-label="Remove">' + UI.icon('trash') + '</button></span></header>' +
      '<div class="pb-body">' + b.join('') + '</div></article>';
  };
  /* Read one part's form back. The type comes from the card; numbers stay numbers. */
  RP.readPart = function (el, prev) {
    var p = { type: el.getAttribute('data-type'), pins: {} };
    if (prev && prev.options) p.options = Object.assign({}, prev.options);
    el.querySelectorAll('[data-f]').forEach(function (inp) {
      var f = inp.getAttribute('data-f'), v;
      if (inp.type === 'checkbox') v = inp.checked;
      else if (inp.type === 'number') v = inp.value === '' ? null : +inp.value;
      else v = inp.value.trim();
      if (f === 'phrases') v = v ? v.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
      if (f === 'address') v = parseInt(v, 16) || 64;
      if (f === 'id') v = String(v).toLowerCase();
      if (['min', 'max', 'home', 'warn'].indexOf(f) >= 0 && typeof v === 'string') v = v === '' ? null : +v;
      p[f] = v;
    });
    el.querySelectorAll('[data-pin]').forEach(function (inp) {
      var v = inp.value.trim();
      if (v !== '') p.pins[inp.getAttribute('data-pin')] = inp.type === 'number' ? +v : v.toUpperCase();
    });
    var o = el.querySelectorAll('[data-o]');
    if (o.length) {
      p.options = {};
      o.forEach(function (inp) { p.options[inp.getAttribute('data-o')] = inp.type === 'number' ? +inp.value : inp.value.trim(); });
    }
    return p;
  };

  /* ---------------------------------------------------------------- the Pi's 40-pin header */
  var HEADER = [null, '3V3', '5V', 2, '5V', 3, 'GND', 4, 14, 'GND', 15, 17, 18, 27, 'GND', 22, 23, '3V3', 24, 10, 'GND', 9, 25, 11, 8, 'GND', 7, 0, 1, 5, 'GND', 6, 12, 13, 'GND', 19, 16, 26, 20, 'GND', 21];
  var PART_COLORS = ['#e2611e', '#3f6f9c', '#6b7a3a', '#c23b22', '#a57a10', '#7a5a3a', '#2f8a8a', '#8a4f9c', '#5b6166', '#b8945e'];
  RP.wires = function (config) {
    var out = [], colorOf = {};
    (config.parts || []).forEach(function (p, i) {
      colorOf[p.id] = PART_COLORS[i % PART_COLORS.length];
      if (p.driver === 'pca9685') { out.push({ bcm: 2, part: p, field: 'I²C SDA', color: colorOf[p.id] }, { bcm: 3, part: p, field: 'I²C SCL', color: colorOf[p.id] }); return; }
      if (p.driver === 'arduino' || p.driver === 'sim') return;
      Object.keys(p.pins || {}).forEach(function (f) { out.push({ bcm: p.pins[f], part: p, field: PIN_LABEL[f] || f, color: colorOf[p.id] }); });
    });
    var seen = {};
    return out.filter(function (w) { var k = w.bcm + w.part.id + w.field; if (seen[k]) return false; seen[k] = 1; return true; });
  };
  RP.pinMap = function (config) {
    var wires = RP.wires(config), byBcm = {};
    wires.forEach(function (w) { (byBcm[w.bcm] = byBcm[w.bcm] || []).push(w); });
    var W = 20 * 26 + 40, svg = '<svg class="pb-header" viewBox="0 0 ' + W + ' 140" role="img" aria-label="Raspberry Pi GPIO header with the pins this robot uses">' +
      '<rect x="10" y="38" width="' + (W - 20) + '" height="64" rx="6" fill="var(--c-surface-2)" stroke="var(--c-line)"/>';
    for (var pin = 1; pin <= 40; pin++) {
      var col = Math.floor((pin - 1) / 2), top = pin % 2 === 0, x = 22 + col * 26, y = top ? 46 : 72;
      var name = HEADER[pin], used = typeof name === 'number' ? byBcm[name] : null;
      var fill = name === 'GND' ? '#1a1712' : name === '5V' ? '#c23b22' : name === '3V3' ? '#e9b42c' : used ? used[0].color : 'var(--c-surface)';
      svg += '<rect x="' + x + '" y="' + y + '" width="20" height="20" rx="3" fill="' + fill + '" stroke="var(--c-ink)" stroke-width="' + (used ? 2 : 1) + '"/>';
      var lab = typeof name === 'number' ? String(name) : name;
      svg += '<text x="' + (x + 10) + '" y="' + (top ? 32 : 120) + '" text-anchor="middle" fill="' + (used ? used[0].color : 'var(--c-muted)') + '"' + (used ? ' font-weight="700"' : '') + '>' + lab + '</text>';
      if (used && used.length > 1) svg += '<text x="' + (x + 10) + '" y="' + (top ? 20 : 132) + '" text-anchor="middle" fill="var(--c-bad)">×' + used.length + '</text>';
    }
    svg += '<text x="16" y="12" fill="var(--c-muted)">← pin 1 (3V3) is at the end nearest the SD card · numbers = GPIO (BCM) · red 5V · yellow 3V3 · black GND</text></svg>';
    var rows = wires.slice().sort(function (a, b) { return a.bcm - b.bcm; }).map(function (w) {
      var phys = HEADER.indexOf(w.bcm);
      return '<tr><td><i style="background:' + w.color + '"></i><b>GPIO ' + w.bcm + '</b> <span class="muted">(pin ' + phys + ')</span></td><td>' + esc(w.part.label || w.part.id) + ' · ' + esc(w.field) + '</td></tr>';
    });
    var ard = (config.parts || []).filter(function (p) { return p.driver === 'arduino'; });
    var ardRows = [];
    ard.forEach(function (p) { Object.keys(p.pins || {}).forEach(function (f) { ardRows.push('<tr><td><b>' + esc(p.pins[f]) + '</b></td><td>' + esc(p.label || p.id) + ' · ' + esc(PIN_LABEL[f] || f) + '</td></tr>'); }); });
    return svg + (rows.length ? '<table class="pb-wires" style="margin-top:10px"><thead><tr><th>Pi pin</th><th>Goes to</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' : '<p class="small muted">No parts use the Pi\'s pins directly.</p>') +
      (ardRows.length ? '<table class="pb-wires" style="margin-top:14px"><thead><tr><th>Arduino pin</th><th>Goes to</th></tr></thead><tbody>' + ardRows.join('') + '</tbody></table>' : '');
  };

  /* ---------------------------------------------------------------- the Arduino sketch */
  var SKETCH = null;
  RP.loadSketch = function () {
    if (SKETCH) return Promise.resolve(SKETCH);
    return fetch('_/theme/robopresence_bridge.ino.txt', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('sketch ' + r.status); return r.text(); }).then(function (t) { SKETCH = t; return t; });
  };
  RP.sketchConfig = function (config, name) {
    var ard = (config.parts || []).filter(function (p) { return p.driver === 'arduino'; });
    var pin = function (v) { return v ? String(v).toUpperCase() : '-1'; };
    var q = function (s) { return '"' + String(s).replace(/[^a-z0-9_]/gi, '_') + '"'; };
    var drive = ard.filter(function (p) { return p.type === 'drive'; })[0];
    var servos = ard.filter(function (p) { return p.type === 'servo'; }), sliders = ard.filter(function (p) { return p.type === 'slider'; });
    var sw = ard.filter(function (p) { return p.type === 'toggle' || p.type === 'button'; }), an = ard.filter(function (p) { return p.type === 'gauge'; });
    var sonar = ard.filter(function (p) { return p.type === 'distance'; })[0];
    var dp = (drive && drive.pins) || {};
    var L = [];
    L.push('// ===== CONFIG =====');
    L.push('#define RP_NAME ' + q(RP.slug(name).replace(/-/g, '_')));
    L.push('#define HAS_DRIVE ' + (drive ? 1 : 0));
    L.push('const char* DRIVE_ID = ' + q(drive ? drive.id : 'drive') + ';');
    L.push('const int L_IN1 = ' + pin(dp.left_in1) + ', L_IN2 = ' + pin(dp.left_in2) + ', L_PWM = ' + pin(dp.left_pwm) + ';     // left motor: two direction pins + the speed (PWM) pin');
    L.push('const int R_IN1 = ' + pin(dp.right_in1) + ', R_IN2 = ' + pin(dp.right_in2) + ', R_PWM = ' + pin(dp.right_pwm) + ';    // right motor');
    L.push('const int STBY = ' + pin(dp.standby) + ';                           // TB6612FNG standby pin, or -1 (L298N)');
    L.push('');
    L.push('struct ServoSpec { const char* id; int pin; int lo; int hi; int home; };');
    L.push('ServoSpec SERVOS[] = {                         // id, pin, smallest angle, largest angle, home (0 = centre)');
    servos.forEach(function (p) { L.push('  {' + q(p.id) + ', ' + pin((p.pins || {}).pin) + ', ' + Math.round(p.min) + ', ' + Math.round(p.max) + ', ' + Math.round(p.home || 0) + '},'); });
    L.push('  {NULL, -1, 0, 0, 0}'); L.push('};'); L.push('');
    L.push('struct SliderSpec { const char* id; int pin; int lo; int hi; int home; bool servo; };');
    L.push('SliderSpec SLIDERS[] = {                       // id, pin, min, max, home, true = a servo (0..180), false = PWM (0..255)');
    sliders.forEach(function (p) { L.push('  {' + q(p.id) + ', ' + pin((p.pins || {}).pin) + ', ' + Math.round(p.min) + ', ' + Math.round(p.max) + ', ' + Math.round(p.home || 0) + ', ' + (p.output === 'servo' ? 'true' : 'false') + '},'); });
    L.push('  {NULL, -1, 0, 0, 0, false}'); L.push('};'); L.push('');
    L.push('struct SwitchSpec { const char* id; int pin; bool button; };');
    L.push('SwitchSpec SWITCHES[] = {                      // id, pin, true = push button (held), false = on/off switch');
    sw.forEach(function (p) { L.push('  {' + q(p.id) + ', ' + pin((p.pins || {}).pin) + ', ' + (p.type === 'button' ? 'true' : 'false') + '},'); });
    L.push('  {NULL, -1, false}'); L.push('};'); L.push('');
    L.push('struct AnalogSpec { const char* id; int pin; float factor; const char* unit; };');
    L.push('AnalogSpec ANALOGS[] = {                       // id, analog pin, volts multiplier (voltage divider), unit');
    an.forEach(function (p) { L.push('  {' + q(p.id) + ', ' + pin((p.pins || {}).pin) + ', ' + (p.factor || 1) + ', "' + String(p.unit || '').replace(/"/g, '') + '"},'); });
    L.push('  {NULL, -1, 1.0, ""}'); L.push('};'); L.push('');
    L.push('const char* SONAR_ID = ' + q(sonar ? sonar.id : 'distance') + ';');
    L.push('const int SONAR_TRIG = ' + pin(sonar && sonar.pins.trigger) + ', SONAR_ECHO = ' + pin(sonar && sonar.pins.echo) + ';    // HC-SR04 pins, or -1 when there is none');
    L.push('// ===== END CONFIG =====');
    return L.join('\n');
  };
  RP.sketch = function (config, name) {
    return RP.loadSketch().then(function (t) {
      var a = t.indexOf('// ===== CONFIG ====='), b = t.indexOf('// ===== END CONFIG =====');
      if (a < 0 || b < 0) return t;
      return t.slice(0, a) + RP.sketchConfig(config, name) + t.slice(b + '// ===== END CONFIG ====='.length);
    });
  };
})();

/* ===== _rp_cockpit.html ===== */
(function () {
  'use strict';
  var RP = window.RP, esc = UI.esc;
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var GEARS = [0.35, 0.65, 1.0];

  /* opts: {robot: {id, name, color, manifest}, role, mode: 'sim'|'demo'|'live', back: '#garage', backLabel,
            connect: function (onStep) -> Promise(link), pilot, subtitle, autoConnect} */
  RP.cockpit = function (view, opts) {
    var robot = opts.robot || {}, mode = opts.mode || 'sim', role = opts.role || 'owner';
    var viewer = role === 'viewer';
    var link = null, manifest = robot.manifest || null, split = RP.split(manifest);
    var values = {}, sensors = {}, seat = { driver: null, name: null }, me = null;
    var gear = clamp(UI.store.get('gear', 1), 0, 2);
    var head = { pan: 0, tilt: 0, sentPan: null, sentTilt: null, ratePan: 0, rateTilt: 0, dragging: false, synced: false };
    var drive = { pad: [0, 0], keys: [0, 0], pad2: [0, 0], sent: [0, 0], seq: 0, zeroes: 0 };
    var keys = {}, held = {}, timers = [], rtt = null, pingN = 0, pings = {}, startedAt = 0, statSum = { rtt: [], fps: [], kbps: [] };
    var recorder = null, recChunks = [], recStart = 0, alive = true, gpIndex = null, gpPrev = [];
    var bolts = 0;

    view.innerHTML = '<div class="ck" data-mode="' + mode + '">' +
      '<div class="ck-bar">' +
        '<a class="ck-back" href="' + esc(opts.back || '#garage') + '">' + UI.icon('back') + '<span>' + esc(opts.backLabel || 'Garage') + '</span></a>' +
        '<div class="ck-title"><b>' + esc(robot.name || 'Robot') + '</b><span class="ck-mode ' + (mode === 'live' ? (viewer ? 'view' : 'live') : '') + '">' +
          (mode === 'live' ? (viewer ? 'WATCHING' : 'LIVE') : mode === 'demo' ? 'SHOWROOM SIM' : 'SIMULATOR') + '</span></div>' +
        '<div class="ck-stats"><span class="ck-stat" data-stat="rtt">RTT <b>–</b></span><span class="ck-stat" data-stat="fps"><b>–</b> fps</span>' +
          '<span class="ck-stat opt" data-stat="kbps"><b>–</b> kbps</span><span class="ck-stat opt" data-stat="path"><b>–</b></span></div>' +
        '<div class="ck-tools">' +
          '<button class="ck-tool" data-act="snap" title="Snapshot (P)" aria-label="Save a snapshot">' + UI.icon('snapshot') + '</button>' +
          '<button class="ck-tool opt" data-act="rec" title="Record a clip" aria-label="Record a clip">' + UI.icon('record') + '</button>' +
          '<button class="ck-tool opt" data-act="full" title="Full screen (F)" aria-label="Full screen">' + UI.icon('fullscreen') + '</button>' +
          '<button class="ck-tool" data-act="help" title="Keys (?)" aria-label="Keyboard and gamepad">' + UI.icon('keyboard') + '</button>' +
          '<button class="ck-tool ck-end" data-act="end">' + UI.icon('x') + 'End</button>' +
        '</div></div>' +
      '<div class="ck-main"><div class="ck-stagewrap">' +
        '<div class="ck-stage" data-stage><video playsinline autoplay muted></video>' +
          '<div class="ck-hud">' +
            '<div class="ck-scale-x" data-scale="x" hidden><span class="ck-caret"></span></div>' +
            '<div class="ck-scale-y" data-scale="y" hidden><span class="ck-caret"></span></div>' +
            '<div class="ck-reticle"><i></i></div>' +
            '<div class="ck-wheels" data-wheels hidden><div class="ck-wheel"><i></i></div><div class="ck-wheel"><i></i></div></div>' +
            '<div class="ck-prox" data-prox hidden></div>' +
            '<div class="ck-hudsens" data-hudsens></div>' +
            '<div class="ck-rec" data-recbadge hidden>● REC <span>0:00</span></div>' +
            '<div class="ck-ticker" data-ticker></div>' +
            '<div class="ck-banner" data-banner hidden></div>' +
          '</div><div class="ck-flash" data-flash></div>' +
          '<div class="ck-overlay" data-overlay></div>' +
        '</div>' +
        '<div class="ck-deck" data-deck>' +
          '<div class="ck-pad" data-pad="drive" aria-label="Drive joystick"><i>' + UI.icon('wheel') + '</i><span>DRIVE · WASD</span></div>' +
          '<div class="ck-pad look" data-pad="look" aria-label="Look around"><i>' + UI.icon('eye') + '</i><span>LOOK · ARROWS</span></div>' +
        '</div></div>' +
        '<aside class="ck-side" data-side></aside>' +
      '</div></div>';

    var Q = function (s) { return view.querySelector(s); };
    var root = Q('.ck'), video = Q('video'), stage = Q('[data-stage]'), overlay = Q('[data-overlay]'), side = Q('[data-side]');

    /* ------------------------------------------------------------ side panel from the manifest */
    function controlHtml(c) {
      if (c.error) return '<div class="ck-broken"><b>' + esc(c.label || c.id) + '</b>: not working. ' + esc(c.error) + '</div>';
      var k = c.key ? ' <kbd>' + esc(c.key.toUpperCase()) + '</kbd>' : '';
      var ic = UI.icon(RP.typeIcon(c.type, c.id));
      if (c.type === 'toggle') return '<div class="ck-row"><label>' + ic + esc(c.label || c.id) + k + '</label><button class="ck-switch" data-toggle="' + esc(c.id) + '" aria-pressed="false" aria-label="' + esc(c.label || c.id) + '"></button></div>';
      if (c.type === 'button') return '<div class="ck-row"><label>' + ic + esc(c.label || c.id) + k + '</label><button class="ck-hold" data-hold="' + esc(c.id) + '">Hold</button></div>';
      if (c.type === 'servo' || c.type === 'slider') {
        var lo = c.min != null ? c.min : 0, hi = c.max != null ? c.max : 100;
        return '<div class="ck-ctl"><div class="ck-row"><label>' + ic + esc(c.label || c.id) + k + '</label><span class="ck-val" data-val="' + esc(c.id) + '">–</span></div>' +
          '<input class="ck-range" type="range" min="' + lo + '" max="' + hi + '" step="1" value="' + (c.home != null ? c.home : lo) + '" data-range="' + esc(c.id) + '" aria-label="' + esc(c.label || c.id) + '"></div>';
      }
      if (c.type === 'say') return '<div class="ck-ctl"><label class="small" style="display:flex;gap:7px;align-items:center">' + ic + esc(c.label || 'Speak') + '</label>' +
        '<form class="ck-say" data-say="' + esc(c.id) + '"><input type="text" maxlength="200" placeholder="Type, then Enter" aria-label="What the robot says"><button type="submit">Say</button></form>' +
        ((c.phrases || []).length ? '<div class="ck-chips">' + c.phrases.map(function (p) { return '<button type="button" class="ck-chipbtn" data-phrase="' + esc(c.id) + '" data-text="' + esc(p) + '">' + esc(p) + '</button>'; }).join('') + '</div>' : '') + '</div>';
      if (c.type === 'select') return '<div class="ck-ctl"><label class="small">' + ic + esc(c.label || c.id) + '</label><div class="ck-chips">' +
        (c.options || []).map(function (o) { return '<button type="button" class="ck-chipbtn" data-choice="' + esc(c.id) + '" data-v="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') + '</div></div>';
      return '<div class="ck-unknown"><b>' + esc(c.label || c.id) + '</b> is a "' + esc(c.type) + '" part. This cockpit doesn\'t know how to draw it yet' +
        (c.min != null && c.max != null ? ', so here is a plain slider:</div><input class="ck-range" type="range" min="' + c.min + '" max="' + c.max + '" data-range="' + esc(c.id) + '">' : '.</div>');
    }
    function drawSide() {
      split = RP.split(manifest);
      var headHtml = (split.pan || split.tilt) ? '<div class="ck-box"><h4>Head <button class="ck-chipbtn" data-act="home">' + UI.icon('target') + ' Home <kbd>H</kbd></button></h4>' +
        [split.pan, split.tilt].filter(Boolean).map(controlHtml).join('') + '<p class="ck-note" style="margin-top:8px">Drag the picture to look around.</p></div>' : '';
      var others = split.others;
      side.innerHTML =
        '<button class="ck-estop" data-act="stop" aria-label="Emergency stop (Space)"><b>' + UI.icon('stop') + 'STOP <small>SPACE</small></b></button>' +
        (split.drive && !viewer ? '<div class="ck-box"><h4>Gear <span>' + esc(split.drive.label || 'Wheels') + '</span></h4><div class="ck-gear">' +
          ['1 · creep', '2 · cruise', '3 · full'].map(function (g, i) { return '<button data-gear="' + i + '" class="' + (gear === i ? 'on' : '') + '">' + g + '</button>'; }).join('') + '</div></div>' : '') +
        headHtml +
        (others.length ? '<div class="ck-box"><h4>Parts <span>' + others.length + '</span></h4><div class="ck-ctl" style="gap:12px">' + others.map(controlHtml).join('') + '</div></div>' : '') +
        (split.sensors.length ? '<div class="ck-box"><h4>Sensors</h4><div class="ck-sens" data-sens>' + split.sensors.map(function (s) { return RP.gauge(s, sensors[s.id]); }).join('') + '</div></div>' : '') +
        (mode !== 'live' ? '<div class="ck-box"><h4>Lost bolts <span data-boltcount>' + bolts + ' / 5</span></h4><div class="ck-bolts" data-bolts>' + [0, 1, 2, 3, 4].map(function (i) { return '<i class="' + (i < bolts ? 'got' : '') + '"></i>'; }).join('') + '</div>' +
          '<p class="ck-note" style="margin-top:8px">Five bolts rolled under things in this garage. Drive over them to pick them up.</p></div>' : '') +
        '<div class="ck-box"><h4>Mission log</h4><ul class="ck-log" data-log></ul></div>' +
        (split.problems.length ? '<div class="ck-box"><h4>Not working</h4>' + split.problems.map(function (p) { return '<p class="ck-note" style="color:#ffb3a3">' + esc(p.id) + ': ' + esc(p.text) + '</p>'; }).join('') + '</div>' : '') +
        '<div class="ck-box"><h4>Controls</h4><div class="ck-keys">' + keyRows().map(function (r) { return '<span>' + r[0] + '</span><span>' + esc(r[1]) + '</span>'; }).join('') + '</div>' +
          '<p class="ck-note" data-gp style="margin-top:8px">' + UI.icon('gamepad') + ' Plug in a gamepad and press a button to use it.</p></div>';
      Q('[data-pad="drive"]').style.visibility = split.drive && !viewer ? 'visible' : 'hidden';
      Q('[data-pad="look"]').style.visibility = (split.pan || split.tilt) && !viewer ? 'visible' : 'hidden';
      Q('[data-scale="x"]').hidden = !split.pan;
      Q('[data-scale="y"]').hidden = !split.tilt;
      Q('[data-wheels]').hidden = !split.drive;
      if (viewer) side.querySelectorAll('.ck-switch, .ck-hold, .ck-range, .ck-say button, .ck-say input, [data-phrase], [data-choice], [data-act="home"]').forEach(function (el) { el.disabled = true; });
      logLines.forEach(function (l) { addLogEl(l); });
      applyValues();
      drawSensors();
    }
    function keyRows() {
      var rows = [];
      if (split.drive) rows.push(['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>', 'drive'], ['<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>', 'gear']);
      if (split.pan || split.tilt) rows.push(['<kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd>', 'look'], ['<kbd>H</kbd>', 'head home']);
      rows.push(['<kbd>Space</kbd>', 'emergency stop']);
      split.others.forEach(function (c) { if (c.key) rows.push(['<kbd>' + esc(c.key.toUpperCase()) + '</kbd>', (c.type === 'button' ? 'hold: ' : '') + (c.label || c.id)]); });
      rows.push(['<kbd>P</kbd>', 'snapshot'], ['<kbd>F</kbd>', 'full screen']);
      return rows;
    }

    /* ------------------------------------------------------------ robot -> cockpit */
    var logLines = [];
    function addLogEl(l) {
      var ul = side.querySelector('[data-log]');
      if (!ul) return;
      var li = document.createElement('li');
      li.className = l.level;
      li.innerHTML = '<time>' + l.time + '</time>' + esc(l.text);
      ul.insertBefore(li, ul.firstChild);
      while (ul.children.length > 40) ul.removeChild(ul.lastChild);
    }
    function log(text, level) {
      var l = { text: text, level: level || 'info', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) };
      logLines.push(l); if (logLines.length > 40) logLines.shift();
      addLogEl(l);
      var t = Q('[data-ticker]');
      t.textContent = text; t.className = 'ck-ticker show ' + (level === 'stop' ? 'stop' : '');
      clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, 4500);
    }
    function onMessage(m) {
      if (!alive || !m) return;
      if (m.t === 'manifest') { manifest = m; drawSide(); head.synced = false; }
      else if (m.t === 'state') { if (m.values) values = m.values; if (m.seat) seat = m.seat; if (m.you) me = m.you; if (!head.synced) { syncHeadFromRobot(); head.synced = true; } applyValues(); drawBanner(); }
      else if (m.t === 'tel') { if (m.sensors) sensors = m.sensors; if (m.values) { values = m.values; applyValues(); } drawSensors(); }
      else if (m.t === 'pong') { var t0 = pings[m.n]; if (t0) { rtt = Math.round(performance.now() - t0); statSum.rtt.push(rtt); delete pings[m.n]; drawStats({}); } }
      else if (m.t === 'log') {
        log(m.text, m.level);
        var b = /Found a lost bolt: (\d)/.exec(m.text);
        if (b) { bolts = +b[1]; var bx = side.querySelector('[data-bolts]'); if (bx) bx.querySelectorAll('i').forEach(function (i, n) { i.classList.toggle('got', n < bolts); }); var bc = side.querySelector('[data-boltcount]'); if (bc) bc.textContent = bolts + ' / 5'; if (bolts === 5) UI.toast('All five bolts found. Number one pilot!', 'ok'); }
      }
    }
    function applyValues() {
      Object.keys(values).forEach(function (id) {
        var v = values[id];
        var sw = side.querySelector('[data-toggle="' + id + '"]');
        if (sw) sw.setAttribute('aria-pressed', v === true ? 'true' : 'false');
        var hb = side.querySelector('[data-hold="' + id + '"]');
        if (hb && !held[id]) hb.classList.toggle('down', v === true);
        var val = side.querySelector('[data-val="' + id + '"]');
        if (val && typeof v === 'number') {
          var c = (manifest.controls || []).filter(function (x) { return x.id === id; })[0] || {};
          val.textContent = Math.round(v) + (c.unit || '');
          var rg = side.querySelector('[data-range="' + id + '"]');
          if (rg && document.activeElement !== rg && !head.dragging && !(split.pan && id === split.pan.id && head.ratePan) && !(split.tilt && id === split.tilt.id && head.rateTilt)) rg.value = v;
        }
      });
      if (split.pan && typeof values[split.pan.id] === 'number') caret('x', split.pan, values[split.pan.id]);
      if (split.tilt && typeof values[split.tilt.id] === 'number') caret('y', split.tilt, values[split.tilt.id]);
      if (split.drive && values[split.drive.id]) {
        var w = values[split.drive.id], bars = view.querySelectorAll('.ck-wheel i');
        [w.l, w.r].forEach(function (x, i) { var el = bars[i]; if (!el) return; el.className = x < 0 ? 'neg' : ''; el.style.height = Math.abs(x || 0) * 50 + '%'; });
      }
    }
    function caret(axis, c, v) {
      var el = Q('[data-scale="' + axis + '"] .ck-caret'), pct = (v - c.min) / ((c.max - c.min) || 1) * 100;
      if (axis === 'x') el.style.left = pct + '%'; else el.style.top = (100 - pct) + '%';
      el.lastChild && el.lastChild.nodeType === 3 ? el.lastChild.nodeValue = Math.round(v) + '°' : el.appendChild(document.createTextNode(Math.round(v) + '°'));
    }
    function drawSensors() {
      var box = side.querySelector('[data-sens]');
      if (box) box.innerHTML = split.sensors.map(function (s) { return RP.gauge(s, sensors[s.id]); }).join('');
      var hud = [], prox = Q('[data-prox]');
      prox.hidden = true;
      split.sensors.forEach(function (s) {
        var v = sensors[s.id], lvl = RP.sensorLevel(s, v);
        if (s.type === 'distance' && typeof v === 'number') { prox.hidden = false; prox.className = 'ck-prox ' + lvl; prox.textContent = '▲ ' + Math.round(v) + ' cm'; }
        else if (typeof v === 'number') hud.push('<span class="' + lvl + '">' + esc((s.label || s.id).toUpperCase()) + ' ' + RP.fmtValue(s, v) + '</span>');
      });
      Q('[data-hudsens]').innerHTML = hud.slice(0, 4).join('');
      if (split.drive) Q('[data-prox]').style.bottom = '86px';
    }
    function drawBanner() {
      var b = Q('[data-banner]');
      if (!link) { b.hidden = true; return; }
      if (viewer) { b.hidden = false; b.innerHTML = UI.icon('eye') + ' You\'re watching' + (seat.name ? ': ' + esc(seat.name) + ' is driving' : '') + '.'; return; }
      if (seat.driver && me && seat.driver !== me) { b.hidden = false; b.innerHTML = esc(seat.name || 'Someone') + ' is driving. <button data-act="seat">Take the wheel</button>'; return; }
      if (!seat.driver && me) { b.hidden = false; b.innerHTML = 'Nobody is driving. <button data-act="seat">Take the wheel</button>'; return; }
      b.hidden = true;
    }
    function driving() { return link && !viewer && (!me || !seat.driver || seat.driver === me); }

    /* ------------------------------------------------------------ cockpit -> robot */
    function send(msg, quick) { if (link) link.send(msg, quick); }
    function setPart(id, v, quick) { send({ t: 'set', id: id, v: v, s: ++drive.seq }, quick); }
    var sendTimer = setInterval(function () {
      if (!link) return;
      pollGamepad();
      // wheels
      if (split.drive && driving()) {
        var g = GEARS[gear], x = clamp(drive.pad[0] + drive.keys[0] + drive.pad2[0], -1, 1), y = clamp(drive.pad[1] + drive.keys[1] + drive.pad2[1], -1, 1);
        x = Math.round(x * g * 100) / 100; y = Math.round(y * g * 100) / 100;
        if (x || y) { send({ t: 'drive', x: x, y: y, s: ++drive.seq }, true); drive.zeroes = 3; }
        else if (drive.zeroes > 0) { send({ t: 'drive', x: 0, y: 0, s: ++drive.seq }, drive.zeroes > 1); drive.zeroes--; }
        drive.sent = [x, y];
      }
      // head: rate control from the look pad, the arrow keys and the right stick
      if (driving() && head.synced) {
        var dt = 0.05;
        var rp = head.ratePan + head.keyPan + head.gpPan, rt = head.rateTilt + head.keyTilt + head.gpTilt;
        if (split.pan && rp) head.pan = clamp(head.pan + rp * 120 * dt, split.pan.min, split.pan.max);
        if (split.tilt && rt) head.tilt = clamp(head.tilt + rt * 90 * dt, split.tilt.min, split.tilt.max);
        if (split.pan && head.sentPan !== Math.round(head.pan)) { head.sentPan = Math.round(head.pan); setPart(split.pan.id, head.sentPan, true); }
        if (split.tilt && head.sentTilt !== Math.round(head.tilt)) { head.sentTilt = Math.round(head.tilt); setPart(split.tilt.id, head.sentTilt, true); }
      }
    }, 50);
    head.keyPan = head.keyTilt = head.gpPan = head.gpTilt = 0;
    function syncHeadFromRobot() {
      if (split.pan && typeof values[split.pan.id] === 'number') head.pan = head.sentPan = values[split.pan.id];
      if (split.tilt && typeof values[split.tilt.id] === 'number') head.tilt = head.sentTilt = values[split.tilt.id];
    }
    function stopAll() { send({ t: 'stop' }); drive.pad = [0, 0]; drive.keys = [0, 0]; log('Emergency stop.', 'stop'); RP.beep(220, 120, 0.04); }
    function homeHead() {
      send({ t: 'home' });
      if (split.pan) head.pan = head.sentPan = split.pan.home || 0;
      if (split.tilt) head.tilt = head.sentTilt = split.tilt.home || 0;
    }

    /* ------------------------------------------------------------ pads (pointer) */
    function padVec(pad, e) {
      var r = pad.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, rad = r.width / 2 - 24;
      var dx = (e.clientX - cx) / rad, dy = (e.clientY - cy) / rad, len = Math.sqrt(dx * dx + dy * dy);
      if (len > 1) { dx /= len; dy /= len; }
      pad.querySelector('i').style.transform = 'translate(' + (dx * rad) + 'px,' + (dy * rad) + 'px)';
      return [Math.abs(dx) < 0.08 ? 0 : dx, Math.abs(dy) < 0.08 ? 0 : -dy];
    }
    view.querySelectorAll('[data-pad]').forEach(function (pad) {
      var kind = pad.getAttribute('data-pad'), id = null;
      pad.addEventListener('pointerdown', function (e) {
        if (!driving()) return;
        id = e.pointerId; pad.setPointerCapture(id); pad.classList.add('active');
        if (kind === 'look') syncHeadFromRobot();
        move(e); e.preventDefault();
      });
      function move(e) {
        if (e.pointerId !== id) return;
        var v = padVec(pad, e);
        if (kind === 'drive') drive.pad = v; else { head.ratePan = v[0]; head.rateTilt = v[1]; }
      }
      function up(e) {
        if (e.pointerId !== id) return;
        id = null; pad.classList.remove('active'); pad.querySelector('i').style.transform = '';
        if (kind === 'drive') drive.pad = [0, 0]; else { head.ratePan = head.rateTilt = 0; }
      }
      pad.addEventListener('pointermove', move);
      pad.addEventListener('pointerup', up);
      pad.addEventListener('pointercancel', up);
    });
    // drag the picture to look
    var drag = null;
    stage.addEventListener('pointerdown', function (e) {
      if (!driving() || e.target.closest('.ck-banner, .ck-overlay') || !(split.pan || split.tilt)) return;
      syncHeadFromRobot();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: head.pan, tilt: head.tilt };
      stage.setPointerCapture(e.pointerId); stage.classList.add('dragging'); head.dragging = true;
    });
    stage.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var r = stage.getBoundingClientRect(), k = 70 / r.width;  // a full-width drag turns the head 70 degrees
      if (split.pan) head.pan = clamp(drag.pan - (e.clientX - drag.x) * k * 1.0, split.pan.min, split.pan.max);
      if (split.tilt) head.tilt = clamp(drag.tilt + (e.clientY - drag.y) * k * 1.0, split.tilt.min, split.tilt.max);
    });
    function endDrag(e) { if (drag && e.pointerId === drag.id) { drag = null; stage.classList.remove('dragging'); head.dragging = false; } }
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('dblclick', function () { if (driving()) homeHead(); });

    /* ------------------------------------------------------------ side panel clicks */
    view.addEventListener('click', function (e) {
      var a = e.target.closest('[data-act]');
      if (a) {
        var act = a.getAttribute('data-act');
        if (act === 'stop') stopAll();
        else if (act === 'home') homeHead();
        else if (act === 'seat') send({ t: 'seat' });
        else if (act === 'snap') snapshot();
        else if (act === 'rec') toggleRec(a);
        else if (act === 'full') fullscreen();
        else if (act === 'help') help();
        else if (act === 'end') end();
        else if (act === 'retry') start();
        return;
      }
      var g = e.target.closest('[data-gear]');
      if (g) { setGear(+g.getAttribute('data-gear')); return; }
      var sw = e.target.closest('[data-toggle]');
      if (sw && driving()) { var id = sw.getAttribute('data-toggle'); var on = sw.getAttribute('aria-pressed') !== 'true'; sw.setAttribute('aria-pressed', String(on)); setPart(id, on); return; }
      var ph = e.target.closest('[data-phrase]');
      if (ph && driving()) { send({ t: 'say', id: ph.getAttribute('data-phrase'), text: ph.getAttribute('data-text') }); return; }
      var ch = e.target.closest('[data-choice]');
      if (ch && driving()) { setPart(ch.getAttribute('data-choice'), ch.getAttribute('data-v')); side.querySelectorAll('[data-choice="' + ch.getAttribute('data-choice') + '"]').forEach(function (b) { b.classList.toggle('on', b === ch); }); }
    });
    view.addEventListener('submit', function (e) {
      var f = e.target.closest('[data-say]');
      if (!f) return;
      e.preventDefault();
      var inp = f.querySelector('input');
      if (inp.value.trim() && driving()) { send({ t: 'say', id: f.getAttribute('data-say'), text: inp.value.trim() }); inp.value = ''; }
    });
    view.addEventListener('input', function (e) {
      var r = e.target.closest('[data-range]');
      if (!r || !driving()) return;
      var id = r.getAttribute('data-range'), v = +r.value;
      if (split.pan && id === split.pan.id) { head.pan = v; return; }
      if (split.tilt && id === split.tilt.id) { head.tilt = v; return; }
      setPart(id, v, true);
    });
    view.addEventListener('change', function (e) {
      var r = e.target.closest('[data-range]');
      if (r && driving()) setPart(r.getAttribute('data-range'), +r.value);
    });
    function holdDown(id, el) { if (!driving() || held[id]) return; held[id] = true; if (el) el.classList.add('down'); send({ t: 'press', id: id, down: true }); }
    function holdUp(id, el) { if (!held[id]) return; held[id] = false; if (el) el.classList.remove('down'); send({ t: 'press', id: id, down: false }); }
    view.addEventListener('pointerdown', function (e) { var b = e.target.closest('[data-hold]'); if (b) { e.preventDefault(); holdDown(b.getAttribute('data-hold'), b); } });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      view.addEventListener(ev, function (e) { var b = e.target.closest && e.target.closest('[data-hold]'); if (b) holdUp(b.getAttribute('data-hold'), b); }, true);
    });
    function setGear(i) { gear = clamp(i, 0, 2); UI.store.set('gear', gear); side.querySelectorAll('[data-gear]').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-gear') === gear); }); }

    /* ------------------------------------------------------------ keyboard */
    function typing(e) { var t = e.target; return t && (t.tagName === 'INPUT' && t.type !== 'range' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
    function keyDrive() {
      drive.keys = [(keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0)];
      head.keyPan = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
      head.keyTilt = (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0);
    }
    function partForKey(k) { return split.others.filter(function (c) { return c.key && c.key.toLowerCase() === k && !c.error; })[0]; }
    function onKey(e) {
      if (!alive || typing(e) || document.querySelector('.ui-modal-wrap')) return;
      var down = e.type === 'keydown', code = e.code, k = (e.key || '').toLowerCase();
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(code) >= 0) {
        e.preventDefault(); if (down && keys[code]) return;
        if (down && code.indexOf('Arrow') === 0) syncHeadFromRobot();
        keys[code] = down; keyDrive(); return;
      }
      if (!down) { var p0 = partForKey(k); if (p0 && p0.type === 'button') holdUp(p0.id, side.querySelector('[data-hold="' + p0.id + '"]')); return; }
      if (e.repeat) return;
      if (code === 'Space') { e.preventDefault(); stopAll(); return; }
      if (k === 'h') { homeHead(); return; }
      if (k === '1' || k === '2' || k === '3') { setGear(+k - 1); return; }
      if (k === 'p') { snapshot(); return; }
      if (k === 'f') { fullscreen(); return; }
      if (k === '?') { help(); return; }
      var p = partForKey(k);
      if (p && driving()) {
        if (p.type === 'toggle') { var sw = side.querySelector('[data-toggle="' + p.id + '"]'); var on = !(values[p.id] === true); if (sw) sw.setAttribute('aria-pressed', String(on)); setPart(p.id, on); }
        else if (p.type === 'button') holdDown(p.id, side.querySelector('[data-hold="' + p.id + '"]'));
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    function blur() { keys = {}; keyDrive(); drive.pad = [0, 0]; Object.keys(held).forEach(function (id) { holdUp(id, null); }); }
    window.addEventListener('blur', blur);

    /* ------------------------------------------------------------ gamepad */
    function onPad(e) { gpIndex = e.gamepad.index; var n = side.querySelector('[data-gp]'); if (n) n.innerHTML = UI.icon('gamepad') + ' ' + esc(e.gamepad.id.slice(0, 40)) + ': left stick drives, right stick looks, A ' + (firstOf('button') ? esc(firstOf('button').label) : '–') + ', B stop, X ' + (firstOf('toggle') ? esc(firstOf('toggle').label) : '–') + ', Y head home, LB/RB gear.'; log('Gamepad connected.', 'ok'); }
    window.addEventListener('gamepadconnected', onPad);
    function firstOf(t) { return split.others.filter(function (c) { return c.type === t && !c.error; })[0]; }
    function pollGamepad() {
      if (gpIndex == null || !navigator.getGamepads) return;
      var gp = navigator.getGamepads()[gpIndex];
      if (!gp) return;
      var dz = function (v) { return Math.abs(v) < 0.14 ? 0 : v; };
      drive.pad2 = [dz(gp.axes[0] || 0), -dz(gp.axes[1] || 0)];
      head.gpPan = dz(gp.axes[2] || 0); head.gpTilt = -dz(gp.axes[3] || 0);
      var b = gp.buttons.map(function (x) { return x.pressed; });
      var edge = function (i) { return b[i] && !gpPrev[i]; }, release = function (i) { return !b[i] && gpPrev[i]; };
      var btn = firstOf('button'), tog = firstOf('toggle');
      if (btn && edge(0)) holdDown(btn.id, side.querySelector('[data-hold="' + btn.id + '"]'));
      if (btn && release(0)) holdUp(btn.id, side.querySelector('[data-hold="' + btn.id + '"]'));
      if (edge(1)) stopAll();
      if (tog && edge(2)) setPart(tog.id, !(values[tog.id] === true));
      if (edge(3)) homeHead();
      if (edge(4)) setGear(gear - 1);
      if (edge(5)) setGear(gear + 1);
      gpPrev = b;
    }

    /* ------------------------------------------------------------ tools */
    function snapshot() {
      if (!video.videoWidth) return UI.toast('No picture yet.', 'error');
      var c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      c.toBlob(function (b) { RP.download(RP.slug(robot.name) + '-' + RP.stamp() + '.png', b); });
      var f = Q('[data-flash]'); f.classList.add('on'); setTimeout(function () { f.classList.remove('on'); }, 60);
      RP.beep(1800, 40, 0.03);
      log('Snapshot saved.', 'ok');
    }
    function toggleRec(btn) {
      if (recorder) { recorder.stop(); return; }
      var stream = video.srcObject;
      if (!stream || !window.MediaRecorder) return UI.toast('Recording isn\'t available in this browser.', 'error');
      var type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].filter(function (t) { return MediaRecorder.isTypeSupported(t); })[0];
      recChunks = []; recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      recorder.ondataavailable = function (e) { if (e.data.size) recChunks.push(e.data); };
      recorder.onstop = function () {
        var t = recorder.mimeType || 'video/webm'; recorder = null; btn.classList.remove('on'); Q('[data-recbadge]').hidden = true;
        RP.download(RP.slug(robot.name) + '-' + RP.stamp() + (t.indexOf('mp4') >= 0 ? '.mp4' : '.webm'), new Blob(recChunks, { type: t }));
        log('Clip saved.', 'ok');
      };
      recorder.start(1000); recStart = Date.now(); btn.classList.add('on'); Q('[data-recbadge]').hidden = false;
      log('Recording a clip.', 'info');
    }
    function fullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (root.requestFullscreen) root.requestFullscreen().catch(function () {});
    }
    function help() {
      UI.modal('<h2>Driving controls</h2><div class="ck-keys" style="color:var(--c-ink);font-size:.95rem;gap:9px 14px">' +
        keyRows().map(function (r) { return '<span>' + r[0] + '</span><span>' + esc(r[1]) + '</span>'; }).join('') + '</div>' +
        '<h3 style="margin-top:18px">Touch and mouse</h3><p class="muted">Left pad: drive (push further to go faster). Right pad: look around. Or drag the picture to aim the camera; double-click it to bring the head home.</p>' +
        '<h3>Gamepad</h3><p class="muted">Left stick drives, right stick looks. A = ' + esc((firstOf('button') || {}).label || 'first button') + ', B = emergency stop, X = ' + esc((firstOf('toggle') || {}).label || 'first switch') + ', Y = head home, LB / RB = gear.</p>' +
        '<h3>Safety</h3><p class="muted">The robot stops its wheels by itself when it hasn\'t heard from you for half a second, and whenever you leave. Space or the STOP button stops it at once.</p>');
    }

    /* ------------------------------------------------------------ stats */
    function drawStats(s) {
      var set = function (k, text, lvl) { var el = Q('[data-stat="' + k + '"]'); if (!el) return; el.querySelector('b').textContent = text; el.className = 'ck-stat' + (el.classList.contains('opt') ? ' opt' : '') + (lvl ? ' ' + lvl : ''); };
      if (rtt != null) set('rtt', rtt + ' ms', rtt < 90 ? 'good' : rtt < 220 ? 'warn' : 'bad');
      if (s.fps != null) set('fps', String(Math.round(s.fps)), s.fps >= 20 ? 'good' : s.fps >= 10 ? 'warn' : 'bad');
      if (s.kbps != null) set('kbps', String(s.kbps));
      if (s.type === 'simulator') { set('kbps', 'local'); set('path', 'SIM'); }
      else if (s.path) set('path', s.path === 'relay' ? 'RELAY' : 'P2P', s.path === 'relay' ? 'warn' : 'good');
      if (recorder) { var sec = Math.round((Date.now() - recStart) / 1000); Q('[data-recbadge] span').textContent = Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2); }
    }
    var statTimer = setInterval(function () {
      if (!link) return;
      pings[++pingN] = performance.now(); send({ t: 'ping', n: pingN, ts: Date.now() });
      link.stats().then(function (s) { if (s.fps) statSum.fps.push(s.fps); if (s.kbps) statSum.kbps.push(s.kbps); drawStats(s); }).catch(function () {});
    }, 1000);

    /* ------------------------------------------------------------ connecting */
    var STEPS = mode === 'live' ? ['Preparing the connection', 'Calling the robot through the server', 'Waiting for the robot to check in (every second or two)', 'The robot is answering', 'Connecting peer to peer'] : ['Starting the simulator'];
    function showSteps(now) {
      var i = STEPS.indexOf(now);
      overlay.hidden = false;
      overlay.innerHTML = '<div><div class="art">' + RP.robotArt(robot.color, { eyes: 'off', arms: true }) + '</div><h2>Connecting to ' + esc(robot.name || 'the robot') + '</h2>' +
        '<ul class="ck-steps">' + STEPS.map(function (s, n) { return '<li class="' + (n < i ? 'done' : n === i ? 'now' : '') + '">' + esc(s) + '</li>'; }).join('') + '</ul></div>';
    }
    function showError(msg) {
      overlay.hidden = false;
      overlay.innerHTML = '<div><div class="art">' + RP.robotArt(robot.color, { eyes: 'off', tilt: -30, arms: true }) + '</div><h2>No connection</h2><p>' + esc(msg) + '</p>' +
        '<div class="ui-row" style="justify-content:center"><button class="ui-btn primary" data-act="retry">' + UI.icon('refresh') + 'Try again</button>' +
        '<a class="ui-btn" href="#drive" style="background:#1b1e14;color:#ede7d6;border-color:#343a29">Drive the simulator</a></div></div>';
    }
    function start() {
      if (!alive) return;
      showSteps(STEPS[0]);
      return Promise.resolve(opts.connect(function (s) { if (alive) showSteps(s); })).then(function (l) {
        if (!alive) { l.close(); return; }
        link = l; startedAt = Date.now();
        link.onmessage = onMessage;
        link.onclose = function (why) { if (!alive) return; link = null; showError(why === 'failed' ? 'The connection dropped. The robot may have lost its Wi-Fi.' : 'The connection closed.'); };
        video.srcObject = link.stream;
        var p = video.play(); if (p && p.catch) p.catch(function () {});
        return link.open().then(function () {
          overlay.hidden = true;
          send({ t: 'hello', client: 'cockpit/1' });
          log(mode === 'live' ? 'Connected peer to peer. Video and controls go straight between you and the robot.' : 'Simulator running. Drive around the garage!', 'ok');
          if (mode === 'demo') log('This showroom robot isn\'t plugged in, so you\'re driving the simulator with its parts.', 'info');
          drawBanner();
        });
      }).catch(function (e) { if (alive) showError(e && e.message || 'Something went wrong.'); });
    }
    function end() {
      if (link && mode === 'live') link.close(sessionStats());
      else if (link) link.close();
      link = null;
      location.hash = opts.back || '#garage';
    }
    function sessionStats() {
      var avg = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; };
      return { duration_s: startedAt ? (Date.now() - startedAt) / 1000 : 0, rtt_ms: avg(statSum.rtt), fps: avg(statSum.fps), kbps: avg(statSum.kbps),
               width: video.videoWidth || null, height: video.videoHeight || null };
    }

    drawSide();
    var ready = start();
    window.RP_COCKPIT = { state: function () { return { values: values, sensors: sensors, seat: seat, me: me, rtt: rtt, link: !!link, manifest: manifest, gear: gear, head: { pan: head.pan, tilt: head.tilt }, bolts: bolts, log: logLines.map(function (l) { return l.text; }) }; },
      link: function () { return link; }, keys: keys, drive: drive };
    return {
      ready: ready,
      destroy: function () {
        alive = false;
        [sendTimer, statTimer].forEach(clearInterval);
        window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey);
        window.removeEventListener('blur', blur); window.removeEventListener('gamepadconnected', onPad);
        if (recorder) try { recorder.stop(); } catch (e) {}
        if (link) link.close(mode === 'live' ? sessionStats() : undefined);
        link = null;
        if (window.RP_COCKPIT) window.RP_COCKPIT = null;
      }
    };
  };
})();

/* ===== _rp_link.html ===== */
(function () {
  'use strict';
  var RP = window.RP;

  function iceDone(pc, ms) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(function (resolve) {
      var t = setTimeout(resolve, ms || 3000);
      pc.addEventListener('icegatheringstatechange', function () { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } });
    });
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* Shared by both sides: getStats -> {fps, width, height, kbps, rtt, path: 'direct'|'relay'} */
  function readStats(pc, prev, dir) {
    return pc.getStats().then(function (rep) {
      var out = { type: 'webrtc' }, pairs = {}, cands = {};
      rep.forEach(function (s) {
        if (s.type === (dir || 'inbound-rtp') && s.kind === 'video') {
          out.fps = s.framesPerSecond; out.width = s.frameWidth; out.height = s.frameHeight;
          var bytes = s.bytesReceived != null ? s.bytesReceived : s.bytesSent;
          if (prev && prev.bytes != null && s.timestamp > prev.ts) out.kbps = Math.round((bytes - prev.bytes) * 8 / (s.timestamp - prev.ts));
          out.bytes = bytes; out.ts = s.timestamp;
        }
        if (s.type === 'candidate-pair' && (s.nominated || s.selected) && s.state === 'succeeded') pairs[s.id] = s;
        if (s.type === 'local-candidate' || s.type === 'remote-candidate') cands[s.id] = s;
      });
      Object.keys(pairs).forEach(function (k) {
        var p = pairs[k];
        if (p.currentRoundTripTime != null) out.rtt = Math.round(p.currentRoundTripTime * 1000);
        var l = cands[p.localCandidateId], r = cands[p.remoteCandidateId];
        out.path = (l && l.candidateType === 'relay') || (r && r.candidateType === 'relay') ? 'relay' : 'direct';
      });
      return out;
    });
  }

  /* ---------------------------------------------------------------- the pilot */
  /* opts: {robotId, pass, pilot, ice, audio, onStep(text)} -> Promise of a link like RP.simulator's */
  RP.connectLive = function (opts) {
    var step = opts.onStep || function () {};
    var pc = new RTCPeerConnection({ iceServers: opts.ice || [] });
    var link = { kind: 'live', pc: pc, stream: new MediaStream(), onmessage: null, onclose: null, session: null, closed: false };
    pc.addTransceiver('video', { direction: 'recvonly' });
    if (opts.audio) pc.addTransceiver('audio', { direction: 'recvonly' });
    var fast = pc.createDataChannel('rp-fast', { ordered: false, maxRetransmits: 0 });
    var rel = pc.createDataChannel('rp');
    var onMsg = function (e) { var m; try { m = JSON.parse(e.data); } catch (x) { return; } if (link.onmessage) link.onmessage(m); };
    rel.onmessage = onMsg; fast.onmessage = onMsg;
    pc.ontrack = function (e) { link.stream.addTrack(e.track); if (link.ontrack) link.ontrack(e.track); };
    pc.onconnectionstatechange = function () {
      if ((pc.connectionState === 'failed' || pc.connectionState === 'closed') && !link.closed && link.onclose) link.onclose(pc.connectionState);
    };
    link.send = function (msg, quick) {
      var ch = quick && fast.readyState === 'open' ? fast : rel;
      if (ch.readyState === 'open') { try { ch.send(JSON.stringify(msg)); } catch (e) {} }
    };
    var prev = null;
    link.stats = function () { return readStats(pc, prev).then(function (s) { prev = { bytes: s.bytes, ts: s.ts }; return s; }); };
    link.close = function (stats) {
      if (link.closed) return;
      link.closed = true;
      try { pc.close(); } catch (e) {}
      if (link.session) UI.apiQuiet('drive_end', link.session.session_id, link.session.secret, stats || {}).catch(function () {});
    };
    step('Preparing the connection');
    return pc.createOffer().then(function (o) { return pc.setLocalDescription(o); })
      .then(function () { return iceDone(pc, 2500); })
      .then(function () { step('Calling the robot through the server'); return UI.apiQuiet('drive_offer', opts.robotId || null, pc.localDescription.sdp, opts.pass || null, opts.pilot || null); })
      .then(function (s) {
        link.session = s;
        var t0 = Date.now();
        function poll() {
          if (link.closed) return Promise.reject(new Error('Cancelled.'));
          return UI.apiQuiet('drive_poll', s.session_id, s.secret).then(function (r) {
            if (r.state === 'answered') return r.answer;
            if (r.state === 'rejected') throw new Error(r.reason);
            if (r.state === 'timeout' || Date.now() - t0 > 35000) throw new Error('The robot didn\'t answer. Is it still online? Check its Wi-Fi, then try again.');
            step(r.state === 'delivered' ? 'The robot is answering' : 'Waiting for the robot to check in (every second or two)');
            return wait(450).then(poll);
          });
        }
        return poll();
      })
      .then(function (answer) {
        step('Connecting peer to peer');
        return pc.setRemoteDescription({ type: 'answer', sdp: answer });
      })
      .then(function () {
        return new Promise(function (resolve, reject) {
          if (rel.readyState === 'open') return resolve();
          var t = setTimeout(function () {
            reject(new Error('The robot answered, but no direct connection could be made. Your network may block it: an admin can add a TURN relay server in Admin → Network.'));
          }, 15000);
          rel.onopen = function () { clearTimeout(t); resolve(); };
        });
      })
      .then(function () { link.open = function () { return Promise.resolve(); }; return link; })
      .catch(function (e) { link.close({}); throw e; });
  };

  /* ---------------------------------------------------------------- the robot, in a browser tab */
  /* opts: {api (…/_/api), token, core (RobotCore), stream (MediaStream), onLog(text, level), onChange()} */
  function RobotHost(opts) {
    this.o = opts; this.api = opts.api.replace(/\/$/, ''); this.token = opts.token;
    this.core = opts.core; this.stream = opts.stream; this.sessions = {}; this.running = false;
    this.rev = 0; this.sentManifest = false; this.ice = [];
  }
  RobotHost.prototype.post = function (path, body) {
    body = Object.assign({ token: this.token }, body || {});
    return fetch(this.api + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (r.status === 401) { var e = new Error(j.error || 'Unpaired'); e.unpaired = true; throw e; } return j; }); });
  };
  RobotHost.prototype.log = function (text, level) { if (this.o.onLog) this.o.onLog(text, level || 'info'); };
  RobotHost.prototype.start = function () {
    var self = this;
    this.running = true;
    return this.post('/bot/hello', { manifest: this.core.manifest(), info: { version: 'browser-1.0', model: navigator.userAgent.slice(0, 70), host: location.host, platform: navigator.platform || '', camera: this.o.cameraLabel || '' } })
      .then(function (h) {
        if (!h.ok) throw new Error(h.error || 'The server said no.');
        self.rev = h.config_rev; self.ice = h.ice_servers || [];
        self.log(h.name + ' is online. Waiting for pilots.');
        self.loop();
      });
  };
  RobotHost.prototype.loop = function () {
    var self = this;
    if (!this.running) return;
    var body = { telemetry: this.core.readings(), sessions: Object.keys(this.sessions), config_rev: this.rev };
    if (!this.sentManifest) body.manifest = this.core.manifest();
    this.post('/bot/poll', body).then(function (r) {
      self.sentManifest = true;
      if (r.ice_servers) self.ice = r.ice_servers;
      if (r.config) { self.rev = r.config_rev; if (self.o.onConfig) self.o.onConfig(r.config); self.sentManifest = false; }
      (r.offers || []).forEach(function (o) { self.answer(o); });
      (r.ended || []).forEach(function (sid) { var s = self.sessions[sid]; if (s) s.close(); });
      setTimeout(function () { self.loop(); }, Math.max(300, r.next_ms || 1500));
    }, function (e) {
      if (e.unpaired) { self.running = false; self.log(e.message, 'stop'); if (self.o.onChange) self.o.onChange(); return; }
      self.log('Server unreachable (' + e.message + '), retrying.', 'warn');
      setTimeout(function () { self.loop(); }, 3000);
    });
  };
  RobotHost.prototype.answer = function (offer) {
    var self = this, pc = new RTCPeerConnection({ iceServers: this.ice });
    var chans = {};
    var peer = { id: offer.session, role: offer.role, pilot: offer.pilot, send: function (msg) {
      var ch = chans.rp; if (ch && ch.readyState === 'open') { try { ch.send(JSON.stringify(msg)); } catch (e) {} } } };
    var sess = { pc: pc, peer: peer, joined: false, close: function () {
      if (sess.closed) return; sess.closed = true;
      try { pc.close(); } catch (e) {}
      if (sess.joined) self.core.leave(peer);
      delete self.sessions[offer.session];
      self.log(offer.pilot + ' left.');
      if (self.o.onChange) self.o.onChange();
    } };
    this.sessions[offer.session] = sess;
    pc.ondatachannel = function (e) {
      chans[e.channel.label] = e.channel;
      e.channel.onmessage = function (m) { self.core.handle(peer, m.data); };
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'connected' && !sess.joined) { sess.joined = true; self.core.join(peer); self.log(offer.pilot + ' connected (' + offer.role + ').'); if (self.o.onChange) self.o.onChange(); }
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') sess.close();
    };
    var prev = null;
    sess.stats = function () { return readStats(pc, prev, 'outbound-rtp').then(function (s) { prev = { bytes: s.bytes, ts: s.ts }; return s; }); };
    pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp })
      .then(function () {
        if (self.stream) self.stream.getTracks().forEach(function (t) { pc.addTrack(t, self.stream); });
        return pc.createAnswer();
      })
      .then(function (a) { return pc.setLocalDescription(a); })
      .then(function () { return iceDone(pc, 2500); })
      .then(function () { return self.post('/bot/answer', { session: offer.session, sdp: pc.localDescription.sdp }); })
      .then(function () { self.log('Answered ' + offer.pilot + '.'); })
      .catch(function (e) { self.log('Couldn\'t connect ' + offer.pilot + ': ' + e.message, 'warn'); sess.close(); });
  };
  RobotHost.prototype.stop = function () {
    var self = this;
    this.running = false;
    Object.keys(this.sessions).forEach(function (k) { self.sessions[k].close(); });
    return this.post('/bot/event', { kind: 'offline', text: 'Robot mode stopped in the browser.' }).catch(function () {});
  };
  RP.RobotHost = RobotHost;
})();

/* ===== _rp_sim.html ===== */
(function () {
  'use strict';
  var RP = window.RP;
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var num = function (v, d) { var f = parseFloat(v); return isFinite(f) ? f : d; };
  var SENSOR = { gauge: 1, distance: 1 };

  /* ================================================================ RobotCore */
  /* specs: parts like the manifest's controls + sensors (id, type, label, min, max, home, ...).
     hw: optional hardware hooks {drive(l, r), set(id, v, spec), switch(id, on, spec), say(id, text), read(id, spec)} */
  function RobotCore(specs, opts) {
    opts = opts || {};
    this.name = opts.name || 'Robot';
    this.hw = opts.hw || {};
    this.watchdog = (opts.watchdog_ms || 500) / 1000;
    this.peers = [];
    this.driver = null;
    this.lastDrive = 0;
    this.seq = {};
    this.listeners = [];
    this.build(specs || []);
    var self = this, last = performance.now(), lastTel = 0, lastState = 0;
    this.timer = setInterval(function () {
      var now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      self.tick(dt, now / 1000);
      if (self.peers.length && self.dirty && now - lastState > 100) { lastState = now; self.dirty = false; self.broadcastState(); }
      if (self.peers.length && now - lastTel > 1000) { lastTel = now; self.broadcast({ t: 'tel', sensors: self.readings(), values: self.values() }); }
    }, 20);
  }
  RobotCore.prototype.build = function (specs) {
    this.parts = specs.map(function (s) {
      var p = { spec: s, id: s.id, type: s.type, error: s.error || null };
      if (s.type === 'servo' || s.type === 'slider') {
        p.lo = num(s.min, s.type === 'servo' ? -80 : 0); p.hi = num(s.max, s.type === 'servo' ? 80 : 100);
        p.homeV = clamp(num(s.home, s.type === 'servo' ? 0 : p.lo), p.lo, p.hi); p.target = p.value = p.homeV;
      } else if (s.type === 'toggle' || s.type === 'button') p.value = false;
      else if (s.type === 'drive') { p.target = [0, 0]; p.l = p.r = 0; p.value = { l: 0, r: 0 }; }
      else p.value = null;
      return p;
    });
    this.dirty = true;
  };
  RobotCore.prototype.manifest = function () {
    var m = { protocol: 1, name: this.name, controls: [], sensors: [], problems: [], camera: this.camera || { width: 640, height: 480, fps: 30, source: 'simulator' } };
    this.parts.forEach(function (p) {
      var d = {}; Object.keys(p.spec).forEach(function (k) { if (['driver', 'pins'].indexOf(k) < 0) d[k] = p.spec[k]; });
      if (p.error) { d.error = p.error; m.problems.push({ id: p.id, text: p.error }); }
      (SENSOR[p.type] ? m.sensors : m.controls).push(d);
    });
    return m;
  };
  RobotCore.prototype.part = function (id) { return this.parts.filter(function (p) { return p.id === id; })[0]; };
  RobotCore.prototype.ofType = function (t) { return this.parts.filter(function (p) { return p.type === t && !p.error; })[0]; };
  RobotCore.prototype.values = function () {
    var out = {};
    this.parts.forEach(function (p) {
      if (SENSOR[p.type] || p.error) return;
      out[p.id] = typeof p.value === 'number' ? Math.round(p.value * 10) / 10 : p.value;
    });
    return out;
  };
  RobotCore.prototype.readings = function () {
    var out = {}, hw = this.hw;
    this.parts.forEach(function (p) { if (SENSOR[p.type] && !p.error) out[p.id] = hw.read ? hw.read(p.id, p.spec) : null; });
    return out;
  };
  RobotCore.prototype.on = function (fn) { this.listeners.push(fn); };
  RobotCore.prototype.emit = function (ev) { this.listeners.forEach(function (f) { try { f(ev); } catch (e) { console.error(e); } }); };
  RobotCore.prototype.seat = function () { var d = this.driver; return { driver: d ? d.id : null, name: d ? d.pilot : null }; };
  RobotCore.prototype.broadcast = function (msg) { this.peers.forEach(function (p) { p.send(msg); }); };
  RobotCore.prototype.broadcastState = function () { this.broadcast({ t: 'state', values: this.values(), seat: this.seat() }); };
  RobotCore.prototype.note = function (level, text) {
    this.broadcast({ t: 'log', level: level, text: text });
    this.emit({ kind: 'log', level: level, text: text });
  };
  RobotCore.prototype.join = function (peer) {
    this.peers.push(peer);
    if (peer.role !== 'viewer' && (!this.driver || peer.role === 'owner')) this.giveSeat(peer);
    this.emit({ kind: 'peers' });
  };
  RobotCore.prototype.leave = function (peer) {
    this.peers = this.peers.filter(function (p) { return p !== peer; });
    if (this.driver === peer) {
      this.driver = null; this.allSafe();
      var next = this.peers.filter(function (p) { return p.role !== 'viewer'; })[0];
      if (next) this.giveSeat(next); else this.broadcastState();
    }
    this.emit({ kind: 'peers' });
  };
  RobotCore.prototype.giveSeat = function (peer) {
    if (this.driver !== peer) this.allSafe();
    this.driver = peer; this.seq = {};
    this.broadcastState();
    this.broadcast({ t: 'log', level: 'info', text: peer.pilot === 'You' ? 'You are driving.' : peer.pilot + ' is driving.' });
  };
  RobotCore.prototype.allSafe = function () {
    var self = this;
    this.parts.forEach(function (p) {
      if (p.type === 'drive') { p.target = [0, 0]; p.l = p.r = 0; p.value = { l: 0, r: 0 }; if (self.hw.drive) self.hw.drive(0, 0); }
      if (p.type === 'button' && p.value) { p.value = false; if (self.hw.switch) self.hw.switch(p.id, false, p.spec); }
    });
    this.dirty = true;
  };
  RobotCore.prototype.handle = function (peer, msg) {
    if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch (e) { return; } }
    if (!msg || typeof msg !== 'object') return;
    var t = msg.t, self = this;
    if (t === 'ping') { peer.send({ t: 'pong', n: msg.n, ts: msg.ts, robot_ms: Date.now() }); return; }
    if (t === 'hello') { peer.send(Object.assign(this.manifest(), { t: 'manifest' })); peer.send({ t: 'state', values: this.values(), seat: this.seat(), you: peer.id }); return; }
    if (t === 'stop') { this.allSafe(); this.note('stop', 'Emergency stop pressed by ' + peer.pilot + '.'); return; }
    if (peer.role === 'viewer') return;
    if (t === 'seat') {
      if (!this.driver || peer.role === 'owner' || this.driver.role !== 'owner') this.giveSeat(peer);
      else peer.send({ t: 'log', level: 'warn', text: this.driver.pilot + ' (the owner) is driving.' });
      return;
    }
    if (peer !== this.driver) return;
    var key = t + ':' + (msg.id || '');
    if (typeof msg.s === 'number') { if (msg.s <= (this.seq[key] == null ? -1 : this.seq[key])) return; this.seq[key] = msg.s; }
    if (t === 'drive') {
      var d = this.ofType('drive');
      if (d) { d.target = [clamp(num(msg.x, 0), -1, 1), clamp(num(msg.y, 0), -1, 1)]; this.lastDrive = performance.now() / 1000; this.wdStopped = false; }
      return;
    }
    if (t === 'home') { this.parts.forEach(function (p) { if (p.homeV != null) p.target = p.homeV; }); this.dirty = true; return; }
    var p = this.part(msg.id);
    if (!p || p.error) return;
    if (t === 'set') {
      if (p.homeV != null) p.target = clamp(num(msg.v, p.target), p.lo, p.hi);
      else if (p.type === 'toggle' || p.type === 'button') { p.value = !!msg.v; if (self.hw.switch) self.hw.switch(p.id, p.value, p.spec); }
    } else if (t === 'press') {
      p.value = !!msg.down;
      if (self.hw.switch) self.hw.switch(p.id, p.value, p.spec);
      if (p.value) this.emit({ kind: 'press', id: p.id, spec: p.spec });
    } else if (t === 'say') {
      var text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (text) {
        p.value = text;
        if (self.hw.say) self.hw.say(p.id, text, p.spec);
        this.broadcast({ t: 'log', level: 'info', text: (p.spec.label || 'Voice') + ': “' + text.slice(0, 120) + '”' });
        this.emit({ kind: 'say', text: text });
      }
    }
    this.dirty = true;
  };
  RobotCore.prototype.tick = function (dt, nowS) {
    var self = this, hw = this.hw;
    var d = this.ofType('drive');
    if (d && (d.target[0] || d.target[1]) && nowS - this.lastDrive > this.watchdog) {
      d.target = [0, 0];
      if (!this.wdStopped) { this.wdStopped = true; this.note('stop', 'Wheels stopped: no signal from the pilot for ' + this.watchdog.toFixed(1) + ' s.'); }
    }
    this.parts.forEach(function (p) {
      if (p.error) return;
      if (p.homeV != null) {
        var speed = num(p.spec.speed, 240), step = speed * dt, before = p.value;
        p.value += clamp(p.target - p.value, -step, step);
        if (p.value !== before) { self.dirty = true; if (hw.set) hw.set(p.id, p.value, p.spec); }
      } else if (p.type === 'drive') {
        var top = clamp(num(p.spec.max_speed, 0.8), 0.1, 1), turn = clamp(num(p.spec.turn, 0.7), 0.2, 1);
        var x = p.target[0], y = p.target[1], l = y + x * turn, r = y - x * turn, m = Math.max(1, Math.abs(l), Math.abs(r));
        l = l / m * top; r = r / m * top;
        if (self.blockForward && (l + r) / 2 > 0.02) { var f = (l + r) / 2; l -= f; r -= f; if (!self.wasBlocked) self.note('warn', 'Bumper sonar: something close ahead, forward drive paused.'); self.wasBlocked = true; } else self.wasBlocked = false;
        var st = 3.5 * dt, bl = p.l, br = p.r;
        p.l += clamp(l - p.l, -st, st); p.r += clamp(r - p.r, -st, st);
        if (Math.abs(p.l) < 0.02 && l === 0) p.l = 0;
        if (Math.abs(p.r) < 0.02 && r === 0) p.r = 0;
        p.value = { l: Math.round(p.l * 100) / 100, r: Math.round(p.r * 100) / 100 };
        if (p.l !== bl || p.r !== br) { self.dirty = true; if (hw.drive) hw.drive(p.l, p.r); }
      }
    });
  };
  RobotCore.prototype.destroy = function () { clearInterval(this.timer); this.peers = []; };
  RP.RobotCore = RobotCore;

  /* The parts a simulator gets when it has no manifest to copy. */
  RP.SIM_PARTS = [
    { id: 'drive', type: 'drive', label: 'Wheels', max_speed: 0.8 },
    { id: 'pan', type: 'servo', label: 'Look left / right', min: -80, max: 80, home: 0, unit: '°', group: 'head', axis: 'x' },
    { id: 'tilt', type: 'servo', label: 'Look up / down', min: -35, max: 55, home: 5, unit: '°', group: 'head', axis: 'y' },
    { id: 'lights', type: 'toggle', label: 'Headlights', key: 'l' },
    { id: 'horn', type: 'button', label: 'Beep', key: 'b' },
    { id: 'voice', type: 'say', label: 'Speak', phrases: ['Hello!', 'Need input!', 'Coming through', 'Found it!'] },
    { id: 'battery', type: 'gauge', label: 'Battery', unit: 'V', min: 6.0, max: 8.4, warn: 6.6, low_is_bad: true },
    { id: 'distance', type: 'distance', label: 'Bumper sonar', unit: 'cm', max: 200, warn: 25 }
  ];
  RP.specsFromManifest = function (m) {
    var out = [];
    ((m && m.controls) || []).forEach(function (c) { out.push(Object.assign({}, c, { error: null })); });
    ((m && m.sensors) || []).forEach(function (s) { out.push(Object.assign({}, s, { error: null })); });
    return out.length ? out : RP.SIM_PARTS.slice();
  };

  /* ================================================================ SimWorld: the garage */
  var D2R = Math.PI / 180;
  function shade(hex, k) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgb(' + Math.round(clamp(r * k, 0, 255)) + ',' + Math.round(clamp(g * k, 0, 255)) + ',' + Math.round(clamp(b * k, 0, 255)) + ')';
  }
  var ROOM = { x0: -4, x1: 4, z0: -3, z1: 3, h: 2.4 };
  var BOXES = [
    { n: 'workbench', x: -1.2, z: 2.55, w: 2.4, d: 0.8, h: 0.9, c: '#7a5a3a' },
    { n: 'toolbox', x: -0.6, z: 2.55, w: 0.55, d: 0.32, h: 0.3, y0: 0.9, c: '#c23b22' },
    { n: 'shelf', x: -3.7, z: 0.2, w: 0.6, d: 2.2, h: 1.8, c: '#5b6166' },
    { n: 'crate', x: 2.1, z: 0.7, w: 0.7, d: 0.7, h: 0.55, c: '#a8844f' },
    { n: 'small crate', x: 2.3, z: 1.55, w: 0.45, d: 0.45, h: 0.4, c: '#b8945e' },
    { n: 'paint cans', x: -3.55, z: -2.35, w: 0.7, d: 0.7, h: 0.35, c: '#3f6f9c' },
    { n: 'tyre stack', x: 3.45, z: -2.4, w: 0.8, d: 0.8, h: 0.7, c: '#2a2b26' },
    { n: 'charging dock', x: 0, z: -2.85, w: 0.7, d: 0.3, h: 0.12, c: '#e2611e', dock: true }
  ];
  var BOLT_SPOTS = [[2.9, 2.3], [-2.7, 1.9], [0.9, -0.4], [-1.9, -1.6], [3.3, -0.9]];

  function SimWorld(canvas, core, opts) {
    opts = opts || {};
    this.cv = canvas; this.g = canvas.getContext('2d'); this.core = core;
    this.W = canvas.width; this.H = canvas.height;
    this.x = 0; this.z = -2.25; this.heading = 0; this.battery = 8.2; this.bumpT = 0; this.t = 0;
    this.ball = { x: 0.9, z: 0.6, vx: 0, vz: 0, r: 0.12 };
    this.bolts = BOLT_SPOTS.map(function (p, i) { return { x: p[0], z: p[1], got: false, i: i }; });
    this.found = 0;
    this.onEvent = opts.onEvent || function () {};
    this.label = opts.label || 'SIM';
    var self = this, last = performance.now();
    this.timer = setInterval(function () {
      var now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      self.step(dt); self.draw();
    }, 33);
  }
  SimWorld.prototype.value = function (id) { var p = this.core.part(id); return p ? p.value : null; };
  SimWorld.prototype.headAngles = function () {
    var split = RP.split(this.core.manifest()), pan = 0, tilt = 0;
    if (split.pan) pan = num(this.value(split.pan.id), 0);
    if (split.tilt) tilt = num(this.value(split.tilt.id), 0);
    return [pan, tilt];
  };
  SimWorld.prototype.lightsOn = function () {
    return this.core.parts.some(function (p) { return p.type === 'toggle' && /light|lamp|flood/.test(p.id + ' ' + (p.spec.label || '').toLowerCase()) && p.value === true; });
  };
  SimWorld.prototype.blocked = function (x, z, r) {
    if (x - r < ROOM.x0 || x + r > ROOM.x1 || z - r < ROOM.z0 || z + r > ROOM.z1) return 'wall';
    for (var i = 0; i < BOXES.length; i++) {
      var b = BOXES[i];
      if (b.y0 || b.dock) continue;
      if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) return b.n;
    }
    return null;
  };
  SimWorld.prototype.ray = function (x, z, dx, dz) {  // distance to the nearest wall or box along (dx, dz)
    var best = 99;
    var walls = [[(ROOM.x1 - x) / dx, dx > 0], [(ROOM.x0 - x) / dx, dx < 0], [(ROOM.z1 - z) / dz, dz > 0], [(ROOM.z0 - z) / dz, dz < 0]];
    walls.forEach(function (w) { if (w[1] && isFinite(w[0]) && w[0] > 0) best = Math.min(best, w[0]); });
    BOXES.forEach(function (b) {
      if (b.y0 || b.dock) return;
      var tx1 = (b.x - b.w / 2 - x) / dx, tx2 = (b.x + b.w / 2 - x) / dx, tz1 = (b.z - b.d / 2 - z) / dz, tz2 = (b.z + b.d / 2 - z) / dz;
      var tmin = Math.max(Math.min(tx1, tx2), Math.min(tz1, tz2)), tmax = Math.min(Math.max(tx1, tx2), Math.max(tz1, tz2));
      if (tmax >= Math.max(0, tmin) && tmin > 0) best = Math.min(best, tmin);
    });
    return best;
  };
  SimWorld.prototype.distanceCm = function () {
    var d = this.ray(this.x, this.z, Math.sin(this.heading) || 1e-9, Math.cos(this.heading) || 1e-9) - 0.2;
    return Math.round(clamp(d * 100, 2, 200) * 10) / 10;
  };
  SimWorld.prototype.step = function (dt) {
    this.t += dt;
    var d = this.core.ofType('drive'), l = d ? d.l : 0, r = d ? d.r : 0;
    var v = (l + r) / 2 * 0.75, w = (l - r) * 1.7;
    this.heading += w * dt;
    var nx = this.x + Math.sin(this.heading) * v * dt, nz = this.z + Math.cos(this.heading) * v * dt;
    var hit = this.blocked(nx, nz, 0.2);
    if (hit && Math.abs(v) > 0.05) {
      if (this.bumpT <= 0) { this.onEvent({ kind: 'bump', what: hit }); RP.beep(140, 90, 0.05); }
      this.bumpT = 0.25;
    } else if (!hit) { this.x = nx; this.z = nz; }
    if (this.bumpT > 0) this.bumpT -= dt;
    this.battery = Math.max(6.0, this.battery - (0.00002 + Math.abs(l) * 0.0004 + Math.abs(r) * 0.0004) * dt * 30);
    // the ball: pushed by the robot, rolls, bounces
    var B = this.ball, ddx = B.x - this.x, ddz = B.z - this.z, dist = Math.sqrt(ddx * ddx + ddz * ddz);
    if (dist < 0.2 + B.r && dist > 0.001) {
      var push = Math.max(0.4, Math.abs(v) * 1.6);
      B.vx = ddx / dist * push; B.vz = ddz / dist * push;
      B.x = this.x + ddx / dist * (0.2 + B.r); B.z = this.z + ddz / dist * (0.2 + B.r);
    }
    var bx = B.x + B.vx * dt, bz = B.z + B.vz * dt;
    if (this.blocked(bx, B.z, B.r)) B.vx = -B.vx * 0.6; else B.x = bx;
    if (this.blocked(B.x, bz, B.r)) B.vz = -B.vz * 0.6; else B.z = bz;
    B.vx *= Math.pow(0.45, dt); B.vz *= Math.pow(0.45, dt);
    // bolts
    var self = this;
    this.bolts.forEach(function (b) {
      if (b.got) return;
      var ex = b.x - self.x, ez = b.z - self.z;
      if (ex * ex + ez * ez < 0.32 * 0.32) {
        b.got = true; self.found++;
        RP.beep(1320, 90, 0.05); setTimeout(function () { RP.beep(1760, 120, 0.05); }, 110);
        self.onEvent({ kind: 'bolt', found: self.found, total: self.bolts.length });
      }
    });
    this.core.blockForward = false;
    var sonar = this.core.ofType('distance');
    if (sonar && num(sonar.spec.stop_at, 0) > 0 && this.distanceCm() < num(sonar.spec.stop_at, 0)) this.core.blockForward = true;
  };
  SimWorld.prototype.reset = function () {
    this.x = 0; this.z = -2.25; this.heading = 0; this.found = 0; this.battery = 8.2;
    this.bolts.forEach(function (b) { b.got = false; });
    this.ball = { x: 0.9, z: 0.6, vx: 0, vz: 0, r: 0.12 };
  };

  // ---------------------------------------------------------------- drawing
  SimWorld.prototype.cam = function () {
    var ht = this.headAngles(), shake = this.bumpT > 0 ? Math.sin(this.t * 90) * 0.012 : 0;
    var yaw = this.heading + ht[0] * D2R, pitch = ht[1] * D2R;
    return { x: this.x + Math.sin(this.heading) * 0.05, y: 0.34 + shake, z: this.z + Math.cos(this.heading) * 0.05,
             sy: Math.sin(yaw), cy: Math.cos(yaw), sp: Math.sin(pitch), cp: Math.cos(pitch), f: (this.W / 2) / Math.tan(31 * D2R) };
  };
  function toCam(C, p) {
    var dx = p[0] - C.x, dy = p[1] - C.y, dz = p[2] - C.z;
    var cx = dx * C.cy - dz * C.sy, cz = dx * C.sy + dz * C.cy;
    return [cx, dy * C.cp - cz * C.sp, dy * C.sp + cz * C.cp];
  }
  var NEAR = 0.05;
  function clipPoly(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length], ina = a[2] > NEAR, inb = b[2] > NEAR;
      if (ina) out.push(a);
      if (ina !== inb) { var t = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]); }
    }
    return out;
  }
  SimWorld.prototype.proj = function (C, p) { return [this.W / 2 + C.f * p[0] / p[2], this.H / 2 - C.f * p[1] / p[2]]; };
  SimWorld.prototype.light = function (dist) {
    var amb = this.lightsOn() ? 1.05 : 0.74;
    var lamp = this.lightsOn() ? clamp(1.25 - dist * 0.12, 0.75, 1.25) : 1;
    return amb * lamp * clamp(1.15 - dist * 0.055, 0.55, 1.1);
  };
  SimWorld.prototype.draw = function () {
    var g = this.g, W = this.W, H = this.H, C = this.cam(), self = this, lit = this.lightsOn();
    g.fillStyle = lit ? '#46483d' : '#2b2c25'; g.fillRect(0, 0, W, H);
    var faces = [], room = [], objs = [];
    function quad(pts, color, n, extra) {
      var cam = pts.map(function (p) { return toCam(C, p); });
      var cx = 0, cy = 0, cz = 0; pts.forEach(function (p) { cx += p[0]; cy += p[1]; cz += p[2]; });
      cx /= pts.length; cy /= pts.length; cz /= pts.length;
      if (n) { var vx = cx - C.x, vy = cy - C.y, vz = cz - C.z; if (vx * n[0] + vy * n[1] + vz * n[2] >= 0) return; }
      var cl = clipPoly(cam); if (cl.length < 3) return;
      var dist = Math.sqrt((cx - C.x) * (cx - C.x) + (cy - C.y) * (cy - C.y) + (cz - C.z) * (cz - C.z));
      var k = self.light(dist) * (n ? 0.72 + 0.28 * Math.abs(n[0] * 0.5 + n[1] * 0.8 + n[2] * 0.3) : 1);
      var deco = extra === 'peg' || extra === 'window' || extra === 'sign';  // flat on a wall: always in front of it
      faces.push({ d: deco ? dist - 3 : dist, pts: cl, color: shade(color, k), extra: extra });
    }
    var R = ROOM;
    // floor + ceiling + walls
    quad([[R.x0, 0, R.z0], [R.x1, 0, R.z0], [R.x1, 0, R.z1], [R.x0, 0, R.z1]], '#8a8778', [0, 1, 0], 'floor');
    quad([[R.x0, R.h, R.z1], [R.x1, R.h, R.z1], [R.x1, R.h, R.z0], [R.x0, R.h, R.z0]], '#5e5c52', [0, -1, 0]);
    quad([[R.x0, 0, R.z1], [R.x1, 0, R.z1], [R.x1, R.h, R.z1], [R.x0, R.h, R.z1]], '#c9c0a6', [0, 0, -1]);
    quad([[R.x1, 0, R.z0], [R.x0, 0, R.z0], [R.x0, R.h, R.z0], [R.x1, R.h, R.z0]], '#b9b6a8', [0, 0, 1], 'door');
    quad([[R.x1, 0, R.z1], [R.x1, 0, R.z0], [R.x1, R.h, R.z0], [R.x1, R.h, R.z1]], '#c4bb9f', [-1, 0, 0]);
    quad([[R.x0, 0, R.z0], [R.x0, 0, R.z1], [R.x0, R.h, R.z1], [R.x0, R.h, R.z0]], '#bdb497', [1, 0, 0]);
    // wall dressing: pegboard, window, safety sign
    quad([[-2.9, 1.05, R.z1 - 0.01], [0.6, 1.05, R.z1 - 0.01], [0.6, 2.0, R.z1 - 0.01], [-2.9, 2.0, R.z1 - 0.01]], '#a07c52', [0, 0, -1], 'peg');
    quad([[R.x1 - 0.01, 1.0, 1.9], [R.x1 - 0.01, 1.0, -0.4], [R.x1 - 0.01, 1.9, -0.4], [R.x1 - 0.01, 1.9, 1.9]], lit ? '#6c86a6' : '#30425a', [-1, 0, 0], 'window');
    quad([[1.4, 1.3, R.z1 - 0.01], [2.4, 1.3, R.z1 - 0.01], [2.4, 1.9, R.z1 - 0.01], [1.4, 1.9, R.z1 - 0.01]], '#e9b42c', [0, 0, -1], 'sign');
    room = faces; faces = objs;
    // boxes
    BOXES.forEach(function (b) {
      var x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, y0 = b.y0 || 0, y1 = y0 + b.h;
      quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], b.c, [0, 1, 0], b.dock ? 'dock' : null);
      quad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], b.c, [0, 0, -1]);
      quad([[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], b.c, [0, 0, 1]);
      quad([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], b.c, [1, 0, 0]);
      quad([[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], b.c, [-1, 0, 0]);
    });
    // traffic cone (a four-sided pyramid)
    var cx = 1.2, cz = -1.0, s = 0.16, top = [cx, 0.5, cz];
    [[[cx - s, 0, cz - s], [cx + s, 0, cz - s]], [[cx + s, 0, cz - s], [cx + s, 0, cz + s]], [[cx + s, 0, cz + s], [cx - s, 0, cz + s]], [[cx - s, 0, cz + s], [cx - s, 0, cz - s]]]
      .forEach(function (e, i) { var n = [[0, .3, -1], [1, .3, 0], [0, .3, 1], [-1, .3, 0]][i]; quad([e[0], e[1], top], '#ee6a1c', n); });
    room.sort(function (a, b) { return b.d - a.d; });
    objs.sort(function (a, b) { return b.d - a.d; });
    room.concat(objs).forEach(function (f) {
      g.beginPath();
      f.pts.forEach(function (p, i) { var q = self.proj(C, p); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
      g.closePath(); g.fillStyle = f.color; g.fill();
      if (f.extra === 'floor') self.floorLines(C);
      if (f.extra === 'dock' || f.extra === 'sign') { g.save(); g.clip(); self.stripes(); g.restore(); }
      if (f.extra === 'peg') { g.save(); g.clip(); g.fillStyle = 'rgba(30,25,18,.35)'; for (var i = 0; i < 220; i++) { var px = (i * 37) % W, py = (i * 53) % H; g.fillRect(px, py, 2, 2); } g.restore(); }
      if (f.extra === 'door') { g.save(); g.clip(); g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 2; for (var y = 0.15; y < R.h; y += 0.22) self.line(C, [R.x1, y, R.z0 + 0.01], [R.x0, y, R.z0 + 0.01]); g.restore(); }
    });
    // ball + bolts (sprites, sorted far to near)
    var sprites = [];
    var B = this.ball, bc = toCam(C, [B.x, B.r, B.z]);
    if (bc[2] > NEAR) sprites.push({ d: bc[2], draw: function () {
      var q = self.proj(C, bc), rr = C.f * B.r / bc[2];
      var gr = g.createRadialGradient(q[0] - rr * .35, q[1] - rr * .35, rr * .1, q[0], q[1], rr);
      gr.addColorStop(0, shade('#ff8a3d', self.light(bc[2]) * 1.2)); gr.addColorStop(1, shade('#b8400c', self.light(bc[2])));
      g.fillStyle = gr; g.beginPath(); g.arc(q[0], q[1], rr, 0, 7); g.fill();
    } });
    this.bolts.forEach(function (b) {
      if (b.got) return;
      var bp = toCam(C, [b.x, 0.16 + Math.sin(self.t * 2 + b.i) * 0.03, b.z]);
      if (bp[2] <= NEAR) return;
      sprites.push({ d: bp[2], draw: function () {
        var q = self.proj(C, bp), rr = C.f * 0.06 / bp[2], sx = Math.abs(Math.cos(self.t * 2.4 + b.i));
        g.save(); g.translate(q[0], q[1]); g.scale(Math.max(0.2, sx), 1);
        g.beginPath(); for (var i = 0; i < 6; i++) { var a = Math.PI / 3 * i + Math.PI / 6; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        g.closePath(); g.fillStyle = '#f2c94c'; g.fill(); g.lineWidth = Math.max(1, rr * .18); g.strokeStyle = '#8a6a12'; g.stroke();
        g.beginPath(); g.arc(0, 0, rr * .38, 0, 7); g.fillStyle = '#6b5210'; g.fill(); g.restore();
        g.fillStyle = 'rgba(255,226,120,.25)'; g.beginPath(); g.arc(q[0], q[1], rr * 2.2, 0, 7); g.fill();
      } });
    });
    sprites.sort(function (a, b) { return b.d - a.d; }).forEach(function (s) { s.draw(); });
    // headlights: a warm pool in the middle
    if (lit) {
      var gr = g.createRadialGradient(W / 2, H * .62, 10, W / 2, H * .62, W * .55);
      gr.addColorStop(0, 'rgba(255,236,180,.30)'); gr.addColorStop(1, 'rgba(255,236,180,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    } else {
      var vg = g.createRadialGradient(W / 2, H / 2, H * .3, W / 2, H / 2, W * .7);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
    }
    // camera noise + time stamp (it is a camera after all)
    g.fillStyle = 'rgba(255,255,255,.035)';
    for (var i = 0; i < 90; i++) g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
    var now = new Date(), ts = now.toLocaleTimeString([], { hour12: false });
    g.font = '600 11px "IBM Plex Mono", monospace';
    var stamp = this.label + '  ' + ts + '  ' + this.found + '/' + this.bolts.length + ' bolts';
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(W - g.measureText(stamp).width - 18, H - 24, g.measureText(stamp).width + 10, 16);
    g.fillStyle = '#f4eedd'; g.fillText(stamp, W - g.measureText(stamp).width - 13, H - 12);
  };
  SimWorld.prototype.line = function (C, a, b) {
    var p = toCam(C, a), q = toCam(C, b);
    if (p[2] <= NEAR && q[2] <= NEAR) return;
    if (p[2] <= NEAR) { var t = (NEAR - p[2]) / (q[2] - p[2]); p = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, NEAR]; }
    if (q[2] <= NEAR) { var u = (NEAR - q[2]) / (p[2] - q[2]); q = [q[0] + (p[0] - q[0]) * u, q[1] + (p[1] - q[1]) * u, NEAR]; }
    var A = this.proj(C, p), B = this.proj(C, q), g = this.g;
    g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke();
  };
  SimWorld.prototype.floorLines = function (C) {
    var g = this.g, R = ROOM;
    g.strokeStyle = 'rgba(40,38,30,.35)'; g.lineWidth = 1;
    for (var x = R.x0 + 0.5; x < R.x1; x += 0.5) this.line(C, [x, 0.001, R.z0], [x, 0.001, R.z1]);
    for (var z = R.z0 + 0.5; z < R.z1; z += 0.5) this.line(C, [R.x0, 0.001, z], [R.x1, 0.001, z]);
    g.strokeStyle = '#e9b42c'; g.lineWidth = 3;  // painted safety lines around the work area
    this.line(C, [-2.8, 0.002, -1.9], [2.8, 0.002, -1.9]); this.line(C, [-2.8, 0.002, 1.95], [2.8, 0.002, 1.95]);
    this.line(C, [-2.8, 0.002, -1.9], [-2.8, 0.002, 1.95]); this.line(C, [2.8, 0.002, -1.9], [2.8, 0.002, 1.95]);
  };
  SimWorld.prototype.stripes = function () {
    var g = this.g;
    g.fillStyle = 'rgba(26,23,18,.85)';
    for (var i = -this.H; i < this.W + this.H; i += 22) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 11, 0); g.lineTo(i + 11 - this.H, this.H); g.lineTo(i - this.H, this.H); g.fill(); }
  };
  SimWorld.prototype.read = function (id, spec) {
    if (spec.type === 'distance') return this.distanceCm();
    if (spec.unit === 'V') return Math.round(this.battery * 100) / 100;
    var lo = num(spec.min, 0), hi = num(spec.max, 100);
    return Math.round((lo + (hi - lo) * (0.42 + Math.sin(this.t / 9) * 0.05)) * 10) / 10;
  };
  SimWorld.prototype.destroy = function () { clearInterval(this.timer); };
  RP.SimWorld = SimWorld;

  /* ================================================================ SimLink: cockpit <-> RobotCore in this page */
  RP.simulator = function (manifest, opts) {
    opts = opts || {};
    var canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    var core = new RobotCore(RP.specsFromManifest(manifest), { name: (manifest && manifest.name) || 'Simulator', watchdog_ms: 500 });
    core.camera = { width: 640, height: 480, fps: 30, source: 'simulator' };
    var world = new SimWorld(canvas, core, { label: opts.label || 'SIM CAM', onEvent: function (ev) {
      if (ev.kind === 'bump') core.note('warn', 'Bonk! Hit the ' + ev.what + '.');
      if (ev.kind === 'bolt') core.note('info', 'Found a lost bolt: ' + ev.found + ' of ' + ev.total + (ev.found === ev.total ? '. All of them! Number one pilot.' : '.'));
      if (opts.onEvent) opts.onEvent(ev);
    } });
    core.hw = { read: function (id, spec) { return world.read(id, spec); },
                say: function (id, text) { try { var u = new SpeechSynthesisUtterance(text); u.rate = 1.05; u.pitch = 1.3; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {} } };
    core.on(function (ev) { if (ev.kind === 'press' && /horn|beep|bell|chime/.test(ev.id)) { RP.beep(660, 160, 0.05); setTimeout(function () { RP.beep(880, 160, 0.05); }, 170); } });
    var stream = canvas.captureStream ? canvas.captureStream(30) : null;
    var DELAY = 18;  // one-way, so the cockpit shows a believable round trip
    var link = { kind: 'sim', stream: stream, canvas: canvas, core: core, world: world, onmessage: null, rtt: null };
    var peer = { id: 'you', role: opts.role || 'owner', pilot: opts.pilot || 'You', send: function (msg) {
      setTimeout(function () { if (link.onmessage) link.onmessage(JSON.parse(JSON.stringify(msg))); }, DELAY);
    } };
    link.send = function (msg) { setTimeout(function () { core.handle(peer, JSON.parse(JSON.stringify(msg))); }, DELAY); };
    link.open = function () { core.join(peer); return Promise.resolve(); };
    link.stats = function () { return Promise.resolve({ type: 'simulator', fps: 30, width: 640, height: 480, kbps: 0 }); };
    link.close = function () { core.leave(peer); core.destroy(); world.destroy(); if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); };
    return link;
  };
})();

/* ===== admin.html ===== */
(function () {
  var esc = UI.esc;
  var TABS = [['overview', 'Overview', 'grid'], ['robots', 'Robots', 'robot'], ['network', 'Network', 'signal'], ['feedback', 'Feedback', 'inbox'], ['users', 'Users', 'users'], ['demo', 'Demo data', 'database']];

  UI.page('admin', { title: 'Admin', auth: 'admin' }, function (view, ctx) {
    var tab = TABS.some(function (t) { return t[0] === ctx.args[0]; }) ? ctx.args[0] : 'overview';
    var fbFilter = 'new';
    view.innerHTML = '<div class="ui-wrap"><div class="ui-page-head"><div><h1>Admin</h1><p class="muted">Only admins see this page.</p></div></div>' +
      '<nav class="ui-tabs">' + TABS.map(function (t) {
        return '<a href="#admin/' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + UI.icon(t[2]) + t[1] + '</a>';
      }).join('') + '</nav><div data-body><div class="ui-skel"></div></div></div>';
    var body = view.querySelector('[data-body]');

    function overview() {
      return UI.api('admin_overview').then(function (d) {
        var stat = function (n, label, go) { return '<a class="ui-card ui-stat" href="#admin/' + go + '" style="text-decoration:none;color:inherit"><b>' + n + '</b><span>' + label + '</span></a>'; };
        body.innerHTML = '<div class="ad-stats">' + stat(d.users, 'people signed up', 'users') + stat(d.admins, UI.plural(d.admins, 'admin').replace(/^\d+ /, ''), 'users') +
          stat(d.robots, UI.plural(d.robots, 'robot').replace(/^\d+ /, ''), 'robots') + stat(d.online, 'online now', 'robots') + stat(d.sessions_week, 'drives this week', 'robots') +
          stat(d.feedback_new, 'new feedback', 'feedback') + '</div>' +
          '<p class="muted small" style="margin-top:18px">Demo data is <b>' + esc(d.demo.state) + '</b> (' + d.demo.counts.users + ' demo people). Manage it in the Demo data tab.</p>';
      });
    }

    function feedback() {
      return UI.api('list_feedback', null).then(function (d) {
        var items = d.items.filter(function (i) { return fbFilter === 'all' || i.status === fbFilter; });
        body.innerHTML = '<div class="ui-row" style="margin-bottom:16px"><div class="ui-seg">' + [['new', 'New'], ['read', 'Read'], ['done', 'Done'], ['all', 'All']].map(function (f) {
          var n = f[0] === 'all' ? d.items.length : d.counts[f[0]];
          return '<button data-filter="' + f[0] + '" class="' + (fbFilter === f[0] ? 'on' : '') + '">' + f[1] + ' (' + n + ')</button>';
        }).join('') + '</div></div>' +
          (items.length ? '<div class="ad-fb">' + items.map(function (i) {
            var c = i.context || {};
            return '<div class="ui-item" data-id="' + esc(i.id) + '"><div class="meta"><span class="ui-badge ' + (i.kind === 'bug' ? 'bad' : i.kind === 'idea' ? 'brand' : '') + '">' + esc(i.kind_label) + '</span>' +
              '<b>' + esc(i.name) + '</b>' + (i.email ? '<a href="mailto:' + esc(i.email) + '">' + esc(i.email) + '</a>' : '') + '<span>' + esc(UI.fmtDateTime(i.created)) + '</span></div>' +
              '<p class="msg">' + esc(i.message) + '</p>' +
              '<div class="ctx">' + esc([c.page, c.screen, c.theme, c.browser].filter(Boolean).join(' · ')) + '</div>' +
              '<textarea data-note placeholder="Private note (only admins see it)">' + esc(i.note) + '</textarea>' +
              '<div class="ui-row" style="margin-top:10px">' + ['new', 'read', 'done'].map(function (s) {
                return '<button class="ui-btn sm' + (i.status === s ? ' primary' : '') + '" data-status="' + s + '">' + s[0].toUpperCase() + s.slice(1) + '</button>';
              }).join('') + '<span class="ui-spacer"></span><button class="ui-btn sm danger" data-del-fb>' + UI.icon('trash') + 'Delete</button></div></div>';
          }).join('') + '</div>'
            : '<div class="ui-empty">' + UI.icon('inbox') + '<h3>No ' + (fbFilter === 'all' ? '' : fbFilter + ' ') + 'messages</h3><p>New feedback goes to Prepsto (prepsto.com). Older messages and requests from the app show up here.</p></div>');
      });
    }

    function users(query) {
      return UI.api('list_users', query || null).then(function (d) {
        body.innerHTML = '<form class="ui-row" data-search style="margin-bottom:14px"><input type="search" name="q" placeholder="Search by name or email" value="' + esc(query || '') + '" style="max-width:360px">' +
          '<button class="ui-btn" type="submit">' + UI.icon('search') + 'Search</button><span class="muted small">' + UI.plural(d.total, 'person', 'people') + '</span></form>' +
          '<table class="ad-users"><thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Admin</th><th>Active</th></tr></thead><tbody>' +
          d.users.map(function (u) {
            return '<tr data-id="' + esc(u.id) + '"><td><b>' + esc(u.name) + '</b></td><td class="email">' + esc(u.email) + '</td><td class="joined muted">' + esc(UI.fmtDate(u.joined)) + '</td>' +
              '<td><label class="ui-check"><input type="checkbox" data-admin' + (u.is_admin ? ' checked' : '') + '> Admin</label></td>' +
              '<td><label class="ui-check"><input type="checkbox" data-enabled' + (u.enabled ? ' checked' : '') + '> Active</label></td></tr>';
          }).join('') + '</tbody></table>';
      });
    }

    function demo() {
      return UI.api('admin_overview').then(function (d) {
        var c = d.demo.counts;
        body.innerHTML = '<div class="ui-card ui-narrow" style="margin:0"><h3>Demo data</h3>' +
          '<p class="muted">Example people and content, so the app never looks empty for the first visitors. Demo rows are flagged, so removing them never touches real data. Once removed, it stays removed until you load it again.</p>' +
          '<p>Status: <b>' + esc(d.demo.state) + '</b> · ' + Object.keys(c).map(function (k) { return c[k] + ' ' + esc(k); }).join(', ') + '</p>' +
          '<div class="ui-row"><button class="ui-btn primary" data-demo="load">' + UI.icon('refresh') + (d.demo.state === 'loaded' ? 'Reload demo data' : 'Load demo data') + '</button>' +
          '<button class="ui-btn danger" data-demo="remove">' + UI.icon('trash') + 'Remove demo data</button></div></div>';
      });
    }

    function robots() {
      return UI.api('admin_robots').then(function (d) {
        body.innerHTML = '<p class="muted small">Every robot, with its owner and status. Admins never get camera access: robots can be in people\'s homes.</p>' +
          (d.robots.length ? '<table class="ad-users"><thead><tr><th>Robot</th><th>Owner</th><th>Status</th><th>Brain</th><th>Drives</th></tr></thead><tbody>' + d.robots.map(function (r) {
            return '<tr><td><b>' + esc(r.name) + '</b>' + (r.demo ? ' <span class="ui-badge">demo</span>' : '') + '<br><span class="small muted">' + esc(r.model || '') + (r.version ? ' · code ' + esc(r.version) : '') + '</span></td>' +
              '<td class="email">' + esc(r.owner) + (r.email ? '<br><span class="small muted">' + esc(r.email) + '</span>' : '') + '</td>' +
              '<td>' + RP.lamp({ online: r.online, last_seen: r.last_seen, paired: !!r.last_seen }) + '</td><td class="joined">' + esc(RP.BOARDS[r.board] || r.board) + ' · ' + r.parts + ' parts</td><td>' + r.sessions + '</td></tr>';
          }).join('') + '</tbody></table>' : '<div class="ui-empty">' + UI.icon('robot') + '<h3>No robots yet</h3></div>');
      });
    }

    function network() {
      return UI.api('get_network').then(function (n) {
        body.innerHTML = '<form class="ui-card ui-stack ui-narrow" style="margin:0;max-width:820px" data-net><h3>Connection servers</h3>' +
          '<p class="muted small" style="margin:0">Browsers and robots use these to find a path to each other. STUN is enough on most networks. Strict networks (some offices, some mobile carriers) need a <b>TURN relay</b>: add one (urls starting with turn: or turns:, with a username and credential), from your own coturn server or a hosted service.</p>' +
          '<label class="ui-field"><span>ICE servers <em>(JSON list, sent to every pilot and robot)</em></span><textarea name="ice" style="min-height:150px;font:500 .85rem/1.5 var(--font-mono)">' + esc(JSON.stringify(n.ice_servers, null, 2)) + '</textarea></label>' +
          '<div class="ui-grid two"><label class="ui-field"><span>Robot check-in while someone is about to drive <em>(ms)</em></span><input type="number" name="fast" min="300" max="5000" value="' + n.poll_fast_ms + '"></label>' +
          '<label class="ui-field"><span>Robot check-in when idle <em>(ms)</em></span><input type="number" name="idle" min="1000" max="30000" value="' + n.poll_idle_ms + '"></label></div>' +
          '<p class="small muted" style="margin:0">Faster check-ins connect pilots sooner but make more server calls (one per robot per check-in).</p>' +
          '<label class="ui-field"><span>Robot code download <em>(the installer fetches this .tar.gz)</em></span><input type="url" name="source" value="' + esc(n.source) + '"></label>' +
          '<div class="ui-row"><button class="ui-btn primary" type="submit">' + UI.icon('check') + 'Save</button><button class="ui-btn" type="button" data-net-reset>Back to the defaults</button></div></form>';
        body.querySelector('[data-net-reset]').addEventListener('click', function () {
          var f = body.querySelector('[data-net]');
          f.ice.value = JSON.stringify(n.default_ice, null, 2); f.fast.value = 600; f.idle.value = 2500; f.source.value = n.default_source;
        });
      });
    }

    var DRAW = { overview: overview, robots: robots, network: network, feedback: feedback, users: users, demo: demo };

    view.addEventListener('click', function (e) {
      var f = e.target.closest('[data-filter]');
      if (f) { fbFilter = f.getAttribute('data-filter'); feedback(); return; }
      var st = e.target.closest('[data-status]');
      if (st) {
        var card = st.closest('[data-id]');
        UI.api('set_feedback_status', card.getAttribute('data-id'), st.getAttribute('data-status'), card.querySelector('[data-note]').value).then(function () { UI.toast('Saved', 'ok'); feedback(); });
        return;
      }
      var del = e.target.closest('[data-del-fb]');
      if (del) {
        UI.confirm({ title: 'Delete this message?', ok: 'Delete', danger: true }).then(function (yes) {
          if (yes) UI.api('delete_feedback', del.closest('[data-id]').getAttribute('data-id')).then(feedback);
        });
        return;
      }
      var dm = e.target.closest('[data-demo]');
      if (dm) {
        var load = dm.getAttribute('data-demo') === 'load';
        UI.confirm({ title: load ? 'Load the demo data?' : 'Remove the demo data?', text: load ? 'Demo people and content are added (any old demo rows are replaced).' : 'Every demo row is deleted. Real data stays.', ok: load ? 'Load' : 'Remove', danger: !load })
          .then(function (yes) { if (yes) UI.busy(dm, UI.api(load ? 'demo_load' : 'demo_remove')).then(function () { UI.toast('Done', 'ok'); demo(); }); });
      }
    });
    view.addEventListener('change', function (e) {
      var row = e.target.closest('tr[data-id]');
      if (!row) return;
      var id = row.getAttribute('data-id'), box = e.target;
      var fn = box.hasAttribute('data-admin') ? 'set_admin' : box.hasAttribute('data-enabled') ? 'set_enabled' : null;
      if (fn) UI.api(fn, id, box.checked).then(function () { UI.toast('Saved', 'ok'); }, function (err) { box.checked = !box.checked; UI.toast(err.message, 'error'); });
    });
    view.addEventListener('submit', function (e) {
      if (e.target.matches('[data-search]')) { e.preventDefault(); users(UI.formData(e.target).q); }
      if (e.target.matches('[data-net]')) {
        e.preventDefault();
        var f = e.target, ice;
        try { ice = JSON.parse(f.ice.value); } catch (err) { UI.toast('The ICE servers aren\'t valid JSON.', 'error'); return; }
        UI.busy(f.querySelector('[type=submit]'), UI.api('set_network', { ice_servers: ice, poll_fast_ms: +f.fast.value, poll_idle_ms: +f.idle.value, source: f.source.value }))
          .then(function () { UI.toast('Saved. Robots pick it up on their next check-in.', 'ok'); });
      }
    });
    return DRAW[tab]();
  });
})();

/* ===== auth.html ===== */
(function () {
  var esc = UI.esc;
  function pw(name, auto) {
    return '<div class="au-pw"><input type="password" name="' + name + '" autocomplete="' + auto + '" required minlength="8">' +
      '<button type="button" data-show>Show</button></div>';
  }
  UI.page('auth', { title: 'Sign in', auth: 'guest' }, function (view, ctx) {
    var mode = ['signup', 'reset'].indexOf(ctx.args[0]) >= 0 ? ctx.args[0] : 'login';
    function draw(msg, isErr) {
      var heading = { login: 'Welcome back', signup: 'Create your account', reset: 'Reset your password' }[mode];
      var sub = { login: 'Sign in to continue to ' + esc(UI.config.name) + '.', signup: 'It\'s free and takes a few seconds.',
        reset: 'We\'ll email you a link to choose a new password.' }[mode];
      view.innerHTML = '<div class="au-wrap"><div class="ui-card au-card">' +
        '<h1>' + heading + '</h1><p class="muted">' + sub + '</p>' +
        (mode !== 'reset' ? '<div class="ui-seg" role="tablist"><button type="button" data-mode="login" class="' + (mode === 'login' ? 'on' : '') + '">Sign in</button>' +
          '<button type="button" data-mode="signup" class="' + (mode === 'signup' ? 'on' : '') + '">Create account</button></div>' : '<div style="height:14px"></div>') +
        '<form class="ui-stack" data-form="' + mode + '" novalidate>' +
        (mode === 'signup' ? '<label class="ui-field"><span>Your name</span><input type="text" name="name" autocomplete="name" required maxlength="60"></label>' : '') +
        '<label class="ui-field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>' +
        (mode === 'login' ? '<label class="ui-field"><span>Password</span>' + pw('password', 'current-password') + '</label>' : '') +
        (mode === 'signup' ? '<label class="ui-field"><span>Password <em>(at least 8 characters)</em></span>' + pw('password', 'new-password') + '</label>' +
          (window.LegalKit ? '<div>' + LegalKit.consentField() + '</div>' : '') : '') +
        '<div data-msg role="alert"' + (msg ? ' class="' + (isErr ? 'ui-error' : 'ui-note') + '">' + esc(msg) : ' hidden>') + '</div>' +
        '<button class="ui-btn primary block" type="submit">' + { login: 'Sign in', signup: 'Create account', reset: 'Send the link' }[mode] + '</button></form>' +
        '<div class="au-links">' + (mode === 'login' ? '<a data-mode="reset">Forgot your password?</a>' : '<a data-mode="login">' + UI.icon('back') + ' Back to sign in</a>') +
        '<a href="#landing" data-go="landing">About ' + esc(UI.config.name) + '</a></div></div></div>';
      var first = view.querySelector('input');
      if (first && !msg) first.focus();
    }
    view.addEventListener('click', function (e) {
      var m = e.target.closest('[data-mode]');
      if (m) { e.preventDefault(); mode = m.getAttribute('data-mode'); history.replaceState(null, '', '#auth' + (mode === 'login' ? '' : '/' + mode)); draw(); return; }
      var s = e.target.closest('[data-show]');
      if (s) { var i = s.parentNode.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; s.textContent = i.type === 'password' ? 'Show' : 'Hide'; }
    });
    view.addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target, v = UI.formData(form);
      var problem = !/^\S+@\S+\.\S+$/.test(v.email || '') ? 'Please enter a valid email address.'
        : mode !== 'reset' && (v.password || '').length < (mode === 'signup' ? 8 : 1) ? (mode === 'signup' ? 'Please choose a password of at least 8 characters.' : 'Please enter your password.')
        : mode === 'signup' && (v.name || '').trim().length < 2 ? 'Please tell us your name.' : null;
      if (problem) { say(problem, true); return; }
      if (mode === 'signup' && window.LegalKit && !LegalKit.consentChecked(form)) return;  // the kit shows its own message
      UI.busy(form.querySelector('[type=submit]'), UI.auth(mode, v)).then(function (r) {
        if (mode === 'reset' || (r && !r.me)) { mode = 'login'; draw(r && r.message, false); restore({ email: v.email }); }
        else UI.toast(mode === 'signup' ? 'Welcome to ' + UI.config.name + '!' : 'Welcome back!', 'ok');
      }, function (err) { say(err.message, true); });
    });
    function say(msg, isErr) {
      var box = view.querySelector('[data-msg]');
      box.className = isErr ? 'ui-error' : 'ui-note'; box.textContent = msg; box.hidden = false;
    }
    function restore(v) {
      ['name', 'email'].forEach(function (k) { var i = view.querySelector('[name=' + k + ']'); if (i && v[k]) i.value = v[k]; });
    }
    draw();
  });
})();

/* ===== bot.html ===== */
(function () {
  var esc = UI.esc;

  /* An Arduino over USB with Web Serial, speaking the robopresence_bridge protocol (see robot/robopresence/arduino.py). */
  RP.SerialArduino = function () { this.values = {}; this.parts = []; this.port = null; this.writer = null; };
  RP.SerialArduino.prototype.connect = function (baud) {
    var self = this;
    if (!navigator.serial) return Promise.reject(new Error('This browser has no Web Serial. Use Chrome or Edge on a computer (or Android Chrome where Web Serial is available).'));
    return navigator.serial.requestPort().then(function (port) {
      self.port = port;
      return port.open({ baudRate: baud || 115200 });
    }).then(function () {
      self.writer = self.port.writable.getWriter();
      self.read();
      return new Promise(function (r) { setTimeout(r, 2000); });  // the Arduino resets when the port opens
    }).then(function () { return self.hello(); });
  };
  RP.SerialArduino.prototype.send = function (line) {
    if (!this.writer) return;
    this.writer.write(new TextEncoder().encode(line + '\n')).catch(function () {});
  };
  RP.SerialArduino.prototype.read = function () {
    var self = this, reader = this.port.readable.getReader(), dec = new TextDecoder(), buf = '';
    (function pump() {
      reader.read().then(function (r) {
        if (r.done) return;
        buf += dec.decode(r.value);
        var lines = buf.split('\n'); buf = lines.pop();
        lines.forEach(function (l) { self.line(l.trim()); });
        pump();
      }).catch(function () {});
    })();
    this.reader = reader;
    this.tick = setInterval(function () { self.send('R'); }, 1000);
  };
  RP.SerialArduino.prototype.line = function (l) {
    if (!l || l[0] === '#') return;
    var w = l.split(/\s+/), kv = {};
    w.slice(1).forEach(function (x) { var i = x.indexOf('='); if (i > 0) kv[x.slice(0, i)] = x.slice(i + 1); });
    if (l.indexOf('RP1 HELLO') === 0) { this._hello = []; this.name = kv.name; }
    else if (w[0] === 'PART' && this._hello) this._hello.push(kv);
    else if (w[0] === 'END' && this._hello) { this.parts = this._hello; this._hello = null; if (this._done) this._done(); }
    else if (w[0] === 'V') { var self = this; Object.keys(kv).forEach(function (k) { self.values[k] = parseFloat(kv[k]); }); }
  };
  RP.SerialArduino.prototype.hello = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('The Arduino didn\'t answer. Is the Robo Presence bridge sketch uploaded?')); }, 3500);
      self._done = function () { clearTimeout(t); resolve(self.parts); };
      self.send('?');
    });
  };
  RP.SerialArduino.prototype.close = function () {
    clearInterval(this.tick);
    try { this.send('X'); } catch (e) {}
    var p = this.port, rd = this.reader, wr = this.writer;
    setTimeout(function () { try { rd && rd.cancel(); wr && wr.releaseLock(); p && p.close(); } catch (e) {} }, 100);
  };

  var PI_ONLY = { tb6612: 1, l298n: 1, drv8833: 1, gpio: 1, pwm: 1, pca9685: 1, hcsr04: 1, cpu_temp: 1, wifi: 1, espeak: 0, plugin: 1 };

  UI.page('bot', { title: 'Robot mode', auth: 'user' }, function (view, ctx) {
    var R = null, run = null, logs = [];
    view.innerHTML = '<div class="ui-wrap"><div class="ui-skel" style="height:300px"></div></div>';

    function partsPlan() {
      return (R.config.parts || []).map(function (p) {
        var how = p.driver === 'sim' ? 'simulated here' : p.driver === 'arduino' ? 'Arduino over USB' : p.driver === 'espeak' ? 'this device speaks it' : PI_ONLY[p.driver] ? 'needs a Raspberry Pi: skipped' : p.driver;
        return { p: p, how: how, ok: !PI_ONLY[p.driver] };
      });
    }
    function draw() {
      var plan = partsPlan(), needsArduino = plan.some(function (x) { return x.p.driver === 'arduino'; });
      view.innerHTML = '<div class="ui-wrap"><p style="margin:0 0 12px"><a href="#robot/' + esc(R.id) + '">' + UI.icon('back') + ' ' + esc(R.name) + '</a></p>' +
        '<div class="ui-page-head"><div><div class="eyebrow">Robot mode</div><h1>This device is ' + esc(R.name) + '</h1>' +
        '<p class="muted">Put this phone or laptop on the robot, choose a camera and press Start. Pilots then connect to it exactly like to a Raspberry Pi.</p></div></div>' +
        '<div class="bt-grid"><div>' +
          '<div class="bt-screen" data-screen><span class="lbl" data-lbl>CAMERA</span><div class="idle" data-idle><div><div class="art">' + RP.robotArt(R.color, { eyes: 'off', small: true }) + '</div>Not running</div></div></div>' +
          '<div class="ui-card ui-stack"><h3>Camera</h3><div class="ui-seg" data-cam>' +
            '<button type="button" data-v="sim" class="on">Simulated garage</button><button type="button" data-v="user">Front camera</button><button type="button" data-v="environment">Back camera</button></div>' +
            '<p class="small muted" style="margin:0">The simulated garage needs no camera: handy for testing from a desk. Real cameras ask for permission.</p>' +
            '<div class="bt-big">' + '<button class="ui-btn primary lg" data-start>' + UI.icon('play') + 'Start robot</button>' +
            '<button class="ui-btn lg" data-stop hidden>' + UI.icon('pause') + 'Stop</button></div></div>' +
        '</div><div>' +
          '<div class="ui-card"><h3>Status</h3><div data-status>' + RP.lamp({ online: false, paired: true }) + '</div><div class="bt-pilots" data-pilots style="margin-top:10px"></div></div>' +
          '<div class="ui-card ui-stack"><h3>Parts</h3><div class="bt-parts">' + plan.map(function (x) {
            return '<div class="' + (x.ok ? '' : 'no') + '">' + UI.icon(RP.typeIcon(x.p.type, x.p.id)) + '<span><b>' + esc(x.p.label || x.p.id) + '</b> · ' + esc(x.how) + '</span></div>'; }).join('') + '</div>' +
            (needsArduino ? '<label class="ui-check"><input type="checkbox" data-usearduino checked> Connect the Arduino when I press Start (Chrome or Edge; you pick the USB port)</label>' : '') +
            '<p class="small muted" style="margin:0">Change parts in the <a href="#robot/' + esc(R.id) + '/parts">Parts tab</a>. Pi-only parts need the Raspberry Pi brain.</p></div>' +
          '<div class="ui-card"><h3>Log</h3><ul class="bt-log" data-log>' + logs.map(li).join('') + '</ul></div>' +
        '</div></div></div>';
    }
    function li(l) { return '<li class="' + l[1] + '">' + esc(l[2]) + ' ' + esc(l[0]) + '</li>'; }
    function log(text, level) {
      logs.unshift([text, level || 'info', new Date().toLocaleTimeString([], { hour12: false })]);
      logs = logs.slice(0, 60);
      var ul = view.querySelector('[data-log]'); if (ul) ul.innerHTML = logs.map(li).join('');
    }
    function status() {
      var box = view.querySelector('[data-status]'); if (!box) return;
      var on = run && run.host.running;
      box.innerHTML = RP.lamp({ online: !!on, paired: true }) + (on ? ' <span class="small muted">Pilots can connect now.</span>' : '');
      var peers = run ? run.core.peers : [];
      view.querySelector('[data-pilots]').innerHTML = peers.length ? peers.map(function (p) { return '<span class="rp-chip">' + UI.icon(p.role === 'viewer' ? 'eye' : 'joystick') + esc(p.pilot) + (run.core.driver === p ? ' · driving' : '') + '</span>'; }).join('') : '<span class="small muted">' + (on ? 'No pilots yet.' : '') + '</span>';
      view.querySelector('[data-start]').hidden = !!on; view.querySelector('[data-stop]').hidden = !on;
    }

    function start(btn) {
      var camMode = view.querySelector('[data-cam] .on').getAttribute('data-v');
      var useArd = view.querySelector('[data-usearduino]') && view.querySelector('[data-usearduino]').checked;
      var plan = partsPlan(), ard = null, world = null, canvas = null, stream = null, label = '';
      var specs = plan.map(function (x) {
        var s = Object.assign({}, x.p);
        if (s.type === 'custom') s.type = (s.options || {}).ui || 'button';
        if (!x.ok) s.error = 'needs a Raspberry Pi (this is robot mode in a browser)';
        if (s.driver === 'arduino' && !useArd) s.error = 'the Arduino isn\'t connected';
        if (s.type === 'distance' || s.type === 'gauge') { s.unit = s.unit || (s.type === 'distance' ? 'cm' : ''); }
        return s;
      });
      var core = new RP.RobotCore(specs, { name: R.name, watchdog_ms: (R.config.safety || {}).watchdog_ms || 500 });
      var p = Promise.resolve();
      if (useArd) p = p.then(function () {
        ard = new RP.SerialArduino();
        return ard.connect((R.config.arduino || {}).baud).then(function (parts) {
          log('Arduino says it has: ' + parts.map(function (x) { return x.id; }).join(', ') + '.', 'info');
          var have = parts.map(function (x) { return x.id; });
          core.parts.forEach(function (pt) { if (pt.spec.driver === 'arduino' && have.indexOf(pt.id) < 0) pt.error = 'the Arduino sketch has no part called "' + pt.id + '"'; });
        });
      });
      p = p.then(function () {
        if (camMode === 'sim') {
          canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
          world = new RP.SimWorld(canvas, core, { label: R.name.toUpperCase().slice(0, 12) + ' CAM' });
          stream = canvas.captureStream(30); label = 'simulated garage';
          return;
        }
        return navigator.mediaDevices.getUserMedia({ video: { facingMode: camMode, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } }, audio: !!(R.config.camera || {}).audio })
          .then(function (s) { stream = s; label = (s.getVideoTracks()[0] || {}).label || camMode + ' camera'; });
      });
      p = p.then(function () {
        var ardDrive = { l: 0, r: 0, at: 0 };
        core.hw = {
          drive: function (l, r) { var d = core.ofType('drive'); if (ard && d && d.spec.driver === 'arduino') { ardDrive = { l: l, r: r }; ard.send('D ' + Math.round(l * 100) + ' ' + Math.round(r * 100)); } },
          set: function (id, v, spec) { if (ard && spec.driver === 'arduino') ard.send('S ' + id + ' ' + Math.round(spec.invert ? -v : v)); },
          switch: function (id, on, spec) { if (ard && spec.driver === 'arduino') ard.send((spec.type === 'button' ? 'B ' : 'T ') + id + ' ' + (on ? 1 : 0)); },
          say: function (id, text) { try { var u = new SpeechSynthesisUtterance(text); speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {} },
          read: function (id, spec) {
            if (spec.driver === 'arduino') return ard ? (ard.values[id] != null ? ard.values[id] : null) : null;
            if (world) return world.read(id, spec);
            if (spec.type === 'distance') return null;
            return spec.unit === 'V' ? 8.1 : null;
          }
        };
        var resend = setInterval(function () { if (ard && (ardDrive.l || ardDrive.r)) ard.send('D ' + Math.round(ardDrive.l * 100) + ' ' + Math.round(ardDrive.r * 100)); }, 250);
        core.on(function (ev) { if (ev.kind === 'log') log(ev.text, ev.level); if (ev.kind === 'peers') status(); });
        return UI.api('tab_claim', R.id).then(function (t) {
          var host = new RP.RobotHost({ api: R.api_origin, token: t.token, core: core, stream: stream, cameraLabel: label,
            onLog: log, onChange: status, onConfig: function () { log('The parts changed in the website: press Stop and Start to load them.', 'warn'); } });
          run = { core: core, host: host, world: world, stream: stream, ard: ard, resend: resend, lock: null };
          return host.start();
        });
      });
      return UI.busy(btn, p.then(function () {
        var scr = view.querySelector('[data-screen]');
        view.querySelector('[data-idle]').hidden = true;
        view.querySelector('[data-lbl]').textContent = label.toUpperCase().slice(0, 30);
        var v = document.createElement('video'); v.muted = true; v.playsInline = true; v.autoplay = true; v.srcObject = stream; scr.insertBefore(v, scr.firstChild);
        v.play && v.play().catch(function () {});
        if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { if (run) run.lock = l; }).catch(function () {});
        status();
        UI.toast(R.name + ' is online in this tab.', 'ok');
      }).catch(function (e) {
        log(e.message, 'warn'); UI.toast(e.message, 'error');
        if (ard) ard.close(); if (world) world.destroy(); core.destroy();
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        run = null;
      }));
    }
    function stop() {
      if (!run) return;
      var r = run; run = null;
      r.host.stop(); clearInterval(r.resend); r.core.destroy();
      if (r.world) r.world.destroy(); if (r.ard) r.ard.close();
      if (r.stream) r.stream.getTracks().forEach(function (t) { t.stop(); });
      if (r.lock) r.lock.release().catch(function () {});
      log('Stopped.', 'info');
      draw(); status();
    }

    view.addEventListener('click', function (e) {
      var c = e.target.closest('[data-cam] [data-v]');
      if (c && !run) { view.querySelectorAll('[data-cam] [data-v]').forEach(function (b) { b.classList.toggle('on', b === c); }); return; }
      if (e.target.closest('[data-start]')) start(e.target.closest('[data-start]'));
      if (e.target.closest('[data-stop]')) stop();
    });
    var ready = UI.api('get_robot', ctx.args[0]).then(function (d) {
      R = d.robot;
      if (R.role !== 'owner') { view.innerHTML = '<div class="ui-wrap"><div class="ui-empty">' + UI.icon('lock') + '<h3>Only the owner can run this robot</h3><p><a href="#garage">Back to the garage</a></p></div></div>'; return; }
      draw();
    });
    window.RP_BOT = { state: function () { return run ? { running: run.host.running, peers: run.core.peers.length, values: run.core.values() } : null; } };
    return { ready: ready, destroy: function () { stop(); window.RP_BOT = null; } };
  });
})();

/* ===== drive.html ===== */
(function () {
  var esc = UI.esc;

  UI.page('drive', { title: 'Drive', nav: 'Test drive', icon: 'joystick', order: 20, chrome: false }, function (view, ctx) {
    var a = ctx.args, me = ctx.me, cockpit = null;
    var back = me ? '#garage' : '#landing', backLabel = me ? 'Garage' : 'Home';

    function sim(robot, label) {
      cockpit = RP.cockpit(view, { robot: robot, mode: label || 'sim', role: 'owner', back: robot.id ? '#robot/' + robot.id : back,
        backLabel: robot.id ? robot.name : backLabel,
        connect: function () { return RP.simulator(robot.manifest, { pilot: me ? me.name : 'You', label: (robot.name || 'SIM').toUpperCase().slice(0, 12) + ' CAM' }); } });
      return cockpit.ready;
    }

    function live(d, pass, pilotName) {
      var r = d.robot;
      if (r.demo) return sim({ id: null, name: r.name, color: r.color, manifest: r.manifest }, 'demo').then(function () {});
      cockpit = RP.cockpit(view, { robot: r, mode: 'live', role: d.role, back: pass ? '#landing' : '#robot/' + r.id, backLabel: pass ? 'Leave' : r.name,
        connect: function (step) {
          if (!r.online) return Promise.reject(new Error(r.name + ' is offline' + (r.last_seen ? ' (last seen ' + UI.ago(r.last_seen) + ')' : '') + '. Switch it on and check its Wi-Fi; the page connects as soon as you try again.'));
          return RP.connectLive({ robotId: pass ? null : r.id, pass: pass, pilot: pilotName, ice: d.ice_servers, audio: !!(r.manifest && r.manifest.camera && r.manifest.camera.audio), onStep: step });
        } });
      return cockpit.ready;
    }

    function guest(token) {
      return UI.api('pass_info', token).then(function (p) {
        var name = UI.store.get('guest_name', '');
        view.innerHTML = '<div class="ui dv-guest"><div class="ui-card rp-plate"><div class="art">' + RP.robotArt(p.robot.color, { tilt: 8 }) + '</div>' +
          '<div class="eyebrow">Guest pass · ' + (p.role === 'viewer' ? 'watch only' : 'you can drive') + '</div>' +
          '<h1 style="font-size:2rem">' + esc(p.robot.name) + '</h1>' +
          '<p class="muted">' + esc(p.robot.owner) + ' invited you to ' + (p.role === 'viewer' ? 'watch through' : 'drive') + ' their robot. The pass works until ' + esc(UI.fmtDateTime(p.expires)) + '.</p>' +
          RP.lamp({ online: p.robot.online, paired: true }) +
          '<form data-guest><label class="ui-field"><span>Your name <em>(the owner sees it in the robot\'s log)</em></span><input type="text" name="name" maxlength="40" required value="' + esc(name) + '" placeholder="e.g. Grandma Lin"></label>' +
          '<button class="ui-btn primary lg" type="submit">' + UI.icon('joystick') + (p.role === 'viewer' ? 'Start watching' : 'Start driving') + '</button>' +
          '<p class="small muted" style="margin:0">Video and controls go straight between your browser and the robot. Nothing is recorded by Robo Presence.</p></form></div></div>';
        view.querySelector('[data-guest]').addEventListener('submit', function (e) {
          e.preventDefault();
          var n = UI.formData(e.target).name.trim();
          UI.store.set('guest_name', n);
          UI.api('drive_open', null, token).then(function (d) { live(d, token, n); });
        });
      }, function (e) {
        view.innerHTML = '<div class="ui dv-guest"><div class="ui-card"><div class="art">' + RP.robotArt('steel', { eyes: 'off', tilt: -30 }) + '</div><h1 style="font-size:1.8rem">Pass not valid</h1>' +
          '<p class="muted">' + esc(e.message) + '</p><a class="ui-btn primary" href="#drive">Try the simulator instead</a></div></div>';
      });
    }

    var ready;
    if (!a[0]) ready = sim({ id: null, name: 'Garage simulator', color: 'orange', manifest: null });
    else if (a[0] === 'pass' && a[1]) ready = guest(a[1]);
    else if (a[0] === 'sim' && a[1]) {
      ready = me ? UI.api('get_robot', a[1]).then(function (d) { var r = d.robot; return sim({ id: r.id, name: r.name, color: r.color, manifest: r.manifest }); })
        : sim({ id: null, name: 'Garage simulator', color: 'orange', manifest: null });
    } else {
      if (!me) { UI.after = location.hash; UI.go('auth'); return Promise.resolve(); }
      ready = UI.api('drive_open', a[0]).then(function (d) { return live(d, null, null); });
    }
    return { ready: ready, destroy: function () { if (cockpit) cockpit.destroy(); } };
  });
})();

/* ===== garage.html ===== */
(function () {
  var esc = UI.esc;
  RP.robotCard = function (r) {
    var role = r.role === 'pilot' ? '<span class="ui-badge brand gr-role">Pilot</span>' : r.role === 'viewer' ? '<span class="ui-badge gr-role">Viewer</span>' : '';
    var chips = [];
    if (r.controls.indexOf('drive') >= 0) chips.push(['wheel', 'wheels']);
    var servos = r.controls.filter(function (t) { return t === 'servo'; }).length;
    if (servos) chips.push(['servo', servos + ' servo' + (servos > 1 ? 's' : '')]);
    var extra = r.controls.length - (r.controls.indexOf('drive') >= 0 ? 1 : 0) - servos;
    if (extra > 0) chips.push(['plug', extra + ' more']);
    if (r.sensors) chips.push(['gauge', r.sensors + ' sensor' + (r.sensors > 1 ? 's' : '')]);
    if (r.battery != null) chips.push(['battery', r.battery + '%']);
    return '<a class="ui-card gr-card" href="#robot/' + esc(r.id) + '" data-robot="' + esc(r.id) + '">' +
      '<div class="gr-art">' + RP.lamp(r) + role + RP.robotArt(r.color, { pan: r.online ? 12 : -18, tilt: r.online ? 6 : -14, eyes: r.online || r.demo ? 'on' : 'off', small: true }) + '</div>' +
      '<div class="gr-body"><h3>' + esc(r.name) + '</h3>' +
      '<p class="muted">' + (r.model ? esc(r.model.replace(/ Rev [\d.]+$/, '').replace(/^Raspberry Pi/, 'Pi').replace(/ Model B$/, '')) : esc(RP.BOARDS[r.board] || 'Robot')) + (r.board === 'pi_arduino' ? ' + Arduino' : '') + (r.owner ? ' · by ' + esc(r.owner) : '') + '</p>' +
      (r.notes && r.demo ? '<p class="small">' + esc(r.notes) + '</p>' : '') +
      '<div class="rp-chips">' + chips.map(function (c) { return '<span class="rp-chip">' + UI.icon(c[0]) + esc(c[1]) + '</span>'; }).join('') + '</div></div></a>';
  };

  RP.newRobot = function () {
    var m = UI.modal('<h2>New robot</h2><form class="ui-stack" data-new>' +
      '<label class="ui-field"><span>Name</span><input type="text" name="name" maxlength="40" required placeholder="e.g. Sprocket"></label>' +
      '<div class="ui-field"><span>Its brain</span><div class="gr-presets">' +
      [['pi', 'chip', 'Raspberry Pi', 'Camera, motor driver and servos all wired to the Pi. The usual build.'],
       ['pi_arduino', 'plug', 'Raspberry Pi + Arduino', 'The Pi streams video; an Arduino over USB runs motors, servos and sensors, and reports what it has.'],
       ['browser', 'phone', 'Phone or laptop', 'An old phone or laptop rides on the robot and runs it from a browser tab. Start with simulated parts.']]
        .map(function (p, i) { return '<label class="ui-choice"><input type="radio" name="preset" value="' + p[0] + '"' + (i ? '' : ' checked') + '><span>' + UI.icon(p[1]) + '<b>' + p[2] + '</b><small>' + p[3] + '</small></span></label>'; }).join('') +
      '</div></div><div class="ui-field"><span>Paint</span><div class="gr-swatches">' +
      Object.keys(RP.COLORS).map(function (k, i) { return '<label title="' + esc(RP.COLORS[k].name) + '"><input type="radio" name="color" value="' + k + '"' + (i ? '' : ' checked') + '><i style="background:' + RP.COLORS[k].body + '"></i></label>'; }).join('') +
      '</div></div><div class="ui-row end"><button class="ui-btn ghost" type="button" data-close>Cancel</button><button class="ui-btn primary" type="submit">' + UI.icon('plus') + 'Build it</button></div></form>');
    m.el.querySelector('[data-new]').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = UI.formData(e.target);
      UI.busy(e.target.querySelector('[type=submit]'), UI.api('create_robot', v.name, v.preset, v.color)).then(function (d) {
        m.close(); UI.toast(d.robot.name + ' is in your garage. Next: install it.', 'ok');
        UI.go('robot', d.robot.id, d.robot.board === 'browser' ? 'overview' : 'install');
      });
    });
  };

  UI.page('garage', { title: 'Garage', nav: 'Garage', icon: 'robot', auth: 'user', order: 10 }, function (view, ctx) {
    view.innerHTML = '<div class="ui-wrap"><div class="ui-skel" style="height:320px"></div></div>';
    var mini = null;
    function draw(d) {
      var first = ctx.me.name.split(' ')[0];
      view.innerHTML = '<div class="ui-wrap">' +
        '<div class="gr-head"><div><div class="eyebrow">Garage · ' + UI.plural(d.mine.length, 'robot') + '</div><h1>' + (d.mine.length ? 'Your robots' : 'Hello, ' + esc(first)) + '</h1>' +
        '<p class="muted" style="margin:6px 0 0">' + (d.mine.length ? 'Open one to drive it, change its parts or install it.' : 'Build your first robot: pick its brain, then install it with one command.') + '</p></div>' +
        '<button class="ui-btn primary" data-new>' + UI.icon('plus') + 'New robot</button></div>' +
        '<div class="gr-grid">' + d.mine.map(RP.robotCard).join('') +
          (d.mine.length < d.max ? '<button class="gr-new" data-new>' + '<div>' + UI.icon('plus') + '<h3 style="margin:0 0 4px;color:var(--c-ink)">' + (d.mine.length ? 'Add a robot' : 'Build your first robot') + '</h3><p class="small">Raspberry Pi, Pi + Arduino, or an old phone</p></div></button>' : '') +
        '</div>' +
        (d.shared.length ? '<div class="gr-sec"><h2>Shared with you</h2><span class="muted small">Robots other people let you drive or watch</span></div><div class="gr-grid">' + d.shared.map(RP.robotCard).join('') + '</div>' : '') +
        '<div class="gr-sec"><h2>Test drive</h2></div>' +
        '<a class="ui-card gr-sim rp-plate" href="#drive" style="text-decoration:none;color:inherit"><div class="txt"><div class="eyebrow">No hardware needed</div><h3 style="font:400 1.6rem/1.1 var(--font-display)">The garage simulator</h3>' +
          '<p class="muted">A virtual robot in a virtual garage, driven with the real cockpit: joystick, look pad, headlights, horn, sonar. Five bolts are lost under the furniture. Find them all.</p>' +
          '<span class="ui-btn primary">' + UI.icon('joystick') + 'Start the simulator</span></div><div class="scr" data-mini><span>SIM CAM · LIVE</span></div></a>' +
        (d.showroom.length ? '<div class="gr-sec"><h2>Showroom</h2><span class="muted small">Robots built by other makers (demo). Open one to see its parts, or drive it in the simulator.</span></div><div class="gr-grid">' + d.showroom.map(RP.robotCard).join('') + '</div>' : '') +
        '</div>';
      // a live miniature of the simulator in the card
      try {
        var box = view.querySelector('[data-mini]');
        var c = document.createElement('canvas'); c.width = 320; c.height = 240; box.insertBefore(c, box.firstChild);
        var core = new RP.RobotCore(RP.SIM_PARTS.slice(), { name: 'mini' });
        var world = new RP.SimWorld(c, core, { label: 'SIM' });
        world.W = 320; world.H = 240; world.heading = 0.5;
        var t = 0, spin = setInterval(function () { t += 0.05; var p = core.part('pan'); if (p) p.value = Math.sin(t) * 40; }, 50);
        mini = { stop: function () { clearInterval(spin); world.destroy(); core.destroy(); } };
      } catch (e) { console.warn(e); }
    }
    view.addEventListener('click', function (e) { if (e.target.closest('[data-new]')) { e.preventDefault(); RP.newRobot(); } });
    return { ready: UI.api('get_garage').then(draw), destroy: function () { if (mini) mini.stop(); } };
  });
})();

/* ===== guide.html ===== */
(function () {
  var esc = UI.esc;
  var code = function (t) { return '<pre class="rp-code">' + esc(t) + '</pre>'; };
  var SECTIONS = [
    ['build', 'Build', 'wrench'], ['pi', 'Set up the Pi', 'chip'], ['install', 'Install', 'terminal'], ['arduino', 'Arduino', 'plug'],
    ['parts', 'New parts', 'sliders'], ['connection', 'Connection', 'signal'], ['protocol', 'Protocol', 'book'], ['trouble', 'Troubleshooting', 'bug']
  ];

  function flow() {
    return '<svg class="gd-flow" viewBox="0 0 720 230" role="img" aria-label="The pilot\'s browser and the robot meet through the server once, then talk directly">' +
      '<rect x="10" y="60" width="180" height="100" rx="6" fill="var(--c-surface)" stroke="var(--c-ink)" stroke-width="2"/><text x="100" y="98" text-anchor="middle">Pilot\'s browser</text><text class="sm" x="100" y="118" text-anchor="middle">cockpit</text>' +
      '<rect x="270" y="10" width="180" height="64" rx="6" fill="var(--c-surface-2)" stroke="var(--c-ink)" stroke-width="2"/><text x="360" y="38" text-anchor="middle">Robo Presence (Anvil)</text><text class="sm" x="360" y="56" text-anchor="middle">accounts + introductions</text>' +
      '<rect x="530" y="60" width="180" height="100" rx="6" fill="var(--c-surface)" stroke="var(--c-ink)" stroke-width="2"/><text x="620" y="98" text-anchor="middle">Robot (Pi)</text><text class="sm" x="620" y="118" text-anchor="middle">robopresence + aiortc</text>' +
      '<path d="M190 80 L270 50" stroke="var(--c-muted)" stroke-width="2" stroke-dasharray="5 4"/><text class="sm" x="196" y="54">1 offer</text>' +
      '<path d="M530 80 L450 50" stroke="var(--c-muted)" stroke-width="2" stroke-dasharray="5 4"/><text class="sm" x="462" y="86">2 poll · 3 answer</text>' +
      '<path d="M190 135 L530 135" stroke="var(--c-brand)" stroke-width="5"/><path d="M520 127 l12 8 -12 8" fill="none" stroke="var(--c-brand)" stroke-width="4"/><path d="M200 127 l-12 8 12 8" fill="none" stroke="var(--c-brand)" stroke-width="4"/>' +
      '<text x="360" y="158" text-anchor="middle">4 peer to peer (WebRTC)</text><text class="sm" x="360" y="176" text-anchor="middle">video → pilot · controls → robot · 50 to 200 ms</text>' +
      '<text class="sm" x="360" y="212" text-anchor="middle">STUN finds a direct path; a TURN relay is the fallback for strict networks</text></svg>';
  }

  function body() {
    return '' +
    '<section id="g-build"><h2>Build the robot</h2>' +
      '<p>A Robo Presence robot is a camera on a pan-tilt head, riding on two motors, with a computer that streams the video and moves the parts. Everything else is optional.</p>' +
      '<table class="gd-table wide"><thead><tr><th>Part</th><th>What to get</th><th>Notes</th></tr></thead><tbody>' +
      [['Brain', 'Raspberry Pi 4 or 5 (2 GB is plenty)', 'A Pi Zero 2 W works at 320 × 240. A Pi 3B+ at 640 × 480, 15 fps.'],
       ['Camera', 'Camera Module 3 (or 2), or any USB webcam', 'The Pi camera is lighter on the CPU. Wide-angle versions feel better to drive.'],
       ['Chassis', 'A 2WD or 4WD kit, or tank tracks, with two DC gear motors', 'Four motors? Wire each side\'s pair together.'],
       ['Motor driver', 'TB6612FNG (recommended), L298N or DRV8833', 'The TB6612 runs cooler and wastes less battery than the L298N.'],
       ['Head', 'Two SG90 or MG90S servos + a pan-tilt bracket', 'Or a pan-tilt HAT with a PCA9685 chip (steadier servos, uses I²C).'],
       ['Power', '2S Li-ion pack (7.4 V) + a 5 V 3 A step-down (UBEC) for the Pi', 'Servos want their own 5 to 6 V supply, not the Pi\'s 5 V pin.'],
       ['Extras', 'Arduino Nano/Uno, HC-SR04 sonar, LEDs, a buzzer, a USB speaker', 'Anything else: see New parts.']]
        .map(function (r) { return '<tr><td><b>' + r[0] + '</b></td><td>' + r[1] + '</td><td class="muted">' + r[2] + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h3>Power, the part people get wrong</h3><ul>' +
        '<li>Feed the Pi from a 5 V regulator that gives at least 3 A. When motors start they pull the battery voltage down; a weak supply reboots the Pi mid-drive.</li>' +
        '<li>Give the motors their power from the battery through the motor driver (VM / 12V pin), and the servos their own 5 to 6 V.</li>' +
        '<li><b>Join every ground</b>: the Pi, the motor driver, the servo supply and the Arduino share GND, or signals won\'t work.</li>' +
        '<li>The Pi\'s pins are 3.3 V. An HC-SR04 echo pin gives 5 V: put a 1 kΩ + 2 kΩ divider in between.</li></ul>' +
      '<h3>Wiring</h3><p>Every robot\'s <b>Parts</b> tab draws its own wiring: a map of the Pi\'s 40-pin header with each used pin marked, and a list of what goes where. The Raspberry Pi starting set uses:</p>' +
      '<table class="gd-table"><tbody>' + [['Wheels (TB6612)', 'left IN1/IN2/PWM = GPIO 17/27/12, right = 23/24/13, STBY = 25'], ['Pan / tilt servos', 'GPIO 18 / GPIO 19'], ['Headlights', 'GPIO 16 (through a transistor or LED driver for anything bright)'],
        ['Buzzer', 'GPIO 26'], ['Sonar', 'trigger GPIO 5, echo GPIO 6 (divider!)']].map(function (r) { return '<tr><td><b>' + r[0] + '</b></td><td>' + r[1] + '</td></tr>'; }).join('') + '</tbody></table></section>' +

    '<section id="g-pi"><h2>Set up the Raspberry Pi</h2><ol>' +
      '<li>Install <a href="https://www.raspberrypi.com/software/" target="_blank" rel="noopener">Raspberry Pi Imager</a> on a computer.</li>' +
      '<li>Choose your Pi model and <b>Raspberry Pi OS Lite (64-bit)</b> (Bookworm or newer). The desktop version works too, it just uses more memory.</li>' +
      '<li>In the settings ("Edit settings"), set a <b>host name</b> (e.g. <code>sprocket</code>), a <b>user name and password</b>, your <b>Wi-Fi</b>, and turn on <b>SSH</b>.</li>' +
      '<li>Write the card, put it in the Pi, power it up and give it a minute.</li>' +
      '<li>From a computer on the same Wi-Fi:' + code('ssh <user>@sprocket.local') + '</li></ol>' +
      '<p>Using a pan-tilt HAT (PCA9685)? Turn on I²C: <code>sudo raspi-config</code> → Interface options → I2C.</p></section>' +

    '<section id="g-install"><h2>Install the robot code</h2>' +
      '<p>Make a robot in your garage, open its <b>Install</b> tab and copy the one-line command. On the Pi:</p>' +
      code("curl -fsSL 'https://<this app>/_/api/install?c=ABCD2345' | sudo bash") +
      '<p>It takes a few minutes the first time. It:</p><ul>' +
        '<li>installs system packages (picamera2, gpiozero, lgpio, pyserial, smbus2, espeak-ng; pigpio on a Pi 4 and older),</li>' +
        '<li>makes a Python environment in <code>/opt/robopresence/venv</code> with <a href="https://github.com/aiortc/aiortc" target="_blank" rel="noopener">aiortc</a> (WebRTC for Python),</li>' +
        '<li>downloads the robot code from GitHub to <code>/opt/robopresence/robot</code>,</li>' +
        '<li>trades the one-time code for the robot\'s own secret token (kept in <code>/etc/robopresence/robot.json</code>, readable only by you),</li>' +
        '<li>starts the <code>robopresence</code> service, which starts again by itself after a reboot.</li></ul>' +
      '<p>The Install tab turns green when the robot calls in. Handy commands on the robot:</p>' +
      '<table class="gd-table"><tbody>' + [['robopresence status', 'is it running?'], ['robopresence logs', 'follow its log (Ctrl+C to leave)'], ['robopresence test', 'sweep servos, flash switches, read sensors'],
        ['robopresence test --wheels', '…and spin the wheels (lift the robot!)'], ['robopresence update', 'get the newest robot code, keep the pairing'], ['robopresence pair ABCD-2345', 'pair again with a new code'],
        ['robopresence info', 'show the pairing and the parts it reports']].map(function (r) { return '<tr><td><code>' + r[0] + '</code></td><td>' + r[1] + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<p>Prefer to read first? The installer is <a href="https://github.com/arkulinskis/robo-presence/blob/master/robot/install.sh" target="_blank" rel="noopener">robot/install.sh</a>. To install by hand: download the <code>robot</code> folder and run <code>sudo bash install.sh --server https://&lt;this app&gt;/_/api --code ABCD-2345</code>.</p>' +
      '<p><b>No Pi?</b> Robot mode runs the robot in a browser tab on an old phone or laptop: open the robot and press <i>Run it in this browser</i>.</p></section>' +

    '<section id="g-arduino"><h2>Add an Arduino</h2>' +
      '<p>Choose the <b>Raspberry Pi + Arduino</b> brain when you\'d rather let an Arduino (Uno, Nano, Mega…) drive the motors, servos and sensors: it has steadier timing, 5 V pins and analog inputs for a battery. The Pi still streams the video and talks to the cockpit; it sends the Arduino one-line commands over USB.</p><ol>' +
        '<li>In the Parts tab, set the parts\' <i>Runs on</i> to <b>Arduino</b> and choose Arduino pins (2 to 13, A0 to A7).</li>' +
        '<li>The Install tab shows the <b>robopresence_bridge</b> sketch with its CONFIG block filled in. Copy it into the Arduino IDE, pick the board and port, Upload.</li>' +
        '<li>Plug the Arduino into the Pi\'s USB. On start, the Pi asks the Arduino <code>?</code> and it lists its parts.</li></ol>' +
      '<div class="gd-warn">On an Uno or Nano the Servo library takes over PWM on pins 9 and 10, so put motor speed pins on 3, 5, 6 or 11.</div>' +
      '<p>The Arduino stops the wheels by itself 700 ms after the last command, a second safety net under the Pi\'s own watchdog.</p></section>' +

    '<section id="g-parts"><h2>New parts (more actuators later)</h2>' +
      '<p>Nothing in the cockpit is hard-coded. When the robot starts (and whenever its parts change) it sends a <b>manifest</b>: the list of parts that actually work. The cockpit turns each part into a control:</p>' +
      '<table class="gd-table wide"><thead><tr><th>Type</th><th>The cockpit shows</th><th>Robot drivers</th></tr></thead><tbody>' +
      [['drive', 'joystick, WASD, gamepad left stick, gears', 'tb6612, l298n, drv8833, arduino'], ['servo', 'a slider; two servos with axis x and y become the head: look pad, drag-to-look, arrow keys', 'gpio, pca9685, arduino'],
       ['slider', 'a slider from min to max', 'pwm, arduino'], ['toggle', 'an on/off switch (optional key)', 'gpio, arduino'], ['button', 'a hold-to-press button', 'gpio, arduino'],
       ['say', 'a text box + quick phrases', 'espeak'], ['gauge', 'a bar with the value and unit; warns at a level', 'cpu_temp, wifi, arduino'], ['distance', 'a gauge + a HUD warning; can pause forward driving', 'hcsr04, arduino'],
       ['custom', 'the control you pick (slider, switch, button, voice)', 'a Python plugin']].map(function (r) { return '<tr><td><code>' + r[0] + '</code></td><td>' + r[1] + '</td><td class="muted">' + r[2] + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<p>A part type the cockpit doesn\'t know yet still shows up (as a card, or a plain slider if it has a range), so a newer robot never breaks an older cockpit.</p>' +
      '<h3>Three ways to add a part</h3><ol>' +
        '<li><b>A standard part</b>: add it in the Parts tab and save. The robot picks up the new config within a couple of seconds, rebuilds its parts and sends the new manifest; the cockpit redraws, even mid-drive.</li>' +
        '<li><b>A Python plugin</b> for hardware the robot code doesn\'t know: put a file in <code>/etc/robopresence/plugins/</code> on the robot and add a <i>Plugin part</i> naming it. A claw on a servo:' +
        code('# /etc/robopresence/plugins/my_claw.py\nfrom robopresence import parts as P\n\nclass Claw(P.Positioner):          # a value that moves smoothly to its target\n    UNIT = "%"\n    def start(self):\n        from gpiozero import AngularServo\n        self.servo = AngularServo(22, min_angle=0, max_angle=180)\n    def write(self, v):             # 0 % open .. 100 % closed\n        self.servo.angle = 10 + 85 * v / 100\n\ndef make(spec, robot):\n    return Claw(dict(spec, min=0, max=100, home=0), robot)') +
        'Other bases: <code>Switch</code> (override <code>write(on)</code>), <code>Sensor</code> (override <code>read()</code>), or <code>Part</code> for anything. The example lives in <code>robot/plugins/example_claw.py</code>.</li>' +
        '<li><b>Let the Arduino report it</b>: add a line to the sketch\'s CONFIG lists (a servo, slider, switch or analog). The Arduino announces it on start; parts the config doesn\'t have are added automatically and appear in the cockpit.</li></ol></section>' +

    '<section id="g-connection"><h2>How the connection works</h2>' + flow() +
      '<ol><li>The robot checks in with Robo Presence every second or two (faster while someone has its page open), over plain HTTPS. No ports to open on your router.</li>' +
        '<li>When you press Drive, your browser makes a WebRTC <b>offer</b> (it wants video, and opens two data channels: one fast and lossy for the joystick, one reliable for everything else) and leaves it with the server.</li>' +
        '<li>The robot picks it up, answers with its camera, and the server hands the answer back.</li>' +
        '<li>From then on your browser and the robot talk <b>directly</b>. The server never sees the video or the controls.</li></ol>' +
      '<h3>Latency</h3><p>The cockpit shows the round trip (RTT), the frame rate and whether the path is direct (P2P) or relayed. To make it snappier: use 5 GHz Wi-Fi, a lower camera size (Parts tab → Camera), and H.264 (lighter on the Pi). Joystick commands go 20 times a second on the lossy channel, so a lost packet is simply replaced by the next one instead of delaying it.</p>' +
      '<h3>STUN and TURN</h3><p>Both sides first ask a public STUN server (Google\'s, by default) for their public address. That finds a direct path on most home and mobile networks. Some strict networks block it; then the connection needs a <b>TURN relay</b>, a server that forwards the encrypted media. Admins add TURN servers (yours, or a hosted one) in <b>Admin → Network</b>, and both browsers and robots use them.</p></section>' +

    '<section id="g-protocol"><h2>Protocol (for your own robot)</h2>' +
      '<p>Anything that speaks this can be a Robo Presence robot: the Python robot, robot mode in a browser, or your own code (ESP32 with a companion, ROS bridge…).</p>' +
      '<h3>Robot ↔ server (HTTPS, JSON)</h3><table class="gd-table"><tbody>' +
      [['POST /_/api/bot/claim', '{code, info} → {token, robot_id, name} (once, with the install code)'], ['POST /_/api/bot/hello', '{token, manifest, info} → {config, config_rev, ice_servers, poll_ms}'],
       ['POST /_/api/bot/poll', '{token, telemetry, sessions, config_rev, manifest?} → {offers, ended, config?, next_ms}'], ['POST /_/api/bot/answer', '{token, session, sdp} or {token, session, reject}'],
       ['POST /_/api/bot/event', '{token, kind, text}: a line in the robot\'s log on the website']].map(function (r) { return '<tr><td><code>' + r[0] + '</code></td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<p>A 401 reply means the robot was unpaired: stop and ask for a new code.</p>' +
      '<h3>Cockpit ↔ robot (WebRTC data channels, JSON)</h3>' +
      code('cockpit -> robot\n  {"t":"hello"}                          robot replies with its manifest and state\n  {"t":"drive","x":0.2,"y":0.8,"s":42}   x = turn, y = forward, -1..1; s = sequence number\n  {"t":"set","id":"pan","v":30,"s":43}   servo / slider value, or true/false for a switch\n  {"t":"press","id":"horn","down":true}  button down / up\n  {"t":"say","id":"voice","text":"Hi"}\n  {"t":"stop"}  {"t":"home"}  {"t":"seat"}  {"t":"ping","n":7,"ts":...}\nrobot -> cockpit\n  {"t":"manifest", "controls":[...], "sensors":[...], "problems":[...]}\n  {"t":"state","values":{"pan":30,...},"seat":{"driver":"..","name":"Ana"}}\n  {"t":"tel","sensors":{"battery":7.6,...}}   once a second\n  {"t":"pong",...}  {"t":"log","level":"stop","text":"Wheels stopped: no signal..."}') +
      '<p>Rules every robot keeps: stop the wheels when no <code>drive</code> arrives for the watchdog time (500 ms), when the driver disconnects, and on <code>stop</code>. Ignore messages from viewers (except stop) and from anyone who isn\'t in the driver\'s seat. The full reference is in <code>robot/robopresence/robot.py</code>.</p></section>' +

    '<section id="g-trouble"><h2>Troubleshooting</h2>' +
      [['The robot stays offline', 'On the robot: <code>robopresence status</code> and <code>robopresence logs</code>. Check the Wi-Fi (<code>ping -c3 google.com</code>). If the log says "unpaired", make a new code in the Install tab and run <code>robopresence pair CODE</code>.'],
       ['"The robot answered, but no direct connection could be made"', 'One of the networks blocks direct WebRTC. Try another network (a phone hotspot) to confirm, then add a TURN server in Admin → Network.'],
       ['No picture, or "Camera: test pattern"', 'Pi camera: check the ribbon cable (contacts facing the right way) and run <code>rpicam-hello</code>. USB webcam: <code>ls /dev/video*</code>. Set the source explicitly in Parts → Camera.'],
       ['The Pi reboots when the motors start', 'A brownout: the motors drag the supply down. Use a separate 5 V 3 A regulator for the Pi and a capacitor (470 µF) across the motor supply.'],
       ['The servos jitter', 'On a Pi 4 and older the installer sets up pigpio for steady pulses; on a Pi 5, use a PCA9685 board. Give the servos their own 5 to 6 V supply and join the grounds.'],
       ['It drives in circles / backwards', 'In the Parts tab: tick Reverse left/right motor, or swap the motor wires. A slow pull to one side: use Trim.'],
       ['The Arduino parts say "not working"', 'Is the bridge sketch uploaded, and its CONFIG block the same as the Parts tab (ids must match)? <code>ls /dev/ttyACM* /dev/ttyUSB*</code> should show it.'],
       ['Lag is high', 'Lower the camera size and frame rate, prefer H.264, move closer to the router or use 5 GHz, and check the cockpit says P2P rather than RELAY.']]
        .map(function (r) { return '<h3>' + esc(r[0]) + '</h3><p>' + r[1] + '</p>'; }).join('') + '</section>';
  }

  UI.page('guide', { title: 'Build guide', nav: 'Guide', icon: 'book', order: 30 }, function (view, ctx) {
    var sec = SECTIONS.some(function (s) { return s[0] === ctx.args[0]; }) ? ctx.args[0] : null;
    view.innerHTML = '<div class="ui-wrap"><div class="ui-page-head"><div><div class="eyebrow">Build guide</div><h1>From parts bin to driving</h1>' +
      '<p class="muted">Everything you need to build, wire, install and extend a Robo Presence robot.</p></div>' +
      (ctx.me ? '<a class="ui-btn primary" href="#garage">' + UI.icon('robot') + 'Your garage</a>' : '<a class="ui-btn primary" href="#auth/signup" data-go="auth/signup">Start your garage</a>') + '</div>' +
      '<div class="gd"><nav class="gd-toc" aria-label="Sections">' + SECTIONS.map(function (s) {
        return '<a href="#guide/' + s[0] + '" data-sec="' + s[0] + '" class="' + (s[0] === (sec || 'build') ? 'on' : '') + '">' + UI.icon(s[2]) + s[1] + '</a>'; }).join('') + '</nav>' +
      '<div class="gd-body">' + body() + '</div></div></div>';
    if (sec) setTimeout(function () { var el = view.querySelector('#g-' + sec); if (el) el.scrollIntoView(); }, 30);
    view.addEventListener('click', function (e) {
      var a = e.target.closest('[data-sec]');
      if (!a) return;
      e.preventDefault();
      var el = view.querySelector('#g-' + a.getAttribute('data-sec'));
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      view.querySelectorAll('[data-sec]').forEach(function (x) { x.classList.toggle('on', x === a); });
      history.replaceState(null, '', '#guide/' + a.getAttribute('data-sec'));
    });
  });
})();

/* ===== landing.html ===== */
(function () {
  var COPY = {
    eyebrow: 'Home-built telepresence robots',
    title: 'Build a robot. <em>Drive it from anywhere.</em>',
    lead: 'Robo Presence turns a Raspberry Pi, a camera, two motors and two servos into a robot you drive live from any browser: low-latency video, a joystick, a head that looks around, and every part you bolt on later.',
    proof: ['Open-source robot code', 'One-line install on the Pi', 'Peer-to-peer video (WebRTC)'],
    steps: [['wrench', 'Pick the parts', 'Wheels, a pan-tilt head, lights, a horn, a sonar… Choose them in the Parts tab: it draws the wiring and writes the Arduino sketch for you.'],
            ['terminal', 'Install with one line', 'Flash Raspberry Pi OS, then paste one <code>curl … | sudo bash</code> on the Pi. It installs the robot code, pairs the robot with your account and starts it.'],
            ['joystick', 'Drive', 'Press Drive. Video and controls go straight between your browser and the robot, typically in 50 to 200 milliseconds.']],
    features: [['video', 'Live video, peer to peer', 'WebRTC carries the camera to you and your commands to the robot directly, like a video call. The server only makes the introduction.'],
               ['joystick', 'A real cockpit', 'Joystick, WASD, a gamepad, drag the picture to look, three gears, an emergency stop, snapshots and clip recording.'],
               ['plug', 'It adapts to your robot', 'The robot reports the parts it has and the cockpit draws switches, sliders, hold buttons, a voice box and gauges to match. Add a part, it shows up.'],
               ['chip', 'Pi, Arduino or an old phone', 'Wire everything to a Pi, let an Arduino run the motors and report its parts, or put a phone on the robot and run it from a browser tab.'],
               ['users', 'Share the keys', 'Invite pilots and viewers by email, or send a guest-pass link that runs out. Grandparents don\'t need an account.'],
               ['shield', 'Safe by default', 'The wheels stop by themselves half a second after the signal drops, when you leave, and on STOP. Admins never get your camera.']],
    faq: [['What do I need to build one?', 'A Raspberry Pi 4 or 5 (a Zero 2 W works at low resolution), a Pi camera or USB webcam, a chassis with two motors (or tank tracks), a motor driver such as the TB6612FNG, two hobby servos on a pan-tilt bracket, and a battery with a 5 V regulator. An Arduino Nano, a sonar, LEDs and a buzzer are optional extras. The build guide has the full list and the wiring.'],
          ['Why WebRTC, and how fast is it?', 'Most web apps send everything through a server, which adds delay. Robo Presence uses WebRTC, the technology behind browser video calls: your browser and the robot connect directly, so video and controls skip the server. On home Wi-Fi expect around 50 to 150 ms; across the internet, 100 to 300 ms. The cockpit shows the round trip live.'],
          ['Does it work when the robot is somewhere else?', 'Usually, yes: the robot only needs Wi-Fi with internet access, and a public STUN server helps both sides find each other. A few strict networks (some offices, some mobile carriers) block direct connections; then an admin adds a TURN relay server in Admin → Network and it works everywhere.'],
          ['Can I add a claw, a laser or a fan later?', 'Yes. Add a switch, slider, servo or button in the Parts tab and save: the robot reloads its parts within seconds and the cockpit grows a control for it. For something new, write a short Python plugin on the robot, or let the Arduino report the part itself.'],
          ['Is the robot code open?', 'Yes. The Python robot (aiortc for WebRTC, gpiozero for the pins) and the Arduino sketch are in the robot folder of the public GitHub repository. You can read the installer before you run it.'],
          ['Who can see my camera?', 'Only you, the people you share the robot with, and anyone holding a guest pass you made, while they are connected. Video goes straight between browsers and the robot and is never stored by Robo Presence.'],
          ['Is it free?', 'Yes. You pay only for your parts.']]
  };
  var esc = UI.esc;

  function heroArt() {
    var view = '<svg class="lp-view" viewBox="0 0 320 210" aria-hidden="true"><rect width="320" height="210" fill="#2b2c25"/>' +
      '<path d="M0 118 L320 118 L320 210 L0 210 Z" fill="#59574c"/>' +
      [-6, -4, -2, 0, 2, 4, 6].map(function (i) { return '<path d="M' + (160 + i * 12) + ' 118 L' + (160 + i * 80) + ' 210" stroke="#3e3c33" stroke-width="1"/>'; }).join('') +
      [126, 140, 162, 196].map(function (y) { return '<path d="M0 ' + y + ' L320 ' + y + '" stroke="#3e3c33" stroke-width="1"/>'; }).join('') +
      '<path d="M40 190 L120 132 M280 190 L200 132" stroke="#e9b42c" stroke-width="3"/>' +
      '<rect x="0" y="34" width="320" height="84" fill="#8f8a74"/><rect x="24" y="52" width="120" height="44" fill="#7a5d3e"/>' +
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return '<circle cx="' + (34 + i * 12) + '" cy="62" r="1.6" fill="#3e2f1f"/><circle cx="' + (34 + i * 12) + '" cy="74" r="1.6" fill="#3e2f1f"/><circle cx="' + (34 + i * 12) + '" cy="86" r="1.6" fill="#3e2f1f"/>'; }).join('') +
      '<rect x="210" y="94" width="58" height="44" fill="#a8844f"/><path d="M210 94 l10 -8 h58 l-10 8z" fill="#c09a62"/><path d="M268 94 l10 -8 v44 l-10 8z" fill="#8a6c40"/>' +
      '<path d="M176 140 l10 -32 l10 32 z" fill="#ee6a1c"/><rect x="179" y="124" width="14" height="4" fill="#fff" opacity=".85"/>' +
      '<circle cx="120" cy="150" r="9" fill="#f2c94c" stroke="#8a6a12" stroke-width="2"/><circle cx="120" cy="150" r="3" fill="#6b5210"/>' +
      '<g stroke="#f0732e" stroke-width="2"><path d="M146 105 h10 M164 105 h10 M160 91 v10 M160 109 v10"/><circle cx="160" cy="105" r="7" fill="none" opacity=".7"/></g>' +
      '<g font-family="IBM Plex Mono, monospace" font-size="8" fill="#ede7d6"><rect x="8" y="190" width="132" height="13" fill="rgba(0,0,0,.5)"/><text x="12" y="199">CAM 1  21:47:09  BAT 7.9V</text>' +
      '<rect x="252" y="8" width="60" height="13" fill="rgba(0,0,0,.5)"/><text x="256" y="17">SONAR 64cm</text></g>' +
      '<path d="M96 12 h128" stroke="rgba(237,231,214,.5)"/><path d="M174 12 v6" stroke="#f0732e" stroke-width="2"/></svg>';
    return '<div class="lp-hart" aria-hidden="true"><div class="lp-screen"><div class="lp-sbar"><span class="live">LIVE</span><span>SPROCKET</span><span class="r">RTT 64 ms · P2P</span></div>' + view +
      '<div class="lp-deck"><i></i><b>STOP</b><i class="sq"></i></div></div>' +
      '<svg class="lp-waves" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"><path d="M20 70 a30 30 0 0 1 30 -30"/><path d="M20 90 a50 50 0 0 1 50 -50"/><path d="M20 110 a70 70 0 0 1 70 -70"/></svg>' +
      '<div class="lp-bot">' + RP.robotArt('orange', { lights: true, pan: 26, tilt: 10 }) + '</div></div>';
  }

  function adapt() {
    var j = function (k, v) { return '  <span class="k">"' + k + '"</span>: ' + v; };
    var s = function (v) { return '<span class="s">"' + v + '"</span>'; };
    var n = function (v) { return '<span class="n">' + v + '</span>'; };
    var code = '{\n' + j('name', s('Sprocket')) + ',\n' + j('controls', '[\n') +
      '    {' + '"id": ' + s('drive') + ', "type": ' + s('drive') + '},\n' +
      '    {' + '"id": ' + s('pan') + ', "type": ' + s('servo') + ', "min": ' + n(-80) + ', "max": ' + n(80) + ', "axis": ' + s('x') + '},\n' +
      '    {' + '"id": ' + s('tilt') + ', "type": ' + s('servo') + ', "min": ' + n(-35) + ', "max": ' + n(55) + ', "axis": ' + s('y') + '},\n' +
      '    {' + '"id": ' + s('lights') + ', "type": ' + s('toggle') + ', "key": ' + s('l') + '},\n' +
      '    {' + '"id": ' + s('horn') + ', "type": ' + s('button') + '},\n' +
      '    {' + '"id": ' + s('claw') + ', "type": ' + s('slider') + ', "unit": ' + s('%') + '},\n' +
      '    {' + '"id": ' + s('voice') + ', "type": ' + s('say') + '}\n  ],\n' +
      j('sensors', '[{"id": ' + s('distance') + ', "type": ' + s('distance') + '}]') + '\n}';
    var ctl = [['joystick', 'Joystick + WASD + gamepad', 'drive'], ['eye', 'Look pad + drag the picture', 'pan + tilt'], ['toggle', 'Headlights switch, key L', 'lights'],
               ['button', 'Hold-to-beep button', 'horn'], ['slider', 'Claw slider, 0 to 100 %', 'claw'], ['voice', 'Voice box with quick phrases', 'voice'], ['distance', 'Sonar gauge + HUD warning', 'distance']];
    return '<div class="lp-adapt"><pre class="rp-code">' + code + '</pre><div class="ctl">' + ctl.map(function (c) {
      return '<div>' + UI.icon(c[0]) + '<span>' + esc(c[1]) + '</span><span class="ar">← ' + esc(c[2]) + '</span></div>'; }).join('') +
      '<p class="small muted" style="margin:4px 0 0">Bolt on a new part and save it in the Parts tab: the robot sends a new list within seconds, and the cockpit redraws while you drive.</p></div></div>';
  }

  UI.page('landing', { title: 'Build a robot, drive it from anywhere' }, function (view, ctx) {
    var me = ctx.me, C = COPY;
    var primary = me ? '<a class="ui-btn primary lg" href="#garage" data-go="garage">' + UI.icon('robot') + 'Open your garage</a>'
      : '<a class="ui-btn primary lg" href="#auth/signup" data-go="auth/signup">Start your garage ' + UI.icon('arrow') + '</a>';
    view.innerHTML =
      '<section class="lp-hero"><div class="ui-wrap"><div>' +
        '<div class="eyebrow">' + esc(C.eyebrow) + '</div><h1>' + C.title + '</h1><p class="lp-lead">' + esc(C.lead) + '</p>' +
        '<div class="lp-cta">' + primary + '<a class="ui-btn lg" href="#drive">' + UI.icon('joystick') + 'Test drive, no account</a></div>' +
        '<div class="lp-proof">' + C.proof.map(function (p) { return '<span>' + UI.icon('check') + esc(p) + '</span>'; }).join('') + '</div>' +
      '</div>' + heroArt() + '</div></section>' +
      '<section class="lp-section" id="how"><div class="ui-wrap"><div class="lp-head"><div class="eyebrow">How it works</div><h2>From parts bin to driving in an afternoon</h2></div>' +
        '<div class="lp-steps">' + C.steps.map(function (s) { return '<div class="ui-card lp-step rp-plate">' + UI.icon(s[0]) + '<h3>' + esc(s[1]) + '</h3><p class="muted">' + s[2] + '</p></div>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-head"><div class="eyebrow">More input</div><h2>Your robot tells the cockpit what it has</h2>' +
        '<p>When it starts, the robot sends a short list of its parts. The cockpit turns each one into the right control. No hard-coded buttons, so tomorrow\'s parts just work.</p></div>' + adapt() + '</div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-head"><h2>Everything a robot pilot needs</h2></div>' +
        '<div class="ui-grid">' + C.features.map(function (f) { return '<div class="ui-card lp-feature">' + UI.icon(f[0]) + '<h3>' + esc(f[1]) + '</h3><p>' + esc(f[2]) + '</p></div>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-head"><h2>Questions</h2></div><div class="lp-faq">' +
        C.faq.map(function (q) { return '<details><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-band"><div><h2>Your robot is waiting in the garage</h2><p>Try the simulator now, no account needed. Build the real one this weekend.</p></div>' +
        '<div class="ui-row"><a class="ui-btn lg" href="#drive">' + UI.icon('joystick') + 'Test drive</a>' +
        (me ? '<a class="ui-btn primary lg" href="#garage" data-go="garage">Open your garage</a>' : '<a class="ui-btn primary lg" href="#auth/signup" data-go="auth/signup">Start your garage</a>') + '</div>' +
      '</div></div></section>';
  });
})();

/* ===== profile.html ===== */
(function () {
  var esc = UI.esc;
  UI.page('profile', { title: 'Your profile', auth: 'user' }, function (view, ctx) {
    var me = ctx.me;
    view.innerHTML = '<div class="ui-wrap ui-narrow"><div class="pf-head"><span class="ui-avatar">' + esc(UI.initials(me.name)) + '</span>' +
      '<div><h1>' + esc(me.name) + '</h1><div class="muted">' + esc(me.email) + (me.joined ? ' · member since ' + esc(UI.fmtDate(me.joined, { month: 'long', year: 'numeric' })) : '') + '</div></div></div>' +
      '<div class="pf-grid"><form class="ui-card ui-stack" data-name><h3>Your name</h3><label class="ui-field"><span>Shown to other people</span>' +
      '<input type="text" name="name" value="' + esc(me.name) + '" maxlength="60" required></label><button class="ui-btn primary" type="submit">Save</button></form>' +
      '<div class="ui-card ui-stack"><h3>Appearance</h3><p class="muted small">Follow your device, or pick one.</p><div data-theme-box></div>' +
      '<h3 style="margin-top:22px">Password</h3><p class="muted small">We\'ll email you a link to choose a new one.</p>' +
      '<button class="ui-btn" data-reset>' + UI.icon('mail') + 'Email me a reset link</button></div></div>' +
      '<div class="ui-card" style="margin-top:16px"><div class="pf-links">' +
      (me.is_admin ? '<a href="#admin" data-go="admin">' + UI.icon('shield') + 'Admin</a>' : '') +
      '<button data-feedback>' + UI.icon('chat') + 'Submit feedback</button>' +
      '<button data-lk-open="overview">' + UI.icon('lock') + 'Privacy &amp; Terms, and your data</button>' +
      '<button data-signout-here>' + UI.icon('logout') + 'Sign out</button></div></div></div>';
    function themeBox() {
      var t = UI.theme();
      view.querySelector('[data-theme-box]').innerHTML = '<div class="ui-seg">' + [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
        return '<button type="button" data-theme-pick="' + o[0] + '" class="' + (t === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    }
    themeBox();
    view.addEventListener('click', function (e) {
      var t = e.target.closest('[data-theme-pick]');
      if (t) { UI.setTheme(t.getAttribute('data-theme-pick')); themeBox(); UI.renderChrome(); return; }
      if (e.target.closest('[data-reset]')) {
        UI.busy(e.target.closest('[data-reset]'), UI.auth('reset', { email: me.email })).then(function (r) { UI.toast(r.message, 'ok'); });
      }
      if (e.target.closest('[data-signout-here]')) UI.auth('logout');
    });
    view.querySelector('[data-name]').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = UI.formData(e.target);
      UI.busy(e.target.querySelector('[type=submit]'), UI.api('update_profile', v.name)).then(function (r) {
        UI.setMe(r.me); ctx.me = r.me; UI.toast('Saved', 'ok');
        view.querySelector('.pf-head h1').textContent = r.me.name;
      });
    });
  });
})();

/* ===== robot.html ===== */
(function () {
  var esc = UI.esc;
  var TABS = [['overview', 'Overview', 'robot'], ['parts', 'Parts', 'wrench'], ['install', 'Install', 'terminal'], ['sharing', 'Sharing', 'users'], ['log', 'Log', 'clock']];
  var EVENT_ICON = { online: 'signal', offline: 'signal', paired: 'link', config: 'wrench', drive: 'joystick', stop: 'stop', warn: 'info', info: 'info' };

  UI.page('robot', { title: 'Robot', auth: 'user' }, function (view, ctx) {
    var id = ctx.args[0], R = null, tab = 'overview', poll = null, cfg = null, checkT = null, dirty = false, lastOnline = null, waiting = false;
    view.innerHTML = '<div class="ui-wrap"><div class="ui-skel" style="height:300px"></div></div>';

    function owner() { return R && R.role === 'owner'; }
    function tabs() {
      var list = TABS.filter(function (t) { return owner() || t[0] === 'overview' || t[0] === 'log' || (t[0] === 'parts'); });
      return '<nav class="ui-tabs">' + list.map(function (t) { return '<a href="#robot/' + esc(R.id) + '/' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + UI.icon(t[2]) + t[1] + '</a>'; }).join('') + '</nav>';
    }
    function hero() {
      var tel = R.telemetry || {}, m = R.manifest || {};
      var canDrive = R.demo || R.role !== 'viewer';
      var driveBtn = R.demo ? '<a class="ui-btn primary" href="#drive/' + esc(R.id) + '">' + UI.icon('joystick') + 'Drive it (simulator)</a>'
        : '<a class="ui-btn primary" href="#drive/' + esc(R.id) + '"' + (R.online ? '' : ' data-offline') + '>' + UI.icon(canDrive ? 'joystick' : 'eye') + (R.role === 'viewer' ? 'Watch' : 'Drive') + '</a>';
      return '<div class="ui-card rb-hero rp-plate"><div class="art" data-art>' + RP.robotArt(R.color, { eyes: R.online || R.demo ? 'on' : 'off', pan: 14, tilt: 6 }) + '</div><div>' +
        '<div class="ui-row" style="gap:12px">' + RP.lamp(R) + '<span class="ui-badge">' + esc(RP.BOARDS[R.board] || 'Robot') + '</span>' +
        (R.role !== 'owner' && !R.demo ? '<span class="ui-badge brand">' + esc(R.role) + '</span>' : '') + (R.demo ? '<span class="ui-badge">Built by ' + esc(R.owner) + '</span>' : '') + '</div>' +
        '<h1>' + esc(R.name) + '</h1>' +
        (R.notes ? '<p class="muted" style="margin:0 0 6px">' + esc(R.notes) + '</p>' : '') +
        '<div class="rp-chips">' + (m.controls || []).map(function (c) { return '<span class="rp-chip">' + UI.icon(RP.typeIcon(c.type, c.id)) + esc(c.label || c.id) + '</span>'; }).join('') + '</div>' +
        '<div class="rb-acts">' + driveBtn +
        '<a class="ui-btn" href="#drive/sim/' + esc(R.id) + '">' + UI.icon('play') + 'Try its parts in the simulator</a>' +
        (owner() ? '<a class="ui-btn" href="#bot/' + esc(R.id) + '">' + UI.icon('phone') + 'Run it in this browser</a>' : '') + '</div></div></div>';
    }
    function draw() {
      view.innerHTML = '<div class="ui-wrap"><p style="margin:0 0 12px"><a href="#garage">' + UI.icon('back') + ' Garage</a></p>' + hero() + tabs() + '<div data-body></div></div>';
      var body = view.querySelector('[data-body]');
      ({ overview: overview, parts: parts, install: install, sharing: sharing, log: logTab }[tab] || overview)(body);
    }

    /* ---------------------------------------------------------------- overview */
    function overview(body) {
      var m = R.manifest || {}, s = RP.split(m), info = R.info || {}, tel = R.telemetry || {};
      var gets = whatPilotGets(m);
      body.innerHTML = '<div class="rb-cols"><div>' +
        '<div class="ui-card"><h3>' + (R.reported ? 'What ' + esc(R.name) + ' reports' : 'What its parts describe') + '</h3>' +
          '<p class="muted small">' + (R.reported ? 'The robot sends this list each time it starts (and when its parts change), so the cockpit always matches the hardware.' : 'The robot hasn\'t called in yet, so this comes from the Parts tab. Once it runs, it reports what really works.') + '</p>' +
          '<div class="rb-gets">' + gets + '</div></div>' +
        (s.sensors.length ? '<div class="ui-card"><h3>Sensors' + (R.online ? ' <span class="rp-lamp on" style="margin-left:6px"><i></i>live</span>' : '') + '</h3><div class="ui-stack" data-gauges>' +
          s.sensors.map(function (x) { return RP.gauge(x, tel[x.id]); }).join('') + '</div>' + (!R.online && Object.keys(tel).length ? '<p class="small muted" style="margin-top:10px">Last readings, from ' + esc(UI.ago(R.last_seen)) + '.</p>' : '') + '</div>' : '') +
        '</div><div>' +
        '<div class="ui-card"><h3>Facts</h3><dl class="rp-kv">' +
          kv('Status', R.online ? 'online' : R.paired ? 'offline' + (R.last_seen ? ', seen ' + UI.ago(R.last_seen) : '') : 'not paired yet') +
          kv('Computer', info.model) + kv('Robot code', info.version) + kv('Host name', info.host) + kv('Local IP', info.ip) + kv('Camera', info.camera || (m.camera && m.camera.source)) +
          kv('System', info.platform) + kv('Parts version', R.config_rev) + kv('Owner', R.owner || (owner() ? 'you' : '')) + '</dl></div>' +
        (owner() ? editCard() : '') +
        '</div></div>';
    }
    function kv(k, v) { return v == null || v === '' ? '' : '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>'; }
    function whatPilotGets(m) {
      var s = RP.split(m), out = [];
      if (s.drive) out.push(['joystick', 'Joystick, WASD and gamepad for the ' + (s.drive.label || 'wheels').toLowerCase()]);
      if (s.pan || s.tilt) out.push(['eye', 'Look pad, arrow keys and drag-the-picture for the head (' + [s.pan, s.tilt].filter(Boolean).map(function (x) { return x.label || x.id; }).join(', ') + ')']);
      s.others.forEach(function (c) {
        var how = { toggle: 'Switch', button: 'Hold button', slider: 'Slider', servo: 'Slider', say: 'Voice box', select: 'Choices' }[c.type] || 'Unknown part type "' + c.type + '"';
        out.push([RP.typeIcon(c.type, c.id), how + ': ' + (c.label || c.id) + (c.key ? ' (key ' + c.key.toUpperCase() + ')' : ''), c.error]);
      });
      s.sensors.forEach(function (x) { out.push([RP.typeIcon(x.type, x.id), 'Gauge: ' + (x.label || x.id) + (x.unit ? ' (' + x.unit + ')' : ''), x.error]); });
      (s.problems || []).forEach(function (p) { if (!out.some(function (o) { return o[2] === p.text; })) out.push(['info', p.id + ': ' + p.text, p.text]); });
      if (!out.length) return '<div>' + UI.icon('info') + 'No parts yet. Add some in the Parts tab.</div>';
      return out.map(function (o) { return '<div class="' + (o[2] ? 'bad' : '') + '">' + UI.icon(o[2] ? 'info' : o[0]) + '<span>' + esc(o[1]) + (o[2] ? ': not working (' + esc(o[2]) + ')' : '') + '</span></div>'; }).join('');
    }
    function editCard() {
      return '<form class="ui-card ui-stack" data-edit><h3>Name and paint</h3><label class="ui-field"><span>Name</span><input type="text" name="name" maxlength="40" value="' + esc(R.name) + '"></label>' +
        '<div class="ui-field"><span>Paint</span><div class="gr-swatches">' + Object.keys(RP.COLORS).map(function (k) {
          return '<label title="' + esc(RP.COLORS[k].name) + '"><input type="radio" name="color" value="' + k + '"' + (R.color === k ? ' checked' : '') + '><i style="background:' + RP.COLORS[k].body + '"></i></label>'; }).join('') + '</div></div>' +
        '<label class="ui-field"><span>Notes <em>(what it does, where it lives)</em></span><textarea name="notes" maxlength="500" style="min-height:70px">' + esc(R.notes) + '</textarea></label>' +
        '<div class="ui-row between"><button class="ui-btn primary" type="submit">' + UI.icon('check') + 'Save</button>' +
        '<span><button class="ui-btn sm danger" type="button" data-unpair' + (R.paired ? '' : ' disabled') + '>Unpair</button> <button class="ui-btn sm danger" type="button" data-delete>' + UI.icon('trash') + 'Delete</button></span></div></form>';
    }

    /* ---------------------------------------------------------------- parts (the builder) */
    function parts(body) {
      if (!owner()) {
        body.innerHTML = '<div class="ui-card"><h3>Parts</h3><p class="muted">Only ' + esc(R.owner || 'the owner') + ' can change this robot\'s parts. Here is what they are:</p><div class="rb-gets">' + whatPilotGets(R.manifest) + '</div>' +
          (R.demo ? '<p style="margin-top:14px"><a class="ui-btn" href="#drive/sim/' + esc(R.id) + '">' + UI.icon('play') + 'Try these parts in the simulator</a></p>' : '') + '</div>';
        return;
      }
      if (!cfg) cfg = JSON.parse(JSON.stringify(R.config || { parts: [] }));
      var cam = cfg.camera || {};
      body.innerHTML = '<div class="rb-cols"><div>' +
        '<div class="ui-card ui-stack"><h3>Brain</h3><div class="ui-seg" data-board>' + ['pi', 'pi_arduino', 'browser'].map(function (b) { return '<button type="button" data-v="' + b + '" class="' + (cfg.board === b ? 'on' : '') + '">' + RP.BOARDS[b] + '</button>'; }).join('') + '</div>' +
          '<p class="small muted" style="margin:0">' + ({ pi: 'Every part is wired to the Raspberry Pi\'s GPIO pins.', pi_arduino: 'The Pi streams video; an Arduino over USB runs the parts marked "Arduino". It tells the Pi what it has.', browser: 'A phone or laptop on the robot runs it from a browser tab (robot mode). Parts are simulated, or run by an Arduino over USB (Chrome).' })[cfg.board || 'pi'] + '</p></div>' +
        '<div class="ui-card"><h3>Camera</h3><div class="pb-part" style="border:0;box-shadow:none;background:none"><div class="pb-body" style="padding:0" data-cam>' +
          camSel('Source', 'source', cam.source, [['auto', 'Auto (Pi camera, else USB)'], ['picamera', 'Raspberry Pi camera'], ['usb', 'USB webcam'], ['test', 'Test pattern']]) +
          camSel('Size', 'size', cam.size, [['320x240', '320 × 240 (smoothest)'], ['640x480', '640 × 480'], ['960x540', '960 × 540'], ['1280x720', '1280 × 720 (Pi 4/5)']]) +
          '<label class="ui-field"><span>Frames / s</span><input type="number" data-c="fps" min="5" max="30" value="' + esc(cam.fps || 24) + '"></label>' +
          camSel('Codec', 'codec', cam.codec, [['h264', 'H.264 (lighter on the Pi)'], ['vp8', 'VP8']]) +
          '<label class="ui-check"><input type="checkbox" data-c="flip"' + (cam.flip ? ' checked' : '') + '> Upside down</label>' +
          '<label class="ui-check"><input type="checkbox" data-c="audio"' + (cam.audio ? ' checked' : '') + '> Send the microphone</label>' +
        '</div></div></div>' +
        '<div class="rb-parts" data-parts></div>' +
        '<div class="ui-card"><h3>Add a part</h3><div class="pb-catalog">' + RP.CATALOG.map(function (c, i) {
          return '<button type="button" data-add="' + i + '">' + UI.icon(c.icon) + '<b>' + esc(c.name) + '</b><small>' + esc(c.text) + '</small></button>'; }).join('') + '</div>' +
          '<p class="small muted" style="margin:12px 0 0">Something else? A <b>plugin part</b> runs your own Python on the robot (see <a href="#guide/parts">the guide</a>), and an Arduino can report parts of its own: they appear in the cockpit by themselves.</p></div>' +
        '</div><div>' +
        '<div class="ui-card"><h3>What the pilot gets</h3><div class="rb-gets" data-gets></div></div>' +
        '<div class="ui-card"><h3>Wiring</h3><div data-pins></div></div>' +
        '</div></div>' +
        '<div class="rb-sticky"><span class="msg" data-msg>Saved parts reach the robot within a few seconds, even while it runs.</span><span class="ui-row"><button class="ui-btn sm" type="button" data-reset>Start over</button>' +
        '<button class="ui-btn primary" type="button" data-save>' + UI.icon('check') + 'Save parts</button></span></div>';
      drawParts(body);
    }
    function camSel(label, f, v, opts) {
      return '<label class="ui-field"><span>' + label + '</span><select data-c="' + f + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (v === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
    }
    function drawParts(body) {
      var box = body.querySelector('[data-parts]');
      box.innerHTML = cfg.parts.length ? cfg.parts.map(function (p, i) { return RP.partEditor(p, cfg.board, i, cfg.parts.length); }).join('')
        : '<div class="ui-empty">' + UI.icon('wrench') + '<h3>No parts yet</h3><p>Add wheels, a pan-tilt head, lights… below.</p></div>';
      refreshSide(body);
    }
    function readAll(body) {
      var cards = body.querySelectorAll('[data-part]');
      cfg.parts = Array.prototype.map.call(cards, function (el, i) { return RP.readPart(el, cfg.parts[i]); });
      var cam = {}; body.querySelectorAll('[data-c]').forEach(function (inp) { var f = inp.getAttribute('data-c'); cam[f] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? +inp.value : inp.value; });
      cfg.camera = Object.assign({}, cfg.camera, cam);
    }
    function refreshSide(body, problems) {
      var man = { controls: [], sensors: [] };
      cfg.parts.forEach(function (p) {
        var d = Object.assign({}, p); if (p.type === 'custom') d.type = (p.options || {}).ui || 'button';
        (p.type === 'gauge' || p.type === 'distance' ? man.sensors : man.controls).push(d);
      });
      body.querySelector('[data-gets]').innerHTML = whatPilotGets(man);
      body.querySelector('[data-pins]').innerHTML = RP.pinMap(cfg);
      var msg = body.querySelector('[data-msg]');
      if (problems && problems.length) { msg.className = 'msg bad'; msg.innerHTML = UI.icon('info') + ' ' + esc(problems[0]) + (problems.length > 1 ? ' (+' + (problems.length - 1) + ' more)' : ''); }
      else if (problems) { msg.className = 'msg'; msg.textContent = dirty ? 'Looks good. Save to send it to the robot.' : 'Saved parts reach the robot within a few seconds, even while it runs.'; }
    }
    function check(body) {
      clearTimeout(checkT);
      checkT = setTimeout(function () {
        UI.apiQuiet('check_config', R.id, cfg).then(function (r) {
          body.querySelectorAll('[data-part]').forEach(function (el) {
            var pid = el.getAttribute('data-id');
            el.classList.toggle('bad', r.problems.some(function (p) { return p.indexOf("'" + pid + "'") >= 0; }));
          });
          refreshSide(body, r.problems);
        }).catch(function () {});
      }, 350);
    }

    /* ---------------------------------------------------------------- install */
    function install(body) {
      var I = R.install || {}, ard = (R.config.parts || []).some(function (p) { return p.driver === 'arduino'; });
      var host = RP.slug(R.name);
      var steps = [];
      if (R.board === 'browser') steps.push(['Run it in a browser', '<p>This robot\'s brain is a phone or laptop. Open <b>robot mode</b> on that device (signed in as you), point the camera ahead and press Start. Keep the screen on.</p><a class="ui-btn primary" href="#bot/' + esc(R.id) + '">' + UI.icon('phone') + 'Open robot mode</a>' +
        '<p class="small muted" style="margin-top:10px">Prefer a Raspberry Pi after all? Switch the brain in the Parts tab and follow the steps below.</p>']);
      steps.push(['Flash the SD card', '<p>Install <a href="https://www.raspberrypi.com/software/" target="_blank" rel="noopener">Raspberry Pi Imager</a>, choose your Pi model and <b>Raspberry Pi OS Lite (64-bit)</b>. In the settings (the gear, or "Edit settings") set:</p>' +
        '<ul class="rb-list">' + [['Host name', host], ['User name and password', 'yours to choose'], ['Wi-Fi', 'your network and its password'], ['Services', 'enable SSH']].map(function (x) { return '<li>' + UI.icon('check') + '<span><b>' + x[0] + ':</b> ' + esc(x[1]) + '</span></li>'; }).join('') + '</ul>']);
      steps.push(['Connect to the Pi', '<p>Put the card in the Pi, switch it on and wait a minute. From a computer on the same Wi-Fi:</p>' + RP.cmdBox('ssh <user>@' + host + '.local', 'SSH command') +
        '<p class="small muted" style="margin-top:8px">Windows 10/11, macOS and Linux all have ssh built in (Windows: PowerShell).</p>']);
      steps.push(['Install the robot code', I.code ? '<p>Paste this into the Pi. It installs everything (a few minutes the first time), pairs the robot with your account and starts it. The code <b>' + esc(I.code) + '</b> works once, until ' + esc(UI.fmtDateTime(I.expires)) + '.</p>' + RP.cmdBox(I.cmd, 'Install command') +
        '<div class="ui-row" style="margin-top:8px"><button class="ui-btn sm" type="button" data-newcode>' + UI.icon('refresh') + 'New code</button><a class="small" href="https://github.com/arkulinskis/robo-presence/blob/master/robot/install.sh" target="_blank" rel="noopener">Read the installer first</a></div>' + waitBox()
        : (I.pi_paired ? '<p>' + esc(R.name) + ' is paired' + (I.paired_at ? ' (since ' + esc(UI.fmtDate(I.paired_at)) + ')' : '') + '. To update its code later, run this on the robot:</p>' + RP.cmdBox('robopresence update', 'Update command') + waitBox() +
          '<p class="small muted" style="margin-top:10px">Moving to a new SD card? <button class="ui-btn sm" type="button" data-newcode>' + UI.icon('key') + 'Make a new install code</button></p>'
          : '<p>Make an install code: it goes into a one-line command for the Pi.</p><button class="ui-btn primary" type="button" data-newcode>' + UI.icon('key') + 'Make an install code</button>')]);
      if (ard || R.board === 'pi_arduino') steps.push(['Upload the Arduino bridge', '<p>In the <a href="https://www.arduino.cc/en/software" target="_blank" rel="noopener">Arduino IDE</a>: new sketch, paste this (its CONFIG block matches your Parts tab), pick your board and port, Upload. Then plug the Arduino into the Pi\'s USB. The Pi asks it what it has when it starts.</p>' +
        '<div class="ui-row" style="margin-bottom:8px"><button class="ui-btn sm" type="button" data-copysketch>' + UI.icon('copy') + 'Copy the sketch</button><button class="ui-btn sm" type="button" data-dlsketch>' + UI.icon('download') + 'Download robopresence_bridge.ino</button></div>' +
        '<pre class="rp-code rb-sketch" data-sketch>Loading the sketch…</pre>']);
      steps.push(['Wire it, then test', '<p>The <a href="#robot/' + esc(R.id) + '/parts">Parts tab</a> shows which pin goes where. Give the motors and servos their own battery (not the Pi\'s 5 V), and join all the grounds (GND). Then, on the Pi:</p>' +
        RP.cmdBox('robopresence test', 'Test command') + '<p class="small muted" style="margin-top:8px">It sweeps the servos, flashes the switches and reads the sensors. Add <code>--wheels</code> to spin the wheels too (lift the robot first). Other commands: <code>robopresence status | logs | restart | update</code>.</p>']);
      body.innerHTML = '<div class="rb-cols"><div class="rb-steps">' + steps.map(function (s, i) {
        return '<div class="ui-card rb-step"><span class="rp-stepnum">' + (i + 1) + '</span><div><h3>' + s[0] + '</h3>' + s[1] + '</div></div>'; }).join('') + '</div><div>' +
        '<div class="ui-card"><h3>Shopping list</h3><ul class="rb-list">' + [
          ['chip', 'Raspberry Pi 4 or 5 (a Zero 2 W works at 320 × 240)'], ['camera', 'Camera Module 3, or any USB webcam'], ['wheel', 'A 2WD/4WD chassis or tank tracks with two motors'],
          ['bolt', 'Motor driver: TB6612FNG (recommended), L298N or DRV8833'], ['servo', 'Two SG90/MG90S servos + a pan-tilt bracket'],
          ['battery', 'Battery pack (2S Li-ion, 7.4 V) + a 5 V 3 A step-down for the Pi'], ['plug', 'Optional: Arduino Nano/Uno, HC-SR04 sonar, LEDs, a buzzer, a small speaker']
        ].map(function (x) { return '<li>' + UI.icon(x[0]) + '<span>' + esc(x[1]) + '</span></li>'; }).join('') + '</ul><p class="small" style="margin:12px 0 0"><a href="#guide/build">The full build guide</a></p></div>' +
        '<div class="ui-card"><h3>How the connection works</h3><p class="small muted" style="margin:0">The robot checks in with Robo Presence every second or two. When you press Drive, your browser leaves a connection offer, the robot answers, and from then on video and controls go <b>directly</b> between you (WebRTC, the same tech as video calls), typically 50 to 200 ms. If a network blocks direct connections, an admin can add a TURN relay in Admin → Network.</p></div>' +
        '</div></div>';
      if (body.querySelector('[data-sketch]')) RP.sketch(R.config, R.name).then(function (t) { var el = body.querySelector('[data-sketch]'); if (el) el.textContent = t; });
    }
    function waitBox() {
      return '<div class="rb-wait ' + (R.online ? 'ok' : '') + '" data-wait><div class="art">' + RP.robotArt(R.color, { eyes: R.online ? 'on' : 'off', arms: false, small: true }) + '</div><div>' +
        (R.online ? '<b>' + esc(R.name) + ' is online.</b><br><span class="small">It called in ' + esc(UI.ago(R.last_seen)) + '. <a href="#drive/' + esc(R.id) + '">Drive it now</a></span>'
          : '<b>Waiting for ' + esc(R.name) + ' to call in…</b><br><span class="small muted">This turns green by itself when the install finishes.</span>') + '</div></div>';
    }

    /* ---------------------------------------------------------------- sharing */
    function sharing(body, newPass) {
      var link = newPass ? location.origin + location.pathname + '#drive/pass/' + newPass : null;
      body.innerHTML = '<div class="rb-cols"><div>' +
        '<form class="ui-card ui-stack" data-share><h3>Invite people</h3><p class="muted small" style="margin:0">They see ' + esc(R.name) + ' in their garage once they sign up or sign in with this email. Pilots drive; viewers watch.</p>' +
          '<div class="rb-form-row"><label class="ui-field"><span>Email</span><input type="email" name="email" required placeholder="friend@example.com"></label>' +
          '<label class="ui-field"><span>Role</span><select name="role"><option value="pilot">Pilot (drive)</option><option value="viewer">Viewer (watch)</option></select></label>' +
          '<button class="ui-btn primary" type="submit">' + UI.icon('plus') + 'Invite</button></div>' +
          (R.shares.length ? '<table class="rb-table"><tbody>' + R.shares.map(function (s) {
            return '<tr><td><b>' + esc(s.name || s.email) + '</b>' + (s.name ? '<br><span class="small muted">' + esc(s.email) + '</span>' : '') + '</td><td><span class="ui-badge ' + (s.role === 'pilot' ? 'brand' : '') + '">' + esc(s.role) + '</span>' +
              (s.joined ? '' : ' <span class="small muted">invited</span>') + '</td><td style="text-align:right"><button class="ui-btn sm ghost danger" type="button" data-unshare="' + esc(s.id) + '">Remove</button></td></tr>'; }).join('') + '</tbody></table>'
            : '<p class="small muted" style="margin:0">Not shared with anyone yet.</p>') + '</form></div><div>' +
        '<form class="ui-card ui-stack" data-pass><h3>Guest passes</h3><p class="muted small" style="margin:0">A link that lets someone drive or watch without an account, until it runs out. Good for a video call with grandparents, or a demo.</p>' +
          (link ? '<div class="rb-pass"><b>Here is the link.</b> Copy it now: for safety it is only shown once.' + RP.cmdBox(link, 'Guest link').replace('<span class="p">$ </span>', '') + '</div>' : '') +
          '<div class="rb-form-row three"><label class="ui-field"><span>For</span><input type="text" name="label" maxlength="40" placeholder="Grandma"></label>' +
          '<label class="ui-field"><span>Can</span><select name="role"><option value="pilot">Drive</option><option value="viewer">Watch</option></select></label>' +
          '<label class="ui-field"><span>For how long</span><select name="hours"><option value="1">1 hour</option><option value="4">4 hours</option><option value="24" selected>1 day</option><option value="72">3 days</option><option value="168">1 week</option></select></label>' +
          '<button class="ui-btn primary" type="submit">' + UI.icon('link') + 'Make</button></div>' +
          (R.passes.length ? '<table class="rb-table"><tbody>' + R.passes.map(function (p) {
            return '<tr><td><b>' + esc(p.label) + '</b><br><span class="small muted">' + (p.role === 'viewer' ? 'watch' : 'drive') + ' · used ' + p.uses + '×' + (p.last_used ? ', last ' + esc(UI.ago(p.last_used)) : '') + '</span></td>' +
              '<td>' + (p.active ? '<span class="ui-badge good">until ' + esc(UI.fmtDateTime(p.expires)) + '</span>' : '<span class="ui-badge">ended</span>') + '</td>' +
              '<td style="text-align:right">' + (p.active ? '<button class="ui-btn sm ghost danger" type="button" data-revoke="' + esc(p.id) + '">Revoke</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table>' : '') +
        '</form></div></div>';
    }

    /* ---------------------------------------------------------------- log */
    function logTab(body) {
      body.innerHTML = '<div class="rb-cols"><div class="ui-card"><h3>Drives</h3>' + (R.sessions.length ? '<table class="rb-table sessions"><thead><tr><th>Who</th><th>When</th><th>How long</th><th>Round trip</th><th>Video</th></tr></thead><tbody>' +
        R.sessions.map(function (s) {
          return '<tr><td><b>' + esc(s.pilot) + '</b><br><span class="small muted">' + esc(s.role) + (s.guest ? ' · guest pass' : '') + (s.state !== 'ended' ? ' · ' + esc(s.state) : '') + '</span></td><td>' + esc(UI.fmtDateTime(s.created)) + '</td>' +
            '<td>' + RP.dur(s.duration_s) + '</td><td>' + (s.rtt_ms != null ? Math.round(s.rtt_ms) + ' ms' : '–') + '</td><td>' + (s.fps ? Math.round(s.fps) + ' fps' + (s.kbps ? ' · ' + Math.round(s.kbps) + ' kbps' : '') : '–') + '</td></tr>'; }).join('') + '</tbody></table>'
        : '<p class="muted">No drives yet.</p>') + '</div>' +
        '<div class="ui-card"><h3>Robot log</h3>' + (R.events.length ? '<ul class="rb-events">' + R.events.map(function (e) {
          return '<li class="' + esc(e.kind) + '">' + UI.icon(EVENT_ICON[e.kind] || 'info') + '<span>' + esc(e.text) + '</span><time title="' + esc(UI.fmtDateTime(e.at)) + '">' + esc(UI.ago(e.at)) + '</time></li>'; }).join('') + '</ul>' : '<p class="muted">Nothing yet.</p>') + '</div></div>';
    }

    /* ---------------------------------------------------------------- events */
    view.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-offline]') && !R.online && !R.demo) { e.preventDefault(); UI.toast(R.name + ' is offline. Switch it on (or finish the Install steps) first.', 'error'); return; }
      var add = t.closest('[data-add]');
      if (add) { var body = view.querySelector('[data-body]'); readAll(body); cfg.parts.push(RP.newPart(RP.CATALOG[+add.getAttribute('data-add')], cfg.board, cfg.parts)); dirty = true; drawParts(body); check(body);
        var last = body.querySelectorAll('[data-part]'); last = last[last.length - 1]; if (last) { last.scrollIntoView({ block: 'center', behavior: 'smooth' }); var inp = last.querySelector('input[data-f=label]'); if (inp) inp.focus(); } return; }
      var rm = t.closest('[data-remove]');
      if (rm) { var b2 = view.querySelector('[data-body]'); readAll(b2); cfg.parts.splice(+rm.closest('[data-part]').getAttribute('data-part'), 1); dirty = true; drawParts(b2); check(b2); return; }
      var mv = t.closest('[data-move]');
      if (mv) { var b3 = view.querySelector('[data-body]'); readAll(b3); var i = +mv.closest('[data-part]').getAttribute('data-part'), j = i + (+mv.getAttribute('data-move')); var x = cfg.parts.splice(i, 1)[0]; cfg.parts.splice(j, 0, x); dirty = true; drawParts(b3); return; }
      var bd = t.closest('[data-board] [data-v]');
      if (bd) {
        var b4 = view.querySelector('[data-body]'); readAll(b4); var nb = bd.getAttribute('data-v');
        if (nb === cfg.board) return;
        UI.confirm({ title: 'Switch to ' + RP.BOARDS[nb] + '?', text: 'Keep your parts and move them to the new brain where they fit, or start from the ' + RP.BOARDS[nb] + ' starting set.', ok: 'Start from the starting set', cancel: 'Keep my parts' }).then(function (fresh) {
          if (fresh) { UI.api('reset_config', R.id, nb).then(function (d) { R = d.robot; cfg = null; dirty = false; draw(); UI.toast('Parts reset to the ' + RP.BOARDS[nb] + ' set.', 'ok'); }); return; }
          cfg.board = nb;
          cfg.parts.forEach(function (p) { var ds = RP.driversFor(p.type, nb); if (ds.indexOf(p.driver) < 0) { p.driver = nb === 'pi_arduino' && ds.indexOf('arduino') >= 0 ? 'arduino' : ds[0]; p.pins = {}; } });
          dirty = true; parts(b4); check(b4);
        });
        return;
      }
      if (t.closest('[data-save]')) {
        var b5 = view.querySelector('[data-body]'); readAll(b5);
        UI.busy(t.closest('[data-save]'), UI.api('save_config', R.id, cfg).then(function (d) {
          R = d.robot; cfg = JSON.parse(JSON.stringify(R.config)); dirty = false;
          UI.toast('Saved (version ' + R.config_rev + ').' + (R.online ? ' ' + R.name + ' is reloading its parts.' : ''), 'ok');
          (d.notes || []).forEach(function (n) { UI.toast(n); });
          parts(b5);
        }, function (err) {
          var probs = err.result && err.result.problems;
          refreshSide(b5, probs || [err.message]);
          if (probs) b5.querySelectorAll('[data-part]').forEach(function (el) { var pid = el.getAttribute('data-id'); el.classList.toggle('bad', probs.some(function (p) { return p.indexOf("'" + pid + "'") >= 0; })); });
          UI.toast(err.message, 'error');
        }));
        return;
      }
      if (t.closest('[data-reset]')) {
        UI.confirm({ title: 'Start over?', text: 'Your parts go back to the ' + RP.BOARDS[cfg.board || 'pi'] + ' starting set.', ok: 'Start over', danger: true }).then(function (yes) {
          if (yes) UI.api('reset_config', R.id, cfg.board || 'pi').then(function (d) { R = d.robot; cfg = null; dirty = false; draw(); });
        });
        return;
      }
      if (t.closest('[data-newcode]')) { UI.busy(t.closest('[data-newcode]'), UI.api('new_install_code', R.id)).then(function (d) { R = d.robot; waiting = true; draw(); UI.toast('New install code: ' + R.install.code, 'ok'); }); return; }
      if (t.closest('[data-copysketch]')) { RP.sketch(R.config, R.name).then(function (s) { RP.copy(s, 'Sketch'); }); return; }
      if (t.closest('[data-dlsketch]')) { RP.sketch(R.config, R.name).then(function (s) { RP.download('robopresence_bridge.ino', s); }); return; }
      var us = t.closest('[data-unshare]');
      if (us) { UI.api('share_remove', us.getAttribute('data-unshare')).then(function (d) { R = d.robot; draw(); UI.toast('Removed.', 'ok'); }); return; }
      var rv = t.closest('[data-revoke]');
      if (rv) { UI.confirm({ title: 'Revoke this pass?', text: 'The link stops working at once, and anyone using it is disconnected.', ok: 'Revoke', danger: true }).then(function (yes) { if (yes) UI.api('pass_revoke', rv.getAttribute('data-revoke')).then(function (d) { R = d.robot; draw(); }); }); return; }
      if (t.closest('[data-unpair]')) {
        UI.confirm({ title: 'Unpair ' + R.name + '?', text: 'It stops calling in, and needs a new install code (robopresence pair CODE) to come back.', ok: 'Unpair', danger: true }).then(function (yes) {
          if (yes) UI.api('unpair_robot', R.id).then(function (d) { R = d.robot; draw(); UI.toast('Unpaired.', 'ok'); }); });
        return;
      }
      if (t.closest('[data-delete]')) {
        UI.confirm({ title: 'Delete ' + R.name + '?', text: 'Its parts, passes and logs are deleted. The robot itself keeps its code but can\'t call in any more.', ok: 'Delete', danger: true }).then(function (yes) {
          if (yes) UI.api('delete_robot', R.id).then(function () { UI.toast('Deleted.', 'ok'); UI.go('garage'); }); });
      }
    });
    view.addEventListener('input', function (e) {
      if (!e.target.closest('[data-part], [data-cam]')) return;
      var body = view.querySelector('[data-body]'); readAll(body); dirty = true;
      var card = e.target.closest('[data-part]');
      if (card && e.target.getAttribute('data-f') === 'id') card.setAttribute('data-id', e.target.value.trim().toLowerCase());
      refreshSide(body); check(body);
    });
    view.addEventListener('change', function (e) {
      var f = e.target.getAttribute && e.target.getAttribute('data-f');
      if ((f === 'driver' || (e.target.getAttribute('data-o') === 'ui')) && e.target.closest('[data-part]')) {  // a new driver means new pin fields
        var body = view.querySelector('[data-body]'); readAll(body);
        var i = +e.target.closest('[data-part]').getAttribute('data-part'); cfg.parts[i].pins = {};
        drawParts(body); check(body);
      }
    });
    view.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, v = UI.formData(f);
      if (f.matches('[data-edit]')) UI.busy(f.querySelector('[type=submit]'), UI.api('update_robot', R.id, { name: v.name, color: v.color, notes: v.notes })).then(function (d) { R = d.robot; draw(); UI.toast('Saved.', 'ok'); });
      if (f.matches('[data-share]')) UI.busy(f.querySelector('[type=submit]'), UI.api('share_add', R.id, v.email, v.role)).then(function (d) { R = d.robot; draw(); UI.toast('Invited ' + v.email + '.', 'ok'); });
      if (f.matches('[data-pass]')) UI.busy(f.querySelector('[type=submit]'), UI.api('pass_create', R.id, v.label, v.role, +v.hours)).then(function (d) { R = d.robot; sharing(view.querySelector('[data-body]'), d.token); });
    });

    /* ---------------------------------------------------------------- live status */
    function startPoll() {
      if (R.demo) return;
      poll = setInterval(function () {
        if (document.hidden) return;
        UI.apiQuiet('robot_status', R.id).then(function (s) {
          var was = R.online;
          R.online = s.online; R.last_seen = s.last_seen; R.telemetry = s.telemetry; R.paired = s.paired;
          if (s.reported) { R.manifest = s.manifest; R.reported = true; }
          if (was !== s.online || (tab === 'install' && s.online && waiting)) {
            if (s.online && !was && (tab === 'install' || waiting)) { UI.toast(R.name + ' is online!', 'ok'); RP.beep(660, 90); setTimeout(function () { RP.beep(990, 140); }, 110); waiting = false; }
            if (tab !== 'parts' || !dirty) draw(); else { var lampEl = view.querySelector('.rp-lamp'); if (lampEl) lampEl.outerHTML = RP.lamp(R); }
          } else if (tab === 'overview') {
            var g = view.querySelector('[data-gauges]');
            if (g) g.innerHTML = RP.split(R.manifest).sensors.map(function (x) { return RP.gauge(x, (R.telemetry || {})[x.id]); }).join('');
          }
        }).catch(function () {});
      }, 3000);
    }

    tab = TABS.some(function (t) { return t[0] === ctx.args[1]; }) ? ctx.args[1] : 'overview';
    var ready = UI.api('get_robot', id).then(function (d) {
      R = d.robot;
      if (!owner() && ['install', 'sharing'].indexOf(tab) >= 0) tab = 'overview';
      waiting = tab === 'install' && !R.online;
      draw(); startPoll();
    });
    return { ready: ready, destroy: function () { clearInterval(poll); clearTimeout(checkT); } };
  });
})();
