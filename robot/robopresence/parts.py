"""Robot parts: one class per (type, driver). The website's Parts tab writes the config; the robot builds a part
for each entry, starts it, and reports what works in its manifest. The cockpit draws controls from that manifest.

Types (same names as server_code/Parts.py and the cockpit):
  drive     wheels: arcade mix of a joystick (x = turn, y = forward), ramped, stopped by the watchdog
  servo     an angle in degrees (min..max), slewed at `speed` degrees per second
  slider    any value min..max (PWM brightness, a claw, a winch)
  toggle    on / off
  button    held down while pressed (horn, buzzer), or a pulse of pulse_ms
  say       text to speech
  gauge     a number with a unit (CPU temperature, Wi-Fi, battery)
  distance  centimetres to the nearest thing ahead (can stop forward driving at stop_at cm)
  custom    a plugin: a Python file in robot/plugins or /etc/robopresence/plugins (see plugins/example_claw.py)

Add a driver:  @driver("servo", "mydriver") on a Part subclass. Hardware libraries are imported inside start(),
so the robot still runs (and reports the problem) when one is missing.
"""
import importlib.util
import logging
import os
import pathlib
import random
import shutil
import subprocess
import time

log = logging.getLogger("robopresence")
DRIVERS = {}
PLUGIN_DIRS = [pathlib.Path(__file__).resolve().parent.parent / "plugins", pathlib.Path("/etc/robopresence/plugins")]


def driver(type_, name):
    def deco(cls):
        cls.type = type_
        cls.driver = name
        DRIVERS[(type_, name)] = cls
        return cls
    return deco


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def num(v, default=0.0):
    try:
        f = float(v)
        return f if f == f else default
    except (TypeError, ValueError):
        return default


_FACTORY = {}


def pin_factory():
    """gpiozero's pin factory: pigpio when its daemon runs (steady servo pulses), else gpiozero's default (lgpio)."""
    if "f" in _FACTORY:
        return _FACTORY["f"]
    f = None
    try:
        from gpiozero.pins.pigpio import PiGPIOFactory
        f = PiGPIOFactory()
        log.info("Using pigpio for GPIO (steady servo pulses)")
    except Exception:
        f = None
    _FACTORY["f"] = f
    return f


class Part:
    type = "button"
    driver = "sim"
    kind = "control"

    def __init__(self, spec, robot):
        self.spec = spec
        self.id = spec["id"]
        self.robot = robot
        self.error = None
        self.value = None

    # life cycle
    def start(self):
        pass

    def close(self):
        pass

    # what the cockpit gets
    def describe(self):
        s = self.spec
        d = {"id": self.id, "type": self.type, "label": s.get("label") or self.id, "from": self.driver}
        if s.get("key"):
            d["key"] = s["key"]
        if self.error:
            d["error"] = self.error
        return d

    # commands (the robot core calls only the ones that fit the type)
    def set(self, value):
        pass

    def press(self, down):
        pass

    def say(self, text):
        pass

    def drive(self, x, y):
        pass

    def tick(self, dt):
        pass

    def read(self):
        return None

    def safe(self):
        """Stop moving (emergency stop, watchdog, pilot left)."""

    def home(self):
        pass

    def state(self):
        return self.value


# ------------------------------------------------------------------------------------------- wheels
class DriveBase(Part):
    type = "drive"
    ACCEL = 3.5  # full speed change per second

    def __init__(self, spec, robot):
        Part.__init__(self, spec, robot)
        self.target = (0.0, 0.0)
        self.left = self.right = 0.0
        self.blocked = False
        self.value = {"l": 0, "r": 0}

    def describe(self):
        d = Part.describe(self)
        d["max_speed"] = self.spec.get("max_speed", 0.8)
        return d

    def drive(self, x, y):
        self.target = (clamp(num(x), -1, 1), clamp(num(y), -1, 1))

    def safe(self):
        self.target = (0.0, 0.0)
        self.left = self.right = 0.0
        self._out(0.0, 0.0)

    def mix(self):
        x, y = self.target
        top = clamp(num(self.spec.get("max_speed"), 0.8), 0.1, 1.0)
        turn = clamp(num(self.spec.get("turn"), 0.7), 0.2, 1.0)
        left, right = y + x * turn, y - x * turn
        m = max(1.0, abs(left), abs(right))
        left, right = left / m * top, right / m * top
        trim = clamp(num(self.spec.get("trim")), -0.3, 0.3)
        if trim > 0:
            right *= 1 - trim
        elif trim < 0:
            left *= 1 + trim
        return left, right

    def tick(self, dt):
        left, right = self.mix()
        fwd = (left + right) / 2
        was = self.blocked
        self.blocked = fwd > 0.02 and self.robot.forward_limit()
        if self.blocked:  # something close ahead: keep turning and reversing, take away the forward part
            left, right = left - fwd, right - fwd
            if not was:
                self.robot.note("warn", "%s: something close ahead, forward drive paused." % self.robot.distance_label())
        step = self.ACCEL * dt
        self.left += clamp(left - self.left, -step, step)
        self.right += clamp(right - self.right, -step, step)
        if abs(self.left) < 0.02 and left == 0:
            self.left = 0.0
        if abs(self.right) < 0.02 and right == 0:
            self.right = 0.0
        out_l = -self.left if self.spec.get("invert_left") else self.left
        out_r = -self.right if self.spec.get("invert_right") else self.right
        self.value = {"l": round(self.left, 2), "r": round(self.right, 2)}
        self._out(out_l, out_r)

    def _out(self, left, right):
        pass


@driver("drive", "sim")
class DriveSim(DriveBase):
    pass


class _GpioMotors(DriveBase):
    ENABLE = True

    def start(self):
        from gpiozero import Motor, OutputDevice
        p = self.spec.get("pins") or {}
        f = pin_factory()
        kw = {"pin_factory": f} if f else {}
        if self.ENABLE:
            self.m_l = Motor(p["left_in1"], p["left_in2"], enable=p["left_pwm"], pwm=True, **kw)
            self.m_r = Motor(p["right_in1"], p["right_in2"], enable=p["right_pwm"], pwm=True, **kw)
        else:
            self.m_l = Motor(p["left_in1"], p["left_in2"], pwm=True, **kw)
            self.m_r = Motor(p["right_in1"], p["right_in2"], pwm=True, **kw)
        self.stby = OutputDevice(p["standby"], initial_value=True, **kw) if p.get("standby") is not None else None
        self._last = (None, None)

    def _out(self, left, right):
        if not hasattr(self, "m_l"):
            return
        q = (round(left, 2), round(right, 2))
        if q == self._last:
            return
        self._last = q
        self.m_l.value, self.m_r.value = q

    def close(self):
        for m in ("m_l", "m_r", "stby"):
            dev = getattr(self, m, None)
            if dev is not None:
                try:
                    dev.close()
                except Exception:
                    pass


@driver("drive", "tb6612")
class DriveTB6612(_GpioMotors):
    pass


@driver("drive", "l298n")
class DriveL298N(_GpioMotors):
    pass


@driver("drive", "drv8833")
class DriveDRV8833(_GpioMotors):
    ENABLE = False


@driver("drive", "arduino")
class DriveArduino(DriveBase):
    def start(self):
        self.robot.need_arduino(self)
        self._last, self._sent = None, 0.0

    def _out(self, left, right):
        q = (int(round(left * 100)), int(round(right * 100)))
        now = time.monotonic()
        # resend every 0.25 s while moving, so the Arduino's own watchdog keeps the motors on
        if q != self._last or (q != (0, 0) and now - self._sent > 0.25):
            self._last, self._sent = q, now
            self.robot.arduino_send("D %d %d" % q)


# ------------------------------------------------------------------------------------------- servos + sliders
class Positioner(Part):
    """A value that moves smoothly to its target (servos, sliders)."""
    UNIT = "°"

    def __init__(self, spec, robot):
        Part.__init__(self, spec, robot)
        self.lo, self.hi = num(spec.get("min"), -80), num(spec.get("max"), 80)
        self.home_v = clamp(num(spec.get("home")), self.lo, self.hi)
        self.target = self.value = self.home_v
        self._written = None

    def describe(self):
        d = Part.describe(self)
        d.update(min=self.lo, max=self.hi, home=self.home_v, unit=self.spec.get("unit") or self.UNIT)
        if self.spec.get("group"):
            d["group"] = self.spec["group"]
        if self.spec.get("axis"):
            d["axis"] = self.spec["axis"]
        return d

    def set(self, value):
        self.target = clamp(num(value, self.target), self.lo, self.hi)

    def home(self):
        self.target = self.home_v

    def tick(self, dt):
        speed = num(self.spec.get("speed"), 240)
        step = speed * dt if speed > 0 else 1e9
        self.value += clamp(self.target - self.value, -step, step)
        if self._written is None or abs(self.value - self._written) >= 0.25:
            self._written = self.value
            self.write(self.value)

    def write(self, v):
        pass


@driver("servo", "sim")
class ServoSim(Positioner):
    pass


@driver("servo", "gpio")
class ServoGpio(Positioner):
    def start(self):
        from gpiozero import AngularServo
        f = pin_factory()
        kw = {"pin_factory": f} if f else {}
        self.dev = AngularServo(self.spec["pins"]["pin"], min_angle=-90, max_angle=90, initial_angle=self._phys(self.home_v),
                                min_pulse_width=num(self.spec.get("pulse_min"), 0.5) / 1000.0,
                                max_pulse_width=num(self.spec.get("pulse_max"), 2.5) / 1000.0, **kw)

    def _phys(self, v):
        return clamp(-v if self.spec.get("invert") else v, -90, 90)

    def write(self, v):
        if getattr(self, "dev", None) is not None:
            self.dev.angle = self._phys(v)

    def close(self):
        if getattr(self, "dev", None) is not None:
            self.dev.close()


class PCA9685:
    """Just enough of the PCA9685 16-channel PWM chip (pan-tilt HATs) for servos at 50 Hz, over smbus2."""
    _cache = {}

    @classmethod
    def get(cls, address, bus=1):
        key = (bus, address)
        if key not in cls._cache:
            cls._cache[key] = cls(address, bus)
        return cls._cache[key]

    def __init__(self, address, bus=1):
        from smbus2 import SMBus
        self.bus, self.addr = SMBus(bus), address
        self.bus.write_byte_data(self.addr, 0x00, 0x10)            # MODE1: sleep
        self.bus.write_byte_data(self.addr, 0xFE, 121)             # prescale for 50 Hz (25 MHz / (4096 * 50) - 1)
        self.bus.write_byte_data(self.addr, 0x00, 0x20)            # MODE1: wake, auto-increment
        time.sleep(0.005)

    def pulse_ms(self, channel, ms):
        ticks = int(clamp(ms, 0, 20) / 20.0 * 4096)
        reg = 0x06 + 4 * channel
        self.bus.write_i2c_block_data(self.addr, reg, [0, 0, ticks & 0xFF, ticks >> 8])


@driver("servo", "pca9685")
class ServoPCA9685(Positioner):
    def start(self):
        self.chip = PCA9685.get(int(self.spec.get("address", 0x40)))
        self.write(self.home_v)

    def write(self, v):
        if getattr(self, "chip", None) is None:
            return
        v = -v if self.spec.get("invert") else v
        lo, hi = num(self.spec.get("pulse_min"), 0.5), num(self.spec.get("pulse_max"), 2.5)
        self.chip.pulse_ms(int(self.spec.get("channel", 0)), lo + (clamp(v, -90, 90) + 90) / 180.0 * (hi - lo))


@driver("servo", "arduino")
class ServoArduino(Positioner):
    def start(self):
        self.robot.need_arduino(self)

    def write(self, v):
        self.robot.arduino_send("S %s %d" % (self.id, round(-v if self.spec.get("invert") else v)))


@driver("slider", "sim")
class SliderSim(Positioner):
    UNIT = "%"


@driver("slider", "pwm")
class SliderPwm(Positioner):
    UNIT = "%"

    def start(self):
        from gpiozero import PWMOutputDevice
        f = pin_factory()
        self.dev = PWMOutputDevice(self.spec["pins"]["pin"], **({"pin_factory": f} if f else {}))

    def write(self, v):
        if getattr(self, "dev", None) is not None:
            self.dev.value = clamp((v - self.lo) / ((self.hi - self.lo) or 1), 0, 1)

    def close(self):
        if getattr(self, "dev", None) is not None:
            self.dev.close()


@driver("slider", "arduino")
class SliderArduino(Positioner):
    UNIT = "%"

    def start(self):
        self.robot.need_arduino(self)

    def write(self, v):
        self.robot.arduino_send("S %s %d" % (self.id, round(v)))


# ------------------------------------------------------------------------------------------- switches and buttons
class Switch(Part):
    def __init__(self, spec, robot):
        Part.__init__(self, spec, robot)
        self.value = False
        self._pulse_until = 0

    def set(self, value):
        self.value = bool(value)
        self.write(self.value)

    def press(self, down):
        self.value = bool(down)
        pulse = num(self.spec.get("pulse_ms"))
        if down and pulse > 0:
            self._pulse_until = time.monotonic() + pulse / 1000.0
        elif pulse > 0:
            return  # a pulse button ends by itself
        self.write(self.value)

    def tick(self, dt):
        if self._pulse_until and time.monotonic() >= self._pulse_until:
            self._pulse_until = 0
            self.value = False
            self.write(False)

    def safe(self):
        if self.type == "button" and self.value:
            self.value = False
            self.write(False)

    def write(self, on):
        pass


class _GpioSwitch(Switch):
    def start(self):
        from gpiozero import OutputDevice
        f = pin_factory()
        self.dev = OutputDevice(self.spec["pins"]["pin"], active_high=not self.spec.get("active_low"), initial_value=False,
                                **({"pin_factory": f} if f else {}))

    def write(self, on):
        if getattr(self, "dev", None) is not None:
            self.dev.value = 1 if on else 0

    def close(self):
        if getattr(self, "dev", None) is not None:
            self.dev.close()


class _ArduinoSwitch(Switch):
    LETTER = "T"

    def start(self):
        self.robot.need_arduino(self)

    def write(self, on):
        self.robot.arduino_send("%s %s %d" % (self.LETTER, self.id, 1 if on else 0))


@driver("toggle", "sim")
class ToggleSim(Switch):
    pass


@driver("toggle", "gpio")
class ToggleGpio(_GpioSwitch):
    pass


@driver("toggle", "arduino")
class ToggleArduino(_ArduinoSwitch):
    LETTER = "T"


@driver("button", "sim")
class ButtonSim(Switch):
    pass


@driver("button", "gpio")
class ButtonGpio(_GpioSwitch):
    pass


@driver("button", "arduino")
class ButtonArduino(_ArduinoSwitch):
    LETTER = "B"


# ------------------------------------------------------------------------------------------- voice
class Voice(Part):
    def describe(self):
        d = Part.describe(self)
        d["phrases"] = self.spec.get("phrases") or []
        return d

    def say(self, text):
        text = " ".join(str(text or "").split())[:200]
        if text:
            self.value = text
            self.speak(text)

    def speak(self, text):
        log.info("[%s] says: %s", self.id, text)


@driver("say", "sim")
class VoiceSim(Voice):
    pass


@driver("say", "espeak")
class VoiceEspeak(Voice):
    def start(self):
        self.exe = shutil.which("espeak-ng") or shutil.which("espeak")
        if not self.exe:
            raise RuntimeError("espeak-ng isn't installed (sudo apt install espeak-ng)")
        self.proc = None

    def speak(self, text):
        if self.proc is not None and self.proc.poll() is None:
            self.proc.kill()
        self.proc = subprocess.Popen([self.exe, "-v", self.spec.get("voice") or "en", "-s", "150", text],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# ------------------------------------------------------------------------------------------- sensors
class Sensor(Part):
    kind = "sensor"
    UNIT = ""

    def describe(self):
        d = Part.describe(self)
        s = self.spec
        if self.type == "distance":
            d.update(unit="cm", max=s.get("max", 200), warn=s.get("warn", 25))
        else:
            d.update(unit=s.get("unit") or self.UNIT, min=s.get("min", 0), max=s.get("max", 100), warn=s.get("warn"),
                     low_is_bad=bool(s.get("low_is_bad")))
        return d


@driver("gauge", "cpu_temp")
class CpuTemp(Sensor):
    UNIT = "°C"
    PATH = "/sys/class/thermal/thermal_zone0/temp"

    def start(self):
        if not os.path.exists(self.PATH):
            raise RuntimeError("no CPU temperature on this computer")

    def read(self):
        try:
            with open(self.PATH) as f:
                return round(int(f.read().strip()) / 1000.0, 1)
        except (OSError, ValueError):
            return None


@driver("gauge", "wifi")
class WifiSignal(Sensor):
    UNIT = "%"

    def start(self):
        if not os.path.exists("/proc/net/wireless"):
            raise RuntimeError("no Wi-Fi information on this computer")

    def read(self):
        try:
            with open("/proc/net/wireless") as f:
                for line in f.read().splitlines()[2:]:
                    parts = line.split()
                    if len(parts) > 2:
                        return round(clamp(float(parts[2].rstrip(".")) / 70.0 * 100, 0, 100))
        except (OSError, ValueError):
            pass
        return None


@driver("distance", "hcsr04")
class Sonar(Sensor):
    def start(self):
        from gpiozero import DistanceSensor
        p = self.spec["pins"]
        f = pin_factory()
        self.dev = DistanceSensor(echo=p["echo"], trigger=p["trigger"], max_distance=num(self.spec.get("max"), 200) / 100.0,
                                  **({"pin_factory": f} if f else {}))

    def read(self):
        try:
            return round(self.dev.distance * 100, 1)
        except Exception:
            return None

    def close(self):
        if getattr(self, "dev", None) is not None:
            self.dev.close()


@driver("gauge", "arduino")
class ArduinoGauge(Sensor):
    def start(self):
        self.robot.need_arduino(self)

    def read(self):
        return self.robot.arduino_value(self.id)


@driver("distance", "arduino")
class ArduinoDistance(ArduinoGauge):
    pass


@driver("gauge", "sim")
class SimGauge(Sensor):
    """A made-up reading: a slowly draining battery for volts, else a value wandering around 40 % of the range."""

    def start(self):
        self.lo, self.hi = num(self.spec.get("min"), 0), num(self.spec.get("max"), 100)
        self.battery = (self.spec.get("unit") or "") == "V"
        self.v = self.hi - 0.2 if self.battery else self.lo + 0.4 * (self.hi - self.lo)

    def read(self):
        if self.battery:
            self.v = max(self.lo, self.v - 0.0004)
            return round(self.v + random.uniform(-0.01, 0.01), 2)
        span = self.hi - self.lo
        self.v = clamp(self.v + random.uniform(-0.02, 0.02) * span, self.lo + 0.2 * span, self.hi - 0.3 * span)
        return round(self.v, 1)


@driver("distance", "sim")
class SimDistance(Sensor):
    def start(self):
        self.v = 120.0

    def read(self):
        drive = self.robot.part_of_type("drive")
        fwd = (drive.left + drive.right) / 2 if drive is not None else 0
        self.v = clamp(self.v - fwd * 8 + random.uniform(-3, 3) + (4 if self.v < 40 and fwd <= 0 else 0), 8,
                       num(self.spec.get("max"), 200))
        return round(self.v, 1)


# ------------------------------------------------------------------------------------------- plugins
def load_plugin(name):
    for d in PLUGIN_DIRS:
        f = d / (name + ".py")
        if f.is_file():
            spec = importlib.util.spec_from_file_location("rp_plugin_" + name, f)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    raise RuntimeError("plugin '%s' not found (put %s.py in %s)" % (name, name, PLUGIN_DIRS[-1]))


class _Missing(Part):
    def __init__(self, spec, robot, why):
        Part.__init__(self, spec, robot)
        self.error = why


def make(spec, robot, sim=False):
    """The Part for one config entry (never raises: a broken part reports its error instead)."""
    typ, drv = spec.get("type"), spec.get("driver")
    if typ == "custom":
        o = spec.get("options") or {}
        try:
            mod = load_plugin(o.get("plugin") or "")
            part = mod.make(spec, robot) if hasattr(mod, "make") else mod.Part(spec, robot)
            part.type = o.get("ui") or getattr(part, "type", "button")
            return part
        except Exception as e:
            p = _Missing(spec, robot, str(e)[:150])
            p.type = o.get("ui") or "button"
            return p
    if sim and (typ, "sim") in DRIVERS:
        drv = "sim"
    cls = DRIVERS.get((typ, drv))
    if cls is None:
        p = _Missing(spec, robot, "this robot code has no '%s' driver for %s parts (update it: sudo robopresence update)" % (drv, typ))
        p.type = typ if typ else "button"
        return p
    return cls(spec, robot)
