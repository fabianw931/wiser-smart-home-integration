import http from 'node:http';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createMappingStore, DEFAULT_DB_PATH } from './storage.js';
import { validateMappings, mappingMatches } from './src/mappings.js';
import { createCredentialStore } from './credentials.js';
import { createLiveSession } from './live.js';

const READS = new Set(['info', 'loads', 'loads/state', 'rooms', 'devices',
  'sensors', 'hvacgroups', 'hvacgroups/state']);
function asset(path) {
  if (path === '/') return ['index.html', 'text/html'];
  if (/^\/assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(path)) {
    return [path.slice(1), path.endsWith('.js') ? 'text/javascript' : 'text/css'];
  }
  return null;
}
class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const invalid = (message) => { throw new AppError(400, message); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid('Invalid request fields.');
}

export function validateHost(host) {
  if (typeof host !== 'string' || host.length > 253 || host !== host.trim()) invalid('Enter an IP address or hostname only (no URL, port or path).');
  if (isIP(host)) return isIP(host) === 6 ? `[${host}]` : host;
  if (!host || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    invalid('Enter an IP address or hostname only (no URL, port or path).');
  }
  // Do not allow non-canonical numeric IP forms interpreted specially by URL parsers.
  if (/^[\d.]+$/.test(host) || /(^|\.)0x/i.test(host)) invalid('Use a canonical IP address.');
  const parsed = new URL(`http://${host}`);
  if (parsed.hostname !== host.toLowerCase()) invalid('Use a canonical hostname.');
  return host.toLowerCase();
}

export function validateTarget(load, value) {
  if (!load || load.unused) invalid('Select an active discovered load.');
  if (load.type === 'dali') {
    const ranges = { bri: [0, 10000] };
    if (load.sub_type === 'tw') ranges.ct = [1000, 20000];
    else if (load.sub_type === 'rgb') {
      for (const channel of ['red', 'green', 'blue', 'white']) ranges[channel] = [0, 255];
    } else if (load.sub_type !== undefined && load.sub_type !== '') invalid('This DALI subtype is read-only.');
    keys(value, Object.keys(ranges));
    if (!Object.keys(value).length) invalid('Supply at least one target field.');
    for (const [field, target] of Object.entries(value)) {
      const [minimum, maximum] = ranges[field];
      if (!Number.isInteger(target) || target < minimum || target > maximum) invalid(`${field} must be an integer from ${minimum} to ${maximum}.`);
    }
    return;
  }
  const field = load.type === 'motor' ? 'level' : ['onoff', 'dim'].includes(load.type) ? 'bri' : null;
  if (!field) invalid('This load type is read-only.');
  keys(value, [field]);
  if (Object.keys(value).length !== 1 || !Number.isInteger(value[field]) || value[field] < 0 || value[field] > 10000) invalid('Target must be an integer from 0 to 10000.');
  if (load.type === 'onoff' && ![0, 10000].includes(value.bri)) invalid('On/off loads accept only 0 or 10000.');
}

async function body(req, limit = 8192) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new AppError(415, 'JSON required.');
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > limit) throw new AppError(413, 'Request too large.');
  }
  try { return JSON.parse(text); } catch { invalid('Invalid JSON.'); }
}

// Factory permits tests to use an ephemeral fake gateway, without exposing a port
// override or arbitrary URL through the public API.
export function createApp({ gatewayPort = 80, timeout = 10000, claimTimeout = 45000, dbPath = ':memory:', integrationToken = '', integrationControl = false, credentialDir = null, liveEnabled = false } = {}) {
  if (typeof integrationToken !== 'string' || integrationToken !== '' && !/^[A-Za-z0-9_-]{32,256}$/.test(integrationToken)) throw new Error('WISER_INTEGRATION_TOKEN must contain 32–256 URL-safe ASCII characters.');
  const integrationDigest = createHash('sha256').update(integrationToken).digest();
  const gatewayKey = active => active.host.replace(/^\[|\]$/g, '');
  const loadIdentity = (active, load) => createHash('sha256').update(JSON.stringify([
    gatewayKey(active), load.device ?? null, load.channel ?? null, load.type ?? null, load.sub_type ?? null, load.id,
  ])).digest('hex');
  const store = createMappingStore(dbPath);
  const credentials = credentialDir ? createCredentialStore(credentialDir) : null;
  let savedConnection = null;
  let credentialError = '';
  try { savedConnection = credentials?.load() || null; }
  catch { credentialError = 'Saved credentials could not be unlocked. Check credential files and permissions.'; }
  let session = null;
  let generation = 0;
  let connecting = false;
  const pending = new Set();
  function reset() {
    generation++;
    session?.live?.close();
    session = null;
    connecting = false;
    for (const controller of pending) controller.abort();
    pending.clear();
  }
  async function gateway(host, token, path, method = 'GET', payload, pairing = false) {
    const controller = new AbortController();
    pending.add(controller);
    const timer = setTimeout(() => controller.abort(), pairing ? claimTimeout : timeout);
    try {
      const response = await fetch(`http://${host}:${gatewayPort}/api/${path}`, {
        method, signal: controller.signal, redirect: 'error',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      if (!response.ok) {
        await response.body?.cancel();
        const status = [401, 403, 404, 405, 501].includes(response.status) ? response.status : 502;
        throw new AppError(status, [404, 405, 501].includes(status) ? 'Resource unsupported by this gateway.' :
          [401, 403].includes(status) ? 'Gateway rejected credentials; reconnect or pair again.' : 'Gateway request failed.');
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) throw new AppError(502, 'Gateway response too large.');
        chunks.push(Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf8');
      let result;
      try { result = JSON.parse(text); } catch { throw new AppError(502, 'Gateway returned invalid JSON.'); }
      if (!object(result) || result.status !== 'success') throw new AppError(502, 'Gateway reported an API error.');
      return result.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, controller.signal.aborted ? 'Gateway request timed out or was cancelled.' : 'Cannot reach gateway.');
    } finally {
      clearTimeout(timer);
      pending.delete(controller);
    }
  }
  // Never relay account secrets, or even a token echoed unexpectedly by a gateway.
  function sanitize(value, token) {
    const redact = text => [token, integrationToken].filter(Boolean).reduce((result, secret) => result.split(secret).join('[redacted]'), text);
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(item => sanitize(item, token));
    if (object(value)) return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/secret|token|authorization|password/i.test(key))
      .map(([key, item]) => [redact(key), sanitize(item, token)]));
    return value;
  }
  const server = http.createServer(async (req, res) => {
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const port = server.address().port;
      const hosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
      if (!hosts.includes(req.headers.host)) throw new AppError(403, 'Local Host required.');
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new AppError(403, 'Same-origin requests required.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError(403, 'Cross-site requests forbidden.');
      const path = req.url;
      const staticAsset = req.method === 'GET' ? asset(path) : null;
      if (staticAsset) {
        const [file, type] = staticAsset;
        let content;
        try { content = await readFile(new URL(`./dist/${file}`, import.meta.url)); }
        catch (error) {
          if (error.code === 'ENOENT') throw new AppError(404, 'Built asset not found. Run npm run build.');
          throw error;
        }
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return res.end(content);
      }
      if (!path.startsWith('/api/')) throw new AppError(404, 'Not found.');
      if (path.startsWith('/api/integration/')) {
        if (!integrationToken) throw new AppError(404, 'Not found.');
        const bearer = typeof req.headers.authorization === 'string' ? /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.authorization)?.[1] : undefined;
        const supplied = createHash('sha256').update(bearer || '').digest();
        if (!timingSafeEqual(integrationDigest, supplied)) throw new AppError(401, 'Unauthorized.');
        const targetRoute = /^\/api\/integration\/v1\/loads\/(0|[1-9]\d{0,9})\/target$/.exec(path);
        const snapshot = req.method === 'GET' && path === '/api/integration/v1/snapshot';
        if (!snapshot && !(req.method === 'PUT' && targetRoute)) throw new AppError(404, 'Endpoint not allowed.');
        if (!snapshot && integrationControl !== true) throw new AppError(403, 'Integration control disabled.');
        if (!session) throw new AppError(409, 'Connect to a gateway first.');
        const active = session;
        const checkSession = () => { if (session !== active) throw new AppError(409, 'Connection changed.'); };
        if (snapshot) {
          const loads = await gateway(active.host, active.token, 'loads');
          checkSession();
          if (!Array.isArray(loads) || loads.some(load => !object(load) || !Number.isSafeInteger(load.id) || load.id < 0)
            || new Set(loads.map(load => load.id)).size !== loads.length) throw new AppError(502, 'Gateway returned an invalid load list.');
          const states = await gateway(active.host, active.token, 'loads/state');
          checkSession();
          if (!Array.isArray(states) || states.some(state => !object(state) || !Number.isSafeInteger(state.id) || state.id < 0)
            || new Set(states.map(state => state.id)).size !== states.length) throw new AppError(502, 'Gateway returned an invalid state list.');
          const rooms = await gateway(active.host, active.token, 'rooms');
          checkSession();
          if (!Array.isArray(rooms) || rooms.some(room => !object(room) || !Number.isSafeInteger(room.id) || room.id < 0)) throw new AppError(502, 'Gateway returned an invalid room list.');
          const mappings = store.list(gatewayKey(active));
          const byId = new Map(states.map(state => [state.id, state.state]));
          const entities = loads.map(load => {
            const mapping = mappingMatches(load, mappings[load.id]) ? mappings[load.id] : null;
            const state = byId.get(load.id);
            const ranges = { bri: [0, 10000], level: [0, 10000], ct: [1000, 20000], red: [0, 255], green: [0, 255], blue: [0, 255], white: [0, 255] };
            const safeState = object(state) ? Object.fromEntries(Object.entries(ranges)
              .filter(([field, [min, max]]) => Number.isSafeInteger(state[field]) && state[field] >= min && state[field] <= max)
              .map(([field]) => [field, state[field]])) : {};
            return { id: load.id, identity: loadIdentity(active, load),
              name: mapping?.name ?? (typeof load.name === 'string' ? load.name : null),
              room: mapping?.room ?? (typeof rooms.find(room => room.id === load.room)?.name === 'string' ? rooms.find(room => room.id === load.room).name : null),
              type: typeof load.type === 'string' ? load.type : null, sub_type: typeof load.sub_type === 'string' ? load.sub_type : null,
              unused: !!load.unused, state: safeState };
          });
          return reply(200, sanitize({ version: 1, gateway: gatewayKey(active), scope: active.draftScope, observed_at: new Date().toISOString(), entities }, active.token));
        }
        const input = await body(req);
        checkSession();
        keys(input, ['scope', 'identity', 'target']);
        if (typeof input.scope !== 'string' || typeof input.identity !== 'string' || !/^[a-f0-9]{64}$/.test(input.identity)) invalid('Supply a valid scope and identity.');
        if (input.scope !== active.draftScope) throw new AppError(409, 'Connection changed.');
        const current = await gateway(active.host, active.token, `loads/${targetRoute[1]}`);
        checkSession();
        if (!object(current) || current.id !== Number(targetRoute[1])) throw new AppError(502, 'Gateway returned an invalid load.');
        if (input.identity !== loadIdentity(active, current)) throw new AppError(409, 'Load identity changed; refresh before applying.');
        validateTarget(current, input.target);
        checkSession();
        await gateway(active.host, active.token, `loads/${targetRoute[1]}/target_state`, 'PUT', input.target);
        checkSession();
        return reply(200, { accepted: true });
      }
      // Custom header prevents form submissions and cross-origin simple requests.
      if (req.headers['x-wiser-client'] !== 'local-poc') throw new AppError(403, 'Local app header required.');
      if (path.startsWith('/api/local/')) {
        const url = new URL(path, 'http://localhost');
        const route = /^\/api\/local\/mappings(?:\/(import|\d{1,10}))?$/.exec(url.pathname);
        if (!route) throw new AppError(404, 'Endpoint not allowed.');
        if ([...url.searchParams.keys()].some(key => key !== 'gateway') || url.searchParams.getAll('gateway').length !== 1 || url.hash) invalid('Supply one gateway key only.');
        const inputGateway = url.searchParams.get('gateway');
        const gatewayKey = inputGateway === 'sample-home' ? inputGateway : validateHost(inputGateway).replace(/^\[|\]$/g, '');
        const id = route[1];
        const validate = value => {
          try { return validateMappings(value); } catch (error) { invalid(error.message); }
        };
        if (req.method === 'GET' && !id) return reply(200, { data: store.list(gatewayKey) });
        if (req.method === 'PUT' && id && id !== 'import') {
          const mappings = validate({ [id]: await body(req) });
          store.put(gatewayKey, id, mappings[id]);
        } else if (req.method === 'DELETE' && id && id !== 'import') store.remove(gatewayKey, id);
        else if (req.method === 'POST' && id === 'import') {
          const input = await body(req, 2 * 1024 * 1024);
          keys(input, ['mappings']);
          store.merge(gatewayKey, validate(input.mappings));
        } else throw new AppError(404, 'Endpoint not allowed.');
        return reply(200, { data: store.list(gatewayKey) });
      }
      if (req.method === 'GET' && path === '/api/session') return reply(200, { connected: !!session, host: session?.host || savedConnection?.host || null, connecting, draftScope: session?.draftScope || null, remembered: !!savedConnection, credentialError });
      if (req.method === 'POST' && path === '/api/reconnect') {
        await reconnectSaved();
        return reply(200, { connected: true, host: session.host, draftScope: session.draftScope, remembered: true });
      }
      if (req.method === 'POST' && ['/api/disconnect', '/api/disconnect-session'].includes(path)) {
        reset();
        if (path === '/api/disconnect') {
          try { credentials?.forget(); }
          catch { throw new AppError(500, 'Disconnected, but saved credentials could not be forgotten. Check file permissions before restarting.'); }
          savedConnection = null; credentialError = '';
        }
        return reply(200, { connected: false });
      }
      if (req.method === 'POST' && path === '/api/connect') {
        if (connecting) throw new AppError(409, 'Connection already in progress.');
        // Reserve the attempt before reading a potentially streamed body.
        // A later disconnect or replacement must invalidate this request too.
        let current = generation;
        connecting = true;
        const cancel = () => {
          if (!res.writableFinished && generation === current) reset();
        };
        req.once('aborted', cancel);
        res.once('close', cancel);
        res.once('finish', () => {
          req.off('aborted', cancel);
          res.off('close', cancel);
        });
        try {
          const input = await body(req);
          if (generation !== current || req.aborted || res.destroyed) throw new AppError(409, 'Connection cancelled.');
          keys(input, ['host', 'token', 'pair', 'remember']);
          if (input.remember !== undefined && typeof input.remember !== 'boolean') invalid('Remember must be a boolean.');
          if (input.remember && !credentials) throw new AppError(503, 'Credential storage is not configured.');
          const host = validateHost(input.host);
          if (typeof input.pair !== 'boolean') invalid('Choose token or pairing mode.');
          if (input.pair ? input.token !== undefined : typeof input.token !== 'string' || !/^[\x21-\x7e]{1,2048}$/.test(input.token)) invalid('Supply a valid token or choose pairing, not both.');
          reset();
          current = generation;
          connecting = true;
          let token = input.token;
          if (input.pair) {
            const account = await gateway(host, null, 'account/claim', 'POST', { user: `local-poc-${randomUUID()}` }, true);
            token = account?.secret;
            if (typeof token !== 'string' || !/^[\x21-\x7e]{1,2048}$/.test(token)) throw new AppError(502, 'Gateway did not provide a valid pairing credential.');
          }
          const info = await gateway(host, token, 'info');
          if (generation !== current || req.aborted || res.destroyed) throw new AppError(409, 'Connection cancelled.');
          try {
            if (input.remember) credentials.save({ host: host.replace(/^\[|\]$/g, ''), token });
            else credentials?.forget();
          } catch { throw new AppError(500, 'Could not update saved credentials. Check credential file permissions.'); }
          savedConnection = input.remember ? { host: host.replace(/^\[|\]$/g, ''), token } : null;
          credentialError = '';
          session = { host, token, loads: new Map(), draftScope: randomUUID() };
          startLive(session);
          return reply(200, { connected: true, host, info: sanitize(info, token), draftScope: session.draftScope, remembered: !!savedConnection });
        } finally { if (generation === current) connecting = false; }
      }
      if ((req.method === 'PUT' && /^\/api\/loads\/(0|[1-9]\d{0,9})\/target_state$/.test(path)
        || req.method === 'PATCH' && /^\/api\/loads\/(0|[1-9]\d{0,9})\/config$/.test(path))
        && req.headers['x-wiser-intent'] !== 'live') throw new AppError(403, 'Explicit live intent required.');
      if (!session) throw new AppError(409, 'Connect to a gateway first.');
      const active = session;
      if (req.method === 'GET' && path === '/api/events') {
        if (req.headers['x-wiser-scope'] !== active.draftScope) throw new AppError(409, 'Connection changed.');
        if (!active.live) throw new AppError(503, 'Live updates unavailable; use polling.');
        if (!active.live.subscribe(res)) throw new AppError(503, 'Live update client limit reached.');
        return;
      }
      if ((req.method === 'PUT' && /^\/api\/loads\/(0|[1-9]\d{0,9})\/target_state$/.test(path)
        || req.method === 'PATCH' && /^\/api\/loads\/(0|[1-9]\d{0,9})\/config$/.test(path))
        && req.headers['x-wiser-scope'] !== active.draftScope) throw new AppError(409, 'Connection changed.');
      const resource = path.slice('/api/read/'.length);
      if (req.method === 'GET' && path.startsWith('/api/read/') && READS.has(resource)) {
        const data = await gateway(active.host, active.token, resource);
        if (session !== active) throw new AppError(409, 'Connection changed.');
        if (resource === 'loads') {
          if (!Array.isArray(data) || data.some(load => !object(load) || !Number.isSafeInteger(load.id) || load.id < 0)) {
            active.loads.clear();
            throw new AppError(502, 'Gateway returned an invalid load list.');
          }
          active.loads = new Map(data.map(load => [String(load.id), load]));
        }
        return reply(200, { data: sanitize(data, active.token) });
      }
      const match = /^\/api\/loads\/(0|[1-9]\d{0,9})\/target_state$/.exec(path);
      if (req.method === 'PUT' && match) {
        const value = await body(req);
        if (session !== active) throw new AppError(409, 'Connection changed.');
        validateTarget(active.loads.get(match[1]), value);
        await gateway(active.host, active.token, `loads/${match[1]}/target_state`, 'PUT', value);
        return reply(200, { accepted: true });
      }
      const config = /^\/api\/loads\/(0|[1-9]\d{0,9})\/config$/.exec(path);
      if (req.method === 'PATCH' && config) {
        const input = await body(req);
        const checkSession = () => {
          if (session !== active) throw new AppError(409, 'Connection changed.');
        };
        checkSession();
        const discovered = active.loads.get(config[1]);
        if (!discovered) invalid('Select a discovered load.');
        keys(input, ['changes', 'expected']);
        keys(input.changes, ['name', 'room']);
        const fields = Object.keys(input.changes);
        if (!fields.length) invalid('Supply at least one configuration field.');
        keys(input.expected, fields);
        if (Object.keys(input.expected).length !== fields.length) invalid('Expected values must match changed fields.');
        const changes = { ...input.changes };
        for (const field of fields) {
          if (field === 'name') {
            if (typeof changes.name !== 'string' || !changes.name.trim() || changes.name.trim().length > 100) invalid('Name must contain 1 to 100 characters.');
            changes.name = changes.name.trim();
            if (input.expected.name !== null && typeof input.expected.name !== 'string') invalid('Expected name must be a string or null.');
          } else {
            if (!Number.isSafeInteger(changes.room) || changes.room < 0) invalid('Room must be a nonnegative integer.');
            if (input.expected.room !== null && (!Number.isSafeInteger(input.expected.room) || input.expected.room < 0)) invalid('Expected room must be a nonnegative integer or null.');
          }
        }
        const current = await gateway(active.host, active.token, `loads/${config[1]}`);
        checkSession();
        if (!object(current) || current.id !== Number(config[1])) throw new AppError(502, 'Gateway returned an invalid load.');
        if (['device', 'channel', 'type', 'sub_type'].some(field => (current[field] ?? null) !== (discovered[field] ?? null))) throw new AppError(409, 'Load identity changed; refresh before applying.');
        // Best-effort optimistic preflight: the gateway does not offer atomic conditional PATCH.
        if (fields.some(field => (current[field] ?? null) !== input.expected[field])) throw new AppError(409, 'Load configuration changed; refresh before applying.');
        if (fields.includes('room')) {
          const rooms = await gateway(active.host, active.token, 'rooms');
          checkSession();
          if (!Array.isArray(rooms) || rooms.some(room => !object(room) || !Number.isSafeInteger(room.id) || room.id < 0)) throw new AppError(502, 'Gateway returned an invalid room list.');
          if (!rooms.some(room => room.id === changes.room)) invalid('Select an existing room.');
        }
        checkSession();
        await gateway(active.host, active.token, `loads/${config[1]}`, 'PATCH', changes);
        checkSession();
        active.loads.set(config[1], { ...current, ...changes });
        return reply(200, { accepted: true });
      }
      throw new AppError(404, 'Endpoint not allowed.');
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      reply(error instanceof AppError ? error.status : 500,
        { error: error instanceof AppError ? error.message : 'Local server error.' });
    }
  });
  async function reconnectSaved() {
    if (connecting) throw new AppError(409, 'Connection already in progress.');
    if (!savedConnection) throw new AppError(409, 'No saved gateway connection.');
    reset();
    const current = generation;
    const saved = savedConnection;
    connecting = true;
    try {
      const host = validateHost(saved.host);
      await gateway(host, saved.token, 'info');
      if (generation !== current) throw new AppError(409, 'Connection cancelled.');
      session = { host, token: saved.token, loads: new Map(), draftScope: randomUUID() };
      startLive(session);
      credentialError = '';
    } catch (error) {
      if (generation === current) credentialError = 'Saved gateway could not connect. Retry, or forget it and enter a new token.';
      throw error;
    } finally { if (generation === current) connecting = false; }
  }
  server.once('listening', () => { if (savedConnection) void reconnectSaved().catch(() => {}); });
  function startLive(active) {
    if (liveEnabled) active.live = createLiveSession({ host: active.host, port: gatewayPort, token: active.token, scope: active.draftScope, handshakeTimeout: timeout });
  }
  // End indefinite streams before waiting for HTTP server shutdown.
  const closeServer = server.close.bind(server);
  server.close = (...args) => { reset(); return closeServer(...args); };
  server.on('close', () => { reset(); store.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
  createApp({ liveEnabled: true, dbPath: process.env.WISER_DB_PATH || DEFAULT_DB_PATH, credentialDir: process.env.WISER_CREDENTIAL_DIR || fileURLToPath(new URL('./data/credentials', import.meta.url)), integrationToken: process.env.WISER_INTEGRATION_TOKEN || '', integrationControl: process.env.WISER_INTEGRATION_CONTROL === '1' }).listen(port, '127.0.0.1', () => console.log(`Wiser local POC: http://127.0.0.1:${port}`));
}
