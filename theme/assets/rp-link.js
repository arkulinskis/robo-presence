/* rp-link.js (moved unchanged from the JavaScript version's web/pages/_rp_link.html.html)
 _rp_link: WebRTC.
     RP.connectLive  the pilot's side: offer (video in, audio in and/or the pilot's voice out, two data channels out)
                     -> server -> robot -> answer -> peer to peer. link.talk(true|false) = push-to-talk.
     RP.RobotHost    the robot's side in a browser tab (bot.html): calls the bot API like robot/robopresence does,
                     answers pilots' offers with a camera or simulator stream, and feeds their messages to a RobotCore. */
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
  /* opts: {robotId, pass, pilot, ice, audio (hear the robot's mic), talk (push-to-talk), onStep(text)} -> Promise of a link like RP.simulator's */
  RP.connectLive = function (opts) {
    var step = opts.onStep || function () {};
    var pc = new RTCPeerConnection({ iceServers: opts.ice || [] });
    var link = { kind: 'live', pc: pc, stream: new MediaStream(), onmessage: null, onclose: null, session: null, closed: false };
    pc.addTransceiver('video', { direction: 'recvonly' });
    /* One audio line both ways. The pilot's half starts with no track (nothing is sent, no microphone prompt);
       the first link.talk(true) asks for the microphone and slots it in with replaceTrack (no renegotiation). */
    var voice = null, mic = null, micAsk = null;
    if (opts.audio || opts.talk) voice = pc.addTransceiver('audio', { direction: opts.audio && opts.talk ? 'sendrecv' : opts.talk ? 'sendonly' : 'recvonly' });
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
    link.canTalk = !!opts.talk;
    link.talking = false;
    link.talk = function (on) {
      if (!opts.talk || !voice || link.closed) return Promise.resolve(false);
      link.talking = !!on;
      if (mic) { mic.enabled = link.talking; return Promise.resolve(true); }
      if (!on) return Promise.resolve(true);
      if (!micAsk) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('This browser can\'t use a microphone.'));
        micAsk = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
          .then(function (s) {
            var t = s.getAudioTracks()[0];
            if (link.closed) { t.stop(); throw new Error('Closed.'); }
            return voice.sender.replaceTrack(t).then(function () { mic = t; mic.enabled = link.talking; return true; });
          }, function (e) {
            micAsk = null;
            throw new Error(e && e.name === 'NotAllowedError' ? 'The microphone is blocked. Allow it for this site (the icon in the address bar), then hold Talk again.' : 'No microphone found.');
          });
      }
      return micAsk;
    };
    link.close = function (stats) {
      if (link.closed) return;
      link.closed = true;
      if (mic) { try { mic.stop(); } catch (e) {} }
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
      if (sess.voice) { try { sess.voice.srcObject = null; } catch (e) {} }
      try { pc.close(); } catch (e) {}
      if (sess.joined) self.core.leave(peer);
      delete self.sessions[offer.session];
      self.log(offer.pilot + ' left.');
      if (self.o.onChange) self.o.onChange();
    } };
    this.sessions[offer.session] = sess;
    pc.ontrack = function (e) {
      if (e.track.kind !== 'audio' || offer.role === 'viewer' || self.o.talk === false) return;
      var el = document.createElement('audio');
      el.autoplay = true; el.srcObject = new MediaStream([e.track]);
      sess.voice = el;
      var p = el.play(); if (p && p.catch) p.catch(function () { self.log('Tap the page once so ' + offer.pilot + '\'s voice can play.', 'warn'); });
    };
    pc.ondatachannel = function (e) {
      chans[e.channel.label] = e.channel;
      e.channel.onmessage = function (m) { self.core.handle(peer, m.data); };
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'connected' && !sess.joined) { sess.joined = true; if (self.o.chime !== false && RP.chime) RP.chime(); self.core.join(peer); self.log(offer.pilot + ' connected (' + offer.role + ').'); if (self.o.onChange) self.o.onChange(); }
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

  /* ---------------------------------------------------------------- the connection check (#check, 2026-11-20) */
  /* RP.netCheck({stun: ['stun:host:port', ...], relay: [iceServer, ...]}) -> Promise of
       {webrtc, h264, stun: [{url, ok, ip, port}], publicIp, symmetric, udp, relay: {tried, ok, proto}, ms}
     Gathers ICE candidates against each STUN server on its own: the same public port from two servers means an
     easy NAT (direct connections work); different ports mean a strict ("symmetric") NAT that needs the relay. */
  function parseCand(line) {
    var f = String(line || '').replace(/^a=/, '').split(' ');
    var i = f.indexOf('typ');
    if (f.length < 8 || i < 0) return null;
    return { proto: (f[2] || '').toLowerCase(), ip: f[4], port: +f[5], type: f[i + 1], rport: +(f[f.indexOf('rport') + 1] || 0),
             tcptype: f.indexOf('tcptype') >= 0 ? f[f.indexOf('tcptype') + 1] : null };
  }
  function gather(iceServers, policy, ms) {
    return new Promise(function (resolve) {
      var out = [], pc;
      try { pc = new RTCPeerConnection({ iceServers: iceServers, iceTransportPolicy: policy || 'all' }); }
      catch (e) { resolve({ error: e.message, cands: [] }); return; }
      var done = false, finish = function () { if (done) return; done = true; try { pc.close(); } catch (e) {} resolve({ cands: out }); };
      pc.onicecandidate = function (e) { if (!e.candidate) { finish(); return; } var c = parseCand(e.candidate.candidate); if (c) out.push(c); };
      pc.onicegatheringstatechange = function () { if (pc.iceGatheringState === 'complete') finish(); };
      pc.createDataChannel('check');
      pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).catch(finish);
      setTimeout(finish, ms || 6000);
    });
  }
  RP.netCheck = function (opts) {
    opts = opts || {};
    var t0 = performance.now();
    var res = { webrtc: !!window.RTCPeerConnection, h264: null, stun: [], publicIp: null, symmetric: null, udp: false,
                relay: { tried: false, ok: false, proto: null } };
    if (!res.webrtc) return Promise.resolve(res);
    try {
      var caps = window.RTCRtpReceiver && RTCRtpReceiver.getCapabilities && RTCRtpReceiver.getCapabilities('video');
      res.h264 = caps ? caps.codecs.some(function (c) { return /h264/i.test(c.mimeType); }) : null;
    } catch (e) {}
    var stun = (opts.stun || []).slice(0, 3);
    // One connection asking every STUN server: an easy NAT gives one public address (the browser merges repeats);
    // a symmetric NAT gives the same local socket a different public port per server.
    return gather(stun.length ? [{ urls: stun }] : [], 'all', 6000).then(function (g) {
      res.udp = g.cands.some(function (c) { return c.proto === 'udp' && c.type !== 'host'; });
      var srflx = g.cands.filter(function (c) { return c.type === 'srflx' && c.ip.indexOf(':') < 0; });
      res.stun = srflx.map(function (c) { return { ip: c.ip, port: c.port, rport: c.rport }; });
      res.publicIp = srflx.length ? srflx[0].ip : null;
      if (srflx.length && stun.length >= 2) {
        var bySocket = {};
        srflx.forEach(function (c) { var k = c.rport || 'x'; (bySocket[k] = bySocket[k] || {})[c.port] = 1; });
        res.symmetric = Object.keys(bySocket).some(function (k) { return Object.keys(bySocket[k]).length > 1; });
      }
      var relay = opts.relay || [];
      if (!relay.length) return;
      res.relay.tried = true;
      return gather(relay, 'relay', 7000).then(function (g) {
        var r = g.cands.filter(function (c) { return c.type === 'relay'; });
        res.relay.ok = r.length > 0;
        res.relay.proto = r.length ? r.map(function (c) { return c.proto; }).filter(function (p, i, a) { return a.indexOf(p) === i; }).join(' + ') : null;
      });
    }).then(function () { res.ms = Math.round(performance.now() - t0); return res; });
  };
})();
