import https from 'node:https';
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const digest = value => createHash('sha256').update(value).digest();
const fail = (res, status) => {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: status === 401 ? 'Unauthorized.' : 'Request failed.' }));
};
export function createIntegrationListener({ cert, key, token, localPort = 3000, timeout = 40000 } = {}) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('Invalid integration token configuration.');
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) throw new Error('Invalid local port configuration.');
  const expected = digest(token);
  const server = https.createServer({ cert, key, minVersion: 'TLSv1.2' }, (req, res) => {
    if (req.headers.origin !== undefined || /^(cross-site|same-site|same-origin)$/.test(req.headers['sec-fetch-site'] || '')) return fail(res, 403);
    const auth = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.authorization || '');
    if (!timingSafeEqual(expected, digest(auth?.[1] || ''))) return fail(res, 401);
    const allowed = req.method === 'GET' && req.url === '/api/integration/v1/snapshot'
      || req.method === 'PUT' && /^\/api\/integration\/v1\/loads\/(0|[1-9]\d{0,9})\/target$/.test(req.url);
    if (!allowed) return fail(res, 404);
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
  });
  server.requestTimeout = timeout;
  server.headersTimeout = Math.min(timeout, 10000);
  return server;
}

export function startIntegrationListener(env = process.env) {
  try {
    if (!env.WISER_TLS_CERT || !env.WISER_TLS_KEY) throw new Error();
    const info = lstatSync(env.WISER_TLS_KEY);
    if (!info.isFile() || info.isSymbolicLink() || process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid())) throw new Error();
    const server = createIntegrationListener({ cert: readFileSync(env.WISER_TLS_CERT), key: readFileSync(env.WISER_TLS_KEY), token: env.WISER_INTEGRATION_TOKEN, localPort: Number(env.WISER_LOCAL_PORT || 3000) });
    const port = Number(env.WISER_API_PORT || 3443);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
    server.on('error', () => { console.error('Integration listener failed.'); process.exitCode = 1; });
    server.listen(port, env.WISER_API_BIND || '127.0.0.1');
    return server;
  } catch { throw new Error('Invalid integration listener configuration.'); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { startIntegrationListener(); }
  catch { console.error('Invalid integration listener configuration.'); process.exitCode = 1; }
}
