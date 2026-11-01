# Robo Presence robot code

The program that runs on the robot (a Raspberry Pi, optionally with an Arduino), streams its camera and obeys the
cockpit in the Robo Presence website over WebRTC.

## Install

Make a robot in the website's garage, open its **Install** tab and paste the one-line command on the Pi:

```
curl -fsSL 'https://<the app>/_/api/install?c=ABCD2345' | sudo bash
```

By hand from this folder: `sudo bash install.sh --server https://<the app>/_/api --code ABCD-2345`.
Raspberry Pi OS Bookworm or newer, 64-bit recommended. Afterwards: `robopresence status | logs | restart | stop | test [--wheels] | info | update | pair CODE`.

## What's here

| Path | What |
|---|---|
| `install.sh` | installs packages, a venv with aiortc, this code (`/opt/robopresence/robot`), pairs, starts the `robopresence` service |
| `robopresence/__main__.py` | `claim`, `run [--sim]`, `test [--wheels]`, `info` |
| `robopresence/robot.py` | the core: parts from the config, the cockpit's messages, driver's seat, watchdog, 50 Hz loop, telemetry |
| `robopresence/parts.py` | one class per part type and driver (gpiozero, PCA9685, Arduino, espeak, sensors, sim) + plugins |
| `robopresence/peer.py` | one pilot's WebRTC connection (aiortc answerer, H.264 preferred) |
| `robopresence/camera.py` | picamera2, USB (V4L2) or a test pattern that draws the robot's state |
| `robopresence/arduino.py` | the USB serial protocol with the bridge sketch |
| `robopresence/api.py` | the calls to the website (`/bot/claim`, `/bot/hello`, `/bot/poll`, `/bot/answer`, `/bot/event`) |
| `arduino/robopresence_bridge/` | the Arduino sketch; the website fills in its CONFIG block |
| `plugins/example_claw.py` | how to add a part the code doesn't know yet |

## Try it without a robot

On any computer with Python 3.10+: `pip install aiortc numpy`, pair with a code
(`python -m robopresence --config ./robot.json claim --server https://<the app>/_/api --code ABCD-2345`), then
`python -m robopresence --config ./robot.json run --sim` (run from this folder). The robot comes online with simulated
parts and a test-pattern camera, and you can drive it from the website.

## Safety

The wheels stop when no drive command arrives for 500 ms (configurable), when the driver disconnects, and on STOP.
The Arduino sketch stops them again after 700 ms without a command. Give motors and servos their own power, join the
grounds, and lift the robot before `robopresence test --wheels`.
