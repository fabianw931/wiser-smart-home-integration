import { test, expect } from './gateway-fixture.js';

async function connect(page, gateway) {
  await page.goto(gateway.url);
  await page.getByLabel(/Gateway IP or hostname/).fill('127.0.0.1');
  await page.getByLabel('Gateway token').fill(gateway.token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeEnabled();
}

test('buttons identify only on explicit click, weather preserves zero and shows rules separately', async ({ page, gateway }) => {
  gateway.control.installationResources = {
    buttons: [{ id: null, name: 'Hall switch', type: 'button', device: '0000a98f', channel: 0 }],
    smartbuttons: [{ id: 9, name: 'Scene switch', job: 8 }],
    sensors: [
      { id: 1, name: 'Wind speed', type: 'wind', device: '00000124', value: 0, unit: 'm/s' },
      { id: 2, name: 'Rain sensor', type: 'rain', device: '00000124', value: false, unit: 'bool' },
      { id: 3, name: 'Missing temperature', type: 'temperature', device: '00000124', value: null, unit: '°C' },
    ],
    westgroups: [{ id: 6, loads: [3], wind: { action: 'up and lock', threshold: 5.5, unit: 'm/s' } }],
  };
  await connect(page, gateway);
  await page.getByRole('button', { name: 'Buttons', exact: true }).click();
  const button = page.getByRole('article', { name: 'Hall switch', exact: true });
  await expect(button).toContainText('Not registered');
  await expect(page.getByText('Job: 8', { exact: true })).toBeVisible();
  expect(gateway.control.calls.filter(call => call.method !== 'GET')).toEqual([]);
  await button.getByRole('button', { name: 'Identify · flash LED for 2 seconds' }).click();
  await expect(page.getByText(/Identification request accepted/)).toBeVisible();
  expect(gateway.control.calls.filter(call => call.method !== 'GET')).toEqual([
    { path: '/api/buttons/0000a98f_0/ping', method: 'PUT', payload: { time_ms: 2000 } },
  ]);
  await page.getByRole('button', { name: 'Weather', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Wind speed' })).toContainText('0 m/s');
  await expect(page.getByRole('article', { name: 'Rain sensor' })).toContainText('Not detected');
  await expect(page.getByRole('article', { name: 'Missing temperature' })).toContainText('Unavailable');
  await expect(page.getByText('Loads: Office blind')).toBeVisible();
  await expect(page.getByText(/These are configured rules, not live alarms/)).toBeVisible();
  await page.getByLabel('Search weather').fill('Wind');
  await expect(page.getByRole('article', { name: 'Rain sensor' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Disconnect & forget credentials' }).click();
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('unsupported installation resources remain distinct from an empty installation', async ({ page, gateway }) => {
  await connect(page, gateway);
  await page.getByRole('button', { name: 'Buttons', exact: true }).click();
  await expect(page.getByText('Unsupported by gateway').first()).toBeVisible();
  await expect(page.getByText('Resources are not available yet.')).toBeVisible();
  expect(gateway.control.calls.filter(call => call.method !== 'GET')).toEqual([]);
});

test('sample installation is explorable without gateway actions', async ({ page, gateway }) => {
  await page.goto(gateway.url);
  await page.getByRole('button', { name: 'Explore sample home' }).click();
  await page.getByRole('button', { name: 'Buttons', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Entrance switch', exact: true })).toBeVisible();
  for (const button of await page.getByRole('button', { name: 'Identify · flash LED for 2 seconds' }).all()) await expect(button).toBeDisabled();
  await page.getByRole('button', { name: 'Weather', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Wind', exact: true })).toContainText('3.2 m/s');
  expect(gateway.control.calls).toEqual([]);
});
