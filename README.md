# Demo application deployed by Jarvis - Nutanix Rabat 2026

Landing page for the Nutanix live event in **Rabat, Morocco on Dec 1, 2026**: *"Demo application deployed by Jarvis using Nutanix MCP Server & NAI"*.

The page shows:

- The event hero: **LIVE EVENT** badge, title, *using Nutanix MCP Server & NAI*, location and date.
- A visual of **Nutanix NAI** + **Nutanix NKP** (Kubernetes Platform) as glass cards, with the *Simple / Secure / Scalable / Enterprise Ready* feature row.
- A **live counter of connected users**, updated in real time for everyone viewing the page.
- The running app version in the footer.

## How it works

A small Node.js server serves the static page and keeps a WebSocket connection open with every browser. Each time a visitor connects or leaves, the server broadcasts the new total to all open pages. A 30-second ping drops dead connections so the count stays accurate.

```mermaid
flowchart LR
  Browser["Browser (index.html + app.js)"] -->|"HTTP GET static files"| NodeServer["Node.js server.js :3000"]
  Browser <-->|"WebSocket /ws"| NodeServer
  NodeServer -->|"broadcast count on connect/disconnect"| Browser
  Installer["install.sh via curl | bash"] -->|"clone latest v0.0.x tag"| GitHub["github.com/nutanix-nwa/demo-next-rabat-26"]
  Installer -->|"systemd unit"| NodeServer
```

| Endpoint       | Description                                  |
| -------------- | -------------------------------------------- |
| `/`            | The web page                                 |
| `/ws`          | WebSocket, pushes `{ "users": <n> }`         |
| `/api/users`   | Current connected-users count (JSON)         |
| `/api/version` | App version from `package.json` (JSON)       |
| `/healthz`     | Health check, returns `{ "status": "ok" }`   |

## Project structure

```
.
├── server.js            Node.js HTTP + WebSocket server
├── package.json         Version and dependencies (only `ws`)
├── public/
│   ├── index.html       Page markup
│   ├── styles.css       Design (dark purple theme, glass cards, responsive)
│   ├── app.js           WebSocket client, live counter, auto-reconnect
│   └── favicon.svg
├── install.sh           One-line installer for Rocky Linux
└── scripts/
    ├── release.sh       Version bump, tag and prune old releases
    └── loadtest.js      Simulate N concurrent users against a running server
```

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Open <http://localhost:3000>. Open it in a second tab to watch the counter go up. Use another port with `PORT=8080 npm start`.

## Install on Rocky Linux

On a Rocky Linux 8, 9 or 10 VM, run as a user with sudo:

```bash
curl -fsSL https://raw.githubusercontent.com/nutanix-nwa/demo-next-rabat-26/main/install.sh | sudo bash
```

Options are passed as environment variables:

```bash
# Install a specific version on a custom port
curl -fsSL https://raw.githubusercontent.com/nutanix-nwa/demo-next-rabat-26/main/install.sh | sudo VERSION=0.0.2 PORT=8080 bash
```

| Variable   | Default                                                | Description                |
| ---------- | ------------------------------------------------------ | -------------------------- |
| `VERSION`  | latest `v*` tag (falls back to `main` if none)         | Release to install         |
| `PORT`     | `3000`                                                 | Port the app listens on    |
| `REPO_URL` | `https://github.com/nutanix-nwa/demo-next-rabat-26.git` | Repository to install from |

What the script does:

1. Checks it runs as root on Rocky Linux (other EL distributions get a warning).
2. Installs `git`, `curl`, `tar` and Node.js 20 with `dnf` (skipped if Node.js 18+ is already present).
3. Resolves the version to install and clones that tag.
4. Creates the system user `demoapp` and installs the app in `/opt/demo-next-rabat-26` (`npm ci --omit=dev`).
5. Creates, enables and starts the systemd service `demo-next-rabat-26` (starts at boot, restarts automatically on failure) and verifies it is enabled.
6. Opens the port in firewalld if firewalld is running.
7. Waits for `/healthz` to respond and prints the URL, e.g. `http://192.168.1.50:3000`.

**Upgrade:** run the same command again; it installs the latest release and restarts the service. To roll back, run it with `VERSION=<older version>`.

## Operations

```bash
sudo systemctl status demo-next-rabat-26
sudo systemctl restart demo-next-rabat-26
sudo journalctl -u demo-next-rabat-26 -f
curl http://127.0.0.1:3000/healthz
```

### Start on boot

The installer enables the `demo-next-rabat-26` systemd service, so the app starts automatically when the VM boots (after the network is up). If the app crashes, systemd restarts it after 5 seconds and keeps retrying indefinitely.

```bash
# Check autostart is enabled (prints "enabled")
systemctl is-enabled demo-next-rabat-26

# Test: reboot, then from any machine
sudo reboot
curl http://<vm-ip>:3000/healthz

# Disable / re-enable autostart
sudo systemctl disable demo-next-rabat-26
sudo systemctl enable demo-next-rabat-26
```

Uninstall:

```bash
sudo systemctl disable --now demo-next-rabat-26
sudo rm -f /etc/systemd/system/demo-next-rabat-26.service
sudo systemctl daemon-reload
sudo rm -rf /opt/demo-next-rabat-26
sudo userdel demoapp
sudo firewall-cmd --permanent --remove-port=3000/tcp && sudo firewall-cmd --reload
```

## Capacity and sizing

The app is built to serve **500+ concurrent users** on a small VM.

### Recommended VM

| Profile         | vCPU | RAM  | Disk  | Notes                                                       |
| --------------- | ---- | ---- | ----- | ----------------------------------------------------------- |
| **Recommended** | 2    | 2 GB | 20 GB | One core for Node.js, one for the OS, SSH, network and dnf  |
| Minimum         | 1    | 1 GB | 20 GB | Works for 500 users with little headroom                    |

At 500 users expect under 100 MB of memory for the app and under 10% CPU. The same 2 vCPU / 2 GB VM has headroom for several thousand users.

### Measured results

Local test with `scripts/loadtest.js` (each user loads the 5 page files and keeps a live WebSocket):

| Users | HTTP errors | WebSocket errors | Page file p95 | Connect p95 | Server memory | Counter correct |
| ----- | ----------- | ---------------- | ------------- | ----------- | ------------- | --------------- |
| 500   | 0           | 0                | 14 ms         | 4 ms        | about 55 MB   | 500/500         |
| 2000  | 0           | 0                | 25 ms         | 6 ms        | about 76 MB   | 2000/2000       |

On a Rocky Linux 9.8 VM (4 vCPU, 8 GB), with the load test run on the VM itself so the network is not measured:

| Users | HTTP errors | WebSocket errors | Page file p95 | Connect p95 | Server memory | Counter correct |
| ----- | ----------- | ---------------- | ------------- | ----------- | ------------- | --------------- |
| 500   | 0           | 0                | 1 ms          | 1 ms        | about 59 MB   | 500/500         |
| 2000  | 0           | 0                | 2 ms          | 1 ms        | about 78 MB   | 2000/2000       |

When testing from a remote machine, response times are dominated by network latency: each new connection costs one round trip, so a 250 ms link gives about 0.5 s per page file regardless of server load.

### Tuning applied by the installer and the app

- **OS** (`/etc/sysctl.d/90-demo-next-rabat-26.conf`): larger connection queues (`net.core.somaxconn`, `net.ipv4.tcp_max_syn_backlog` = 4096), wider port range, faster socket cleanup (`tcp_fin_timeout` = 15), `fs.file-max` = 200000.
- **Service** (systemd unit): `LimitNOFILE=65535` so each user's open socket fits comfortably; `NODE_OPTIONS=--max-old-space-size=512` to keep memory predictable.
- **Server** (`server.js`): count updates are batched and sent at most every 250 ms (500 users joining sends about 3,000 messages instead of 125,000); static files are served from memory with browser caching for CSS/JS/SVG; listen backlog 4096; keep-alive timeouts above common load balancer idle timeouts; incoming WebSocket messages capped at 1 KB.
- **Browser** (`public/app.js`): reconnects use randomized backoff, so after a restart users reconnect spread out instead of all at once.

### Run the load test against your VM

From another machine with Node.js 18+ and a clone of this repo (`npm install` first):

```bash
node scripts/loadtest.js --url http://<vm-ip>:3000 --users 500 --hold 30 --ramp 5
```

Options: `--users` simulated visitors, `--ramp` seconds to spread connections over, `--hold` seconds to keep them open. It prints request and connect latencies, errors and whether every client sees the right count, then `PASS` or `FAIL`.

Run it from a separate machine, not the VM itself. On macOS raise the open-file limit first (`ulimit -n 20000`); a single client machine is limited to roughly 28k outgoing connections.

## Versioning and releases

Versions follow `MAJOR.MINOR.PATCH` starting at `0.0.1`, and each release is a git tag `vX.Y.Z`. **Only the 4 most recent releases are kept**; older tags are deleted locally and on GitHub.

From a clean `main` branch:

```bash
./scripts/release.sh          # 0.0.1 -> 0.0.2
./scripts/release.sh minor    # 0.0.2 -> 0.1.0
./scripts/release.sh major    # 0.1.0 -> 1.0.0
```

The script bumps `package.json`, commits `release vX.Y.Z`, tags, pushes the branch and tag, then prunes the older tags.

## Troubleshooting

- **Page not reachable from another machine:** check the port is open with `sudo firewall-cmd --list-ports`, and that no cloud or hypervisor firewall blocks it.
- **Installer says the app did not respond:** read the logs with `sudo journalctl -u demo-next-rabat-26 -e`. A common cause is another process using the port; reinstall with a different `PORT`.
- **Counter shows "Offline - reconnecting":** the WebSocket can't reach `/ws`. If you put a reverse proxy in front, it must forward WebSocket upgrades (`Upgrade` and `Connection` headers).
- **Clone fails:** the VM needs outbound HTTPS access to github.com, and the repository must be public (or set `REPO_URL` to a reachable mirror).
