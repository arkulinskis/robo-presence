/* rp-cockpit.js (moved unchanged from the JavaScript version's web/pages/_rp_cockpit.html.html)
 _rp_cockpit: the driving screen, RP.cockpit(view, opts). It draws itself from the robot's manifest:
     wheels -> a joystick (+ WASD, gamepad left stick); a head (pan + tilt servos) -> a look pad, drag on the video,
     arrow keys, gamepad right stick, HUD scales; every other part -> a control in the side panel (switch, hold
     button, slider, voice box, choice chips; unknown types get a "needs a newer cockpit" card); sensors -> gauges.
     When the robot sends a new manifest (parts changed), the controls redraw. Works the same for the simulator
     (RP.simulator) and a real robot (RP.connectLive): both give a "link" with send / onmessage / stream / stats / close. */
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
/* RP.openCockpit(el, o): the cockpit for the Forms version's Pages/Drive (Components/Cockpit), with plain-data options so
   Python never hands functions over. o = {robot, mode: 'sim'|'demo'|'live', role, back, backLabel,
   sim: {manifest, pilot, label}  or  live: {robotId, pass, pilot, ice, audio, offline: "message if the robot is offline"}}.
   Returns RP.cockpit's {ready, destroy}. */
window.RP.openCockpit = function (el, o) {
  var RP = window.RP;
  var connect = o.live ? function (step) {
    if (o.live.offline) return Promise.reject(new Error(o.live.offline));
    return RP.connectLive({ robotId: o.live.robotId || null, pass: o.live.pass || null, pilot: o.live.pilot || null, ice: o.live.ice, audio: !!o.live.audio, onStep: step });
  } : function () {
    return RP.simulator((o.sim || {}).manifest || null, { pilot: (o.sim || {}).pilot || 'You', label: (o.sim || {}).label || 'SIM CAM' });
  };
  return RP.cockpit(el, { robot: o.robot || {}, mode: o.mode || 'sim', role: o.role || 'owner', back: o.back, backLabel: o.backLabel, connect: connect });
};
