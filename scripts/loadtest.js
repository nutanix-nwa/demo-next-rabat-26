#!/usr/bin/env node
'use strict';

// Simulates N visitors: each loads the page files, then keeps a live WebSocket open.
//
//   node scripts/loadtest.js --url http://<vm-ip>:3000 --users 500 --hold 30 --ramp 5

const http = require('http');
const https = require('https');
const WebSocket = require('ws');

function parseArgs(argv) {
  const opts = { url: 'http://127.0.0.1:3000', users: 500, hold: 10, ramp: 5 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in opts)) {
      console.error(`Unknown option --${key}. Options: --url --users --hold --ramp`);
      process.exit(1);
    }
    opts[key] = key === 'url' ? argv[i + 1] : Number(argv[i + 1]);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const base = new URL(opts.url);
const client = base.protocol === 'https:' ? https : http;
const agent = new client.Agent({ keepAlive: true, maxSockets: 256 });
const wsUrl = `${base.protocol === 'https:' ? 'wss:' : 'ws:'}//${base.host}/ws`;
const PAGE_FILES = ['/', '/styles.css', '/app.js', '/favicon.svg', '/api/version'];

const stats = {
  httpOk: 0,
  httpErr: 0,
  httpTimes: [],
  wsOpen: 0,
  wsErr: 0,
  wsClosedEarly: 0,
  connectTimes: [],
  messages: 0,
};
const sockets = [];
const lastSeen = [];

function get(pathname) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = client.get(new URL(pathname, base), { agent }, (res) => {
      res.resume();
      res.on('end', () => {
        if (res.statusCode === 200) stats.httpOk++;
        else stats.httpErr++;
        stats.httpTimes.push(Date.now() - t0);
        resolve();
      });
    });
    req.on('error', () => {
      stats.httpErr++;
      resolve();
    });
    req.setTimeout(15000, () => req.destroy());
  });
}

function getJson(pathname) {
  return new Promise((resolve) => {
    client
      .get(new URL(pathname, base), (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      })
      .on('error', () => resolve(null));
  });
}

async function visitor(index) {
  await Promise.all(PAGE_FILES.map(get));
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ws = new WebSocket(wsUrl);
    sockets[index] = ws;
    let opened = false;
    ws.on('open', () => {
      opened = true;
      stats.wsOpen++;
      stats.connectTimes.push(Date.now() - t0);
      resolve();
    });
    ws.on('message', (data) => {
      stats.messages++;
      try {
        lastSeen[index] = JSON.parse(data).users;
      } catch {
        /* ignore */
      }
    });
    ws.on('error', () => {
      if (!opened) {
        stats.wsErr++;
        resolve();
      }
    });
    ws.on('close', () => {
      if (opened && !finished) stats.wsClosedEarly++;
    });
  });
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let finished = false;

async function main() {
  console.log(`Load test: ${opts.users} users against ${base.origin}, ramp ${opts.ramp}s, hold ${opts.hold}s`);
  const t0 = Date.now();
  const delay = (opts.ramp * 1000) / opts.users;
  const visits = [];
  for (let i = 0; i < opts.users; i++) {
    visits.push(visitor(i));
    if (delay >= 1) await sleep(delay);
  }
  await Promise.all(visits);
  console.log(`All users connected in ${((Date.now() - t0) / 1000).toFixed(1)}s, holding ${opts.hold}s...`);

  await sleep(opts.hold * 1000);
  const server = await getJson('/api/users');
  const counts = lastSeen.filter((v) => v !== undefined);
  const correct = counts.filter((v) => v === stats.wsOpen).length;

  finished = true;
  sockets.forEach((ws) => ws && ws.terminate());

  console.log('');
  console.log(`HTTP requests     ok ${stats.httpOk}, errors ${stats.httpErr}, p50 ${percentile(stats.httpTimes, 50)} ms, p95 ${percentile(stats.httpTimes, 95)} ms, max ${percentile(stats.httpTimes, 100)} ms`);
  console.log(`WebSocket         open ${stats.wsOpen}, errors ${stats.wsErr}, dropped while holding ${stats.wsClosedEarly}`);
  console.log(`Connect time      p50 ${percentile(stats.connectTimes, 50)} ms, p95 ${percentile(stats.connectTimes, 95)} ms, max ${percentile(stats.connectTimes, 100)} ms`);
  console.log(`Count messages    ${stats.messages} received`);
  console.log(`Counter accuracy  ${correct}/${stats.wsOpen} clients see ${stats.wsOpen}; server /api/users = ${server ? server.users : 'n/a'}`);

  const passed = stats.httpErr === 0 && stats.wsErr === 0 && stats.wsClosedEarly === 0 && correct === stats.wsOpen && stats.wsOpen === opts.users;
  console.log(passed ? '\nPASS' : '\nFAIL');
  process.exit(passed ? 0 : 1);
}

main();
