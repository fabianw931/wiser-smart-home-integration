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

// `onEvent` sees every emitted event (also with no browser or machine client attached), so the app can patch its cache.
// Gateway messages are kept in small in-memory rings (never persisted) to learn undocumented formats:
// 200 for anything that is not a plain load state event, and 50 for load events (kind: 'load') so a busy home cannot evict the rare messages.
export const RAW_LIMIT = 200;
export const RAW_LOAD_LIMIT = 50;
export function createLiveSession({ host, port, token, scope, handshakeTimeout = 10000, heartbeatInterval = 30000, reconnectDelay = 1000, onEvent }) {
  const clients = new Set();
  const beats = new Map();
  let socket, retry, heartbeat, closed = false, live = false, attempt = 0;
  const drop = response => { clients.delete(response); clearInterval(beats.get(response)); beats.delete(response); };
  const write = (response, event) => {
    if (response.destroyed || response.writableEnded) { drop(response); return; }
    if (!response.write(`${JSON.stringify({ ...event, scope })}\n`)) { drop(response); response.destroy(); }
  };
  const raw = []; // arrival order; load entries are capped separately from the rest
  const remember = (entry, limit, isLoad) => {
    raw.push(entry);
    let count = 0;
    for (const item of raw) if ((item.kind === 'load') === isLoad) count++;
    if (count > limit) raw.splice(raw.findIndex(item => (item.kind === 'load') === isLoad), 1);
  };
  const emit = event => { try { onEvent?.(event); } catch { /* A failing observer must not stop the stream. */ } for (const response of clients) write(response, event); };
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
      if (closed || socket !== current) return;
      if (binary) {
        // Never parsed or forwarded; only length and a short hex prefix are kept so an undocumented binary format becomes visible.
        const bytes = Buffer.isBuffer(data) ? data : Buffer.concat([].concat(data));
        remember({ at: new Date().toISOString(), message: { binary: { length: bytes.length, hex: bytes.subarray(0, 64).toString('hex') } } }, RAW_LIMIT, false);
        return;
      }
      const text = data.toString();
      let parsed, event = null;
      try { parsed = JSON.parse(text); event = loadEvent(parsed); } catch { parsed = { unparsed: text.slice(0, 500) }; }
      if (event) { remember({ at: new Date().toISOString(), kind: 'load', message: parsed }, RAW_LOAD_LIMIT, true); emit(event); }
      else remember({ at: new Date().toISOString(), message: parsed }, RAW_LIMIT, false);
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
    rawEvents: () => raw.slice(),
    clearRawEvents() { raw.length = 0; },
    // `heartbeat` (ms) keeps idle machine streams observable by proxies and clients; the browser stream omits it.
    subscribe(response, { heartbeat: beat = 0 } = {}) {
      if (closed || clients.size >= 16) return false;
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      clients.add(response); response.once('close', () => drop(response));
      if (beat > 0) { const timer = setInterval(() => write(response, { type: 'heartbeat' }), beat); timer.unref(); beats.set(response, timer); }
      write(response, { type: 'status', status: live ? 'live' : 'polling' });
      if (live) write(response, { type: 'resync' });
      return true;
    },
    close() {
      closed = true; clearTimeout(retry); clearInterval(heartbeat); socket?.terminate();
      for (const response of clients) { clearInterval(beats.get(response)); response.end(); }
      clients.clear(); beats.clear();
    },
  };
}
