# Robo Presence

Build a home-made camera robot on wheels (Raspberry Pi, Pi + Arduino, or an old phone), install its brain with one
command, and drive it live from any browser: low-latency WebRTC video, a joystick, a pan-tilt head, and controls that
adapt to whatever parts the robot reports. For makers, and for families who want a robot to visit through. The look is a
garage-built 80s robot: khaki and olive, safety-orange keys, stencil headings. Built on [Anvil](https://anvil.works).

- **App repo:** github.com/arkulinskis/robo-presence (branch `master`). Anvil pulls `master`.
- **Live:** https://robo-presence.anvil.app
- **Robot code:** [`robot/`](robot/) in this repo (Python + aiortc, the installer, the Arduino sketch, a plugin example).

## How it works

```
pilot's browser ──1 offer──▶ Anvil (accounts + introductions) ◀──2 poll / 3 answer── robot (Pi: robot/robopresence)
       ◀════════════ 4 peer to peer (WebRTC): video → pilot, controls → robot, 50–200 ms ════════════▶
```
The robot checks in over HTTPS every 0.6–2.5 s (`/_/api/bot/poll`), so no router ports are opened. The browser's
offer and the robot's answer are complete SDPs (no trickle ICE), so Anvil carries exactly one of each per drive. Anvil
never sees the video or the controls. STUN (Google's by default) finds a direct path; admins can add TURN in Admin → Network.

## What it does

**For everyone (no account):**
- **Landing page** with the promise, how it works, a live "manifest → controls" explainer, features, FAQ.
- **Simulator** (`#drive`): the real cockpit driving a virtual robot in a small 3D garage drawn on a canvas: wheels,
  pan/tilt camera, headlights, horn, voice (browser speech), sonar, battery, bumps, a ball to push, and five lost bolts to find.
- **Build guide** (`#guide`): shopping list, power and wiring, Pi setup, install, Arduino, adding new parts (types,
  plugins, Arduino-reported parts), how the connection works, the protocol, troubleshooting.
- **Guest passes** (`#drive/pass/<token>`): drive or watch someone's robot without an account until the pass runs out.

**For members:**
- **Garage** (`#garage`): your robots, robots shared with you, the simulator, and the Showroom (three demo robots with
  their own parts; "driving" one runs the simulator with those parts). New robot: name, brain (Pi / Pi + Arduino /
  phone or laptop), paint.
- **Robot page** (`#robot/<id>/<tab>`):
  - *Overview*: live status lamp, what the robot reports (or what its parts describe while offline), live sensor
    gauges, facts (model, code version, host, local IP, camera), name/paint/notes, unpair, delete.
  - *Parts*: the builder. Brain, camera (source, size, fps, codec, flip, mic), every part with its driver, pins and
    options (wheels with speed/turn/trim/invert, servos with limits/home/speed/head axis, sliders, switches, hold
    buttons, voice with quick phrases, gauges, sonar with "pause forward under", plugin parts), add from a catalogue,
    reorder, live validation (duplicate pins, unknown pins…), "what the pilot gets", the Pi 40-pin header map and an
    Arduino pin list. Saved parts reach a running robot within seconds; the cockpit redraws mid-drive.
  - *Install*: Raspberry Pi Imager settings, ssh, the one-line installer with a one-time code (24 h) and a live
    "waiting for the robot to call in" lamp, the Arduino bridge sketch with its CONFIG block generated from the parts
    (copy / download .ino), wiring + `robopresence test`.
  - *Sharing*: invite pilots (drive) and viewers (watch) by email; guest-pass links (1 h to 1 week, shown once, revocable;
    revoking disconnects the guest).
  - *Log*: drives (who, when, how long, round trip, fps, kbps) and the robot's event log (online, offline, paired, parts,
    emergency stops, watchdog stops, obstacle pauses).
- **Cockpit** (`#drive/<id>`): full-screen video with a HUD (pan and tilt scales, reticle, wheel bars, sonar warning,
  battery/CPU/Wi-Fi), drive joystick + look pad (touch and mouse), drag the picture to look, double-click to centre,
  WASD / arrows / Space (STOP) / H / 1-2-3 gears / part keys, gamepad (sticks, A/B/X/Y, bumpers), three gears, STOP,
  controls generated from the manifest (unknown part types get a fallback card), mission log, live RTT / fps / kbps /
  P2P-or-relay, snapshots (PNG), clip recording (MP4/WebM), full screen, driver's seat ("Take the wheel").
- **Robot mode** (`#bot/<id>`): this browser tab becomes the robot (an old phone or laptop on the chassis): camera =
  the device's front/back camera or the simulated garage; parts simulated or run by an Arduino over Web Serial; keeps the
  screen awake; answers pilots over WebRTC exactly like a Pi.

**For admins** (`#admin`; arkulinskis@gmail.com becomes an admin on first sign-in):
- **Overview:** people, robots, online now, drives this week, new feedback.
- **Robots:** every robot with owner, status, brain, parts and drives (never camera access).
- **Network:** the ICE servers (STUN/TURN) sent to pilots and robots, robot check-in speeds, the robot code download URL.
- **Feedback inbox**, **Users** (make admin, disable), **Demo data** (load / remove the showroom).

Feedback goes through Prepsto ("Submit feedback" in the footer and menu). Privacy & Terms: footer link, `#legal`.

## The robot side

`robot/` is copied into the repo as it is; the installer downloads it from GitHub.
- `curl -fsSL '<app>/_/api/install?c=CODE' | sudo bash` → `BotApi.install_script` returns a bootstrap that downloads the
  repo tarball and runs `robot/install.sh`: apt packages (picamera2, gpiozero, lgpio, pyserial, smbus2, espeak-ng, pigpio
  on Pi ≤4), a venv in `/opt/robopresence/venv` with aiortc, the code in `/opt/robopresence/robot`, `robopresence claim`
  (token in `/etc/robopresence/robot.json`, mode 600), a systemd service, and the `robopresence` helper command
  (`status | logs | restart | stop | test [--wheels] | info | update | pair CODE`).
- `robopresence run`: hello → poll loop → answers offers with aiortc (camera via picamera2, V4L2 or a test pattern,
  shared through MediaRelay, H.264 preferred), parts from the website's config (cached in `hardware.json`), 50 Hz control
  loop with ramping, servo slewing, the 500 ms watchdog, obstacle pause, driver's seat, 1 Hz telemetry.
- `robot/arduino/robopresence_bridge/robopresence_bridge.ino`: the USB serial bridge (`?`, `D`, `S`, `T`, `B`, `X`, `R`),
  its own 700 ms wheel watchdog, and a CONFIG block the website fills in.
- `robot/plugins/example_claw.py`: how to add a part the code doesn't know.

## Setting it up in Anvil (once)

1. In the Anvil editor: **Create app → Clone from GitHub**, and paste `https://github.com/arkulinskis/robo-presence`.
2. **Users** service: email + password and "Continue with Google", sign-up allowed (already set in `anvil.yaml`; check it).
3. Open the app in the editor. If it shows a **Schema Mismatch** alert, choose **"The schema of the source code is correct"** so Anvil creates the tables.
4. **Run** it and sign up with **arkulinskis@gmail.com** straight away (that account becomes the admin).
5. **Publish** (Publish → public URL, or your own domain).

<!-- libraries:start -->
## Libraries and outside services

What this project uses besides its own code. Generated by `APP_MAKER/tools/libraries.py`; to change it, edit `APP_MAKER/libraries/catalog.py` and re-run the script.

| Name | How it gets in | Used here for |
|---|---|---|
| [Google Fonts](https://fonts.google.com) | Loaded from a CDN | IBM Plex Mono, IBM Plex Sans, Saira Stencil One |
| [aiortc](https://github.com/aiortc/aiortc) | Python package | the robot program (robot/robopresence): camera stream + controls over WebRTC |
| [gpiozero](https://gpiozero.readthedocs.io) | Python package | wheels (TB6612/L298N/DRV8833), servos, switches, buttons, HC-SR04 sonar |
| [picamera2](https://github.com/raspberrypi/picamera2) | Python package | the Raspberry Pi camera on the robot |
| [PyAV](https://pyav.basswood-io.com) | Python package | camera frames (picamera2 and the test pattern) for aiortc |
| [pyserial](https://github.com/pyserial/pyserial) | Python package | the Pi talks to the robopresence_bridge Arduino sketch |
| [smbus2](https://github.com/kplindegaard/smbus2) | Python package | PCA9685 servo boards (pan-tilt HATs) |
| [NumPy](https://numpy.org) | Python package | Fast number arrays for Python. |

**Built into the browser:** Canvas 2D, Speech synthesis, Web Audio API, Camera, microphone and screen, MediaRecorder, WebRTC, Screen Wake Lock, localStorage, Clipboard, File downloads (Blob), Fullscreen.

**Anvil platform:** Anvil, Anvil Data Tables, Anvil JS bridge (anvil.js), Anvil Users.

**Build and test tools (not shipped):** Node.js, PyYAML, Headless Chrome (DevTools Protocol).

<!-- libraries:end -->

## Working on it

See `.claude/skills/robopresence/SKILL.md`. In short:

```
python -I tools/check.py --ui                    # syntax, server tests, headless UI tests (incl. a real WebRTC drive) → ALL CHECKS PASSED
python -I tools/preview/devserver.py 8765        # the app on in-memory data: http://localhost:8765/  (?as=ana#garage, ?as=admin#admin)
BOT_PYTHON=<python with aiortc+numpy> python -I tools/testing/bot_e2e.py 8765   # the real Python robot over WebRTC
python tools/deploy.py                           # dry run (needs PyYAML, so no -I)
python tools/deploy.py --push "Message"          # deploy: commit + push to GitHub, Anvil pulls it
```

## Project layout

```
web/            the interface: core.js/core.css (engine + tokens), app.js (header, footer), pages/*.html
  pages/_rp*.html   shared: _rp (icons, robot art, manifests), _rp_sim (RobotCore, SimWorld, simulator link),
                    _rp_link (WebRTC pilot + browser robot host), _rp_cockpit (the cockpit), _rp_builder (parts builder)
client_code/    Main.py (the only Anvil form: bridge to the server, sign-in), legal.py
server_code/    Parts.py (part types, presets, validation, manifests), Robots.py, Sharing.py, Drive.py (signalling),
                BotApi.py (the robot's HTTP API + installer), DemoData.py, Admin.py, common.py, Accounts.py, Feedback.py
robot/          the robot program, installer, Arduino sketch, plugins (copied to the repo as is)
assets/         icon.svg + generated PNG icons (served at _/theme/<name>); the sketch is also served as robopresence_bridge.ino.txt
tools/          sync_to_anvil.py (settings + table schema), deploy.py, check.py, preview/ (dev server, UI tests, screenshots),
                testing/ (server tests, bot_e2e.py)
```
