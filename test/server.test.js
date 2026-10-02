import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp, validateHost, validateTarget } from '../server.js';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
async function close(server) {
  const done = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await done;
}
async function fixture(t, { onGateway, ...options } = {}) {
  const calls = [];
  let mode = '';
  const gateway = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const payload = raw ? JSON.parse(raw) : undefined;
    calls.push({ path: req.url, method: req.method, token: req.headers.authorization, payload });
    if (onGateway && await onGateway(req, res, payload)) return;
    if (mode === 'timeout') return;
    if (mode === 'redirect') { res.writeHead(302, { Location: '/api/loads' }); return res.end(); }
    if (mode.startsWith('http-')) { res.writeHead(Number(mode.slice(5)) || 401); return res.end('Never relay fake-secret'); }
    if (mode === 'invalid-json') return res.end('{');
    if (mode === 'envelope-error') return res.end(JSON.stringify({ status: 'error', message: 'Never relay fake-secret' }));
    if (req.url === '/api/hvacgroups') { res.writeHead(404); return res.end(); }
    let data = {};
    if (req.url === '/api/account/claim') data = { secret: 'fake-secret', user: payload.user };
    if (req.url === '/api/info') data = { name: 'Test gateway', secret: 'not-for-browser', echo: 'fake-secret' };
    if (req.url === '/api/loads') data = [
      { id: 1, name: 'Light', type: 'onoff' },
      { id: 2, name: 'Dimmer', type: 'dim' },
      { id: 3, name: 'Blind', type: 'motor' },
      { id: 4, type: 'dim', unused: true },
    ];
    if (req.url === '/api/loads/state') data = [{ id: 1, state: { bri: 10000 } }];
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'success', data }));
  });
  const port = await listen(gateway);
  const app = createApp({ gatewayPort: port, timeout: 1000, ...options });
  const appPort = await listen(app);
  t.after(async () => { await close(app); await close(gateway); });
  async function request(path, method = 'GET', payload, headers = {}) {
    const res = await fetch(`http://127.0.0.1:${appPort}${path}`, {
      method,
      headers: { 'X-Wiser-Client': 'local-poc', ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    return { status: res.status, body: await res.json(), headers: res.headers };
  }
  async function connect(pair = false) {
    return request('/api/connect', 'POST', { host: '127.0.0.1', pair, ...(!pair ? { token: 'fake-secret' } : {}) });
  }
  return { calls, request, connect, appPort, setMode: value => { mode = value; } };
}

test('gateway host accepts canonical addresses and DNS names, rejects URL injection', () => {
  for (const host of ['192.168.1.2', 'wiser.local', 'localhost', '2001:db8::1']) assert.ok(validateHost(host));
  for (const host of ['', 'http://wiser', 'wiser:80', 'wiser/path', 'user@wiser', 'wiser?x=1', 'wiser#x', ' wiser', 'wiser\n', '127.1', '2130706433', '0177.0.0.1', '0x7f000001', '-bad.local', '[::1]']) {
    assert.throws(() => validateHost(host), undefined, host);
  }
});

test('target validation is strict and respects discovered load type', () => {
  for (const [type, target] of [['onoff', { bri: 0 }], ['onoff', { bri: 10000 }], ['dim', { bri: 5678 }], ['motor', { level: 10000 }]]) {
    assert.doesNotThrow(() => validateTarget({ type }, target));
  }
  for (const [load, target] of [
    [null, { bri: 0 }], [{ type: 'onoff' }, { bri: 1 }],
    [{ type: 'dim' }, { bri: '2' }], [{ type: 'dim' }, { bri: 1.2 }],
    [{ type: 'dim' }, { bri: -1 }], [{ type: 'dim' }, { bri: 10001 }],
    [{ type: 'dim' }, { bri: 0, extra: 1 }], [{ type: 'dim' }, {}],
    [{ type: 'motor' }, { tilt: 10 }], [{ type: 'motor' }, { bri: 0 }],
    [{ type: 'unknown' }, { bri: 0 }], [{ type: 'dim', unused: true }, { bri: 0 }],
  ]) assert.throws(() => validateTarget(load, target));
});

test('connect, discover, validate and proxy targets; optional failures remain isolated', async t => {
  const f = await fixture(t);
  assert.equal((await f.connect()).status, 200);
  assert.equal((await f.request('/api/loads/1/target_state', 'PUT', { bri: 0 })).status, 400);
  assert.equal((await f.request('/api/read/loads')).body.data.length, 4);
  assert.equal((await f.request('/api/read/hvacgroups')).status, 404);
  assert.equal((await f.request('/api/read/loads/state')).body.data[0].state.bri, 10000);
  for (const [id, payload] of [[1, { bri: 10000 }], [2, { bri: 1234 }], [3, { level: 9000 }]]) {
    assert.equal((await f.request(`/api/loads/${id}/target_state`, 'PUT', payload)).status, 200);
    assert.deepEqual(f.calls.at(-1).payload, payload);
    assert.equal(f.calls.at(-1).token, 'Bearer fake-secret');
  }
  const before = f.calls.length;
  for (const path of ['/api/read/jobs/1/run', '/api/read/devices/identify', '/api/read/loads?x=1', '/api/read/account', '/api/loads/01/target_state', '/api/loads/../target_state']) {
    assert.equal((await f.request(path)).status, 404);
  }
  for (const [id, payload] of [[1, { bri: 5 }], [2, { bri: 10001 }], [3, { tilt: 2 }], [4, { bri: 0 }], [999, { bri: 0 }]]) {
    assert.equal((await f.request(`/api/loads/${id}/target_state`, 'PUT', payload)).status, 400);
  }
  for (const [path, method, payload] of [
    ['/api/loads/1/state', 'PUT', { bri: 0 }],
    ['/api/loads/1/target_state', 'POST', { bri: 0 }],
    ['/api/read/loads', 'PUT', { bri: 0 }],
    ['/api/account/claim', 'POST', { user: 'attacker' }],
  ]) assert.equal((await f.request(path, method, payload)).status, 404);
  assert.equal(f.calls.length, before);
});

test('pairing uses unique usernames and never returns secrets', async t => {
  const f = await fixture(t);
  const first = await f.connect(true);
  assert.equal(first.status, 200);
  assert.ok(!JSON.stringify(first.body).includes('fake-secret'));
  assert.ok(!JSON.stringify(first.body).includes('not-for-browser'));
  const claim = f.calls.find(call => call.path === '/api/account/claim');
  assert.equal(claim.method, 'POST');
  assert.equal(claim.token, undefined);
  assert.match(claim.payload.user, /^local-poc-[a-f0-9-]{36}$/);
  assert.equal((await f.connect(true)).status, 200);
  const claims = f.calls.filter(call => call.path === '/api/account/claim');
  assert.notEqual(claims[0].payload.user, claims[1].payload.user);
  const session = await f.request('/api/session');
  assert.deepEqual(session.body, { connected: true, host: '127.0.0.1', connecting: false });
  assert.equal(session.headers.get('cache-control'), 'no-store');
});

test('Host, Origin and custom-header checks reject hostile webpages', async t => {
  const f = await fixture(t);
  const badHostStatus = await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${f.appPort}/api/session`, { headers: { Host: 'evil.example', 'X-Wiser-Client': 'local-poc' } }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
  });
  assert.equal(badHostStatus, 403);
  for (const headers of [{ Origin: 'https://evil.example' }, { 'X-Wiser-Client': '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await f.request('/api/connect', 'POST', { host: '127.0.0.1', pair: true }, headers)).status, 403, JSON.stringify(headers));
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request('/api/session', 'GET', undefined, { Origin: `http://127.0.0.1:${f.appPort}` })).status, 200);
});

test('upstream errors, redirects, invalid JSON and timeouts are safe', async t => {
  const f = await fixture(t, { timeout: 50 });
  for (const mode of ['http-error', 'invalid-json', 'envelope-error', 'redirect', 'timeout']) {
    f.setMode(mode);
    const result = await f.connect();
    assert.equal(result.status, mode === 'http-error' ? 401 : 502, mode);
    assert.ok(!JSON.stringify(result.body).includes('fake-secret'));
    assert.equal((await f.request('/api/session')).body.connected, false);
  }
});

test('disconnect clears session and prevents late pairing from reconnecting', async t => {
  const f = await fixture(t);
  await f.connect();
  assert.equal((await f.request('/api/disconnect', 'POST')).status, 200);
  assert.equal((await f.request('/api/read/loads')).status, 409);
  f.setMode('timeout');
  const pairing = f.connect(true);
  // Wait until claim is actually received rather than relying on a timer race.
  while (!f.calls.some(call => call.path === '/api/account/claim')) await new Promise(resolve => setTimeout(resolve, 5));
  await f.request('/api/disconnect', 'POST');
  assert.equal((await pairing).status, 502);
  assert.equal((await f.request('/api/session')).body.connected, false);
});

test('concurrent connects reject the second attempt, and disconnect permits a replacement', async t => {
  let arrived;
  const firstInfo = new Promise(resolve => { arrived = resolve; });
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  let infoCount = 0;
  const f = await fixture(t, {
    onGateway: async (req, res) => {
      if (req.url !== '/api/info' || ++infoCount !== 1) return false;
      arrived();
      await hold;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'success', data: { name: 'stale gateway' } }));
      return true;
    },
  });
  try {
    const first = f.connect();
    await firstInfo;
    assert.deepEqual((await f.request('/api/session')).body, { connected: false, host: null, connecting: true });
    assert.equal((await f.connect()).status, 409);
    assert.equal(infoCount, 1, 'rejected connect must not call the gateway');
    assert.equal((await f.request('/api/disconnect', 'POST')).status, 200);
    assert.equal((await f.connect()).status, 200);
    release();
    assert.equal((await first).status, 502);
    assert.deepEqual((await f.request('/api/session')).body, { connected: true, host: '127.0.0.1', connecting: false });
  } finally {
    release();
  }
});

test('disconnect cancels an in-flight discovery without restoring its old controls', async t => {
  let arrived;
  const oldLoadsRequested = new Promise(resolve => { arrived = resolve; });
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  let loadRequests = 0;
  const f = await fixture(t, {
    onGateway: async (req, res) => {
      if (req.url !== '/api/loads' || ++loadRequests !== 1) return false;
      arrived();
      await hold;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'success', data: [{ id: 99, type: 'dim' }] }));
      return true;
    },
  });
  try {
    await f.connect();
    const oldRead = f.request('/api/read/loads');
    await oldLoadsRequested;
    assert.equal((await f.request('/api/disconnect', 'POST')).status, 200);
    assert.equal((await f.connect()).status, 200);
    assert.equal((await f.request('/api/read/loads')).status, 200);
    release();
    assert.notEqual((await oldRead).status, 200);
    const before = f.calls.length;
    assert.equal((await f.request('/api/loads/99/target_state', 'PUT', { bri: 1000 })).status, 400);
    assert.equal(f.calls.length, before, 'a cancelled discovery must not add stale loads');
    assert.equal((await f.request('/api/loads/2/target_state', 'PUT', { bri: 1000 })).status, 200);
  } finally {
    release();
  }
});

test('credential failures on an established session do not disclose upstream bodies', async t => {
  const f = await fixture(t);
  assert.equal((await f.connect()).status, 200);
  for (const [mode, expected] of [['http-401', 401], ['http-403', 403], ['http-500', 502]]) {
    f.setMode(mode);
    const result = await f.request('/api/read/loads');
    assert.equal(result.status, expected, mode);
    assert.ok(!JSON.stringify(result.body).includes('fake-secret'), mode);
    assert.ok(!JSON.stringify(result.body).includes('Never relay'), mode);
    assert.equal((await f.request('/api/session')).body.connected, true);
  }
});

test('unsupported optional resources do not prevent required loads or controls', async t => {
  const f = await fixture(t, {
    onGateway: (req, res) => {
      if (req.url === '/api/rooms') { res.writeHead(405); res.end('Never relay fake-secret'); return true; }
      if (req.url === '/api/sensors') { res.writeHead(501); res.end('Never relay fake-secret'); return true; }
      return false;
    },
  });
  assert.equal((await f.connect()).status, 200);
  for (const [resource, status] of [['hvacgroups', 404], ['rooms', 405], ['sensors', 501]]) {
    const result = await f.request(`/api/read/${resource}`);
    assert.equal(result.status, status);
    assert.ok(!JSON.stringify(result.body).includes('fake-secret'));
  }
  assert.equal((await f.request('/api/read/loads')).status, 200);
  assert.equal((await f.request('/api/loads/2/target_state', 'PUT', { bri: 5000 })).status, 200);
  assert.equal(f.calls.at(-1).path, '/api/loads/2/target_state');
});

test('malformed load discovery revokes cached controls until a valid rediscovery', async t => {
  let malformed = false;
  const f = await fixture(t, {
    onGateway: (req, res) => {
      if (req.url !== '/api/loads' || !malformed) return false;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'success', data: [{ id: 2, type: 'dim' }, { id: '3', type: 'dim' }] }));
      return true;
    },
  });
  await f.connect();
  assert.equal((await f.request('/api/read/loads')).status, 200);
  malformed = true;
  assert.equal((await f.request('/api/read/loads')).status, 502);
  const before = f.calls.length;
  assert.equal((await f.request('/api/loads/2/target_state', 'PUT', { bri: 1234 })).status, 400);
  assert.equal(f.calls.length, before, 'invalid discovery must not leave controls writable');
  malformed = false;
  assert.equal((await f.request('/api/read/loads')).status, 200);
  assert.equal((await f.request('/api/loads/2/target_state', 'PUT', { bri: 1234 })).status, 200);
});

test('static app is served with security headers and no arbitrary file access', async t => {
  const f = await fixture(t);
  for (const path of ['/', '/app.js', '/style.css']) {
    const response = await fetch(`http://127.0.0.1:${f.appPort}${path}`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await response.text();
  }
  assert.equal((await f.request('/server.js')).status, 404);
});

test('invalid connection input never reaches the gateway', async t => {
  const f = await fixture(t);
  for (const payload of [
    { host: 'http://127.0.0.1', pair: true },
    { host: '127.0.0.1:80', pair: true },
    { host: '127.0.0.1', pair: true, token: 'fake-secret' },
    { host: '127.0.0.1', pair: false, token: '' },
    { host: '127.0.0.1', pair: false, token: 'bad\nheader' },
    { host: '127.0.0.1', pair: true, user: 'shared-account' },
    { host: '127.0.0.1', pair: 'true' },
  ]) assert.equal((await f.request('/api/connect', 'POST', payload)).status, 400);
  const invalidJson = await fetch(`http://127.0.0.1:${f.appPort}/api/connect`, {
    method: 'POST',
    headers: { 'X-Wiser-Client': 'local-poc', 'Content-Type': 'application/json' },
    body: '{broken',
  });
  assert.equal(invalidJson.status, 400);
  await invalidJson.text();
  assert.equal(f.calls.length, 0);
});

test('disconnect invalidates a connect whose body is still streaming', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const req = http.request(`http://127.0.0.1:${f.appPort}/api/connect`, {
    method: 'POST',
    headers: { 'X-Wiser-Client': 'local-poc', 'Content-Type': 'application/json' },
  });
  req.on('error', () => {});
  t.after(() => req.destroy());
  const response = new Promise(resolve => req.once('response', res => { res.resume(); resolve(res.statusCode); }));
  req.write('{"host":"127.0.0.1",');
  // Observe the pending attempt before disconnecting, rather than relying on a delay.
  while (!(await f.request('/api/session')).body.connecting) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.connect()).status, 409);
  await f.request('/api/disconnect', 'POST');
  req.end('"pair":true}');
  assert.equal(await response, 409);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request('/api/session')).body.connected, false);
});

test('abandoning a pending claim cannot retain credentials or clear a later session', { timeout: 5000 }, async t => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  let arrived;
  const claimed = new Promise(resolve => { arrived = resolve; });
  const f = await fixture(t, {
    onGateway: async (req, res) => {
      if (req.url !== '/api/account/claim') return false;
      arrived();
      await hold;
      res.end(JSON.stringify({ status: 'success', data: { secret: 'fake-secret' } }));
      return true;
    },
  });
  t.after(release);
  const req = http.request(`http://127.0.0.1:${f.appPort}/api/connect`, {
    method: 'POST',
    headers: { 'X-Wiser-Client': 'local-poc', 'Content-Type': 'application/json' },
  });
  req.on('error', () => {});
  t.after(() => req.destroy());
  req.end(JSON.stringify({ host: '127.0.0.1', pair: true }));
  await claimed;
  req.destroy();
  while ((await f.request('/api/session')).body.connecting) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.request('/api/session')).body.connected, false);
  assert.equal((await f.connect()).status, 200);
  release();
  assert.equal((await f.request('/api/session')).body.connected, true);
});

test('normal response closure preserves an established connection', async t => {
  const f = await fixture(t);
  assert.equal((await f.connect()).status, 200);
  assert.equal((await f.request('/api/session')).body.connected, true);
  assert.equal((await f.request('/api/read/loads')).status, 200);
});
