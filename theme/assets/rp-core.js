/* rp-core.js (moved unchanged from the JavaScript version's web/pages/_rp.html.html)
 _rp: shared toolkit for every page (loaded first): window.RP.
     Icons for parts, the robot illustration (RP.robotArt), status lamps, manifest helpers (RP.split),
     sensor gauges, copy-to-clipboard, small formatters. The cockpit, simulator, WebRTC links and the
     parts builder live in _rp_cockpit / _rp_sim / _rp_link / _rp_builder. */
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
