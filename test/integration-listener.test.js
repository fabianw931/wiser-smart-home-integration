import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { createIntegrationListener } from '../integration-listener.js';

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
