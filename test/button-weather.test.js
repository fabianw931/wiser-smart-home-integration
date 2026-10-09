import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server.js';

async function fixture(t) {
  const calls = [];
  let buttons = [{ id: 4, device: '0000a98f', channel: 0 }];
  let beforeButtons = async () => {};
  const gateway = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    calls.push({ path: req.url, method: req.method, payload: raw ? JSON.parse(raw) : undefined });
    if (req.url === '/api/buttons') await beforeButtons();
    res.end(JSON.stringify({ status: 'success', data: req.url === '/api/buttons' ? buttons : [] }));
  });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  const app = createApp({ gatewayPort: gateway.address().port });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(async () => {
    await new Promise(resolve => app.close(resolve));
    await new Promise(resolve => gateway.close(resolve));
  });
  let scope;
  async function request(path, method = 'GET', payload, headers = {}) {
    const response = await fetch(`http://127.0.0.1:${app.address().port}${path}`, {
      method, headers: { 'X-Wiser-Client': 'local-poc', 'Content-Type': 'application/json',
        ...(scope ? { 'X-Wiser-Scope': scope } : {}), ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  }
  const connected = await request('/api/connect', 'POST', { host: '127.0.0.1', token: 'fake-secret', pair: false });
  assert.equal(connected.status, 200);
  scope = connected.body.draftScope;
  const identify = (payload, headers = {}) => request('/api/buttons/identify', 'POST', payload, { 'X-Wiser-Intent': 'live', ...headers });
  return { calls, request, identify, setButtons: value => { buttons = value; }, beforeButtons: callback => { beforeButtons = callback; } };
}

test('buttons and weather expose only the explicit read collections', async t => {
  const f = await fixture(t);
  for (const resource of ['buttons', 'smartbuttons', 'sensors', 'westgroups']) {
    assert.equal((await f.request(`/api/read/${resource}`)).status, 200);
  }
  const count = f.calls.length;
  for (const [path, method] of [['/api/read/buttons/managed', 'GET'], ['/api/buttons', 'POST'],
    ['/api/buttons/4', 'PATCH'], ['/api/buttons/4/ping', 'PUT'], ['/api/smartbuttons/4', 'DELETE'],
    ['/api/westgroups/4', 'PATCH'], ['/api/read/buttons?extra=1', 'GET']]) {
    assert.equal((await f.request(path, method, method === 'GET' ? undefined : {})).status, 404, path);
  }
  assert.equal(f.calls.length, count);
});

test('identify requires live intent, local protections and current session scope', async t => {
  const f = await fixture(t);
  const button = { device: '0000a98f', channel: 0 };
  const count = f.calls.length;
  assert.equal((await f.request('/api/buttons/identify', 'POST', button)).status, 403);
  assert.equal((await f.identify(button, { 'X-Wiser-Scope': 'stale' })).status, 409);
  assert.equal((await f.identify(button, { 'X-Wiser-Client': 'other' })).status, 403);
  assert.equal((await f.identify(button, { Origin: 'http://evil.local' })).status, 403);
  assert.equal(f.calls.length, count);
});

test('identify validates physical identity and freshly discovers registered and unregistered buttons', async t => {
  const f = await fixture(t);
  for (const payload of [{ device: '../loads', channel: 0 }, { device: '0000a98f', channel: -1 },
    { device: '0000a98f', channel: '0' }, { device: '0000a98f', channel: 0, time_ms: 60000 }, null]) {
    assert.equal((await f.identify(payload)).status, 400);
  }
  assert.equal(f.calls.length, 1);
  assert.equal((await f.identify({ device: 'deadbeef', channel: 0 })).status, 400);
  assert.equal((await f.identify({ device: '0000a98f', channel: 0 })).status, 200);
  assert.deepEqual(f.calls.at(-1), { path: '/api/buttons/4/ping', method: 'PUT', payload: { time_ms: 2000 } });
  f.setButtons([{ id: null, device: '0000a98f', channel: 0 }]);
  assert.equal((await f.identify({ device: '0000a98f', channel: 0 })).status, 200);
  assert.deepEqual(f.calls.at(-1), { path: '/api/buttons/0000a98f_0/ping', method: 'PUT', payload: { time_ms: 2000 } });
  f.setButtons([]);
  assert.equal((await f.identify({ device: '0000a98f', channel: 0 })).status, 400);
  f.setButtons([{ device: '0000a98f', channel: 0 }, { device: '0000a98f', channel: 0 }]);
  assert.equal((await f.identify({ device: '0000a98f', channel: 0 })).status, 400);
  assert.equal(f.calls.filter(call => call.method !== 'GET').length, 2);
});

test('disconnect during fresh button discovery prevents identify on a replacement session', async t => {
  const f = await fixture(t);
  let entered;
  const discovery = new Promise(resolve => { entered = resolve; });
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  f.beforeButtons(async () => { entered(); await hold; });
  const pending = f.identify({ device: '0000a98f', channel: 0 });
  await discovery;
  assert.equal((await f.request('/api/disconnect', 'POST', {})).status, 200);
  assert.equal((await f.request('/api/connect', 'POST', { host: '127.0.0.1', token: 'new-token', pair: false })).status, 200);
  release();
  assert.ok([409, 502].includes((await pending).status));
  assert.equal(f.calls.filter(call => call.path.endsWith('/ping')).length, 0);
});
