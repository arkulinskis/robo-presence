"""Talking to an Arduino that runs robot/arduino/robopresence_bridge (USB serial, 115200 baud, one line per message).

Pi -> Arduino                         Arduino -> Pi
  ?              who are you?           RP1 HELLO name=<name> fw=<version>
                                        PART id=pan type=servo min=-80 max=80 home=0   (one line per part)
                                        END
  D <l> <r>      wheels, -100..100      (the Arduino stops the wheels by itself after 700 ms without a D)
  S <id> <v>     servo degrees / slider value
  T <id> 0|1     switch
  B <id> 0|1     button down / up
  X              stop everything
  R              read sensors           V battery=7.42 distance=54.0
Lines starting with # are logs from the Arduino.
"""
import glob
import logging
import threading
import time

log = logging.getLogger("robopresence")


def find_port():
    for pattern in ("/dev/ttyACM*", "/dev/ttyUSB*", "/dev/serial/by-id/*"):
        found = sorted(glob.glob(pattern))
        if found:
            return found[0]
    return None


class Arduino:
    def __init__(self, port="auto", baud=115200):
        import serial  # pyserial
        self.port = find_port() if port in (None, "", "auto") else port
        if not self.port:
            raise RuntimeError("no Arduino found on USB (looked for /dev/ttyACM* and /dev/ttyUSB*)")
        self.ser = serial.Serial(self.port, baud, timeout=0.2)
        self.lock = threading.Lock()
        self.values = {}
        self.parts = []
        self.name = ""
        self._hello = None
        self.alive = True
        time.sleep(2.0)  # most Arduinos reset when the port opens
        self.thread = threading.Thread(target=self._reader, daemon=True)
        self.thread.start()
        self.hello()

    def send(self, line):
        try:
            with self.lock:
                self.ser.write((line.strip() + "\n").encode("ascii", "replace"))
        except Exception as e:
            log.warning("Arduino write failed: %s", e)

    def hello(self, timeout=3.0):
        self._hello = []
        self.send("?")
        end = time.time() + timeout
        while time.time() < end and self._hello is not None:
            time.sleep(0.05)
        if self._hello is not None:
            self._hello = None
            raise RuntimeError("the Arduino on %s didn't answer. Is the Robo Presence bridge sketch uploaded?" % self.port)
        return self.parts

    def _reader(self):
        buf = b""
        last_read = 0.0
        while self.alive:
            try:
                chunk = self.ser.read(256)
            except Exception as e:
                log.warning("Arduino read failed: %s", e)
                time.sleep(1)
                continue
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                self._line(line.decode("ascii", "replace").strip())
            if time.time() - last_read > 1.0:
                last_read = time.time()
                self.send("R")

    def _line(self, line):
        if not line:
            return
        if line.startswith("#"):
            log.info("Arduino: %s", line[1:].strip())
            return
        words = line.split()
        if line.startswith("RP1 HELLO"):
            kv = dict(w.split("=", 1) for w in words[2:] if "=" in w)
            self.name = kv.get("name", "")
            if self._hello is not None:
                self._hello = []
        elif words[0] == "PART" and self._hello is not None:
            kv = dict(w.split("=", 1) for w in words[1:] if "=" in w)
            for k in ("min", "max", "home"):
                if k in kv:
                    try:
                        kv[k] = float(kv[k])
                    except ValueError:
                        kv.pop(k)
            self._hello.append(kv)
        elif words[0] == "END" and self._hello is not None:
            self.parts = self._hello
            self._hello = None
        elif words[0] == "V":
            for w in words[1:]:
                if "=" in w:
                    k, v = w.split("=", 1)
                    try:
                        self.values[k] = float(v)
                    except ValueError:
                        self.values[k] = v

    def close(self):
        self.alive = False
        try:
            self.send("X")
            self.ser.close()
        except Exception:
            pass
