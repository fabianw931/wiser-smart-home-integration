import https from 'node:https';
import http from 'node:http';
import { isIP } from 'node:net';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const digest = value => createHash('sha256').update(value).digest();
const fail = (res, status) => {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: status === 401 ? 'Unauthorized.' : 'Request failed.' }));
};
// `tls: false` is the explicit plain-HTTP mode for a trusted LAN; every check below applies identically in both modes.
export function createIntegrationListener({ cert, key, token, localPort = 3000, timeout = 40000, streamIdleTimeout = 65000, tls = true } = {}) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('Invalid integration token configuration.');
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) throw new Error('Invalid local port configuration.');
  const expected = digest(token);
  // Long-lived NDJSON relay. The upstream app sends a heartbeat every ~20 s, so silence for streamIdleTimeout means a dead link.
  // Nothing is buffered beyond one chunk: a slow client pauses the upstream, and the app drops clients that fall behind.
  function relayStream(req, res) {
    req.resume();
    const headerTimer = setTimeout(() => { fail(res, 504); upstream.destroy(); }, timeout);
    const upstream = http.request({ hostname: '127.0.0.1', port: localPort, path: req.url, method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/x-ndjson' }, timeout: streamIdleTimeout }, response => {
      clearTimeout(headerTimer);
      if (response.statusCode !== 200 || !/^application\/x-ndjson(?:;|$)/i.test(response.headers['content-type'] || '')) {
        response.resume();
        return fail(res, response.statusCode >= 400 && response.statusCode <= 499 ? response.statusCode : 502);
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      res.socket?.setNoDelay(true);
      response.on('data', chunk => { if (!res.write(chunk)) { response.pause(); res.once('drain', () => response.resume()); } });
      response.on('end', () => res.end());
      response.on('error', () => res.destroy());
    });
    res.once('close', () => { clearTimeout(headerTimer); upstream.destroy(); });
    upstream.on('timeout', () => { fail(res, 504); upstream.destroy(); });
    upstream.on('error', () => fail(res, 502));
    upstream.end();
  }
  const handler = (req, res) => {
    if (req.headers.origin !== undefined || /^(cross-site|same-site|same-origin)$/.test(req.headers['sec-fetch-site'] || '')) return fail(res, 403);
    const auth = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.authorization || '');
    if (!timingSafeEqual(expected, digest(auth?.[1] || ''))) return fail(res, 401);
    const stream = req.method === 'GET' && req.url === '/api/integration/v1/events';
    const allowed = stream || req.method === 'GET' && req.url === '/api/integration/v1/snapshot'
      || req.method === 'PUT' && (req.url === '/api/integration/v1/buttons/identify'
        || /^\/api\/integration\/v1\/loads\/(0|[1-9]\d{0,9})\/target$/.test(req.url));
    if (!allowed) return fail(res, 404);
    if (stream) return relayStream(req, res);
    let size = 0;
    const chunks = [];
    const timer = setTimeout(() => { fail(res, 504); req.destroy(); }, timeout);
    res.once('close', () => clearTimeout(timer));
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 8192) { fail(res, 413); req.pause(); }
      else chunks.push(chunk);
    });
    req.on('error', () => fail(res, 400));
    req.on('end', () => {
      if (res.writableEnded || size > 8192) return;
      const upstream = http.request({ hostname: '127.0.0.1', port: localPort, path: req.url, method: req.method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout }, response => {
        let responseSize = 0;
        const output = [];
        response.on('data', chunk => {
          responseSize += chunk.length;
          if (responseSize > 2 * 1024 * 1024) { fail(res, 502); response.destroy(); }
          else output.push(chunk);
        });
        response.on('error', () => fail(res, 502));
        response.on('end', () => {
          if (res.writableEnded) return;
          if (response.statusCode < 200 || response.statusCode >= 300) return fail(res, response.statusCode >= 400 && response.statusCode <= 499 ? response.statusCode : 502);
          res.writeHead(response.statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(Buffer.concat(output));
        });
      });
      res.once('close', () => upstream.destroy());
      upstream.on('timeout', () => { fail(res, 504); upstream.destroy(); });
      upstream.on('error', () => fail(res, 502));
      upstream.end(Buffer.concat(chunks));
    });
  };
  const server = tls ? https.createServer({ cert, key, minVersion: 'TLSv1.2' }, handler) : http.createServer(handler);
  server.requestTimeout = timeout;
  server.headersTimeout = Math.min(timeout, 10000);
  return server;
}

// Environment rules (all errors are generic about secrets and name only the variable at fault):
// - WISER_API_TLS: unset or 1 = HTTPS (cert and key required); 0 = plain HTTP, only with an explicit literal-IP WISER_API_BIND.
// - Plain HTTP never defaults its bind address, so nobody is exposed by accident; 0.0.0.0 or :: must be typed deliberately.
export function startIntegrationListener(env = process.env, { localPort, log = message => console.log(message) } = {}) {
  const tls = env.WISER_API_TLS === undefined || env.WISER_API_TLS === '' || env.WISER_API_TLS === '1' ? true : env.WISER_API_TLS === '0' ? false : null;
  if (tls === null) throw new Error('WISER_API_TLS must be 0 (plain HTTP) or 1 (HTTPS, the default).');
  const port = Number(env.WISER_API_PORT || 3443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WISER_API_PORT must be 1–65535.');
  const bind = env.WISER_API_BIND || (tls ? '127.0.0.1' : '');
  if (!tls && !isIP(bind)) throw new Error('Plain HTTP (WISER_API_TLS=0) needs WISER_API_BIND set to the IP address to listen on (for example the LAN address of this computer; 0.0.0.0 for all interfaces).');
  if (tls && (!env.WISER_TLS_CERT || !env.WISER_TLS_KEY)) throw new Error('HTTPS needs WISER_TLS_CERT and WISER_TLS_KEY (or set WISER_API_TLS=0 for plain HTTP on a trusted LAN).');
  let options = { tls: false };
  if (tls) {
    let info;
    try { info = lstatSync(env.WISER_TLS_KEY); } catch { throw new Error('WISER_TLS_KEY could not be read.'); }
    if (!info.isFile() || info.isSymbolicLink() || process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid())) {
      throw new Error('WISER_TLS_KEY must be a regular file owned by this account with no group or other permissions (chmod 600).');
    }
    try { options = { tls: true, cert: readFileSync(env.WISER_TLS_CERT), key: readFileSync(env.WISER_TLS_KEY) }; } catch { throw new Error('WISER_TLS_CERT or WISER_TLS_KEY could not be read.'); }
  }
  const server = createIntegrationListener({ ...options, token: env.WISER_INTEGRATION_TOKEN, localPort: localPort ?? Number(env.WISER_LOCAL_PORT || 3000) });
  server.on('error', () => { console.error('Integration listener failed (is the port already in use?).'); process.exitCode = 1; });
  server.listen(port, bind, () => {
    const address = `${bind.includes(':') ? `[${bind}]` : bind}:${port}`;
    if (tls) log(`Home Assistant integration API: https://${address} (TLS)`);
    else log(`Home Assistant integration API: http://${address} WITHOUT TLS - the integration token travels unencrypted on the network (the same exposure class as the gateway's own HTTP). Use only on a trusted LAN and never forward this port.${/^(0\.0\.0\.0|::)$/.test(bind) ? ' It listens on ALL interfaces.' : ''}`);
  });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { startIntegrationListener(); }
  catch (error) { console.error(error.message || 'Invalid integration listener configuration.'); process.exitCode = 1; }
}
