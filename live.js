import WebSocket from 'ws';

const ranges = { bri: [0, 10000], level: [0, 10000], ct: [1000, 20000], red: [0, 255], green: [0, 255], blue: [0, 255], white: [0, 255] };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function loadEvent(value) {
  if (!object(value?.load) || !Number.isSafeInteger(value.load.id) || value.load.id < 0 || !object(value.load.state)) return null;
  const state = {};
  for (const [field, [min, max]] of Object.entries(ranges)) {
    if (!Object.hasOwn(value.load.state, field)) continue;
    const next = value.load.state[field];
    // Null invalidates an old observation without relaying upstream strings.
    state[field] = Number.isInteger(next) && next >= min && next <= max ? next : null;
  }
  return Object.keys(state).length ? { type: 'load', id: value.load.id, state } : null;
}

export function createLiveSession({ host, port, token, scope, handshakeTimeout = 10000, heartbeatInterval = 30000, reconnectDelay = 1000 }) {
  const clients = new Set();
  let socket, retry, heartbeat, closed = false, live = false, attempt = 0;
  const write = (response, event) => {
    if (response.destroyed || response.writableEnded) { clients.delete(response); return; }
    if (!response.write(`${JSON.stringify({ ...event, scope })}\n`)) { clients.delete(response); response.destroy(); }
  };
  const emit = event => { for (const response of clients) write(response, event); };
  function connect() {
    if (closed) return;
    const current = new WebSocket(`ws://${host}:${port}/api`, { headers: { Authorization: `Bearer ${token}` }, followRedirects: false, maxPayload: 64 * 1024, handshakeTimeout });
    socket = current;
    let alive = true;
    current.on('open', () => {
      if (closed || socket !== current) return current.terminate();
      live = true; attempt = 0;
      emit({ type: 'status', status: 'live' }); emit({ type: 'resync' });
      heartbeat = setInterval(() => { if (!alive) return current.terminate(); alive = false; current.ping(); }, heartbeatInterval);
      heartbeat.unref();
    });
    current.on('pong', () => { alive = true; });
    current.on('message', (data, binary) => {
      if (closed || socket !== current || binary) return;
      try { const event = loadEvent(JSON.parse(data.toString())); if (event) emit(event); } catch { /* Ignore malformed upstream events. */ }
    });
    current.on('error', () => {});
    current.on('close', () => {
      if (socket !== current) return;
      clearInterval(heartbeat); live = false;
      if (closed) return;
      emit({ type: 'status', status: 'polling' });
      retry = setTimeout(connect, Math.min(30000, reconnectDelay * 2 ** Math.min(attempt++, 5))); retry.unref();
    });
  }
  connect();
  return {
    subscribe(response) {
      if (closed || clients.size >= 16) return false;
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      clients.add(response); response.once('close', () => clients.delete(response));
      write(response, { type: 'status', status: live ? 'live' : 'polling' });
      if (live) write(response, { type: 'resync' });
      return true;
    },
    close() {
      closed = true; clearTimeout(retry); clearInterval(heartbeat); socket?.terminate();
      for (const response of clients) response.end();
      clients.clear();
    },
  };
}
