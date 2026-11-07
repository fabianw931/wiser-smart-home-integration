import { test, expect } from './gateway-fixture.js';

test.use({ liveUpdates: true });

test('raw gateway events panel captures non-load messages on demand, without polling or gateway requests', async ({ page, gateway }) => {
  await page.goto(gateway.url);
  await page.getByLabel(/Gateway IP or hostname/).fill('127.0.0.1');
  await page.getByLabel('Gateway token').fill(gateway.token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await expect(page.getByText('Live', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();

  const panel = page.getByRole('region', { name: 'Gateway events (raw)' });
  await expect(panel).toContainText('Press a registered wall button and refresh to see its message');
  await expect(panel.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
  // Nothing is shown, and nothing is fetched, until Refresh is pressed.
  await expect(panel.getByRole('status')).toHaveCount(0);

  const requests = [];
  page.on('request', request => { if (request.url().includes('/api/diagnostics/gateway-events')) requests.push(request.method()); });
  const callsBefore = gateway.control.calls.length;
  gateway.control.pushState(2, { bri: 5000 }); // plain load events are not captured
  gateway.control.pushRaw({ button: { id: 12, event: 'click', secret: 'never-shown' } });
  gateway.control.pushRaw({ findme: { button: { device: '00019edc', channel: 0 } } });
  await page.waitForTimeout(300);
  expect(requests).toEqual([]);

  await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
  const captured = panel.getByLabel('Captured gateway messages');
  await expect(captured).toContainText('{"button":{"id":12,"event":"click"}}');
  await expect(captured).toContainText('{"findme":{"button":{"device":"00019edc","channel":0}}}');
  await expect(captured).not.toContainText('never-shown');
  await expect(captured).not.toContainText('"bri"');
  await expect(captured).toContainText(/\d{4}-\d{2}-\d{2}T/);
  expect(requests).toEqual(['GET']);

  await panel.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('No messages captured yet.');
  await expect(captured).toHaveCount(0);
  // The capture used the already open WebSocket only: no new gateway request came from reading or clearing it.
  const gatewayCalls = gateway.control.calls.slice(callsBefore);
  expect(gatewayCalls).toEqual([]);
});
