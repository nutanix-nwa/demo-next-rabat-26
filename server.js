'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { version } = require('./package.json');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const LISTEN_BACKLOG = 4096;
const BROADCAST_INTERVAL_MS = 250;
const HEARTBEAT_MS = 30000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

// HTML must revalidate so a new release shows up immediately.
function cacheControlFor(ext) {
  return ext === '.html' ? 'no-cache' : 'public, max-age=300';
}

function loadStaticFiles(dir, prefix = '/') {
  const files = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const urlPath = prefix + entry.name;
    if (entry.isDirectory()) {
      for (const [key, value] of loadStaticFiles(fullPath, urlPath + '/')) files.set(key, value);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const body = fs.readFileSync(fullPath);
      files.set(urlPath, {
        body,
        headers: {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Content-Length': body.length,
          'Cache-Control': cacheControlFor(ext),
        },
      });
    }
  }
  return files;
}

const staticFiles = loadStaticFiles(PUBLIC_DIR);

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME_TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res, pathname) {
  const file = staticFiles.get(pathname.endsWith('/') ? pathname + 'index.html' : pathname);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  res.writeHead(200, file.headers);
  res.end(req.method === 'HEAD' ? undefined : file.body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (pathname === '/healthz') return sendJson(res, 200, { status: 'ok' });
  if (pathname === '/api/version') return sendJson(res, 200, { version });
  if (pathname === '/api/users') return sendJson(res, 200, { users: wss.clients.size });
  serveStatic(req, res, pathname);
});

// Must exceed typical load balancer idle timeouts (60s) to avoid races on reused connections.
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });

let broadcastTimer = null;
let lastBroadcastCount = -1;

function broadcastCount() {
  broadcastTimer = null;
  const count = wss.clients.size;
  if (count === lastBroadcastCount) return;
  lastBroadcastCount = count;
  const message = JSON.stringify({ users: count });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(message);
  }
}

function scheduleBroadcast() {
  if (!broadcastTimer) broadcastTimer = setTimeout(broadcastCount, BROADCAST_INTERVAL_MS);
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  ws.on('close', scheduleBroadcast);
  ws.on('error', () => ws.terminate());
  ws.send(JSON.stringify({ users: wss.clients.size }));
  scheduleBroadcast();
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, HOST, LISTEN_BACKLOG, () => {
  console.log(`demo-next-rabat-26 v${version} listening on http://${HOST}:${PORT}`);
});

function shutdown() {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.terminate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
