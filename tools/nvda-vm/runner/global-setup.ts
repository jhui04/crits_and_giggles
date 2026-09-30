import net from 'node:net';
import http from 'node:http';
import { APP_PORTS } from './tests/app-urls';

// run-tests.ps1 serves Crits & Giggles on the HOST. NVDA_APP_HOST is the
// address the guest reaches the host at (10.0.2.2, the VirtualBox NAT
// gateway, which maps to the host's loopback).
//
// Instead of pointing the browser at http://10.0.2.2:5174, this setup starts
// a plain TCP forwarder inside the guest: 127.0.0.1:5174 and :3005 (and ::1)
// -> NVDA_APP_HOST:5174 and :3005. The browser then uses
// http://localhost:5174, exactly like the root playwright.config.ts, so the
// Host header, the page origin and localStorage all look like a normal local
// run, and vite's host check never sees a foreign host name.
//
// The forwarder lives in the Playwright runner's main process and is closed
// by the returned teardown function.

const sockets = new Set<net.Socket>();

function forward(listenHost: string, port: number, upstreamHost: string): Promise<net.Server | null> {
  const server = net.createServer((client) => {
    const upstream = net.connect(port, upstreamHost);
    sockets.add(client);
    sockets.add(upstream);
    const close = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on('error', close);
    upstream.on('error', close);
    client.on('close', close);
    upstream.on('close', close);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  return new Promise((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      // No IPv6 loopback is not fatal: Chromium falls back to 127.0.0.1.
      if (listenHost === '::1' && err.code === 'EADDRNOTAVAIL') resolve(null);
      else reject(new Error(`forwarder ${listenHost}:${port} -> ${upstreamHost}:${port}: ${err.message}`));
    });
    server.listen(port, listenHost, () => resolve(server));
  });
}

function httpStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 10_000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

export default async function globalSetup() {
  const upstreamHost = process.env.NVDA_APP_HOST;
  if (!upstreamHost) {
    throw new Error('NVDA_APP_HOST is not set. Run the suite through tools/nvda-vm/run-tests.ps1, which starts the app on the host.');
  }
  const servers: net.Server[] = [];
  for (const port of [APP_PORTS.app, APP_PORTS.api]) {
    for (const listenHost of ['127.0.0.1', '::1']) {
      const s = await forward(listenHost, port, upstreamHost);
      if (s) servers.push(s);
    }
  }
  console.log(`INFO: forwarding localhost:${APP_PORTS.app} and :${APP_PORTS.api} to ${upstreamHost} (${servers.length} listeners)`);

  // Fail fast, with a clear message, if the host servers can't be reached.
  for (const url of [`http://127.0.0.1:${APP_PORTS.app}/`, `http://127.0.0.1:${APP_PORTS.api}/api/campaigns`]) {
    try {
      const status = await httpStatus(url);
      console.log(`${status >= 200 && status < 400 ? 'PASS' : 'FAIL'}: guest -> host ${url} answered HTTP ${status}`);
      if (status < 200 || status >= 400) throw new Error(`HTTP ${status}`);
    } catch (err) {
      for (const s of servers) s.close();
      throw new Error(`The app on the host is not reachable from the guest through ${url}: ${(err as Error).message}`);
    }
  }

  return async () => {
    for (const s of sockets) s.destroy();
    await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r(undefined)))));
  };
}
