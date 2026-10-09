import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { createApp } from '../server.js';
import { loadEvent, createLiveSession } from '../live.js';

test('live messages allowlist fields and explicitly invalidate malformed observations', () => {
  assert.deepEqual(loadEvent({ load: { id: 1, state: { bri: 123, ct: 'secret', white: 256, token: 'secret', level: -1 } } }),
    { type: 'load', id: 1, state: { bri: 123, level: null, ct: null, white: null } });
  for (const value of [null, {}, { load: { id: -1, state: { bri: 1 } } }, { load: { id: 1, state: { password: 'secret' } } }]) assert.equal(loadEvent(value), null);
});

test('scoped local streams receive authenticated gateway events and end on disconnect', async t => {
  const gateway = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: 'success', data: {} })); });
  const upstream = new WebSocketServer({ server: gateway, path: '/api' });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  const app = createApp({ gatewayPort: gateway.address().port, liveEnabled: true });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  const headers = { 'X-Wiser-Client': 'local-poc', 'Content-Type': 'application/json' };
  t.after(() => { app.closeAllConnections(); app.close(); for (const socket of upstream.clients) socket.terminate(); upstream.close(); gateway.closeAllConnections(); gateway.close(); });
  const connection = once(upstream, 'connection');
  const response = await fetch(`${base}/api/connect`, { method: 'POST', headers, body: JSON.stringify({ host: '127.0.0.1', token: 'test-secret', pair: false }) });
  const session = await response.json(); assert.equal(response.status, 200);
  const [socket, request] = await connection;
  assert.equal(request.headers.authorization, 'Bearer test-secret');
  assert.equal((await fetch(`${base}/api/events`, { headers })).status, 409);
  assert.equal((await fetch(`${base}/api/events`, { headers: { ...headers, 'X-Wiser-Scope': session.draftScope, Origin: 'http://evil.example' } })).status, 403);
  const stream = await fetch(`${base}/api/events`, { headers: { ...headers, 'X-Wiser-Scope': session.draftScope } });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader(); let buffered = '';
  async function line() {
    while (!buffered.includes('\n')) { const next = await reader.read(); assert.equal(next.done, false); buffered += new TextDecoder().decode(next.value); }
    const end = buffered.indexOf('\n'); const result = JSON.parse(buffered.slice(0, end)); buffered = buffered.slice(end + 1); return result;
  }
  assert.deepEqual(await line(), { type: 'status', status: 'live', scope: session.draftScope });
  assert.deepEqual(await line(), { type: 'resync', scope: session.draftScope });
  socket.send(JSON.stringify({ load: { id: 7, state: { bri: 888, password: 'test-secret' } } }));
  assert.deepEqual(await line(), { type: 'load', id: 7, state: { bri: 888 }, scope: session.draftScope });
  await fetch(`${base}/api/disconnect`, { method: 'POST', headers });
  assert.equal((await reader.read()).done, true);
});

test('socket reconnect emits polling, live and resync; closing cancels retries', async t => {
  const gateway = http.createServer(); const upstream = new WebSocketServer({ server: gateway });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  const first = once(upstream, 'connection');
  const manager = createLiveSession({ host: '127.0.0.1', port: gateway.address().port, token: 'secret', scope: 'scope', reconnectDelay: 10 });
  t.after(() => { manager.close(); for (const socket of upstream.clients) socket.terminate(); upstream.close(); gateway.close(); });
  const [socket] = await first; await new Promise(resolve => setImmediate(resolve));
  const events = []; let resolveResync, resolveInitial;
  const initial = new Promise(resolve => { resolveInitial = resolve; });
  const resync = new Promise(resolve => { resolveResync = resolve; });
  const response = { writeHead() {}, once() {}, end() {}, write(line) { const value = JSON.parse(line); events.push(value); if (value.type === 'resync') resolveInitial(); if (events.filter(item => item.type === 'resync').length === 2) resolveResync(); return true; } };
  manager.subscribe(response); await initial; socket.terminate();
  await resync;
  const sequence = events.map(event => event.type === 'status' ? event.status : event.type);
  if (sequence[0] === 'polling') sequence.shift();
  assert.deepEqual(sequence, ['live', 'resync', 'polling', 'live', 'resync']);
  manager.close();
});
