/* rp-link.js (moved unchanged from the JavaScript version's web/pages/_rp_link.html.html)
 _rp_link: WebRTC.
     RP.connectLive  the pilot's side: offer (video in, two data channels out) -> server -> robot -> answer -> peer to peer.
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
