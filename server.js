import http from 'node:http';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const READS = new Set(['info', 'loads', 'loads/state', 'rooms', 'devices',
  'sensors', 'hvacgroups', 'hvacgroups/state']);
const ASSETS = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
};
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
  const field = load.type === 'motor' ? 'level' : ['onoff', 'dim'].includes(load.type) ? 'bri' : null;
  if (!field) invalid('This load type is read-only.');
  keys(value, [field]);
  if (Object.keys(value).length !== 1 || !Number.isInteger(value[field]) || value[field] < 0 || value[field] > 10000) invalid('Target must be an integer from 0 to 10000.');
  if (load.type === 'onoff' && ![0, 10000].includes(value.bri)) invalid('On/off loads accept only 0 or 10000.');
}

async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new AppError(415, 'JSON required.');
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 8192) throw new AppError(413, 'Request too large.');
  }
  try { return JSON.parse(text); } catch { invalid('Invalid JSON.'); }
}

// Factory permits tests to use an ephemeral fake gateway, without exposing a port
// override or arbitrary URL through the public API.
export function createApp({ gatewayPort = 80, timeout = 10000, claimTimeout = 45000 } = {}) {
  let session = null;
  let generation = 0;
  let connecting = false;
  const pending = new Set();
  function reset() {
    generation++;
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
    if (typeof value === 'string') return token ? value.split(token).join('[redacted]') : value;
    if (Array.isArray(value)) return value.map(item => sanitize(item, token));
    if (object(value)) return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/secret|token|authorization|password/i.test(key))
      .map(([key, item]) => [token ? key.split(token).join('[redacted]') : key, sanitize(item, token)]));
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
      if (req.method === 'GET' && ASSETS[path]) {
        const [file, type] = ASSETS[path];
        const content = await readFile(new URL(`./public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return res.end(content);
      }
      if (!path.startsWith('/api/')) throw new AppError(404, 'Not found.');
      // Custom header prevents form submissions and cross-origin simple requests.
      if (req.headers['x-wiser-client'] !== 'local-poc') throw new AppError(403, 'Local app header required.');
      if (req.method === 'GET' && path === '/api/session') return reply(200, { connected: !!session, host: session?.host || null, connecting });
      if (req.method === 'POST' && path === '/api/disconnect') {
        reset();
        return reply(200, { connected: false });
      }
      if (req.method === 'POST' && path === '/api/connect') {
        if (connecting) throw new AppError(409, 'Connection already in progress.');
        const input = await body(req);
        keys(input, ['host', 'token', 'pair']);
        const host = validateHost(input.host);
        if (typeof input.pair !== 'boolean') invalid('Choose token or pairing mode.');
        if (input.pair ? input.token !== undefined : typeof input.token !== 'string' || !/^[\x21-\x7e]{1,2048}$/.test(input.token)) invalid('Supply a valid token or choose pairing, not both.');
        if (connecting) throw new AppError(409, 'Connection already in progress.');
        reset();
        const current = generation;
        connecting = true;
        try {
          let token = input.token;
          if (input.pair) {
            const account = await gateway(host, null, 'account/claim', 'POST', { user: `local-poc-${randomUUID()}` }, true);
            token = account?.secret;
            if (typeof token !== 'string' || !/^[\x21-\x7e]{1,2048}$/.test(token)) throw new AppError(502, 'Gateway did not provide a valid pairing credential.');
          }
          const info = await gateway(host, token, 'info');
          if (generation !== current) throw new AppError(409, 'Connection cancelled.');
          session = { host, token, loads: new Map() };
          return reply(200, { connected: true, host, info: sanitize(info, token) });
        } finally { if (generation === current) connecting = false; }
      }
      if (!session) throw new AppError(409, 'Connect to a gateway first.');
      const active = session;
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
      throw new AppError(404, 'Endpoint not allowed.');
    } catch (error) {
      reply(error instanceof AppError ? error.status : 500,
        { error: error instanceof AppError ? error.message : 'Local server error.' });
    }
  });
  server.on('close', reset);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
  createApp().listen(port, '127.0.0.1', () => console.log(`Wiser local POC: http://127.0.0.1:${port}`));
}
