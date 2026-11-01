#!/usr/bin/env bash
# Robo Presence robot installer, for Raspberry Pi OS (Bookworm or newer, 64-bit recommended).
#
# Usually started by the one-line command from the robot's Install tab on the website:
#     curl -fsSL 'https://<your app>/_/api/install?c=ABCD2345' | sudo bash
# By hand, from a copy of this robot/ folder:
#     sudo bash install.sh --server https://<your app>/_/api --code ABCD-2345
# Later updates keep the pairing:   robopresence update
#
# What it does: installs system packages (camera, GPIO, serial, speech), a Python environment with aiortc (WebRTC),
# copies the robot code to /opt/robopresence, pairs with the website (the token goes to /etc/robopresence/robot.json,
# readable only by you), and starts the robopresence service, which starts again by itself after a reboot.
set -euo pipefail

SERVER=""
CODE=""
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="${2:-}"; shift 2 ;;
    --code) CODE="${2:-}"; shift 2 ;;
    --source) SRC="${2:-}"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "Please run it with sudo."; exit 1; }

APP=/opt/robopresence
ETC=/etc/robopresence
RUN_AS="${SUDO_USER:-}"
if [ -z "$RUN_AS" ] || [ "$RUN_AS" = "root" ]; then
  RUN_AS="$(getent passwd 1000 | cut -d: -f1 || true)"
  RUN_AS="${RUN_AS:-root}"
fi
if [ -z "$SERVER" ] && [ -f "$ETC/server" ]; then SERVER="$(cat "$ETC/server")"; fi
[ -n "$SERVER" ] || { echo "No server address. Use the install command from the robot's Install tab."; exit 1; }

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

say "Installing system packages (a few minutes the first time)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip curl
for pkg in python3-numpy python3-gpiozero python3-lgpio python3-serial python3-smbus2 python3-picamera2 espeak-ng; do
  if apt-cache show "$pkg" >/dev/null 2>&1; then
    apt-get install -y -qq "$pkg" >/dev/null || echo "   (couldn't install $pkg, carrying on)"
  fi
done
MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo unknown)"
echo "   This is: $MODEL"
# pigpio gives servos a steady pulse on a Pi 4 and older (it doesn't support the Pi 5).
if ! echo "$MODEL" | grep -q "Raspberry Pi 5" && apt-cache show pigpio >/dev/null 2>&1; then
  apt-get install -y -qq pigpio python3-pigpio >/dev/null && systemctl enable --now pigpiod >/dev/null 2>&1 || true
fi

say "Setting up Python with aiortc (WebRTC video and controls)"
mkdir -p "$APP" "$ETC/plugins"
[ -x "$APP/venv/bin/python" ] || python3 -m venv --system-site-packages "$APP/venv"
"$APP/venv/bin/pip" install -q --upgrade pip
"$APP/venv/bin/pip" install -q -r "$SRC/requirements.txt"

say "Copying the robot code to $APP/robot"
rm -rf "$APP/robot.new"
mkdir -p "$APP/robot.new"
cp -r "$SRC/robopresence" "$SRC/plugins" "$SRC/requirements.txt" "$SRC/install.sh" "$APP/robot.new/"
[ -d "$SRC/arduino" ] && cp -r "$SRC/arduino" "$APP/robot.new/"
rm -rf "$APP/robot"
mv "$APP/robot.new" "$APP/robot"
echo "$SERVER" > "$ETC/server"
chown -R "$RUN_AS" "$ETC"
for grp in video gpio dialout i2c audio; do
  getent group "$grp" >/dev/null && usermod -aG "$grp" "$RUN_AS" || true
done

cat > /usr/local/bin/robopresence <<'HELPER'
#!/usr/bin/env bash
# Robo Presence helper: robopresence status | logs | restart | stop | test [--wheels] | info | update | pair CODE
APP=/opt/robopresence; ETC=/etc/robopresence
run() { PYTHONPATH="$APP/robot" "$APP/venv/bin/python" -m robopresence --config "$ETC/robot.json" "$@"; }
case "${1:-help}" in
  status)  systemctl status robopresence --no-pager ;;
  logs)    journalctl -u robopresence -f -n 60 ;;
  restart) sudo systemctl restart robopresence && echo "Restarted." ;;
  stop)    sudo systemctl stop robopresence && echo "Stopped." ;;
  test)    shift; sudo systemctl stop robopresence; run test "$@"; sudo systemctl start robopresence ;;
  info)    run info ;;
  update)  curl -fsSL "$(cat "$ETC/server")/install" | sudo bash ;;
  pair)    [ -n "${2:-}" ] || { echo "Usage: robopresence pair ABCD-2345"; exit 1; }
           curl -fsSL "$(cat "$ETC/server")/install?c=$2" | sudo bash ;;
  *)       echo "robopresence status | logs | restart | stop | test [--wheels] | info | update | pair CODE" ;;
esac
HELPER
chmod +x /usr/local/bin/robopresence

if [ -n "$CODE" ]; then
  say "Pairing with the website"
  sudo -u "$RUN_AS" env PYTHONPATH="$APP/robot" "$APP/venv/bin/python" -m robopresence --config "$ETC/robot.json" \
    claim --server "$SERVER" --code "$CODE"
elif [ ! -f "$ETC/robot.json" ]; then
  echo "This robot isn't paired yet: use the install command with a code from the robot's Install tab."
  exit 1
else
  echo "   Keeping the existing pairing."
fi

say "Starting the robopresence service"
cat > /etc/systemd/system/robopresence.service <<UNIT
[Unit]
Description=Robo Presence robot
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_AS
Environment=PYTHONPATH=$APP/robot
Environment=PYTHONUNBUFFERED=1
ExecStart=$APP/venv/bin/python -m robopresence --config $ETC/robot.json run
Restart=always
RestartSec=5
# exit code 3 = unpaired in the website: don't keep knocking
RestartPreventExitStatus=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable robopresence >/dev/null 2>&1
systemctl restart robopresence

say "Done! Your robot's page should say Online within a few seconds."
echo "   Handy commands:  robopresence status | logs | test | restart | update"
echo "   (A new group membership for the camera or GPIO may need one reboot: sudo reboot)"
