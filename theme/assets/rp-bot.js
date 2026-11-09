/* rp-bot.js: robot mode's engine. RP.SerialArduino (Web Serial, the robopresence_bridge protocol, moved unchanged from
   web/pages/bot.html) and RP.BotRunner (the old page's start/stop, now driven by client_code/Pages/Bot). */
(function () {
  'use strict';
  var RP = window.RP;
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

  /* RP.BotRunner(robot, opts): robot mode's engine (Forms version: Pages/Bot draws the page around it).
     robot = get_robot's robot (config, name, api_origin ...); opts: {camera: 'sim'|'user'|'environment', arduino: bool,
     claim: function () -> Promise of {token} (tab_claim through Python), onLog(text, level), onChange()}.
     run.start() -> Promise (rejects with a sentence); run.stop(); run.running(); run.peers() -> [{pilot, role, driving}];
     run.stream / run.label once started. RP.botPlan(robot) = what each part does in this browser. */
  RP.botPlan = function (R) {
    return (R.config.parts || []).map(function (p) {
      var how = p.driver === 'sim' ? 'simulated here' : p.driver === 'arduino' ? 'Arduino over USB' : p.driver === 'espeak' ? 'this device speaks it' : PI_ONLY[p.driver] ? 'needs a Raspberry Pi: skipped' : p.driver;
      return { p: p, how: how, ok: !PI_ONLY[p.driver] };
    });
  };
  RP.BotRunner = function (R, opts) {
    var self = this;
    self.R = R; self.opts = opts || {}; self.run = null; self.stream = null; self.label = '';
    var log = function (t, l) { if (self.opts.onLog) self.opts.onLog(String(t), l || 'info'); };
    var status = function () { if (self.opts.onChange) self.opts.onChange(); };
    self.running = function () { return !!(self.run && self.run.host.running); };
    self.peers = function () {
      if (!self.run) return [];
      return self.run.core.peers.map(function (p) { return { pilot: p.pilot, role: p.role, driving: self.run.core.driver === p }; });
    };
    self.start = function () {
      var camMode = self.opts.camera || 'sim', useArd = !!self.opts.arduino;
      var plan = RP.botPlan(R), ard = null, world = null, canvas = null, stream = null, label = '';
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
        return Promise.resolve(self.opts.claim()).then(function (t) {
          var host = new RP.RobotHost({ api: R.api_origin, token: t.token, core: core, stream: stream, cameraLabel: label,
            onLog: log, onChange: status, onConfig: function () { log('The parts changed in the website: press Stop and Start to load them.', 'warn'); } });
          self.run = { core: core, host: host, world: world, stream: stream, ard: ard, resend: resend, lock: null };
          return host.start();
        });
      });
      return p.then(function () {
        self.stream = stream; self.label = label;
        if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { if (self.run) self.run.lock = l; }).catch(function () {});
      }, function (e) {
        if (ard) ard.close(); if (world) world.destroy(); core.destroy();
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        self.run = null;
        throw e;
      });
    };
    self.stop = function () {
      if (!self.run) return;
      var r = self.run; self.run = null; self.stream = null;
      r.host.stop(); clearInterval(r.resend); r.core.destroy();
      if (r.world) r.world.destroy(); if (r.ard) r.ard.close();
      if (r.stream) r.stream.getTracks().forEach(function (t) { t.stop(); });
      if (r.lock) r.lock.release().catch(function () {});
      log('Stopped.', 'info');
    };
    self.state = function () { return self.run ? { running: self.run.host.running, peers: self.run.core.peers.length, values: self.run.core.values() } : null; };
  };
  /* Show a stream in a box (the robot-mode screen); null removes the video. */
  RP.showStream = function (box, stream) {
    var old = box.querySelector('video'); if (old) old.remove();
    if (!stream) return;
    var v = document.createElement('video'); v.muted = true; v.playsInline = true; v.autoplay = true; v.srcObject = stream;
    box.insertBefore(v, box.firstChild);
    if (v.play) v.play().catch(function () {});
  };
  /* The garage card's live miniature of the simulator (Components/SimMini). Returns {stop}. */
  RP.miniSim = function (box) {
    var c = document.createElement('canvas'); c.width = 320; c.height = 240; box.insertBefore(c, box.firstChild);
    var core = new RP.RobotCore(RP.SIM_PARTS.slice(), { name: 'mini' });
    var world = new RP.SimWorld(c, core, { label: 'SIM' });
    world.W = 320; world.H = 240; world.heading = 0.5;
    var t = 0, spin = setInterval(function () { t += 0.05; var p = core.part('pan'); if (p) p.value = Math.sin(t) * 40; }, 50);
    return { stop: function () { clearInterval(spin); world.destroy(); core.destroy(); c.remove(); } };
  };
})();
