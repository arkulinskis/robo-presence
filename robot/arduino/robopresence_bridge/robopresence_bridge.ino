// Robo Presence bridge for Arduino (Uno, Nano, Mega, Leonardo...). Upload it with the Arduino IDE.
// The Raspberry Pi on the robot talks to it over USB at 115200 baud and the Arduino runs the motors, servos,
// switches and sensors. When the Pi asks "?", the Arduino lists its parts, so the website's cockpit adjusts.
// Protocol: robot/robopresence/arduino.py.  Safety: the wheels stop by themselves 700 ms after the last command.
//
// The robot's Install tab on the website fills in the CONFIG block from the Parts tab. You can also edit it here.
// Every list ends with a {NULL, ...} line: keep it. Pins are Arduino pin numbers (2..13, A0..A7).
// Note: the Servo library takes over PWM on pins 9 and 10 on an Uno/Nano, so motor speed pins go on 3, 5, 6 or 11.
#include <Servo.h>

// ===== CONFIG =====
#define RP_NAME "robo_presence"
#define HAS_DRIVE 1
const char* DRIVE_ID = "drive";
const int L_IN1 = 7, L_IN2 = 8, L_PWM = 5;     // left motor: two direction pins + the speed (PWM) pin
const int R_IN1 = 4, R_IN2 = 12, R_PWM = 6;    // right motor
const int STBY = A2;                           // TB6612FNG standby pin, or -1 (L298N)

struct ServoSpec { const char* id; int pin; int lo; int hi; int home; };
ServoSpec SERVOS[] = {                         // id, pin, smallest angle, largest angle, home (0 = centre)
  {"pan", 9, -80, 80, 0},
  {"tilt", 10, -35, 55, 10},
  {NULL, -1, 0, 0, 0}
};

struct SliderSpec { const char* id; int pin; int lo; int hi; int home; bool servo; };
SliderSpec SLIDERS[] = {                       // id, pin, min, max, home, true = a servo (0..180), false = PWM (0..255)
  {NULL, -1, 0, 0, 0, false}
};

struct SwitchSpec { const char* id; int pin; bool button; };
SwitchSpec SWITCHES[] = {                      // id, pin, true = push button (held), false = on/off switch
  {"lights", 2, false},
  {"horn", 3, true},
  {NULL, -1, false}
};

struct AnalogSpec { const char* id; int pin; float factor; const char* unit; };
AnalogSpec ANALOGS[] = {                       // id, analog pin, volts multiplier (voltage divider), unit
  {"battery", A0, 3.0, "V"},
  {NULL, -1, 1.0, ""}
};

const char* SONAR_ID = "distance";
const int SONAR_TRIG = A4, SONAR_ECHO = A5;    // HC-SR04 pins, or -1 when there is none
// ===== END CONFIG =====

#define FW "1.0"
#define WATCHDOG_MS 700
#define MAX_SERVOS 12

Servo servoObj[MAX_SERVOS];
Servo sliderObj[MAX_SERVOS];
char line[72];
byte lineLen = 0;
unsigned long lastDrive = 0;
bool moving = false;

// How many entries each list has before its {NULL...} line (counted once in setup).
#define COUNT(arr, n) do { n = 0; while (n < (int)(sizeof(arr) / sizeof(arr[0])) && arr[n].id != NULL) n++; } while (0)
int nServos = 0, nSliders = 0, nSwitches = 0, nAnalogs = 0;

void motor(int in1, int in2, int pwm, int v) {
  v = constrain(v, -100, 100);
  digitalWrite(in1, v > 0 ? HIGH : LOW);
  digitalWrite(in2, v < 0 ? HIGH : LOW);
  analogWrite(pwm, (long)abs(v) * 255 / 100);
}

void stopWheels() {
  if (!HAS_DRIVE) return;
  motor(L_IN1, L_IN2, L_PWM, 0);
  motor(R_IN1, R_IN2, R_PWM, 0);
  moving = false;
}

void setSlider(int i, int v) {
  SliderSpec& s = SLIDERS[i];
  v = constrain(v, s.lo, s.hi);
  long span = (s.hi - s.lo) ? (s.hi - s.lo) : 1;
  if (s.servo) sliderObj[i].write((long)(v - s.lo) * 180 / span);
  else analogWrite(s.pin, (long)(v - s.lo) * 255 / span);
}

void setup() {
  Serial.begin(115200);
  COUNT(SERVOS, nServos); COUNT(SLIDERS, nSliders); COUNT(SWITCHES, nSwitches); COUNT(ANALOGS, nAnalogs);
  if (HAS_DRIVE) {
    int pins[] = {L_IN1, L_IN2, L_PWM, R_IN1, R_IN2, R_PWM};
    for (int i = 0; i < 6; i++) pinMode(pins[i], OUTPUT);
    if (STBY >= 0) { pinMode(STBY, OUTPUT); digitalWrite(STBY, HIGH); }
    stopWheels();
  }
  for (int i = 0; i < nServos && i < MAX_SERVOS; i++) {
    servoObj[i].attach(SERVOS[i].pin);
    servoObj[i].write(constrain(90 + SERVOS[i].home, 0, 180));
  }
  for (int i = 0; i < nSliders && i < MAX_SERVOS; i++) {
    if (SLIDERS[i].servo) sliderObj[i].attach(SLIDERS[i].pin);
    else pinMode(SLIDERS[i].pin, OUTPUT);
    setSlider(i, SLIDERS[i].home);
  }
  for (int i = 0; i < nSwitches; i++) { pinMode(SWITCHES[i].pin, OUTPUT); digitalWrite(SWITCHES[i].pin, LOW); }
  if (SONAR_TRIG >= 0) { pinMode(SONAR_TRIG, OUTPUT); pinMode(SONAR_ECHO, INPUT); }
  Serial.println(F("# Robo Presence bridge ready"));
}

void hello() {
  Serial.print(F("RP1 HELLO name=")); Serial.print(RP_NAME); Serial.print(F(" fw=")); Serial.println(F(FW));
  if (HAS_DRIVE) { Serial.print(F("PART id=")); Serial.print(DRIVE_ID); Serial.println(F(" type=drive")); }
  for (int i = 0; i < nServos; i++) {
    Serial.print(F("PART id=")); Serial.print(SERVOS[i].id); Serial.print(F(" type=servo min=")); Serial.print(SERVOS[i].lo);
    Serial.print(F(" max=")); Serial.print(SERVOS[i].hi); Serial.print(F(" home=")); Serial.println(SERVOS[i].home);
  }
  for (int i = 0; i < nSliders; i++) {
    Serial.print(F("PART id=")); Serial.print(SLIDERS[i].id); Serial.print(F(" type=slider min=")); Serial.print(SLIDERS[i].lo);
    Serial.print(F(" max=")); Serial.print(SLIDERS[i].hi); Serial.print(F(" home=")); Serial.println(SLIDERS[i].home);
  }
  for (int i = 0; i < nSwitches; i++) {
    Serial.print(F("PART id=")); Serial.print(SWITCHES[i].id); Serial.println(SWITCHES[i].button ? F(" type=button") : F(" type=toggle"));
  }
  for (int i = 0; i < nAnalogs; i++) {
    Serial.print(F("PART id=")); Serial.print(ANALOGS[i].id); Serial.print(F(" type=gauge unit=")); Serial.println(ANALOGS[i].unit);
  }
  if (SONAR_TRIG >= 0) { Serial.print(F("PART id=")); Serial.print(SONAR_ID); Serial.println(F(" type=distance")); }
  Serial.println(F("END"));
}

float sonarCm() {
  digitalWrite(SONAR_TRIG, LOW); delayMicroseconds(2);
  digitalWrite(SONAR_TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(SONAR_TRIG, LOW);
  unsigned long us = pulseIn(SONAR_ECHO, HIGH, 25000UL);
  return us ? us / 58.0 : 400.0;
}

void readings() {
  Serial.print('V');
  for (int i = 0; i < nAnalogs; i++) {
    float v = analogRead(ANALOGS[i].pin) * (5.0 / 1023.0) * ANALOGS[i].factor;
    Serial.print(' '); Serial.print(ANALOGS[i].id); Serial.print('='); Serial.print(v, 2);
  }
  if (SONAR_TRIG >= 0) { Serial.print(' '); Serial.print(SONAR_ID); Serial.print('='); Serial.print(sonarCm(), 1); }
  Serial.println();
}

void handle(char* cmd) {
  char* op = strtok(cmd, " ");
  if (!op) return;
  char* a = strtok(NULL, " ");
  char* b = strtok(NULL, " ");
  switch (op[0]) {
    case '?': hello(); break;
    case 'R': readings(); break;
    case 'X':
      stopWheels();
      for (int i = 0; i < nSwitches; i++) if (SWITCHES[i].button) digitalWrite(SWITCHES[i].pin, LOW);
      break;
    case 'D':
      if (HAS_DRIVE && a && b) {
        int l = atoi(a), r = atoi(b);
        motor(L_IN1, L_IN2, L_PWM, l);
        motor(R_IN1, R_IN2, R_PWM, r);
        lastDrive = millis();
        moving = (l != 0 || r != 0);
      }
      break;
    case 'S':
      if (!a || !b) break;
      for (int i = 0; i < nServos; i++) if (!strcmp(SERVOS[i].id, a)) servoObj[i].write(constrain(90 + constrain(atoi(b), SERVOS[i].lo, SERVOS[i].hi), 0, 180));
      for (int i = 0; i < nSliders; i++) if (!strcmp(SLIDERS[i].id, a)) setSlider(i, atoi(b));
      break;
    case 'T':
    case 'B':
      if (!a || !b) break;
      for (int i = 0; i < nSwitches; i++) if (!strcmp(SWITCHES[i].id, a)) digitalWrite(SWITCHES[i].pin, atoi(b) ? HIGH : LOW);
      break;
  }
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (lineLen) { line[lineLen] = 0; handle(line); lineLen = 0; }
    } else if (lineLen < sizeof(line) - 1) {
      line[lineLen++] = c;
    }
  }
  if (moving && millis() - lastDrive > WATCHDOG_MS) {  // no news from the Pi: stop
    stopWheels();
    Serial.println(F("# watchdog: wheels stopped"));
  }
}
