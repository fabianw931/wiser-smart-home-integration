import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { createApp } from '../server.js';

const token = 'test-integration-token-01234567890';
const machine = { Authorization: `Bearer ${token}` };
const local = { 'X-Wiser-Client': 'local-poc', 'Content-Type': 'application/json' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A fake gateway with a call log and mutable collections, plus a WebSocket endpoint at /api.
async function fixture(t, { live = false, ...options } = {}) {
  const calls = [];
  const data = {
    '/api/loads': [{ id: 1, name: 'Light', type: 'dim', device: '0001', channel: 0, room: 0 }],
    '/api/loads/state': [{ id: 1, state: { bri: 1000 } }],
    '/api/rooms': [{ id: 0, name: 'Hall' }],
    '/api/sensors': [], '/api/buttons': [],
  };
  let failing = false;
  const gateway = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    calls.push({ method: req.method, path: req.url, payload: raw ? JSON.parse(raw) : undefined });
    if (failing) { res.writeHead(500); return res.end(); }
    res.setHeader('Content-Type', 'application/json');
    const single = /^\/api\/loads\/(\d+)$/.exec(req.url);
    const body = single ? data['/api/loads'].find(load => load.id === Number(single[1])) : data[req.url] ?? {};
    res.end(JSON.stringify({ status: 'success', data: body }));
  });
  const upstream = new WebSocketServer({ server: gateway, path: '/api' });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  const app = createApp({ gatewayPort: gateway.address().port, liveEnabled: live, integrationToken: token, ...options });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); app.close(); for (const socket of upstream.clients) socket.terminate(); upstream.close(); gateway.closeAllConnections(); gateway.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const socket = live ? once(upstream, 'connection').then(([ws]) => ws) : null;
  return {
    calls, data, base, socket, setFailing: value => { failing = value; },
    reads: () => calls.filter(call => call.method === 'GET').length,
    async connect() { const response = await fetch(`${base}/api/connect`, { method: 'POST', headers: local, body: JSON.stringify({ host: '127.0.0.1', token: 'test-secret', pair: false }) }); const result = await response.json(); calls.length = 0; return result; },
    async snapshot() { const response = await fetch(`${base}/api/integration/v1/snapshot`, { headers: machine }); return { status: response.status, body: await response.json() }; },
    async put(path, payload, headers = machine) { const response = await fetch(`${base}${path}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); return { status: response.status, body: await response.json() }; },
    async local(path, method = 'GET') { const response = await fetch(`${base}${path}`, { method, headers: local }); return { status: response.status, body: await response.json() }; },
  };
}

test('snapshot lists sensors and buttons with stable identities and never guesses readings', async t => {
  const f = await fixture(t);
  f.data['/api/sensors'] = [
    { id: 19, name: 'Terrace', device: '0000a98f', channel: 0, type: 'temperature', sub_type: '', unit: '℃', value: 0, token: 'hidden' },
    { id: 24, name: `Wind ${token}`, device: '00000124', channel: 3, type: 'wind', sub_type: '', unit: 'm/s', value: 0 },
    { id: 25, name: 'Rain', device: '00000124', channel: 4, type: 'rain', sub_type: '', unit: 'bool', value: false },
    { id: 26, device: '00000124', channel: 5, type: 'hail', unit: 'bool', value: 'maybe' },
    { id: 27, device: '00000124', channel: 2, type: 'illuminance', unit: 'lux', value: { raw: 5 } },
    { id: 28, device: '00000124', channel: 6, type: 'temperature', unit: '°C', value: NaN },
  ];
  f.data['/api/buttons'] = [
    { id: null, device: '0000a98f', channel: 1, type: 'button', sub_type: 'up down', secret: 'hidden' },
    { id: 101, device: '0000a98f', channel: 0, type: 'button', sub_type: 'up down', job: 8 },
    { id: 5, device: '0000b000', channel: 0, type: 'button' },
    { id: 6, device: '0000b000', channel: 0, type: 'button' },
    { id: 7, device: 'not hex!', channel: 0, type: 'button' },
    { id: 8, device: '0000c000', channel: -1, type: 'button' },
  ];
  await f.connect();
  const first = (await f.snapshot()).body;
  assert.equal(first.version, 1);
  assert.ok(!JSON.stringify(first).includes(token));
  assert.ok(!JSON.stringify(first).includes('hidden'));
  assert.deepEqual(first.sensors.map(({ identity, ...rest }) => rest), [
    { id: 19, name: 'Terrace', type: 'temperature', sub_type: '', unit: '℃', value: 0, device: '0000a98f', channel: 0 },
    { id: 24, name: 'Wind [redacted]', type: 'wind', sub_type: '', unit: 'm/s', value: 0, device: '00000124', channel: 3 },
    { id: 25, name: 'Rain', type: 'rain', sub_type: '', unit: 'bool', value: false, device: '00000124', channel: 4 },
    { id: 26, name: null, type: 'hail', sub_type: null, unit: 'bool', value: null, device: '00000124', channel: 5 },
    { id: 27, name: null, type: 'illuminance', sub_type: null, unit: 'lux', value: null, device: '00000124', channel: 2 },
    { id: 28, name: null, type: 'temperature', sub_type: null, unit: '°C', value: null, device: '00000124', channel: 6 },
  ]);
  // Only uniquely addressable, identifiable physical inputs are offered.
  assert.deepEqual(first.buttons.map(({ identity, ...rest }) => rest), [
    { id: null, name: null, device: '0000a98f', channel: 1, type: 'button', sub_type: 'up down', registered: false },
    { id: 101, name: null, device: '0000a98f', channel: 0, type: 'button', sub_type: 'up down', registered: true },
  ]);
  const identities = [...first.entities, ...first.sensors, ...first.buttons].map(item => item.identity);
  assert.ok(identities.every(identity => /^[a-f0-9]{64}$/.test(identity)));
  assert.equal(new Set(identities).size, identities.length);
});

test('snapshot tolerates gateways without sensors or buttons but not other failures', async t => {
  const f = await fixture(t, { snapshotTtl: 0 });
  await f.connect();
  const original = f.data;
  for (const path of ['/api/sensors', '/api/buttons']) delete original[path];
  // The fake answers unknown paths with {} (not a list): invalid, never guessed.
  assert.equal((await f.snapshot()).status, 502);
  original['/api/sensors'] = [{ id: 1 }, { id: 1 }]; original['/api/buttons'] = [];
  assert.equal((await f.snapshot()).status, 502);
  original['/api/sensors'] = []; original['/api/buttons'] = [];
  assert.deepEqual((await f.snapshot()).body.sensors, []);
});

test('an older gateway without the collections yields empty lists', async t => {
  const gateway = http.createServer((req, res) => {
    if (req.url === '/api/sensors' || req.url === '/api/buttons') { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'success', data: req.url === '/api/loads' || req.url === '/api/loads/state' || req.url === '/api/rooms' ? [] : {} }));
  });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  const app = createApp({ gatewayPort: gateway.address().port, integrationToken: token });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); app.close(); gateway.closeAllConnections(); gateway.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  await fetch(`${base}/api/connect`, { method: 'POST', headers: local, body: JSON.stringify({ host: '127.0.0.1', token: 'x', pair: false }) });
  const result = await (await fetch(`${base}/api/integration/v1/snapshot`, { headers: machine })).json();
  assert.deepEqual([result.sensors, result.buttons], [[], []]);
});

test('button identification is gated, identity and scope pinned, and uses the existing two second ping', async t => {
  const route = '/api/integration/v1/buttons/identify';
  const readOnly = await fixture(t);
  await readOnly.connect();
  assert.equal((await readOnly.put(route, {})).status, 403);
  assert.equal((await readOnly.put('/api/integration/v1/loads/1/target', {})).status, 403);
  assert.equal(readOnly.calls.length, 0);
  const f = await fixture(t, { integrationControl: true });
  f.data['/api/buttons'] = [
    { id: 101, device: '0000a98f', channel: 0, type: 'button', sub_type: 'up down' },
    { id: null, device: '0000a98f', channel: 1, type: 'button', sub_type: 'up down' },
  ];
  assert.equal((await f.put(route, {})).status, 409);
  await f.connect();
  const snapshot = (await f.snapshot()).body;
  const [registered, unregistered] = snapshot.buttons;
  const puts = () => f.calls.filter(call => call.method === 'PUT');
  const input = { scope: snapshot.scope, identity: registered.identity };
  assert.equal((await f.put(route, input, { Authorization: 'Bearer wrong' })).status, 401);
  for (const invalid of [{}, { ...input, extra: 1 }, { ...input, identity: 'nope' }, { ...input, scope: 5 }, { scope: input.scope, device: '0000a98f', channel: 0 }]) {
    assert.equal((await f.put(route, invalid)).status, 400);
  }
  assert.equal((await f.put(route, { ...input, scope: 'old' })).status, 409);
  assert.equal((await f.put(route, { ...input, identity: 'f'.repeat(64) })).status, 409);
  // A load or sensor identity can never address a button.
  assert.equal((await f.put(route, { ...input, identity: snapshot.entities[0].identity })).status, 409);
  assert.equal((await f.put(`${route}?x=1`, input)).status, 404);
  assert.equal(puts().length, 0);
  assert.deepEqual((await f.put(route, input)).body, { accepted: true });
  assert.equal(puts().at(-1).path, '/api/buttons/101/ping');
  assert.deepEqual(puts().at(-1).payload, { time_ms: 2000 });
  assert.equal((await f.put(route, { ...input, identity: unregistered.identity })).status, 200);
  assert.equal(puts().at(-1).path, '/api/buttons/0000a98f_1/ping');
  // Hardware that disappeared or was replaced is refused rather than re-addressed.
  f.data['/api/buttons'] = [{ ...f.data['/api/buttons'][0], channel: 7 }];
  assert.equal((await f.put(route, input)).status, 409);
  assert.equal(puts().length, 2);
});

test('rapid snapshot requests cost one set of gateway reads per TTL window, independent of client count', async t => {
  const f = await fixture(t, { snapshotTtl: 300 });
  await f.connect();
  const results = await Promise.all(Array.from({ length: 12 }, () => f.snapshot()));
  assert.ok(results.every(result => result.status === 200));
  // loads, loads/state, rooms, sensors, buttons: exactly once, shared by all concurrent requests.
  assert.deepEqual(f.calls.map(call => call.path), ['/api/loads', '/api/loads/state', '/api/rooms', '/api/sensors', '/api/buttons']);
  for (let index = 0; index < 20; index++) await f.snapshot();
  assert.equal(f.reads(), 5);
  assert.equal(new Set(results.map(result => result.body.observed_at)).size, 1);
  await sleep(330);
  await Promise.all([f.snapshot(), f.snapshot(), f.snapshot()]);
  assert.equal(f.reads(), 10);
});

test('personal labels are re-applied from storage on every cached response', async t => {
  const f = await fixture(t, { snapshotTtl: 60000 });
  await f.connect();
  assert.equal((await f.snapshot()).body.entities[0].name, 'Light');
  const mapping = { identity: '[1,"0001",0,"dim"]', name: 'Personal', room: 'My room', notes: '' };
  const saved = await fetch(`${f.base}/api/local/mappings/1?gateway=127.0.0.1`, { method: 'PUT', headers: { ...local, 'X-Wiser-Intent': 'live' }, body: JSON.stringify(mapping) });
  assert.equal(saved.status, 200);
  const entity = (await f.snapshot()).body.entities[0];
  assert.equal(entity.name, 'Personal');
  assert.equal(entity.gateway_name, 'Light');
  assert.equal(f.reads(), 5);
});

test('live events patch cached states without gateway reads; a failed gateway is served only inside 3 x TTL', async t => {
  const f = await fixture(t, { live: true, snapshotTtl: 200 });
  const socket = f.socket;
  await f.connect();
  const ws = await socket;
  const first = (await f.snapshot()).body;
  assert.deepEqual(first.entities[0].state, { bri: 1000 });
  const reads = f.reads();
  ws.send(JSON.stringify({ load: { id: 1, state: { bri: 7000, red: 300 } } }));
  await sleep(40);
  const patched = (await f.snapshot()).body;
  assert.deepEqual(patched.entities[0].state, { bri: 7000 });
  assert.equal(f.reads(), reads);
  // The observation time stays the real gateway read time; patches do not make the data look newer.
  assert.equal(patched.observed_at, first.observed_at);
  // Invalid fields in an event invalidate the observation rather than being kept or zeroed.
  ws.send(JSON.stringify({ load: { id: 1, state: { bri: 'x' } } }));
  await sleep(40);
  assert.deepEqual((await f.snapshot()).body.entities[0].state, {});
  // After the TTL a failing gateway cannot silently refresh; recent data is still served with its true age...
  await sleep(220);
  f.setFailing(true);
  const stale = await f.snapshot();
  assert.equal(stale.status, 200);
  assert.equal(stale.body.observed_at, first.observed_at);
  const failures = f.reads();
  // ...without hammering the gateway on every poll...
  for (let index = 0; index < 5; index++) await f.snapshot();
  assert.equal(f.reads(), failures);
  // ...and beyond 3 x TTL never.
  await sleep(450);
  assert.equal((await f.snapshot()).status, 502);
  f.setFailing(false);
  await sleep(220);
  assert.equal((await f.snapshot()).status, 200);
});

test('an accepted command refreshes the cache once, never more often than every two seconds', async t => {
  const f = await fixture(t, { integrationControl: true, snapshotTtl: 600000 });
  await f.connect();
  const snapshot = (await f.snapshot()).body;
  assert.equal(f.reads(), 5);
  const send = bri => f.put('/api/integration/v1/loads/1/target', { scope: snapshot.scope, identity: snapshot.entities[0].identity, target: { bri } });
  assert.equal((await send(5000)).status, 200);
  // The command itself reads only the one load for the identity check.
  assert.deepEqual(f.calls.slice(5).map(call => `${call.method} ${call.path}`), ['GET /api/loads/1', 'PUT /api/loads/1/target_state']);
  const before = f.reads();
  for (let index = 0; index < 5; index++) await f.snapshot();
  assert.equal(f.reads(), before, 'within two seconds the cache is reused');
  assert.equal((await send(6000)).status, 200);
  await sleep(2100);
  f.data['/api/loads/state'] = [{ id: 1, state: { bri: 6000 } }];
  const refreshed = await Promise.all([f.snapshot(), f.snapshot(), f.snapshot()]);
  assert.equal(refreshed[0].body.entities[0].state.bri, 6000);
  assert.equal(f.reads(), before + 1 + 5);
  for (let index = 0; index < 5; index++) await f.snapshot();
  assert.equal(f.reads(), before + 1 + 5);
});

test('integration event stream is authenticated, read-only, scoped, heartbeating and ends with the session', async t => {
  const f = await fixture(t, { live: true, integrationHeartbeat: 25 });
  const socket = f.socket;
  const route = `${f.base}/api/integration/v1/events`;
  assert.equal((await fetch(route)).status, 401);
  assert.equal((await fetch(route, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(`${route}?x=1`, { headers: machine })).status, 404);
  assert.equal((await fetch(route, { method: 'POST', headers: machine })).status, 404);
  assert.equal((await fetch(route, { headers: { ...machine, Origin: 'http://evil.example' } })).status, 403);
  assert.equal((await fetch(route, { headers: machine })).status, 409);
  const session = await f.connect();
  const ws = await socket;
  // Reads need no control opt-in; the stream is not a command path.
  const stream = await fetch(route, { headers: machine });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /^application\/x-ndjson/);
  const reader = stream.body.getReader(); let buffered = '';
  async function line() {
    while (!buffered.includes('\n')) { const next = await reader.read(); assert.equal(next.done, false); buffered += new TextDecoder().decode(next.value); }
    const end = buffered.indexOf('\n'); const result = JSON.parse(buffered.slice(0, end)); buffered = buffered.slice(end + 1); return result;
  }
  assert.deepEqual(await line(), { type: 'status', status: 'live', scope: session.draftScope });
  assert.deepEqual(await line(), { type: 'resync', scope: session.draftScope });
  ws.send(JSON.stringify({ load: { id: 3, state: { bri: 42, ct: 'secret', password: 'test-secret' } } }));
  let event;
  do event = await line(); while (event.type === 'heartbeat');
  assert.deepEqual(event, { type: 'load', id: 3, state: { bri: 42, ct: null }, scope: session.draftScope });
  assert.deepEqual(await line(), { type: 'heartbeat', scope: session.draftScope });
  await fetch(`${f.base}/api/disconnect`, { method: 'POST', headers: local });
  let ended = false;
  while (!ended) { const next = await reader.read(); ended = next.done; }
  assert.equal(ended, true);
});

test('without a live session the machine event stream says to keep polling', async t => {
  const f = await fixture(t);
  await f.connect();
  assert.equal((await fetch(`${f.base}/api/integration/v1/events`, { headers: machine })).status, 503);
});

test('raw gateway messages are captured in memory, sanitized, bounded and clearable; load updates are flagged and capped separately', async t => {
  const f = await fixture(t, { live: true });
  const route = '/api/diagnostics/gateway-events';
  assert.equal((await f.local(route)).status, 409);
  await f.connect();
  const ws = await f.socket;
  assert.equal((await fetch(`${f.base}${route}`)).status, 403);
  assert.equal((await fetch(`${f.base}${route}`, { headers: { ...local, Origin: 'http://evil.example' } })).status, 403);
  assert.deepEqual((await f.local(route)).body, { data: [] });
  ws.send(JSON.stringify({ load: { id: 1, state: { bri: 5 } } }));
  ws.send(JSON.stringify({ button: { id: 12, event: 'click', password: 'test-secret' }, note: 'test-secret' }));
  ws.send('not json test-secret');
  ws.send(JSON.stringify({ findme: { button: { device: '00019edc', channel: 0 } } }));
  ws.send(Buffer.from([1, 2, 255]));
  await sleep(60);
  const { data } = (await f.local(route)).body;
  // Everything is captured in arrival order with its receive time; plain load updates carry kind 'load'.
  assert.equal(data.length, 5);
  assert.equal(data[0].kind, 'load');
  assert.deepEqual(data[0].message, { load: { id: 1, state: { bri: 5 } } });
  assert.deepEqual(data[1].message, { button: { id: 12, event: 'click' }, note: '[redacted]' });
  assert.equal(data[1].kind, undefined);
  assert.deepEqual(data[2].message, { unparsed: 'not json [redacted]' });
  assert.deepEqual(data[3].message, { findme: { button: { device: '00019edc', channel: 0 } } });
  assert.deepEqual(data[4].message, { binary: { length: 3, hex: '0102ff' } });
  assert.ok(data.every(entry => !Number.isNaN(Date.parse(entry.at))));
  assert.equal(f.calls.length, 0, 'capture never issues gateway requests');
  for (let index = 0; index < 250; index++) ws.send(JSON.stringify({ n: index }));
  await sleep(150);
  const bounded = (await f.local(route)).body.data;
  assert.equal(bounded.filter(entry => entry.kind !== 'load').length, 200);
  assert.equal(bounded.at(-1).message.n, 249);
  for (let index = 0; index < 60; index++) ws.send(JSON.stringify({ load: { id: 1, state: { bri: index } } }));
  await sleep(150);
  const mixed = (await f.local(route)).body.data;
  assert.equal(mixed.filter(entry => entry.kind === 'load').length, 50);
  assert.equal(mixed.filter(entry => entry.kind !== 'load').length, 200);
  assert.deepEqual((await f.local(route, 'DELETE')).body, { data: [] });
  assert.deepEqual((await f.local(route)).body, { data: [] });
});
