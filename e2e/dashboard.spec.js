import { test, expect } from './gateway-fixture.js';

async function connect(page, gateway) {
  await page.goto(gateway.url);
  await page.getByLabel(/Gateway IP or hostname/).fill('127.0.0.1');
  await page.getByLabel('Gateway token').fill(gateway.token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeEnabled();
}

test('token connection discovers and controls lights and blinds, then forgets credentials', async ({ page, gateway }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await connect(page, gateway);
  await expect(page.getByLabel('Gateway token')).toHaveCount(0);
  const hall = page.getByRole('article', { name: 'Hall light' });
  const desk = page.getByRole('article', { name: 'Desk light' });
  const blind = page.getByRole('article', { name: 'Office blind' });
  await expect(hall.getByTestId('reported-state')).toHaveText('Reported: Off');
  await hall.getByRole('button', { name: 'On', exact: true }).click();
  await expect(hall.getByTestId('reported-state')).toHaveText('Reported: On');
  await desk.getByLabel(/Brightness target/).fill('37.5');
  await desk.getByRole('button', { name: 'Set target' }).click();
  await expect(desk.getByTestId('reported-state')).toHaveText('Reported: 37.5% brightness');
  await blind.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(blind.getByTestId('reported-state')).toHaveText('Reported: 0% closed');
  expect(gateway.control.calls.filter(call => call.method === 'PUT').map(call => call.payload)).toEqual([
    { bri: 10000 }, { bri: 3750 }, { level: 0 },
  ]);
  await expect(page.getByRole('article', { name: 'Unknown device' })).toContainText('Read-only');
  await expect(page.getByRole('article', { name: 'Unused channel' })).toContainText('unused channel');
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
  await expect(page.locator('summary').filter({ hasText: 'sensors' })).toContainText('Unsupported');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.getByRole('button', { name: 'Disconnect & forget credentials' }).click();
  await expect(page.getByRole('status')).toContainText('server credentials forgotten');
  await expect(page.getByRole('article')).toHaveCount(0);
  const session = await page.request.get(`${gateway.url}/api/session`, { headers: { 'X-Wiser-Client': 'local-poc' } });
  expect((await session.json()).connected).toBe(false);
  expect(errors).toEqual([]);
});

test('pairing uses a unique account and never exposes the returned credential', async ({ page, gateway }) => {
  await page.goto(gateway.url);
  await page.getByLabel(/Gateway IP or hostname/).fill('127.0.0.1');
  await page.getByRole('radio', { name: 'Pair new client' }).check();
  await expect(page.getByText(/Have physical access/)).toBeVisible();
  const response = page.waitForResponse(`${gateway.url}/api/connect`);
  await page.getByRole('button', { name: 'Start pairing' }).click();
  expect(await (await response).text()).not.toContain(gateway.token);
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeEnabled();
  const claim = gateway.control.calls.find(call => call.path === '/api/account/claim');
  expect(claim.payload.user).toMatch(/^local-poc-[0-9a-f-]+$/);
  expect(await page.content()).not.toContain(gateway.token);
});

test('DALI controls send subtype-specific partial targets and preserve other channels', async ({ page, gateway }) => {
  await connect(page, gateway);
  const spots = page.getByRole('article', { name: 'DALI spots', exact: true });
  const white = page.getByRole('article', { name: 'DALI white', exact: true });
  const color = page.getByRole('article', { name: 'DALI color', exact: true });
  await spots.getByLabel(/Brightness target/).fill('27.5');
  await spots.getByRole('button', { name: 'Set target', exact: true }).click();
  await expect(spots.getByTestId('reported-state')).toHaveText('Reported: 27.5% brightness');
  await white.getByLabel(/Color temperature.*target/).fill('4200');
  await white.getByLabel(/Color temperature.*target/).press('Enter');
  await expect(white).toContainText('Reported Color temperature (ct): 4200');
  await expect(white.getByTestId('reported-state')).toHaveText('Reported: 40% brightness');
  for (const [channel, value] of [['Red', 255], ['Green', 0], ['Blue', 128], ['White', 64]]) {
    await color.getByLabel(`${channel} target (0–255)`).fill(String(value));
    await color.getByRole('button', { name: `Set ${channel.toLowerCase()}`, exact: true }).click();
    await expect(color).toContainText(`Reported ${channel}: ${value}`);
  }
  await expect(color.getByTestId('reported-state')).toHaveText('Reported: 60% brightness');
  await color.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(color.getByTestId('reported-state')).toHaveText('Reported: 0% brightness');
  await expect(color).toContainText('Reported Red: 255');
  expect(gateway.control.calls.filter(call => call.method === 'PUT').map(call => call.payload)).toEqual([
    { bri: 2750 }, { ct: 4200 }, { red: 255 }, { green: 0 }, { blue: 128 }, { white: 64 }, { bri: 0 },
  ]);
  await expect(page.getByRole('article', { name: 'Unknown DALI', exact: true })).toContainText('unsupported DALI subtype');
  await expect(spots.getByLabel(/Color temperature/)).toHaveCount(0);
  await expect(white.getByLabel(/Red target/)).toHaveCount(0);
});

test('missing or invalid load readings disable only that load and recover on refresh', async ({ page, gateway }) => {
  gateway.control.states.set(7, { bri: 4000 });
  gateway.control.states.set(6, { bri: -1 });
  await connect(page, gateway);
  const missing = page.getByRole('article', { name: 'Missing DALI state', exact: true });
  const spots = page.getByRole('article', { name: 'DALI spots', exact: true });
  const white = page.getByRole('article', { name: 'DALI white', exact: true });
  await expect(missing.getByRole('button', { name: 'On', exact: true })).toBeDisabled();
  await expect(spots.getByRole('button', { name: 'On', exact: true })).toBeDisabled();
  await expect(white.getByRole('button', { name: 'On', exact: true })).toBeEnabled();
  await expect(white).toContainText('Reported Color temperature (ct): Unavailable');
  gateway.control.states.set(10, { bri: 2000 });
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await expect(missing.getByRole('button', { name: 'On', exact: true })).toBeEnabled();
});

test('pending diagnostics do not block commands and disconnect rejects their late result', async ({ page, gateway }) => {
  gateway.control.holdDiagnostics = true;
  await connect(page, gateway);
  await expect.poll(() => gateway.control.calls.some(call => call.path === '/api/rooms')).toBe(true);
  const hall = page.getByRole('article', { name: 'Hall light' });
  await hall.getByRole('button', { name: 'On', exact: true }).click();
  await expect(hall.getByTestId('reported-state')).toHaveText('Reported: On');
  expect(gateway.control.calls.filter(call => call.path === '/api/rooms')).toHaveLength(1);
  await page.getByRole('button', { name: 'Disconnect & forget credentials' }).click();
  gateway.control.releaseDiagnostics();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByText('Updating diagnostics in the background…')).toHaveCount(0);
  expect(gateway.control.calls.some(call => call.path === '/api/devices')).toBe(false);
});

test('accepted commands do not become reported state and refresh failure is visibly stale', async ({ page, gateway }) => {
  await connect(page, gateway);
  const hall = page.getByRole('article', { name: 'Hall light' });
  gateway.control.applyTargets = false;
  await hall.getByRole('button', { name: 'On', exact: true }).click();
  await expect(page.getByText(/Target accepted for Hall light/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeEnabled();
  await expect(hall.getByTestId('reported-state')).toHaveText('Reported: Off');
  gateway.control.failAfterTarget = true;
  await hall.getByRole('button', { name: 'On', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Gateway request failed');
  await expect(page.getByText(/Target accepted for Hall light/)).toBeVisible();
  await expect(hall).toContainText('Stale or unavailable');
  await expect(hall.getByRole('button', { name: 'On', exact: true })).toBeDisabled();
  gateway.control.failStates = false;
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await expect(hall.getByRole('button', { name: 'On', exact: true })).toBeEnabled();
});

test('credential errors are actionable and a retry works without browser persistence', async ({ page, gateway }) => {
  gateway.control.rejectAuth = true;
  await page.goto(gateway.url);
  await page.getByLabel(/Gateway IP or hostname/).fill('127.0.0.1');
  await page.getByLabel('Gateway token').fill(gateway.token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Gateway rejected credentials');
  await expect(page.getByLabel('Gateway token')).toHaveValue('');
  gateway.control.rejectAuth = false;
  await page.getByLabel('Gateway token').fill(gateway.token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeEnabled();
});

test('narrow-screen form supports keyboard submission without horizontal overflow', async ({ page, gateway }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(gateway.url);
  await page.getByLabel(/Gateway IP or hostname/).fill('127.0.0.1');
  await page.getByLabel('Gateway token').fill(gateway.token);
  await page.getByLabel('Gateway token').press('Enter');
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-mobile.png'), fullPage: true });
});


async function savePersonalMapping(page, gateway) {
  await connect(page, gateway);
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByLabel('Choose a load to configure').selectOption('1');
  await page.getByLabel('Personal display name').fill('Entrance pendant');
  await page.getByLabel('Personal room', { exact: true }).fill('My studio');
  await page.getByLabel('Personal notes').fill('Left of the door');
  await page.getByRole('button', { name: 'Save local mapping' }).click();
  await expect(page.getByRole('article', { name: 'Mapping for Entrance pendant' })).toContainText('My studio');
}

test('personal mappings persist across reload and reconnect while controls remain real', async ({ page, gateway }, testInfo) => {
  await savePersonalMapping(page, gateway);
  expect(gateway.control.calls.filter(call => call.method !== 'GET')).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('configuration-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('configuration-mobile.png'), fullPage: true });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeEnabled();
  const mapped = page.getByRole('article', { name: 'Entrance pendant', exact: true });
  await expect(mapped).toBeVisible();
  await page.getByLabel('Filter by room').selectOption('My studio');
  await expect(page.getByRole('article')).toHaveCount(1);
  await mapped.getByRole('button', { name: 'On', exact: true }).click();
  await expect(mapped.getByTestId('reported-state')).toHaveText('Reported: On');
  expect(gateway.control.calls.filter(call => call.method !== 'GET').map(call => [call.path, call.payload])).toEqual([
    ['/api/loads/1/target_state', { bri: 10000 }],
  ]);
  await page.getByRole('button', { name: 'Disconnect & forget credentials' }).click();
  await connect(page, gateway);
  await expect(mapped).toBeVisible();
  expect(gateway.control.loads[0].name).toBe('Hall light');
  expect(gateway.control.loads[0].room).toBe(1);
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByRole('button', { name: 'Remove local mapping' }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Hall light', exact: true })).toBeVisible();
});

test('database mappings are available in a fresh browser context', async ({ page, browser, gateway }) => {
  await savePersonalMapping(page, gateway);
  const context = await browser.newContext();
  try {
    const fresh = await context.newPage();
    await fresh.goto(gateway.url);
    await expect(fresh.getByRole('article', { name: 'Entrance pendant', exact: true })).toBeVisible();
    expect(await fresh.evaluate(() => localStorage.length)).toBe(0);
    expect(gateway.control.calls.filter(call => call.method !== 'GET')).toEqual([]);
  } finally { await context.close(); }
});

test('legacy browser mappings migrate without replacing existing database entries', async ({ page, gateway }) => {
  await savePersonalMapping(page, gateway);
  await page.evaluate(() => localStorage.setItem('wiser-personal-mappings-v1', JSON.stringify({
    '127.0.0.1': {
      '1': { identity: '[1,"fake-1",0,"onoff"]', name: 'Old name', room: '', notes: '' },
      '2': { identity: '[2,"fake-2",0,"dim"]', name: 'Migrated lamp', room: 'Office', notes: 'Legacy note' },
    },
  })));
  await page.reload();
  await expect(page.getByRole('article', { name: 'Entrance pendant', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('wiser-personal-mappings-v1'))).toBeNull();
  const response = await page.request.get(`${gateway.url}/api/local/mappings?gateway=127.0.0.1`, { headers: { 'X-Wiser-Client': 'local-poc' } });
  const { data } = await response.json();
  expect(data['1'].name).toBe('Entrance pendant');
  expect(data['2'].name).toBe('Migrated lamp');
  expect(gateway.control.calls.filter(call => call.method !== 'GET')).toEqual([]);
});

test('failed database saves show an error without blocking device controls', async ({ page, gateway }) => {
  await connect(page, gateway);
  await page.route('**/api/local/mappings/1?*', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Database unavailable' }) }));
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByLabel('Choose a load to configure').selectOption('1');
  await page.getByLabel('Personal display name').fill('Not saved');
  await page.getByRole('button', { name: 'Save local mapping' }).click();
  await expect(page.getByRole('alert')).toContainText('Mapping was not saved');
  await expect(page.getByRole('article', { name: 'Mapping for Not saved' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  const hall = page.getByRole('article', { name: 'Hall light', exact: true });
  await hall.getByRole('button', { name: 'On', exact: true }).click();
  await expect(hall.getByTestId('reported-state')).toHaveText('Reported: On');
});

test('gateway metadata is a separate reviewed action and keeps personal mapping', async ({ page, gateway }) => {
  await savePersonalMapping(page, gateway);
  await page.getByText('Change gateway metadata…', { exact: true }).click();
  await page.getByLabel('Gateway display name').fill('Gateway entrance');
  await page.getByRole('combobox', { name: 'Gateway room', exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Review gateway change' }).click();
  await expect(page.getByRole('dialog')).toContainText('Gateway entrance');
  expect(gateway.control.calls.filter(call => call.method !== 'GET')).toEqual([]);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(gateway.control.calls.filter(call => call.method !== 'GET')).toEqual([]);
  await page.getByRole('button', { name: 'Review gateway change' }).click();
  await page.getByRole('button', { name: 'Apply this change to gateway' }).click();
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeEnabled();
  expect(gateway.control.calls.filter(call => call.method === 'PATCH').map(call => call.payload)).toEqual([{ name: 'Gateway entrance', room: 2 }]);
  await expect(page.getByRole('article', { name: 'Mapping for Entrance pendant' })).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Entrance pendant', exact: true })).toBeVisible();
});

test('installer changes reject pending gateway metadata without affecting personal mapping', async ({ page, gateway }) => {
  await savePersonalMapping(page, gateway);
  await page.getByText('Change gateway metadata…', { exact: true }).click();
  await page.getByLabel('Gateway display name').fill('Requested name');
  await page.getByRole('button', { name: 'Review gateway change' }).click();
  gateway.control.loads[0].name = 'Installer update';
  await page.getByRole('button', { name: 'Apply this change to gateway' }).click();
  await expect(page.getByRole('alert')).toContainText(/changed|conflict/i);
  expect(gateway.control.calls.filter(call => call.method === 'PATCH')).toEqual([]);
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Entrance pendant', exact: true })).toBeVisible();
});

test('mapping export and import stay local and never include credentials', async ({ page, gateway }) => {
  await savePersonalMapping(page, gateway);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export mappings' }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  expect(text).not.toContain(gateway.token);
  const data = JSON.parse(text);
  expect(data.mappings['1'].name).toBe('Entrance pendant');
  await page.getByRole('button', { name: 'Remove local mapping' }).click();
  await page.getByLabel('Import mappings file').setInputFiles({ name: 'mappings.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.getByRole('article', { name: 'Mapping for Entrance pendant' })).toBeVisible();
  await page.getByLabel('Import mappings file').setInputFiles({ name: 'wrong.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...data, gateway: 'other-gateway' })) });
  await expect(page.getByRole('alert')).toContainText('for this gateway');
  expect(gateway.control.calls.filter(call => call.method !== 'GET')).toEqual([]);
});

test('sample home is offline and supports room filters and simulated controls', async ({ page, gateway }, testInfo) => {
  await page.goto(gateway.url);
  await page.getByRole('button', { name: 'Explore sample home' }).click();
  await page.getByLabel('Filter by room').selectOption('Kitchen');
  await expect(page.getByRole('article')).toHaveCount(1);
  const counter = page.getByRole('article', { name: 'Counter lighting' });
  await counter.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(counter.getByTestId('reported-state')).toHaveText('Reported: 0% brightness');
  await page.getByLabel('Filter by room').selectOption({ label: 'All rooms' });
  await page.getByLabel('Search loads').fill('Pendant');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByLabel('Search loads').fill('');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('home-desktop.png'), fullPage: true });
  expect(gateway.control.calls).toEqual([]);
});
