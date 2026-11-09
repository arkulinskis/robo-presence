/* rp-sim.js (moved unchanged from the JavaScript version's web/pages/_rp_sim.html.html)
 _rp_sim: the robot in JavaScript.
     RP.RobotCore  the same rules as robot/robopresence/robot.py (messages, driver seat, watchdog, smooth servos),
                   used by the simulator and by robot mode in a browser tab (bot.html).
     RP.SimWorld   a small 3D garage drawn on a canvas: the simulated robot's camera. Wheels move it, pan/tilt aim
                   the camera, the headlights light it up, the sonar measures, and five lost bolts wait to be found.
     RP.SimLink    connects the cockpit to a RobotCore in the same page (like a WebRTC link, with a little delay). */
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
