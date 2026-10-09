import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, validateHost, validateTarget } from '../server.js';

const personalMapping = { identity: '[1,null,null,"dim"]', name: 'My light', room: 'My room', notes: 'My note' };

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
  let draftScope;
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
    if (/^\/api\/loads\/[1-4]$/.test(req.url)) data = { id: Number(req.url.split('/').at(-1)), name: 'Light', type: 'onoff', room: 0 };
    if (req.url === '/api/rooms') data = [{ id: 0, name: 'Ground floor' }, { id: 2, name: 'Office' }];
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'success', data }));
  });
  const port = await listen(gateway);
  const app = createApp({ gatewayPort: port, timeout: 1000, ...options });
  const appPort = await listen(app);
  t.after(async () => { await close(app); await close(gateway); });
  async function request(path, method = 'GET', payload, headers = {}) {
    const requestHeaders = { 'X-Wiser-Client': 'local-poc', ...(['PUT', 'PATCH'].includes(method) ? { 'X-Wiser-Intent': 'live', 'X-Wiser-Scope': draftScope } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers };
    // Explicit undefined removes the compatibility default to exercise browser preview requests.
    for (const key of Object.keys(requestHeaders)) if (requestHeaders[key] === undefined) delete requestHeaders[key];
    const res = await fetch(`http://127.0.0.1:${appPort}${path}`, {
      method,
      headers: requestHeaders,
      body: payload ? JSON.stringify(payload) : undefined,
    });
    return { status: res.status, body: await res.json(), headers: res.headers };
  }
  async function connect(pair = false) {
    const result = await request('/api/connect', 'POST', { host: '127.0.0.1', pair, ...(!pair ? { token: 'fake-secret' } : {}) });
    if (result.status === 200) draftScope = result.body.draftScope;
    return result;
  }
  return { calls, request, connect, appPort, setMode: value => { mode = value; } };
}

test('gateway host accepts canonical addresses and DNS names, rejects URL injection', () => {
  for (const host of ['192.168.1.2', 'wiser.local', 'localhost', '2001:db8::1']) assert.ok(validateHost(host));
  for (const host of ['', 'http://wiser', 'wiser:80', 'wiser/path', 'user@wiser', 'wiser?x=1', 'wiser#x', ' wiser', 'wiser\n', '127.1', '2130706433', '0177.0.0.1', '0x7f000001', '-bad.local', '[::1]']) {
    assert.throws(() => validateHost(host), undefined, host);
  }
});

test('local mapping CRUD and import work disconnected without gateway requests or live intent', async t => {
  const f = await fixture(t);
  const base = '/api/local/mappings';
  const localHeaders = { 'X-Wiser-Intent': undefined, 'X-Wiser-Scope': undefined };
  assert.deepEqual((await f.request(`${base}?gateway=wiser.local`)).body, { data: {} });
  const saved = await f.request(`${base}/1?gateway=WISER.LOCAL`, 'PUT', personalMapping, localHeaders);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, { data: { 1: personalMapping } });
  assert.deepEqual((await f.request(`${base}?gateway=other.local`)).body.data, {});
  const imported = await f.request(`${base}/import?gateway=wiser.local`, 'POST', { mappings: { 1: { ...personalMapping, name: 'Imported' }, 2: personalMapping } });
  assert.deepEqual(imported.body.data, { 1: personalMapping, 2: personalMapping });
  assert.deepEqual((await f.request(`${base}/1?gateway=wiser.local`, 'DELETE')).body.data, { 2: personalMapping });
  assert.equal((await f.request(`${base}/3?gateway=2001%3Adb8%3A%3A1`, 'PUT', personalMapping, localHeaders)).status, 200);
  assert.equal((await f.request(`${base}/4?gateway=sample-home`, 'PUT', personalMapping, localHeaders)).status, 200);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request('/api/session')).body.connected, false);
});

test('local mappings enforce gateway, fields, collection and local request protections', async t => {
  const f = await fixture(t);
  const base = '/api/local/mappings';
  for (const query of ['', '?gateway=', '?gateway=wiser.local&gateway=other.local', '?gateway=wiser.local&extra=1', '?gateway=http%3A%2F%2Fwiser.local', '?gateway=127.1']) {
    assert.equal((await f.request(`${base}${query}`)).status, 400, query);
  }
  for (const mapping of [{ ...personalMapping, token: 'secret' }, { ...personalMapping, name: '' }, { ...personalMapping, notes: 'x'.repeat(1001) }]) {
    assert.equal((await f.request(`${base}/1?gateway=wiser.local`, 'PUT', mapping)).status, 400);
  }
  assert.equal((await f.request(`${base}/import?gateway=wiser.local`, 'POST', { mappings: { 1: personalMapping, 2: { ...personalMapping, room: 1 } } })).status, 400);
  assert.deepEqual((await f.request(`${base}?gateway=wiser.local`)).body.data, {});
  for (const headers of [{ 'X-Wiser-Client': undefined }, { Origin: 'http://evil.local' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await f.request(`${base}/1?gateway=wiser.local`, 'PUT', personalMapping, headers)).status, 403, JSON.stringify(headers));
  }
  const badHost = await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${f.appPort}${base}?gateway=wiser.local`, { headers: { Host: 'evil.local', 'X-Wiser-Client': 'local-poc' } }, res => {
      res.resume(); resolve(res.statusCode);
    });
    req.on('error', reject);
  });
  assert.equal(badHost, 403);
  assert.equal((await f.request(`${base}/import?gateway=wiser.local`, 'POST', { mappings: {}, extra: true })).status, 400);
  assert.equal((await f.request(`${base}/nope?gateway=wiser.local`, 'DELETE')).status, 404);
  assert.equal(f.calls.length, 0);
});

test('local import accepts validated collections larger than gateway request limits', async t => {
  const f = await fixture(t);
  const mappings = Object.fromEntries(Array.from({ length: 12 }, (_, id) => [id, { ...personalMapping, notes: 'x'.repeat(1000) }]));
  const result = await f.request('/api/local/mappings/import?gateway=sample-home', 'POST', { mappings });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, mappings);
  assert.equal(f.calls.length, 0);
});

test('local API mappings persist after the app server closes and restarts', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'wiser-api-')), 'wiser.sqlite');
  let app = createApp({ dbPath });
  let port = await listen(app);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/local/mappings/1?gateway=sample-home`, {
      method: 'PUT', headers: { 'X-Wiser-Client': 'local-poc', 'Content-Type': 'application/json' },
      body: JSON.stringify(personalMapping),
    });
    assert.equal(response.status, 200);
    await response.json();
  } finally { await close(app); }
  app = createApp({ dbPath });
  port = await listen(app);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/local/mappings?gateway=sample-home`, { headers: { 'X-Wiser-Client': 'local-poc' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: { 1: personalMapping } });
  } finally { await close(app); }
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

test('DALI target validation respects subtype ranges and permits partial targets', () => {
  for (const [sub_type, target] of [
    [undefined, { bri: 0 }], ['', { bri: 10000 }],
    ['tw', { bri: 1234, ct: 1000 }], ['tw', { ct: 20000 }],
    ['rgb', { bri: 10000, red: 0, green: 255, blue: 128, white: 255 }],
    ['rgb', { red: 1 }], ['rgb', { white: 0 }],
  ]) assert.doesNotThrow(() => validateTarget({ type: 'dali', sub_type }, target));
  for (const sub_type of [undefined, '', 'tw', 'rgb']) {
    for (const target of [{}, null, [], { bri: '1' }, { bri: 1.2 }, { bri: -1 }, { bri: 10001 }, { extra: 1 }]) {
      assert.throws(() => validateTarget({ type: 'dali', sub_type }, target));
    }
  }
  for (const [sub_type, target] of [
    [undefined, { ct: 1000 }], ['', { red: 1 }],
    ['tw', { red: 1 }], ['tw', { ct: 999 }], ['tw', { ct: 20001 }], ['tw', { ct: 1000.5 }], ['tw', { ct: '1000' }],
    ['rgb', { ct: 1000 }],
    ...['red', 'green', 'blue', 'white'].flatMap(field => [-1, 256, 1.5, '1', null, true].map(value => ['rgb', { [field]: value }])),
    ['other', { bri: 1 }], [null, { bri: 1 }], [0, { bri: 1 }],
  ]) assert.throws(() => validateTarget({ type: 'dali', sub_type }, target));
  assert.throws(() => validateTarget({ type: 'dali', sub_type: 'rgb', unused: true }, { red: 1 }));
});

test('DALI proxy forwards multi-field and partial targets and rejects incompatible writes locally', async t => {
  const loads = [
    { id: 5, type: 'dali' }, { id: 6, type: 'dali', sub_type: 'tw' },
    { id: 7, type: 'dali', sub_type: 'rgb' }, { id: 8, type: 'dali', sub_type: 'unknown' },
    { id: 9, type: 'dali', sub_type: 'rgb', unused: true },
  ];
  const f = await fixture(t, { onGateway(req, res) {
    if (req.url !== '/api/loads') return false;
    res.end(JSON.stringify({ status: 'success', data: loads }));
    return true;
  } });
  await f.connect();
  const beforeDiscovery = f.calls.length;
  assert.equal((await f.request('/api/loads/7/target_state', 'PUT', { red: 1 })).status, 400);
  assert.equal(f.calls.length, beforeDiscovery);
  assert.equal((await f.request('/api/read/loads')).status, 200);
  for (const [id, payload] of [[5, { bri: 1234 }], [6, { bri: 5000, ct: 4000 }], [6, { ct: 20000 }],
    [7, { bri: 5000, red: 255, green: 0, blue: 127, white: 12 }], [7, { blue: 22 }]]) {
    assert.equal((await f.request(`/api/loads/${id}/target_state`, 'PUT', payload)).status, 200);
    assert.deepEqual(f.calls.at(-1), { path: `/api/loads/${id}/target_state`, method: 'PUT', token: 'Bearer fake-secret', payload });
  }
  const beforeInvalid = f.calls.length;
  for (const [id, payload] of [[5, { ct: 4000 }], [6, { red: 1 }], [7, { ct: 4000 }],
    [7, { red: 256 }], [7, {}], [8, { bri: 1 }], [9, { red: 1 }]]) {
    assert.equal((await f.request(`/api/loads/${id}/target_state`, 'PUT', payload)).status, 400);
  }
  assert.equal(f.calls.length, beforeInvalid);
  await f.request('/api/disconnect', 'POST', {});
  const beforeDisconnected = f.calls.length;
  assert.equal((await f.request('/api/loads/7/target_state', 'PUT', { red: 1 })).status, 409);
  assert.equal(f.calls.length, beforeDisconnected);
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
  assert.deepEqual(session.body, { connected: true, host: '127.0.0.1', connecting: false, draftScope: session.body.draftScope, remembered: false, credentialError: '' });
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
    assert.deepEqual((await f.request('/api/session')).body, { connected: false, host: null, connecting: true, draftScope: null, remembered: false, credentialError: '' });
    assert.equal((await f.connect()).status, 409);
    assert.equal(infoCount, 1, 'rejected connect must not call the gateway');
    assert.equal((await f.request('/api/disconnect', 'POST')).status, 200);
    const replacement = await f.connect();
    assert.equal(replacement.status, 200);
    release();
    assert.equal((await first).status, 502);
    assert.deepEqual((await f.request('/api/session')).body, { connected: true, host: '127.0.0.1', connecting: false, draftScope: replacement.body.draftScope, remembered: false, credentialError: '' });
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
  const html = await (await fetch(`http://127.0.0.1:${f.appPort}/`)).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]);
  assert.ok(assets.some(path => path.endsWith('.js')));
  assert.ok(assets.some(path => path.endsWith('.css')));
  for (const path of ['/', ...assets]) {
    const response = await fetch(`http://127.0.0.1:${f.appPort}${path}`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await response.text();
  }
  assert.equal((await f.request('/server.js')).status, 404);
  assert.equal((await f.request('/assets/missing.js')).status, 404);
  assert.equal((await f.request('/src/App.svelte')).status, 404);
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

const integrationToken = 'test-integration-token-01234567890';
const machineHeaders = { 'X-Wiser-Client': undefined, Authorization: `Bearer ${integrationToken}` };
const snapshotPath = '/api/integration/v1/snapshot';

test('remembered gateway reconnects after restart and forget prevents future reconnect', async t => {
  const credentialDir = join(mkdtempSync(join(tmpdir(), 'wiser-remember-')), 'credentials');
  const f = await fixture(t, { credentialDir });
  const saved = await f.request('/api/connect', 'POST', { host: '127.0.0.1', token: 'fake-secret', pair: false, remember: true });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.remembered, true);
  await f.request('/api/disconnect-session', 'POST');
  assert.equal((await f.request('/api/session')).body.remembered, true);
  assert.equal((await f.request('/api/reconnect', 'POST')).status, 200);
  assert.ok(!JSON.stringify((await f.request('/api/session')).body).includes('fake-secret'));
  // A second app instance reads the same encrypted store; all gateways here are fake.
  const second = await fixture(t, { credentialDir });
  for (let attempt = 0; attempt < 50; attempt++) {
    const status = (await second.request('/api/session')).body;
    if (!status.connecting) { assert.equal(status.connected, true); break; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal((await second.request('/api/session')).body.connected, true);
  assert.equal(second.calls.some(call => call.method !== 'GET'), false);
  await second.request('/api/disconnect', 'POST');
  assert.equal((await second.request('/api/session')).body.remembered, false);
  const third = await fixture(t, { credentialDir });
  assert.equal((await third.request('/api/session')).body.connected, false);
  assert.equal(third.calls.length, 0);
});

test('invalid credentials are never remembered and failed startup keeps retry possible', async t => {
  const credentialDir = join(mkdtempSync(join(tmpdir(), 'wiser-failed-remember-')), 'credentials');
  const f = await fixture(t, { credentialDir });
  f.setMode('http-401');
  assert.equal((await f.request('/api/connect', 'POST', { host: '127.0.0.1', token: 'fake-secret', pair: false, remember: true })).status, 401);
  assert.equal((await f.request('/api/session')).body.remembered, false);
  f.setMode('');
  await f.request('/api/connect', 'POST', { host: '127.0.0.1', token: 'fake-secret', pair: false, remember: true });
  const second = await fixture(t, { credentialDir, onGateway(req, res) { res.writeHead(401); res.end(); return true; } });
  for (let attempt = 0; attempt < 50 && (await second.request('/api/session')).body.connecting; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  const status = (await second.request('/api/session')).body;
  assert.equal(status.connected, false);
  assert.equal(status.remembered, true);
  assert.match(status.credentialError, /could not connect/);
  assert.equal(second.calls.some(call => call.method !== 'GET'), false);
});

test('integration is opt-in, validates credentials, and retains local request protections', async t => {
  for (const token of ['short', 'x'.repeat(257), 'x'.repeat(32) + '\n', 'x'.repeat(32) + '+', null]) assert.throws(() => createApp({ integrationToken: token }));
  const disabled = await fixture(t);
  assert.equal((await disabled.request(snapshotPath, 'GET', undefined, machineHeaders)).status, 404);
  const f = await fixture(t, { integrationToken });
  for (const Authorization of [undefined, '', 'Bearer wrong', `Bearer ${'x'.repeat(32)}`]) {
    const result = await f.request(snapshotPath, 'GET', undefined, { ...machineHeaders, Authorization });
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: 'Unauthorized.' });
  }
  assert.equal((await f.request(`${snapshotPath}?token=${integrationToken}`, 'GET', undefined, { 'X-Wiser-Client': undefined })).status, 401);
  assert.equal((await f.request(`${snapshotPath}?token=${integrationToken}`, 'GET', undefined, machineHeaders)).status, 404);
  for (const headers of [{ Origin: 'http://evil.local' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await f.request(snapshotPath, 'GET', undefined, { ...machineHeaders, ...headers })).status, 403);
  }
  const badHost = await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${f.appPort}${snapshotPath}`, { headers: { Host: 'evil.local', Authorization: `Bearer ${integrationToken}` } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(badHost, 403);
  assert.equal((await f.request('/api/session', 'GET', undefined, machineHeaders)).status, 403);
  assert.equal((await f.request(snapshotPath, 'GET', undefined, machineHeaders)).status, 409);
  assert.equal(f.calls.length, 0);
});

test('snapshot merges matching personal labels, exposes safe fields, and does not discover browser controls', async t => {
  const load = { id: 1, device: 3, channel: 2, type: 'dim', sub_type: '', room: 2, name: `Light fake-secret ${integrationToken}`, secret: 'private' };
  const f = await fixture(t, { integrationToken, onGateway(req, res) {
    const data = req.url === '/api/loads' ? [load] : req.url === '/api/loads/state'
      ? [{ id: 1, state: { bri: 1234, ct: 1.5, red: '5', green: -1, blue: 256, secret: 'private', notes: 'private' } }] : undefined;
    if (!data) return false;
    res.end(JSON.stringify({ status: 'success', data }));
    return true;
  } });
  await f.connect();
  const first = await f.request(snapshotPath, 'GET', undefined, machineHeaders);
  assert.equal(first.status, 200);
  assert.equal(first.body.version, 1);
  assert.equal(first.body.gateway, '127.0.0.1');
  assert.ok(!JSON.stringify(first.body).includes(integrationToken));
  assert.ok(!JSON.stringify(first.body).includes('fake-secret'));
  assert.deepEqual(first.body.entities[0].state, { bri: 1234 });
  assert.equal(first.body.entities[0].room, 'Office');
  assert.match(first.body.observed_at, /^\d{4}-/);
  await f.request('/api/local/mappings/1?gateway=127.0.0.1', 'PUT', { identity: '[1,3,2,"dim"]', name: 'Personal', room: 'Personal room', notes: 'hidden' });
  const second = (await f.request(snapshotPath, 'GET', undefined, machineHeaders)).body;
  assert.equal(second.entities[0].name, 'Personal');
  assert.equal(second.entities[0].room, 'Personal room');
  assert.equal(second.entities[0].identity, first.body.entities[0].identity);
  assert.ok(!JSON.stringify(second).includes('hidden'));
  await f.request('/api/local/mappings/1?gateway=127.0.0.1', 'PUT', { identity: '[1,3,2,"dim"]', name: 'Unassigned', room: '', notes: '' });
  assert.equal((await f.request(snapshotPath, 'GET', undefined, machineHeaders)).body.entities[0].room, '');
  await f.request('/api/local/mappings/1?gateway=127.0.0.1', 'PUT', { identity: '[1,999,2,"dim"]', name: 'Wrong hardware', room: 'Wrong room', notes: '' });
  const mismatched = (await f.request(snapshotPath, 'GET', undefined, machineHeaders)).body.entities[0];
  assert.notEqual(mismatched.name, 'Wrong hardware');
  assert.equal(mismatched.room, 'Office');
  const before = f.calls.length;
  assert.equal((await f.request('/api/loads/1/target_state', 'PUT', { bri: 0 })).status, 400);
  assert.equal(f.calls.length, before);
  f.setMode('http-500');
  assert.equal((await f.request(snapshotPath, 'GET', undefined, machineHeaders)).status, 502);
});

test('integration control requires opt-in and fresh matching identity and scope', async t => {
  const readOnly = await fixture(t, { integrationToken });
  assert.equal((await readOnly.request('/api/integration/v1/loads/1/target', 'PUT', {}, machineHeaders)).status, 403);
  assert.equal(readOnly.calls.length, 0);
  let changed = false;
  const f = await fixture(t, { integrationToken, integrationControl: true, onGateway(req, res) {
    if (req.url !== '/api/loads/1' || !changed) return false;
    res.end(JSON.stringify({ status: 'success', data: { id: 1, type: 'onoff', channel: 42 } }));
    return true;
  } });
  await f.connect();
  const snapshot = (await f.request(snapshotPath, 'GET', undefined, machineHeaders)).body;
  const input = { scope: snapshot.scope, identity: snapshot.entities[0].identity, target: { bri: 10000 } };
  const route = '/api/integration/v1/loads/1/target';
  for (const invalid of [{ ...input, scope: 'old' }, { ...input, identity: 'f'.repeat(64) }, { ...input, target: { bri: 5 } }, { ...input, target: { bri: 0, extra: 1 } }, { ...input, extra: true }]) {
    assert.ok([400, 409].includes((await f.request(route, 'PUT', invalid, machineHeaders)).status));
  }
  assert.equal(f.calls.some(call => call.method === 'PUT'), false);
  assert.deepEqual((await f.request(route, 'PUT', input, machineHeaders)).body, { accepted: true });
  assert.deepEqual(f.calls.at(-1).payload, { bri: 10000 });
  changed = true;
  assert.equal((await f.request(route, 'PUT', input, machineHeaders)).status, 409);
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
  await f.connect();
  const before = f.calls.length;
  assert.equal((await f.request(route, 'PUT', input, machineHeaders)).status, 409);
  assert.equal(f.calls.length, before);
});

test('integration forwards DALI and blind targets without converting native units', async t => {
  const loads = [
    { id: 6, type: 'dali', sub_type: 'tw', device: 'dali-white', channel: 0 },
    { id: 7, type: 'dali', sub_type: 'rgb', device: 'dali-color', channel: 1 },
    { id: 8, type: 'motor', device: 'blind', channel: 0 },
  ];
  const f = await fixture(t, { integrationToken, integrationControl: true, onGateway(req, res) {
    const single = /^\/api\/loads\/(6|7|8)$/.exec(req.url);
    if (req.url !== '/api/loads' && !single) return false;
    res.end(JSON.stringify({ status: 'success', data: single ? loads.find(load => load.id === Number(single[1])) : loads }));
    return true;
  } });
  await f.connect();
  const snapshot = (await f.request(snapshotPath, 'GET', undefined, machineHeaders)).body;
  const targets = [{ ct: 4200 }, { red: 255, white: 64 }, { level: 2500 }];
  for (const [index, entity] of snapshot.entities.entries()) {
    assert.deepEqual(entity.state, {});
    const result = await f.request(`/api/integration/v1/loads/${entity.id}/target`, 'PUT', {
      scope: snapshot.scope, identity: entity.identity, target: targets[index],
    }, machineHeaders);
    assert.equal(result.status, 200);
  }
  assert.deepEqual(f.calls.filter(call => call.method === 'PUT').map(call => call.payload), targets);
});

test('disconnect during integration preflight prevents control and cached snapshots', async t => {
  let arrived;
  const requested = new Promise(resolve => { arrived = resolve; });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let hold = false;
  const f = await fixture(t, { integrationToken, integrationControl: true, onGateway: async (req, res) => {
    if (!hold || req.url !== '/api/loads/1') return false;
    arrived();
    await held;
    res.end(JSON.stringify({ status: 'success', data: { id: 1, type: 'onoff' } }));
    return true;
  } });
  try {
    await f.connect();
    const snapshot = (await f.request(snapshotPath, 'GET', undefined, machineHeaders)).body;
    hold = true;
    const applying = f.request('/api/integration/v1/loads/1/target', 'PUT', { scope: snapshot.scope, identity: snapshot.entities[0].identity, target: { bri: 0 } }, machineHeaders);
    await requested;
    await f.request('/api/disconnect', 'POST');
    await f.connect();
    release();
    assert.notEqual((await applying).status, 200);
    assert.equal(f.calls.some(call => call.method === 'PUT'), false);
    await f.request('/api/disconnect', 'POST');
    assert.equal((await f.request(snapshotPath, 'GET', undefined, machineHeaders)).status, 409);
  } finally { release(); }
});

test('draft scope stays stable within a session and changes on every connection', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/session')).body.draftScope, null);
  const first = await f.connect();
  assert.match(first.body.draftScope, /^[a-f0-9-]{36}$/);
  assert.equal((await f.request('/api/session')).body.draftScope, first.body.draftScope);
  await f.request('/api/read/loads');
  assert.equal((await f.request('/api/session')).body.draftScope, first.body.draftScope);
  const second = await f.connect();
  assert.notEqual(second.body.draftScope, first.body.draftScope);
  assert.equal((await f.request('/api/session')).body.draftScope, second.body.draftScope);
  await f.request('/api/disconnect', 'POST');
  assert.equal((await f.request('/api/session')).body.draftScope, null);
});

test('writes require explicit live intent before any gateway request', async t => {
  const f = await fixture(t);
  await f.connect();
  await f.request('/api/read/loads');
  const before = f.calls.length;
  for (const intent of [undefined, '', 'preview', 'LIVE']) {
    for (const [path, method, payload] of [
      ['/api/loads/1/target_state', 'PUT', { bri: 0 }],
      ['/api/loads/1/config', 'PATCH', { changes: { name: 'New' }, expected: { name: 'Light' } }],
    ]) assert.equal((await f.request(path, method, payload, { 'X-Wiser-Intent': intent })).status, 403);
  }
  assert.equal(f.calls.length, before);
});

test('writes from a prior tab session cannot act on a replacement connection', async t => {
  const f = await fixture(t);
  const old = await f.connect();
  await f.connect();
  await f.request('/api/read/loads');
  const before = f.calls.length;
  for (const scope of [undefined, old.body.draftScope, 'invalid']) {
    for (const [path, method, payload] of [
      ['/api/loads/1/target_state', 'PUT', { bri: 0 }],
      ['/api/loads/1/config', 'PATCH', { changes: { name: 'New' }, expected: { name: 'Light' } }],
    ]) assert.equal((await f.request(path, method, payload, { 'X-Wiser-Scope': scope })).status, 409);
  }
  assert.equal(f.calls.length, before);
});

test('configuration refuses a load whose discovered physical identity changed', async t => {
  for (const field of ['device', 'channel', 'type', 'sub_type']) {
    const f = await fixture(t, { onGateway(req, res) {
      if (req.url !== '/api/loads/1') return false;
      res.end(JSON.stringify({ status: 'success', data: { id: 1, name: 'Light', type: 'onoff', [field]: field === 'type' ? 'dim' : 42 } }));
      return true;
    } });
    await f.connect();
    await f.request('/api/read/loads');
    assert.equal((await f.request('/api/loads/1/config', 'PATCH', { changes: { name: 'New' }, expected: { name: 'Light' } })).status, 409, field);
    assert.equal(f.calls.some(call => call.method === 'PATCH'), false);
  }
});

test('concurrent discovery cannot replace the identity captured for configuration preflight', async t => {
  let arrived;
  const requested = new Promise(resolve => { arrived = resolve; });
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  let refreshed = false;
  const f = await fixture(t, { onGateway: async (req, res) => {
    if (req.url === '/api/loads' && refreshed) {
      res.end(JSON.stringify({ status: 'success', data: [{ id: 1, name: 'Light', type: 'dim' }] }));
      return true;
    }
    if (req.url !== '/api/loads/1') return false;
    arrived();
    await hold;
    res.end(JSON.stringify({ status: 'success', data: { id: 1, name: 'Light', type: 'dim' } }));
    return true;
  } });
  try {
    await f.connect();
    await f.request('/api/read/loads');
    const applying = f.request('/api/loads/1/config', 'PATCH', { changes: { name: 'New' }, expected: { name: 'Light' } });
    await requested;
    refreshed = true;
    assert.equal((await f.request('/api/read/loads')).status, 200);
    release();
    assert.equal((await applying).status, 409);
    assert.equal(f.calls.some(call => call.method === 'PATCH'), false);
  } finally { release(); }
});

test('configuration forwards only changed metadata with fresh optimistic preflight', async t => {
  const f = await fixture(t);
  await f.connect();
  const input = { changes: { name: '  New light  ' }, expected: { name: 'Light' } };
  assert.equal((await f.request('/api/loads/1/config', 'PATCH', input)).status, 400);
  await f.request('/api/read/loads');
  assert.equal((await f.request('/api/loads/1/config', 'PATCH', input)).status, 200);
  assert.deepEqual(f.calls.at(-1), { path: '/api/loads/1', method: 'PATCH', token: 'Bearer fake-secret', payload: { name: 'New light' } });
  assert.equal((await f.request('/api/loads/1/config', 'PATCH', { changes: { room: 2 }, expected: { room: 0 } })).status, 200);
  assert.deepEqual(f.calls.slice(-3).map(call => [call.path, call.method]), [['/api/loads/1', 'GET'], ['/api/rooms', 'GET'], ['/api/loads/1', 'PATCH']]);
  assert.deepEqual(f.calls.at(-1).payload, { room: 2 });
  const patches = f.calls.filter(call => call.method === 'PATCH').length;
  assert.equal((await f.request('/api/loads/1/config', 'PATCH', { changes: { name: 'Other' }, expected: { name: 'Stale' } })).status, 409);
  assert.equal((await f.request('/api/loads/1/config', 'PATCH', { changes: { room: 99 }, expected: { room: 0 } })).status, 400);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, patches);
});

test('configuration rejects malformed and read-only changes without upstream requests', async t => {
  const f = await fixture(t);
  await f.connect();
  await f.request('/api/read/loads');
  const before = f.calls.length;
  for (const input of [
    {}, { changes: {}, expected: {} }, { changes: { type: 'dim' }, expected: { type: 'onoff' } },
    { changes: { name: 'New' }, expected: {} },
    { changes: { name: 'New' }, expected: { name: 'Light', room: 0 } },
    ...['', '   ', 'x'.repeat(101), 1, null].map(name => ({ changes: { name }, expected: { name: 'Light' } })),
    ...[-1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1].map(room => ({ changes: { room }, expected: { room: 0 } })),
    { changes: { name: 'New' }, expected: { name: 42 } },
    { changes: { room: 2 }, expected: { room: '0' } },
    { changes: { name: 'New' }, expected: { name: 'Light' }, extra: true },
  ]) assert.equal((await f.request('/api/loads/1/config', 'PATCH', input)).status, 400, JSON.stringify(input));
  assert.equal(f.calls.length, before);
});

test('configuration accepts null expected metadata for absent fields', async t => {
  const f = await fixture(t, { onGateway(req, res) {
    if (req.url !== '/api/loads/1') return false;
    res.end(JSON.stringify({ status: 'success', data: { id: 1, type: 'onoff' } }));
    return true;
  } });
  await f.connect();
  await f.request('/api/read/loads');
  assert.equal((await f.request('/api/loads/1/config', 'PATCH', { changes: { name: 'Named', room: 2 }, expected: { name: null, room: null } })).status, 200);
  assert.deepEqual(f.calls.at(-1).payload, { name: 'Named', room: 2 });
});

test('disconnect during configuration preflight prevents PATCH after reconnect', async t => {
  for (const heldPath of ['/api/loads/1', '/api/rooms']) {
    let arrived;
    const requested = new Promise(resolve => { arrived = resolve; });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const f = await fixture(t, { onGateway: async (req, res) => {
      if (req.url !== heldPath) return false;
      arrived();
      await held;
      res.end(JSON.stringify({ status: 'success', data: heldPath === '/api/rooms' ? [{ id: 2 }] : { id: 1, name: 'Light', room: 0, type: 'onoff' } }));
      return true;
    } });
    try {
      await f.connect();
      await f.request('/api/read/loads');
      const applying = f.request('/api/loads/1/config', 'PATCH', { changes: { room: 2 }, expected: { room: 0 } });
      await requested;
      await f.request('/api/disconnect', 'POST');
      await f.connect();
      release();
      assert.notEqual((await applying).status, 200);
      assert.equal(f.calls.some(call => call.method === 'PATCH'), false);
    } finally { release(); }
  }
});
