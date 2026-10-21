#!/usr/bin/env bash
#
# One-line installer for the Nutanix Rabat 2026 demo web app on Rocky Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/nutanix-nwa/demo-next-rabat-26/main/install.sh | sudo bash
#   curl -fsSL https://raw.githubusercontent.com/nutanix-nwa/demo-next-rabat-26/main/install.sh | sudo VERSION=0.0.2 PORT=8080 bash
#
# Environment variables:
#   VERSION   release to install, e.g. 0.0.2 (default: latest v* tag, falls back to main)
#   PORT      TCP port the app listens on (default: 3000)
#   REPO_URL  git repository to install from
#
set -euo pipefail

APP_NAME="demo-next-rabat-26"
REPO_URL="${REPO_URL:-https://github.com/nutanix-nwa/demo-next-rabat-26.git}"
VERSION="${VERSION:-}"
PORT="${PORT:-3000}"
INSTALL_DIR="/opt/${APP_NAME}"
APP_USER="demoapp"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
NODE_STREAM="20"
NODE_MIN_MAJOR=18

log()  { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "${EUID}" -eq 0 ]] || die "This script must be run as root (pipe it to 'sudo bash')."
[[ "${PORT}" =~ ^[0-9]+$ ]] || die "PORT must be a number, got '${PORT}'."

# --- OS check -----------------------------------------------------------------
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    rocky) log "Detected ${PRETTY_NAME:-Rocky Linux}" ;;
    rhel|almalinux|centos|ol|fedora) warn "Detected ${PRETTY_NAME:-$ID}; this script targets Rocky Linux but will try anyway." ;;
    *) die "Unsupported OS '${ID:-unknown}'. This script targets Rocky Linux." ;;
  esac
else
  die "Cannot read /etc/os-release."
fi

command -v dnf >/dev/null 2>&1 || die "dnf not found."

# --- System dependencies -------------------------------------------------------
log "Installing system packages (git, curl, tar)"
dnf install -y git curl tar >/dev/null

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -v | sed -E 's/^v([0-9]+).*/\1/'
}

if [[ "$(node_major)" -ge "${NODE_MIN_MAJOR}" ]]; then
  log "Node.js $(node -v) already installed"
else
  log "Installing Node.js ${NODE_STREAM}"
  MODULES="$(dnf module list nodejs 2>/dev/null || true)"
  if grep -qE "^nodejs[[:space:]]+${NODE_STREAM}([[:space:]]|$)" <<<"${MODULES}"; then
    dnf module reset -y nodejs >/dev/null
    dnf module enable -y "nodejs:${NODE_STREAM}" >/dev/null
  fi
  dnf install -y nodejs npm >/dev/null || dnf install -y nodejs >/dev/null
  [[ "$(node_major)" -ge "${NODE_MIN_MAJOR}" ]] || die "Node.js >= ${NODE_MIN_MAJOR} is required, got $(node -v 2>/dev/null || echo none)."
  log "Node.js $(node -v) installed"
fi
command -v npm >/dev/null 2>&1 || dnf install -y npm >/dev/null

# --- Resolve version -----------------------------------------------------------
VERSION="${VERSION#v}"
if [[ -z "${VERSION}" ]]; then
  VERSION="$(git ls-remote --tags --refs --sort=-v:refname "${REPO_URL}" 'v*' 2>/dev/null \
    | head -n1 | sed -E 's#.*refs/tags/v##')" || true
fi

if [[ -n "${VERSION}" ]]; then
  GIT_REF="v${VERSION}"
  log "Installing ${APP_NAME} version ${VERSION}"
else
  GIT_REF="main"
  warn "No release tag found; installing from branch 'main'."
fi

# --- Application user ----------------------------------------------------------
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  log "Creating system user '${APP_USER}'"
  useradd --system --no-create-home --home-dir "${INSTALL_DIR}" --shell /sbin/nologin "${APP_USER}"
fi

# --- Fetch and build -----------------------------------------------------------
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

log "Cloning ${REPO_URL} (${GIT_REF})"
git clone --quiet --depth 1 --branch "${GIT_REF}" "${REPO_URL}" "${TMP_DIR}/app" \
  || die "Could not clone ${REPO_URL} at ${GIT_REF}."

log "Installing npm dependencies"
(
  cd "${TMP_DIR}/app"
  if [[ -f package-lock.json ]]; then
    npm ci --omit=dev --no-audit --no-fund --loglevel=error
  else
    npm install --omit=dev --no-audit --no-fund --loglevel=error
  fi
)
rm -rf "${TMP_DIR}/app/.git"

if [[ -d "${INSTALL_DIR}" ]]; then
  rm -rf "${INSTALL_DIR}.previous"
  mv "${INSTALL_DIR}" "${INSTALL_DIR}.previous"
fi
mv "${TMP_DIR}/app" "${INSTALL_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${INSTALL_DIR}"
command -v restorecon >/dev/null 2>&1 && restorecon -R "${INSTALL_DIR}" >/dev/null 2>&1 || true

# --- OS tuning -----------------------------------------------------------------
log "Applying kernel network tuning"
cat > "/etc/sysctl.d/90-${APP_NAME}.conf" <<EOF
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_fin_timeout = 15
fs.file-max = 200000
EOF
sysctl --system >/dev/null || warn "Some sysctl settings could not be applied."

# --- systemd service -----------------------------------------------------------
NODE_BIN="$(command -v node)"
log "Writing ${SERVICE_FILE}"
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Nutanix Rabat 2026 demo web app
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${INSTALL_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=NODE_OPTIONS=--max-old-space-size=512
LimitNOFILE=65535
ExecStart=${NODE_BIN} ${INSTALL_DIR}/server.js
Restart=always
RestartSec=5
TimeoutStopSec=10
SyslogIdentifier=${APP_NAME}
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

log "Enabling ${APP_NAME} at boot"
systemctl daemon-reload
systemctl enable "${APP_NAME}"
systemctl restart "${APP_NAME}"
systemctl is-enabled --quiet "${APP_NAME}" || die "Service ${APP_NAME} is not enabled at boot."

# --- Firewall ------------------------------------------------------------------
if systemctl is-active --quiet firewalld; then
  log "Opening port ${PORT}/tcp in firewalld"
  firewall-cmd --quiet --permanent --add-port="${PORT}/tcp"
  firewall-cmd --quiet --reload
fi

# --- Health check --------------------------------------------------------------
log "Waiting for the app to become healthy"
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    rm -rf "${INSTALL_DIR}.previous"
    IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    log "Installed ${APP_NAME} ${VERSION:-main}"
    echo
    echo "  Open: http://${IP:-<vm-ip>}:${PORT}"
    echo "  Boot: enabled (systemd service ${APP_NAME})"
    echo "  Logs: journalctl -u ${APP_NAME} -f"
    echo
    exit 0
  fi
  sleep 1
done

systemctl --no-pager status "${APP_NAME}" || true
die "The app did not respond on port ${PORT}. Check: journalctl -u ${APP_NAME} -e"
