import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import net from 'node:net';
import { createIntegrationListener, startIntegrationListener } from '../integration-listener.js';

test('machine TLS listener authenticates and limits its proxy surface', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'wiser-tls-test-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  } catch (error) {
    if (error.code === 'ENOENT') return t.skip('openssl unavailable for test certificate');
    throw error;
  }
  const token = 'test_token_abcdefghijklmnopqrstuvwxyz012345';
  let calls = 0;
  let mode = 'ok';
  const upstream = http.createServer((req, res) => {
    calls++;
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    assert.equal(req.headers['x-browser-header'], undefined);
    assert.equal(req.headers.host, `127.0.0.1:${upstream.address().port}`);
    req.resume();
    req.on('end', () => {
      if (mode === 'redirect') { res.writeHead(302, { Location: 'https://example.com' }); res.end(token); }
      else if (mode === 'large') res.end('x'.repeat(2 * 1024 * 1024 + 1));
      else if (mode === 'error') { res.writeHead(500); res.end(token); }
      else res.end('{"ok":true}');
    });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const cert = readFileSync(join(dir, 'cert.pem'));
  const listener = createIntegrationListener({ cert, key: readFileSync(join(dir, 'key.pem')), token, localPort: upstream.address().port });
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  t.after(() => { listener.closeAllConnections(); listener.close(); });
  const request = (path, { method = 'GET', headers = {}, body = '', auth = true } = {}) => new Promise((resolve, reject) => {
    const req = https.request({ hostname: '127.0.0.1', servername: 'localhost', port: listener.address().port, ca: cert, path, method,
      headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
  const snapshot = '/api/integration/v1/snapshot';
  assert.equal((await request(snapshot, { auth: false })).status, 401);
  assert.equal((await request(snapshot, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal(calls, 0);
  for (const path of ['/', '/api/config', snapshot + '?x=1', snapshot + '/', '/api/integration/v1/loads/01/target', '/api/integration/v1/loads/%31/target']) {
    assert.equal((await request(path)).status, 404);
  }
  for (const headers of [{ Origin: 'https://localhost' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await request(snapshot, { headers })).status, 403);
  assert.equal(calls, 0);
  assert.equal((await request(snapshot, { headers: { 'X-Browser-Header': 'secret' } })).status, 200);
  assert.equal((await request('/api/integration/v1/loads/12/target', { method: 'PUT', body: '{"target":true}' })).status, 200);
  const before = calls;
  assert.equal((await request('/api/integration/v1/loads/12/target', { method: 'PUT', body: 'x'.repeat(8193) })).status, 413);
  assert.equal(calls, before);
  for (mode of ['redirect', 'error', 'large']) {
    const result = await request(snapshot);
    assert.equal(result.status, 502);
    assert.equal(result.headers.location, undefined);
    assert.equal(result.body.includes(token), false);
  }
});

test('listener refuses missing or weak authentication', () => {
  for (const token of [undefined, '', 'short', 'x'.repeat(257)]) assert.throws(() => createIntegrationListener({ token }), /token/);
});

// The same proxy surface is exercised over HTTPS and over the explicit plain-HTTP mode.
async function exerciseListener(t, { tls }) {
  const token = 'test_token_abcdefghijklmnopqrstuvwxyz012345';
  let credentials = {};
  if (tls) {
    const dir = mkdtempSync(join(tmpdir(), 'wiser-tls-stream-test-'));
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
    } catch (error) {
      if (error.code === 'ENOENT') return t.skip('openssl unavailable for test certificate');
      throw error;
    }
    credentials = { cert: readFileSync(join(dir, 'cert.pem')), key: readFileSync(join(dir, 'key.pem')) };
  }
  const seen = [];
  let mode = 'stream';
  let upstreamClosed;
  let closed = new Promise(resolve => { upstreamClosed = resolve; });
  const upstream = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    req.resume();
    if (req.url === '/api/integration/v1/buttons/identify' || req.url === '/api/integration/v1/snapshot') { res.setHeader('Content-Type', 'application/json'); return res.end('{"accepted":true}'); }
    req.socket.once('close', () => upstreamClosed());
    if (mode === 'unavailable') { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end(`{"error":"${token}"}`); }
    if (mode === 'unauthorized') { res.writeHead(401); return res.end(); }
    if (mode === 'redirect') { res.writeHead(302, { Location: 'https://example.com', 'Content-Type': 'application/x-ndjson' }); return res.end(token); }
    if (mode === 'json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
    res.write('{"type":"status","status":"live","scope":"s"}\n');
    if (mode === 'big') { for (let index = 0; index < 3; index++) res.write(`${JSON.stringify({ type: 'load', pad: 'x'.repeat(1024 * 1024) })}\n`); return res.end(); }
    if (mode === 'finite') return res.end('{"type":"heartbeat","scope":"s"}\n');
    if (mode === 'stream') setTimeout(() => res.write('{"type":"load","id":1,"state":{"bri":5},"scope":"s"}\n'), 60);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const listener = createIntegrationListener({ ...credentials, tls, token, localPort: upstream.address().port, timeout: 500, streamIdleTimeout: 250 });
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  t.after(() => { listener.closeAllConnections(); listener.close(); });
  const open = (path, { method = 'GET', headers = {}, auth = true, body } = {}) => new Promise((resolve, reject) => {
    const options = { hostname: '127.0.0.1', port: listener.address().port, path, method, headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...headers } };
    const req = tls ? https.request({ ...options, servername: 'localhost', ca: credentials.cert }, resolve) : http.request(options, resolve);
    req.on('error', reject);
    req.end(body);
  });
  const text = async res => { let result = ''; for await (const chunk of res) result += chunk; return result; };
  const events = '/api/integration/v1/events';
  const reset = () => { seen.length = 0; closed = new Promise(resolve => { upstreamClosed = resolve; }); };

  // The same gate as every other route comes first; nothing reaches the app.
  assert.equal((await open(events, { auth: false })).statusCode, 401);
  assert.equal((await open(events, { headers: { Authorization: 'Bearer wrong' } })).statusCode, 401);
  for (const headers of [{ Origin: 'https://localhost' }, { 'Sec-Fetch-Site': 'same-site' }]) assert.equal((await open(events, { headers })).statusCode, 403);
  for (const [path, method] of [['/', 'GET'], ['/api/config', 'GET'], [events + '?x=1', 'GET'], [events + '/', 'GET'], [events, 'POST'], [events, 'PUT'], ['/api/integration/v1/buttons/identify', 'GET'], ['/api/integration/v1/buttons/identify?x=1', 'PUT'], ['/api/integration/v1/buttons/other', 'PUT'], ['/api/diagnostics/gateway-events', 'GET']]) {
    const res = await open(path, { method }); await text(res);
    assert.equal(res.statusCode, 404, `${method} ${path}`);
  }
  assert.deepEqual(seen, []);

  // Lines arrive as they are produced, not when the stream ends; the browser's headers are not forwarded.
  let res = await open(events, { headers: { 'X-Browser-Header': 'secret', Cookie: 'x=1' } });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^application\/x-ndjson/);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(seen[0].headers.authorization, `Bearer ${token}`);
  assert.equal(seen[0].headers['x-browser-header'], undefined);
  assert.equal(seen[0].headers.cookie, undefined);
  assert.equal(seen[0].url, events);
  const lines = []; let buffered = '';
  await new Promise(resolve => res.on('data', chunk => {
    buffered += chunk;
    while (buffered.includes('\n')) { lines.push(JSON.parse(buffered.slice(0, buffered.indexOf('\n')))); buffered = buffered.slice(buffered.indexOf('\n') + 1); if (lines.length === 2) resolve(); }
  }));
  assert.deepEqual(lines.map(line => line.type), ['status', 'load']);
  // A departing client releases the upstream subscription.
  res.destroy();
  await closed;

  reset(); mode = 'finite';
  assert.equal(await text(await open(events)), '{"type":"status","status":"live","scope":"s"}\n{"type":"heartbeat","scope":"s"}\n');

  // No 2 MiB response cap applies to an open stream.
  reset(); mode = 'big';
  assert.ok((await text(await open(events))).length > 3 * 1024 * 1024);

  // A silent upstream is declared dead; the client sees the stream end or break rather than hanging.
  reset(); mode = 'silent';
  res = await open(events);
  const outcome = await Promise.race([
    new Promise(resolve => { res.on('end', () => resolve('ended')); res.on('error', () => resolve('error')); res.on('close', () => resolve('closed')); res.resume(); }),
    new Promise(resolve => setTimeout(() => resolve('hung'), 3000)),
  ]);
  assert.notEqual(outcome, 'hung');
  await closed;

  // Upstream failures are generic and never relay content or redirects.
  for (const [failure, status] of [['unavailable', 502], ['redirect', 502], ['json', 502], ['unauthorized', 401]]) {
    reset(); mode = failure;
    res = await open(events);
    const body = await text(res);
    assert.equal(res.statusCode, status, failure);
    assert.equal(res.headers.location, undefined);
    assert.equal(body.includes(token), false);
  }

  // The identification route is a normal bounded proxy route.
  reset();
  res = await open('/api/integration/v1/buttons/identify', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"scope":"s","identity":"x"}' });
  assert.equal(res.statusCode, 200);
  assert.equal(await text(res), '{"accepted":true}');
  assert.equal(seen[0].method, 'PUT');
  const before = seen.length;
  res = await open('/api/integration/v1/buttons/identify', { method: 'PUT', body: 'x'.repeat(8193) });
  assert.equal(res.statusCode, 413);
  assert.equal(seen.length, before);
  assert.equal((await open('/api/integration/v1/snapshot', { headers: { 'X-Browser-Header': 'secret' } })).statusCode, 200);
}
test('plain-HTTP mode applies the same authentication, allowlist, limits and stream relay', t => exerciseListener(t, { tls: false }));
test('HTTPS mode applies the same authentication, allowlist, limits and stream relay', t => exerciseListener(t, { tls: true }));

test('plain HTTP is opt-in, needs an explicit literal bind address and says that it is unencrypted', async t => {
  const token = 'test_token_abcdefghijklmnopqrstuvwxyz012345';
  const free = await new Promise(resolve => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
  const base = { WISER_INTEGRATION_TOKEN: token, WISER_API_PORT: String(free) };
  const quiet = { log() {} };
  assert.throws(() => startIntegrationListener({ ...base, WISER_API_TLS: '0' }, quiet), /WISER_API_BIND/);
  for (const WISER_API_BIND of ['localhost', 'example.com', '127.0.0.1:80', '0']) assert.throws(() => startIntegrationListener({ ...base, WISER_API_TLS: '0', WISER_API_BIND }, quiet), /WISER_API_BIND/);
  for (const WISER_API_TLS of ['2', 'false', 'no']) assert.throws(() => startIntegrationListener({ ...base, WISER_API_TLS, WISER_API_BIND: '127.0.0.1' }, quiet), /WISER_API_TLS/);
  assert.throws(() => startIntegrationListener({ ...base, WISER_API_TLS: '0', WISER_API_BIND: '127.0.0.1', WISER_API_PORT: '70000' }, quiet), /WISER_API_PORT/);
  assert.throws(() => startIntegrationListener({ ...base, WISER_API_TLS: '0', WISER_API_BIND: '127.0.0.1', WISER_INTEGRATION_TOKEN: 'short' }, quiet), /token/);
  // HTTPS stays the default and still needs a certificate and a private key file.
  assert.throws(() => startIntegrationListener({ ...base, WISER_API_BIND: '127.0.0.1' }, quiet), /WISER_TLS_CERT/);
  const dir = mkdtempSync(join(tmpdir(), 'wiser-key-test-'));
  writeFileSync(join(dir, 'key.pem'), 'not a key', { mode: 0o644 });
  writeFileSync(join(dir, 'cert.pem'), 'not a cert');
  assert.throws(() => startIntegrationListener({ ...base, WISER_TLS_CERT: join(dir, 'cert.pem'), WISER_TLS_KEY: join(dir, 'key.pem') }, quiet), /chmod 600/);

  const upstream = http.createServer((req, res) => { req.resume(); res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const lines = [];
  const server = startIntegrationListener({ ...base, WISER_API_TLS: '0', WISER_API_BIND: '127.0.0.1' }, { localPort: upstream.address().port, log: line => lines.push(line) });
  t.after(() => { server.closeAllConnections(); server.close(); });
  await once(server, 'listening');
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`^Home Assistant integration API: http://127\\.0\\.0\\.1:${free} WITHOUT TLS`));
  assert.match(lines[0], /unencrypted/);
  assert.doesNotMatch(lines[0], new RegExp(token));
  assert.doesNotMatch(lines[0], /ALL interfaces/);
  const status = await new Promise((resolve, reject) => http.get({ hostname: '127.0.0.1', port: free, path: '/api/integration/v1/snapshot', headers: { Authorization: `Bearer ${token}` } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject));
  assert.equal(status, 200);
  // A wildcard bind must be typed deliberately, and is called out.
  const wildcard = [];
  const second = startIntegrationListener({ ...base, WISER_API_PORT: String(free + 1 > 65535 ? free - 1 : free + 1), WISER_API_TLS: '0', WISER_API_BIND: '0.0.0.0' }, { localPort: upstream.address().port, log: line => wildcard.push(line) });
  t.after(() => { second.closeAllConnections(); second.close(); });
  await once(second, 'listening');
  assert.match(wildcard[0], /ALL interfaces/);
});
