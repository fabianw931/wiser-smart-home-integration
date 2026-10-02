import http from 'node:http';
import { test as base, expect } from '@playwright/test';
import { createApp } from '../server.js';

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const close = server => new Promise(resolve => {
  server.close(resolve);
  server.closeAllConnections();
});

// Everything stays on loopback; these tests never discover or control real hardware.
export const test = base.extend({
  gateway: async ({}, use) => {
    const loads = [
      { id: 1, type: 'onoff', name: 'Hall light', device: 'fake-1', channel: 0, unused: false },
      { id: 2, type: 'dim', name: 'Desk light', device: 'fake-2', channel: 0, unused: false },
      { id: 3, type: 'motor', name: 'Office blind', device: 'fake-3', channel: 0, unused: false },
      { id: 4, type: 'unknown', name: 'Unknown device', device: 'fake-4', channel: 0, unused: false },
      { id: 5, type: 'dim', name: 'Unused channel', device: 'fake-5', channel: 0, unused: true },
    ];
    const states = new Map([
      [1, { bri: 0 }], [2, { bri: 2500 }], [3, { level: 4000, moving: 'stop' }],
    ]);
    const control = {
      calls: [],
      failStates: false,
      applyTargets: true,
      failAfterTarget: false,
      rejectAuth: false,
      // A synthetic fixture value, never a real gateway credential.
      token: 'synthetic-browser-fixture-token',
    };
    const fake = http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = body ? JSON.parse(body) : undefined;
      control.calls.push({ path: req.url, method: req.method, payload });
      const reply = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const success = data => reply(200, { status: 'success', data });
      if (req.url === '/api/account/claim') {
        return success({ user: payload.user, secret: control.token });
      }
      if (control.rejectAuth || req.headers.authorization !== `Bearer ${control.token}`) {
        return reply(401, { status: 'error', message: 'Rejected synthetic credential' });
      }
      if (req.url === '/api/info') return success({ name: 'Browser fixture gateway' });
      if (req.url === '/api/loads') return success(loads);
      if (req.url === '/api/loads/state') {
        if (control.failStates) return reply(503, { status: 'error' });
        return success([...states].map(([id, state]) => ({ id, state })));
      }
      const target = /^\/api\/loads\/(\d+)\/target_state$/.exec(req.url);
      if (req.method === 'PUT' && target) {
        if (control.applyTargets) states.set(Number(target[1]), payload);
        if (control.failAfterTarget) control.failStates = true;
        return success({ id: Number(target[1]), target_state: payload });
      }
      if (req.url === '/api/rooms') return success([{ id: 1, name: 'Hall' }]);
      if (['/api/devices', '/api/hvacgroups', '/api/hvacgroups/state'].includes(req.url)) return success([]);
      return reply(404, { status: 'error', message: 'Unsupported fixture resource' });
    });
    const port = await listen(fake);
    const app = createApp({ gatewayPort: port, timeout: 1000 });
    try {
      const appPort = await listen(app);
      await use({ ...control, control, url: `http://127.0.0.1:${appPort}` });
    } finally {
      await close(app);
      await close(fake);
    }
  },
});

export { expect };
