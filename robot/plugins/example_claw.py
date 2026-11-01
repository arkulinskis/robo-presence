"""Example plugin: a claw on a servo, as a template for any new part the website doesn't know yet.

1. Copy this file to /etc/robopresence/plugins/my_claw.py on the robot (or keep it here as example_claw).
2. Website -> your robot -> Parts -> Add a part -> "Plugin part": id claw, control Slider, plugin my_claw,
   settings "pin=22 open=10 closed=95". Save.
3. The robot reloads its parts within a second or two, and the cockpit shows a "Claw" slider.

A plugin module either defines make(spec, robot) or a class called Part. Subclass a base from robopresence.parts:
  Positioner  (a value that moves smoothly to a target: override write(v))
  Switch      (on/off or held button: override write(on))
  Sensor      (override read() -> number)
  Part        (anything: override set / press / say / tick / read / safe)
spec["options"]["settings"] is the free text from the website; spec["options"]["ui"] is the control the cockpit draws.
"""
from robopresence import parts as P


def settings(spec):
    text = (spec.get("options") or {}).get("settings") or ""
    return dict(kv.split("=", 1) for kv in text.split() if "=" in kv)


class Claw(P.Positioner):
    UNIT = "%"

    def start(self):
        s = settings(self.spec)
        self.pin = int(s.get("pin", 22))
        self.open_deg, self.closed_deg = float(s.get("open", 10)), float(s.get("closed", 95))
        from gpiozero import AngularServo
        self.servo = AngularServo(self.pin, min_angle=0, max_angle=180)

    def write(self, v):
        # 0 % = open, 100 % = closed
        if getattr(self, "servo", None) is not None:
            self.servo.angle = self.open_deg + (self.closed_deg - self.open_deg) * P.clamp(v, 0, 100) / 100.0

    def close(self):
        if getattr(self, "servo", None) is not None:
            self.servo.close()


def make(spec, robot):
    o = spec.get("options") or {}
    spec = dict(spec, min=o.get("min", 0), max=o.get("max", 100), home=o.get("min", 0), unit="%")
    return Claw(spec, robot)
