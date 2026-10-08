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
      { id: 1, type: 'onoff', name: 'Hall light', room: 1, device: 'fake-1', channel: 0, unused: false },
      { id: 2, type: 'dim', name: 'Desk light', device: 'fake-2', channel: 0, unused: false },
      { id: 3, type: 'motor', name: 'Office blind', device: 'fake-3', channel: 0, unused: false },
      { id: 4, type: 'unknown', name: 'Unknown device', device: 'fake-4', channel: 0, unused: false },
      { id: 5, type: 'dim', name: 'Unused channel', device: 'fake-5', channel: 0, unused: true },
      { id: 6, type: 'dali', sub_type: '', name: 'DALI spots', device: 'fake-6', channel: 0 },
      { id: 7, type: 'dali', sub_type: 'tw', name: 'DALI white', device: 'fake-7', channel: 0 },
      { id: 8, type: 'dali', sub_type: 'rgb', name: 'DALI color', device: 'fake-8', channel: 0 },
      { id: 9, type: 'dali', sub_type: 'future', name: 'Unknown DALI', device: 'fake-9', channel: 0 },
      { id: 10, type: 'dali', name: 'Missing DALI state', device: 'fake-10', channel: 0 },
    ];
    const states = new Map([
      [1, { bri: 0 }], [2, { bri: 2500 }], [3, { level: 4000, moving: 'stop' }],
      [6, { bri: 5000 }], [7, { bri: 4000, ct: 3000 }],
      [8, { bri: 6000, red: 10, green: 20, blue: 30, white: 40 }], [9, { bri: 5000 }],
    ]);
    const control = {
      calls: [],
      states,
      loads,
      holdDiagnostics: false,
      releaseDiagnostics: () => {},
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
      const loadMetadata = /^\/api\/loads\/(\d+)$/.exec(req.url);
      if (loadMetadata) {
        const load = loads.find(item => item.id === Number(loadMetadata[1]));
        if (!load) return reply(404, { status: 'error' });
        if (req.method === 'PATCH') Object.assign(load, payload);
        return success({ ...load, state: states.get(load.id) });
      }
      if (req.url === '/api/loads/state') {
        if (control.failStates) return reply(503, { status: 'error' });
        return success([...states].map(([id, state]) => ({ id, state })));
      }
      const target = /^\/api\/loads\/(\d+)\/target_state$/.exec(req.url);
      if (req.method === 'PUT' && target) {
        if (control.applyTargets) states.set(Number(target[1]), { ...states.get(Number(target[1])), ...payload });
        if (control.failAfterTarget) control.failStates = true;
        return success({ id: Number(target[1]), target_state: payload });
      }
      if (req.url === '/api/rooms') {
        if (control.holdDiagnostics) await new Promise(resolve => { control.releaseDiagnostics = resolve; });
        return success([{ id: 1, name: 'Hall' }, { id: 2, name: 'Living room' }]);
      }
      if (['/api/devices', '/api/hvacgroups', '/api/hvacgroups/state'].includes(req.url)) return success([]);
      return reply(404, { status: 'error', message: 'Unsupported fixture resource' });
    });
    const port = await listen(fake);
    const app = createApp({ gatewayPort: port, timeout: 10000 });
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
