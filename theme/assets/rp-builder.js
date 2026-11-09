/* rp-builder.js (moved unchanged from the JavaScript version's web/pages/_rp_builder.html.html)
 _rp_builder: the Parts tab's pieces (robot.html uses them).
     RP.CATALOG     the parts you can add, with sensible defaults for each brain (Pi / Pi + Arduino / browser)
     RP.partEditor  the form for one part; RP.readParts reads the forms back into a config
     RP.pinMap      the Raspberry Pi's 40-pin header with every used pin marked, plus a wiring list
     RP.sketch      the Arduino bridge sketch with its CONFIG block filled from the parts
     Field names match server_code/Parts.py (which validates) and robot/robopresence/parts.py (which runs them). */
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
    return '<article class="ui-card pb-part" data-part="' + i + '" data-type="' + t + '" data-id="' + esc(p.id) + '"><header><span class="pb-ic">' + UI.icon(cat.icon || RP.typeIcon(t, p.id)) + '</span>' +
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

/* RP.partsEditor(el, hooks): the Parts tab's list of part cards (Components/PartsList wraps it; the Forms page around
   it owns the brain, the camera, the catalog, "what the pilot gets", the wiring and Save). Added for the Forms version.
     ed.set(cfg)          draw cfg.parts for cfg.board (cfg is kept: the editor reads the cards back into cfg.parts)
     ed.read()            the cards read back -> cfg.parts (a JS array)
     ed.add(i)            add RP.CATALOG[i] at the end, scroll to it, focus its name
     ed.mark(problems)    outline the cards whose id is named in a problem
     hooks.changed()      after every edit (typing, a new driver, move, remove): the page re-checks and redraws its side */
(function () {
  'use strict';
  var RP = window.RP;
  RP.partsEditor = function (el, hooks) {
    var cfg = { board: 'pi', parts: [] };
    hooks = hooks || {};
    function changed() { if (hooks.changed) hooks.changed(); }
    function draw() {
      el.innerHTML = cfg.parts.length ? cfg.parts.map(function (p, i) { return RP.partEditor(p, cfg.board, i, cfg.parts.length); }).join('')
        : '<div class="ui-empty">' + UI.icon('wrench') + '<h3>No parts yet</h3><p>Add wheels, a pan-tilt head, lights… below.</p></div>';
    }
    function read() {
      var cards = el.querySelectorAll('[data-part]');
      cfg.parts = Array.prototype.map.call(cards, function (card, i) { return RP.readPart(card, cfg.parts[i]); });
      return cfg.parts;
    }
    el.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-remove]'), mv = e.target.closest('[data-move]');
      if (rm) { read(); cfg.parts.splice(+rm.closest('[data-part]').getAttribute('data-part'), 1); draw(); changed(); }
      else if (mv) {
        read();
        var i = +mv.closest('[data-part]').getAttribute('data-part'), j = i + (+mv.getAttribute('data-move'));
        var x = cfg.parts.splice(i, 1)[0]; cfg.parts.splice(j, 0, x); draw(); changed();
      }
    });
    el.addEventListener('input', function (e) {
      var card = e.target.closest('[data-part]');
      if (!card) return;
      if (e.target.getAttribute('data-f') === 'id') card.setAttribute('data-id', e.target.value.trim().toLowerCase());
      read(); changed();
    });
    el.addEventListener('change', function (e) {
      var f = e.target.getAttribute && e.target.getAttribute('data-f');
      if ((f === 'driver' || e.target.getAttribute('data-o') === 'ui') && e.target.closest('[data-part]')) {  // a new driver means new pin fields
        read();
        cfg.parts[+e.target.closest('[data-part]').getAttribute('data-part')].pins = {};
        draw(); changed();
      }
    });
    return {
      set: function (c) { cfg = c; cfg.parts = cfg.parts || []; draw(); },
      read: read,
      add: function (i) {
        read();
        cfg.parts.push(RP.newPart(RP.CATALOG[i], cfg.board, cfg.parts)); draw(); changed();
        var cards = el.querySelectorAll('[data-part]'), last = cards[cards.length - 1];
        if (last) { last.scrollIntoView({ block: 'center', behavior: 'smooth' }); var inp = last.querySelector('input[data-f=label]'); if (inp) inp.focus(); }
      },
      mark: function (problems) {
        el.querySelectorAll('[data-part]').forEach(function (card) {
          var pid = card.getAttribute('data-id');
          card.classList.toggle('bad', (problems || []).some(function (p) { return p.indexOf("'" + pid + "'") >= 0; }));
        });
      }
    };
  };
})();
/* Keep the parts when the brain changes: each part moves to a driver the new brain has (Forms version: Tabs/Parts). */
window.RP.moveToBoard = function (parts, nb) {
  (parts || []).forEach(function (p) {
    var ds = window.RP.driversFor(p.type, nb);
    if (ds.indexOf(p.driver) < 0) { p.driver = nb === 'pi_arduino' && ds.indexOf('arduino') >= 0 ? 'arduino' : ds[0]; p.pins = {}; }
  });
  return parts;
};
