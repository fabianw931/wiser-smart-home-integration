import { test, expect } from './gateway-fixture.js';

const writes = gateway => gateway.control.calls.filter(call => call.method !== 'GET');
const puts = gateway => gateway.control.calls.filter(call => call.method === 'PUT');
const countCalls = (gateway, path) => gateway.control.calls.filter(call => call.path === path && call.method === 'GET').length;
const refresh = page => page.getByRole('button', { name: 'Refresh', exact: true });
const power = (device, name) => device.getByRole('checkbox', { name: `${name} power`, exact: true });
const state = device => device.getByTestId('reported-state');
const home = page => page.getByRole('button', { name: 'Home', exact: true });
const layoutSaved = page => page.waitForResponse(response => response.url().includes('/api/local/layout') && response.request().method() === 'PUT' && response.ok());

async function connect(page, gateway) {
  await page.goto(gateway.url);
  await page.getByLabel(/Gateway IP or hostname/).fill('127.0.0.1');
  await page.getByLabel('Gateway token').fill(gateway.token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(refresh(page)).toBeEnabled();
  // The route survives disconnect and reconnect, so always start from Home.
  await home(page).click();
  // Gateway rooms arrive with the background diagnostics; wait so rooms do not move under the test.
  if (!gateway.control.holdDiagnostics) await expect(page.getByRole('region', { name: 'Living room', exact: true })).toBeVisible();
}

async function openSettings(page, section) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: section, exact: true }).click();
}

async function disconnect(page) {
  await openSettings(page, 'Connection');
  await page.getByRole('button', { name: 'Disconnect & forget credentials' }).click();
}

// Controls under "More" are hidden until the row's details are opened.
async function openMore(device) {
  await device.locator('summary').click();
}

async function setExact(device, label, value) {
  await openMore(device);
  await device.getByLabel(label).fill(String(value));
  await device.getByRole('button', { name: 'Set', exact: true }).click();
}

test.describe('live gateway updates', () => {
  test.use({ liveUpdates: true });
  test('wall-switch pushes update reported state and reconnect resynchronizes', async ({ page, gateway }) => {
    await connect(page, gateway);
    await expect(page.getByText(/^Live/)).toBeVisible();
    const hall = page.getByRole('article', { name: 'Hall light', exact: true });
    gateway.control.pushState(1, { bri: 10000 });
    await expect(state(hall)).toHaveText('On');
    await expect(page.getByTestId('overview')).toContainText('5 of 6 lights on');
    const color = page.getByRole('article', { name: 'DALI color', exact: true });
    await openMore(color);
    gateway.control.pushState(8, { red: 200 });
    await expect(color.getByLabel('DALI color red')).toHaveValue('200');
    await expect(state(color)).toHaveText('60%');
    gateway.control.dropLive();
    gateway.control.states.set(1, { bri: 0 });
    await expect(state(hall)).toHaveText('Off', { timeout: 15000 });
    expect(writes(gateway)).toEqual([]);
    await disconnect(page);
    gateway.control.pushState(1, { bri: 10000 });
    await expect(page.getByRole('article')).toHaveCount(0);
  });
});

test('remembered connection can disconnect temporarily, reconnect and be forgotten', async ({ page, gateway }) => {
  await page.goto(gateway.url);
  await page.getByLabel(/Gateway IP or hostname/).fill('127.0.0.1');
  await page.getByLabel('Gateway token').fill(gateway.token);
  await page.getByLabel('Remember this gateway on this computer').check();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(refresh(page)).toBeEnabled();
  await openSettings(page, 'Connection');
  await expect(page.getByText('Remembered securely on this computer')).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect for now', exact: true }).click();
  await page.getByRole('button', { name: 'Reconnect saved gateway' }).click();
  await home(page).click();
  await expect(page.getByRole('article', { name: 'Hall light', exact: true })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.content()).not.toContain(gateway.token);
  await disconnect(page);
  await expect(page.getByRole('button', { name: 'Reconnect saved gateway' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  expect(writes(gateway)).toEqual([]);
});

test('dashboard groups devices by room and edits personal details without gateway changes', async ({ page, gateway }) => {
  await connect(page, gateway);
  await expect(home(page)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Hall', exact: true }).getByRole('article', { name: 'Hall light', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Living room', exact: true }).getByRole('article', { name: 'Desk light', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Unassigned', exact: true }).getByRole('article', { name: 'DALI color', exact: true })).toBeVisible();
  const hall = page.getByRole('article', { name: 'Hall light', exact: true });
  await openMore(hall);
  const config = hall.getByRole('form', { name: 'Name and room for Hall light' });
  await config.getByLabel('Name', { exact: true }).fill('Entry pendant');
  await config.getByLabel('Room', { exact: true }).fill('Entrance');
  await config.getByLabel('Notes').fill('Check with installer');
  await config.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Entrance', exact: true }).getByRole('article', { name: 'Entry pendant' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Hall', exact: true })).toHaveCount(0);
  expect(writes(gateway)).toEqual([]);
  // Every gateway load stays listed, including unused and unsupported ones.
  await expect(page.getByRole('article')).toHaveCount(10);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Entrance', exact: true }).getByRole('article', { name: 'Entry pendant' })).toBeVisible();
});

test('inline editing keeps unsaved input when the save fails and leaves labels unchanged', async ({ page, gateway }) => {
  await connect(page, gateway);
  await page.route('**/api/local/mappings/1?*', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Unavailable' }) }));
  const hall = page.getByRole('article', { name: 'Hall light', exact: true });
  await openMore(hall);
  const config = hall.getByRole('form', { name: 'Name and room for Hall light' });
  await config.getByLabel('Name', { exact: true }).fill('Keep my input');
  await config.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(config.getByRole('alert')).toContainText('Could not save');
  await expect(config.getByLabel('Name', { exact: true })).toHaveValue('Keep my input');
  await expect(page.getByRole('article', { name: 'Hall light', exact: true })).toBeVisible();
  expect(writes(gateway)).toEqual([]);
});

test('appearance follows the system and remembers an explicit override', async ({ page, gateway }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await connect(page, gateway);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openSettings(page, 'Appearance');
  const appearance = page.getByRole('combobox', { name: 'Appearance' });
  await expect(appearance).toHaveValue('system');
  await appearance.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(appearance).toHaveValue('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await appearance.selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(writes(gateway)).toEqual([]);
});

test('dark workspace supports controls, configuration, dialogs and mobile layouts', async ({ page, gateway }, testInfo) => {
  await savePersonalMapping(page, gateway);
  await page.getByText('Change gateway metadata…', { exact: true }).click();
  await page.getByLabel('Gateway display name').fill('Reviewed only');
  await page.getByRole('button', { name: 'Review gateway change' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('combobox', { name: 'Appearance' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('dark-appearance.png'), fullPage: true });
  await home(page).click();
  const lamp = page.getByRole('article', { name: 'Entrance pendant', exact: true });
  await power(lamp, 'Entrance pendant').click();
  await expect(lamp).toHaveClass(/lit/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('dark-home.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dark-mobile.png'), fullPage: true });
  await page.getByLabel('Search devices').fill('No matching device');
  await expect(page.getByText('No devices match “No matching device”.')).toBeVisible();
  await page.getByLabel('Search devices').fill('');
  await expect(lamp).toBeVisible();
  expect(gateway.control.calls.filter(call => call.method === 'PATCH')).toEqual([]);
});

test('appearance remains usable when browser storage is blocked', async ({ page, gateway }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Blocked'); };
    Storage.prototype.setItem = () => { throw new Error('Blocked'); };
  });
  await connect(page, gateway);
  await openSettings(page, 'Appearance');
  await page.getByRole('combobox', { name: 'Appearance' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByText(/Theme changed for this visit/)).toBeVisible();
});

test('token connection discovers and controls lights and blinds, then forgets credentials', async ({ page, gateway }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await connect(page, gateway);
  await expect(page.getByLabel('Gateway token')).toHaveCount(0);
  const hall = page.getByRole('article', { name: 'Hall light', exact: true });
  const desk = page.getByRole('article', { name: 'Desk light', exact: true });
  const blind = page.getByRole('article', { name: 'Office blind', exact: true });
  await expect(state(hall)).toHaveText('Off');
  await expect(page.getByTestId('overview')).toHaveText('4 of 6 lights on · 0 of 1 blinds closed');
  await power(hall, 'Hall light').click();
  await expect(state(hall)).toHaveText('On');
  await setExact(desk, /Exact brightness/, '37.5');
  await expect(state(desk)).toHaveText('37.5%');
  await blind.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(state(blind)).toHaveText('Open');
  expect(puts(gateway).map(call => call.payload)).toEqual([{ bri: 10000 }, { bri: 3750 }, { level: 0 }]);
  await expect(page.getByRole('article', { name: 'Unknown device', exact: true })).toContainText('Read-only');
  await expect(page.getByRole('article', { name: 'Unused channel', exact: true })).toContainText('unused channel');
  await openSettings(page, 'Diagnostics');
  await expect(page.locator('summary').filter({ hasText: 'sensors' })).toContainText('Unsupported');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
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
  await page.getByText('Pair new client', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Pair new client' })).toBeChecked();
  await expect(page.getByText(/Stand next to the gateway/)).toBeVisible();
  const response = page.waitForResponse(`${gateway.url}/api/connect`);
  await page.getByRole('button', { name: 'Start pairing' }).click();
  expect(await (await response).text()).not.toContain(gateway.token);
  await expect(refresh(page)).toBeEnabled();
  const claim = gateway.control.calls.find(call => call.path === '/api/account/claim');
  expect(claim.payload.user).toMatch(/^local-poc-[0-9a-f-]+$/);
  expect(await page.content()).not.toContain(gateway.token);
});

test('DALI controls send subtype-specific partial targets and preserve other channels', async ({ page, gateway }) => {
  await connect(page, gateway);
  const spots = page.getByRole('article', { name: 'DALI spots', exact: true });
  const white = page.getByRole('article', { name: 'DALI white', exact: true });
  const color = page.getByRole('article', { name: 'DALI color', exact: true });
  // Sliders commit after a short debounce; wait for each request so the order is deterministic.
  let sent = 0;
  const slide = async (device, label, value) => {
    await device.getByLabel(label, { exact: true }).fill(String(value));
    await expect.poll(() => puts(gateway).length).toBe(++sent);
  };
  await setExact(spots, /Exact brightness/, '27.5');
  sent++;
  await expect(state(spots)).toHaveText('27.5%');
  await openMore(white);
  await slide(white, 'DALI white color temperature', 4200);
  await expect(white.getByText('Color temperature: 4200 K')).toBeVisible();
  await expect(state(white)).toHaveText('40%');
  await openMore(color);
  for (const [channel, value] of [['red', 255], ['green', 0], ['blue', 128], ['white', 64]]) {
    await slide(color, `DALI color ${channel}`, value);
    await expect(color.getByText(`${channel[0].toUpperCase()}${channel.slice(1)}: ${value}`, { exact: true })).toBeVisible();
  }
  await expect(state(color)).toHaveText('60%');
  await power(color, 'DALI color').click();
  await expect(state(color)).toHaveText('Off');
  await expect(color.getByText('Red: 255', { exact: true })).toBeVisible();
  expect(puts(gateway).map(call => call.payload)).toEqual([
    { bri: 2750 }, { ct: 4200 }, { red: 255 }, { green: 0 }, { blue: 128 }, { white: 64 }, { bri: 0 },
  ]);
});

test('missing or invalid load readings disable only that load and recover on refresh', async ({ page, gateway }) => {
  gateway.control.states.set(7, { bri: 4000 });
  gateway.control.states.set(6, { bri: -1 });
  await connect(page, gateway);
  const missing = page.getByRole('article', { name: 'Missing DALI state', exact: true });
  const spots = page.getByRole('article', { name: 'DALI spots', exact: true });
  const white = page.getByRole('article', { name: 'DALI white', exact: true });
  await expect(power(missing, 'Missing DALI state')).toBeDisabled();
  await expect(state(missing)).toHaveText('No reading');
  await expect(power(spots, 'DALI spots')).toBeDisabled();
  await expect(power(white, 'DALI white')).toBeEnabled();
  await openMore(white);
  await expect(white.getByText('Color temperature: unavailable')).toBeVisible();
  gateway.control.states.set(10, { bri: 2000 });
  await refresh(page).click();
  await expect(power(missing, 'Missing DALI state')).toBeEnabled();
});

test('pending diagnostics do not block commands and disconnect rejects their late result', async ({ page, gateway }) => {
  gateway.control.holdDiagnostics = true;
  await connect(page, gateway);
  await expect.poll(() => gateway.control.calls.some(call => call.path === '/api/rooms')).toBe(true);
  const hall = page.getByRole('article', { name: 'Hall light', exact: true });
  await power(hall, 'Hall light').click();
  await expect(state(hall)).toHaveText('On');
  expect(gateway.control.calls.filter(call => call.path === '/api/rooms')).toHaveLength(1);
  await disconnect(page);
  gateway.control.releaseDiagnostics();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByText('Updating diagnostics in the background…')).toHaveCount(0);
  expect(gateway.control.calls.some(call => call.path === '/api/devices')).toBe(false);
});

test('accepted commands do not become reported state and refresh failure is visibly stale', async ({ page, gateway }) => {
  await connect(page, gateway);
  const hall = page.getByRole('article', { name: 'Hall light', exact: true });
  gateway.control.applyTargets = false;
  await power(hall, 'Hall light').click();
  await expect(page.getByText(/Target accepted for Hall light/)).toBeVisible();
  await expect(refresh(page)).toBeEnabled();
  await expect(state(hall)).toHaveText('Off');
  gateway.control.failAfterTarget = true;
  await power(hall, 'Hall light').click();
  await expect(page.getByRole('alert')).toContainText('Gateway request failed');
  await expect(page.getByText(/Target accepted for Hall light/)).toBeVisible();
  await expect(page.getByText('Readings are stale or unavailable.')).toBeVisible();
  await expect(page.getByText(/^Stale/)).toBeVisible();
  await expect(power(hall, 'Hall light')).toBeDisabled();
  gateway.control.failStates = false;
  await refresh(page).click();
  await expect(power(hall, 'Hall light')).toBeEnabled();
  await expect(page.getByText('Readings are stale or unavailable.')).toHaveCount(0);
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
  await expect(refresh(page)).toBeEnabled();
});

test('narrow-screen form supports keyboard submission without horizontal overflow', async ({ page, gateway }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(gateway.url);
  await page.getByLabel(/Gateway IP or hostname/).fill('127.0.0.1');
  await page.getByLabel('Gateway token').fill(gateway.token);
  await page.getByLabel('Gateway token').press('Enter');
  await expect(refresh(page)).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-mobile.png'), fullPage: true });
});

async function savePersonalMapping(page, gateway) {
  await connect(page, gateway);
  await openSettings(page, 'Names & notes');
  await page.getByLabel('Choose a load to configure').selectOption('1');
  await page.getByLabel('Personal display name').fill('Entrance pendant');
  await page.getByLabel('Personal room', { exact: true }).fill('My studio');
  await page.getByLabel('Personal notes').fill('Left of the door');
  await page.getByRole('button', { name: 'Save local mapping' }).click();
  await expect(page.getByRole('article', { name: 'Mapping for Entrance pendant' })).toContainText('My studio');
}

test('personal mappings persist across reload and reconnect while controls remain real', async ({ page, gateway }, testInfo) => {
  await savePersonalMapping(page, gateway);
  expect(writes(gateway)).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('configuration-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('configuration-mobile.png'), fullPage: true });
  await page.reload();
  await expect(refresh(page)).toBeEnabled();
  await home(page).click();
  const studio = page.getByRole('region', { name: 'My studio', exact: true });
  const mapped = studio.getByRole('article', { name: 'Entrance pendant', exact: true });
  await expect(mapped).toBeVisible();
  await expect(studio.getByRole('article')).toHaveCount(1);
  await power(mapped, 'Entrance pendant').click();
  await expect(state(mapped)).toHaveText('On');
  expect(writes(gateway).map(call => [call.path, call.payload])).toEqual([
    ['/api/loads/1/target_state', { bri: 10000 }],
  ]);
  await disconnect(page);
  await connect(page, gateway);
  await expect(mapped).toBeVisible();
  expect(gateway.control.loads[0].name).toBe('Hall light');
  expect(gateway.control.loads[0].room).toBe(1);
  await openSettings(page, 'Names & notes');
  await page.getByRole('button', { name: 'Remove local mapping' }).click();
  await home(page).click();
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
    expect(writes(gateway)).toEqual([]);
  } finally { await context.close(); }
});

test('legacy browser mappings migrate without replacing existing database entries', async ({ page, gateway }) => {
  await savePersonalMapping(page, gateway);
  await home(page).click();
  await page.evaluate(() => localStorage.setItem('wiser-personal-mappings-v1', JSON.stringify({
    '127.0.0.1': {
      '1': { identity: '[1,"fake-1",0,"onoff"]', name: 'Old name', room: '', notes: '' },
      '2': { identity: '[2,"fake-2",0,"dim"]', name: 'Migrated lamp', room: 'Office', notes: 'Legacy note' },
    },
  })));
  await page.reload();
  await expect(page.getByRole('article', { name: 'Entrance pendant', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Office', exact: true }).getByRole('article', { name: 'Migrated lamp' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('wiser-personal-mappings-v1'))).toBeNull();
  const response = await page.request.get(`${gateway.url}/api/local/mappings?gateway=127.0.0.1`, { headers: { 'X-Wiser-Client': 'local-poc' } });
  const { data } = await response.json();
  expect(data['1'].name).toBe('Entrance pendant');
  expect(data['2'].name).toBe('Migrated lamp');
  expect(writes(gateway)).toEqual([]);
});

test('failed database saves show an error without blocking device controls', async ({ page, gateway }) => {
  await connect(page, gateway);
  await page.route('**/api/local/mappings/1?*', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Database unavailable' }) }));
  await openSettings(page, 'Names & notes');
  await page.getByLabel('Choose a load to configure').selectOption('1');
  await page.getByLabel('Personal display name').fill('Not saved');
  await page.getByRole('button', { name: 'Save local mapping' }).click();
  await expect(page.getByRole('alert')).toContainText('Details were not saved');
  await expect(page.getByRole('article', { name: 'Mapping for Not saved' })).toHaveCount(0);
  await home(page).click();
  const hall = page.getByRole('article', { name: 'Hall light', exact: true });
  await power(hall, 'Hall light').click();
  await expect(state(hall)).toHaveText('On');
});

test('gateway metadata is a separate reviewed action and keeps personal mapping', async ({ page, gateway }) => {
  await savePersonalMapping(page, gateway);
  await page.getByText('Change gateway metadata…', { exact: true }).click();
  await page.getByLabel('Gateway display name').fill('Gateway entrance');
  await page.getByRole('combobox', { name: 'Gateway room', exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Review gateway change' }).click();
  await expect(page.getByRole('dialog')).toContainText('Gateway entrance');
  expect(writes(gateway)).toEqual([]);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes(gateway)).toEqual([]);
  await page.getByRole('button', { name: 'Review gateway change' }).click();
  await page.getByRole('button', { name: 'Apply this change to gateway' }).click();
  await expect(refresh(page)).toBeEnabled();
  await expect.poll(() => gateway.control.calls.filter(call => call.method === 'PATCH').map(call => call.payload)).toEqual([{ name: 'Gateway entrance', room: 2 }]);
  await expect(page.getByRole('article', { name: 'Mapping for Entrance pendant' })).toBeVisible();
  await home(page).click();
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
  await refresh(page).click();
  await home(page).click();
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
  expect(writes(gateway)).toEqual([]);
});

test('sample home is offline and supports floors, search and simulated controls', async ({ page, gateway }, testInfo) => {
  await page.goto(gateway.url);
  await page.getByRole('button', { name: 'Explore sample home' }).click();
  await expect(page.getByText('Simulated', { exact: true })).toBeVisible();
  await expect(refresh(page)).toHaveCount(0);
  const floors = page.getByRole('group', { name: 'Floor', exact: true });
  await floors.getByRole('button', { name: 'Ground floor', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Kitchen', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Bedroom', exact: true })).toHaveCount(0);
  const counter = page.getByRole('article', { name: 'Counter lighting', exact: true });
  await power(counter, 'Counter lighting').click();
  await expect(state(counter)).toHaveText('Off');
  await expect(page.getByRole('status')).toContainText('Sample control updated');
  await floors.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByLabel('Search devices').fill('Pendant');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByLabel('Search devices').fill('');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('home-desktop.png'), fullPage: true });
  expect(gateway.control.calls).toEqual([]);
});

test('room quick actions touch only lit lights, refresh once and report accepted of total', async ({ page, gateway }) => {
  await connect(page, gateway);
  const living = page.getByRole('region', { name: 'Living room', exact: true });
  const actions = living.getByRole('group', { name: 'Living room actions' });
  const statesBefore = countCalls(gateway, '/api/loads/state');
  const loadsBefore = countCalls(gateway, '/api/loads');
  await actions.getByRole('button', { name: 'Lights off', exact: true }).click();
  await expect(page.getByText('Lights off: targets accepted for 3 of 3.')).toBeVisible();
  // Desk light, DALI spots and DALI white were lit; nothing else is touched.
  expect(puts(gateway).map(call => [call.path, call.payload])).toEqual([
    ['/api/loads/2/target_state', { bri: 0 }],
    ['/api/loads/6/target_state', { bri: 0 }],
    ['/api/loads/7/target_state', { bri: 0 }],
  ]);
  expect(countCalls(gateway, '/api/loads/state')).toBe(statesBefore + 1);
  expect(countCalls(gateway, '/api/loads')).toBe(loadsBefore + 1);
  await expect(state(living.getByRole('article', { name: 'Desk light', exact: true }))).toHaveText('Off');
  // With every light off the same button offers to switch them on; one failure is reported honestly.
  gateway.control.failTargets.add(7);
  await actions.getByRole('button', { name: 'Lights on', exact: true }).click();
  await expect(page.getByText('Lights on: targets accepted for 2 of 3.')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Not sent to: DALI white.');
  gateway.control.failTargets.clear();
});

test('blind quick actions ask for inline confirmation before moving anything', async ({ page, gateway }) => {
  await connect(page, gateway);
  const living = page.getByRole('region', { name: 'Living room', exact: true });
  const actions = living.getByRole('group', { name: 'Living room actions' });
  const blind = living.getByRole('article', { name: 'Office blind', exact: true });
  await actions.getByRole('button', { name: 'Close blinds', exact: true }).click();
  const confirm = living.getByRole('group', { name: 'Confirm close blinds' });
  await expect(confirm.getByRole('button', { name: 'Confirm: close blinds (1)' })).toBeVisible();
  expect(puts(gateway)).toEqual([]);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(actions.getByRole('button', { name: 'Close blinds', exact: true })).toBeVisible();
  expect(puts(gateway)).toEqual([]);
  await actions.getByRole('button', { name: 'Close blinds', exact: true }).click();
  await living.getByRole('button', { name: 'Confirm: close blinds (1)' }).click();
  await expect(state(blind)).toHaveText('Closed');
  expect(puts(gateway).map(call => [call.path, call.payload])).toEqual([['/api/loads/3/target_state', { level: 10000 }]]);
  await expect(page.getByTestId('overview')).toContainText('1 of 1 blinds closed');
});

test('whole-home lights action switches lit lights only after an explicit click', async ({ page, gateway }) => {
  await connect(page, gateway);
  expect(puts(gateway)).toEqual([]);
  await page.getByRole('group', { name: 'Whole-home actions' }).getByRole('button', { name: 'Lights off (all)' }).click();
  await expect(page.getByTestId('overview')).toContainText('0 of 6 lights on');
  expect(puts(gateway).map(call => call.path)).toEqual([2, 6, 7, 8].map(id => `/api/loads/${id}/target_state`));
});

test('floors are created in settings, filter Home and persist in the database', async ({ page, browser, gateway }) => {
  await connect(page, gateway);
  await openSettings(page, 'Rooms & floors');
  for (const name of ['Ground floor', 'Upstairs']) {
    const saved = layoutSaved(page);
    await page.getByLabel('New floor').fill(name);
    await page.getByRole('button', { name: 'Add floor' }).click();
    await saved;
    await expect(page.getByRole('region', { name: `Floor ${name}` })).toBeVisible();
  }
  for (const [room, floor] of [['Hall', 'Ground floor'], ['Living room', 'Upstairs']]) {
    const saved = layoutSaved(page);
    await page.getByLabel(`Assign ${room} to a floor`).selectOption({ label: floor });
    await saved;
    await expect(page.getByRole('region', { name: `Floor ${floor}` })).toContainText(room);
  }
  await home(page).click();
  const segments = page.getByRole('group', { name: 'Floor', exact: true });
  await expect(page.getByRole('heading', { name: 'Ground floor', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Upstairs', level: 2 })).toBeVisible();
  await segments.getByRole('button', { name: 'Upstairs', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Living room', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Hall', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Ground floor', level: 2 })).toHaveCount(0);
  await page.reload();
  await expect(segments.getByRole('button', { name: 'Ground floor', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Upstairs', level: 2 })).toBeVisible();
  const context = await browser.newContext();
  try {
    const fresh = await context.newPage();
    await fresh.goto(gateway.url);
    await expect(fresh.getByRole('heading', { name: 'Ground floor', level: 2 })).toBeVisible();
    await expect(fresh.getByRole('group', { name: 'Floor', exact: true }).getByRole('button', { name: 'Upstairs', exact: true })).toBeVisible();
    expect(await fresh.evaluate(() => localStorage.length)).toBe(0);
  } finally { await context.close(); }
  expect(writes(gateway)).toEqual([]);
});

test('pinned devices and rooms appear under Pinned and persist until unpinned', async ({ page, gateway }) => {
  await connect(page, gateway);
  const living = page.getByRole('region', { name: 'Living room', exact: true });
  const pinned = page.getByRole('region', { name: 'Pinned', exact: true });
  await expect(pinned).toHaveCount(0);
  let saved = layoutSaved(page);
  await living.getByRole('button', { name: 'Pin Desk light', exact: true }).click();
  await saved;
  saved = layoutSaved(page);
  await page.getByRole('button', { name: 'Pin room Hall', exact: true }).click();
  await saved;
  await expect(pinned.getByRole('article', { name: 'Desk light', exact: true })).toBeVisible();
  await expect(pinned.getByRole('region', { name: 'Hall', exact: true }).getByRole('article', { name: 'Hall light', exact: true })).toBeVisible();
  await expect(living.getByRole('button', { name: 'Unpin Desk light', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(pinned.getByRole('article', { name: 'Desk light', exact: true })).toBeVisible();
  await expect(pinned.getByRole('region', { name: 'Hall', exact: true })).toBeVisible();
  saved = layoutSaved(page);
  await pinned.getByRole('button', { name: 'Unpin Desk light', exact: true }).click();
  await saved;
  await expect(pinned.getByRole('article', { name: 'Desk light', exact: true })).toHaveCount(0);
  saved = layoutSaved(page);
  await pinned.getByRole('button', { name: 'Unpin room Hall', exact: true }).click();
  await saved;
  await expect(pinned).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Hall', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Living room', exact: true })).toBeVisible();
  await expect(pinned).toHaveCount(0);
  expect(writes(gateway)).toEqual([]);
});

test('search filters devices and expands the rooms that match', async ({ page, gateway }) => {
  // Nine controllable devices: Home starts with every room collapsed.
  gateway.control.loads.push(
    { id: 11, type: 'dim', name: 'Hall lamp', room: 1, device: 'fake-11', channel: 0 },
    { id: 12, type: 'dim', name: 'Hall spot', room: 1, device: 'fake-12', channel: 0 },
  );
  gateway.control.states.set(11, { bri: 0 });
  gateway.control.states.set(12, { bri: 0 });
  await connect(page, gateway);
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Living room/, expanded: false })).toBeVisible();
  await page.getByLabel('Search devices').fill('desk');
  await expect(page.getByRole('region', { name: 'Living room', exact: true }).getByRole('article', { name: 'Desk light', exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Hall', exact: true })).toHaveCount(0);
  await page.getByLabel('Search devices').fill('nothing like this');
  await expect(page.getByText('No devices match “nothing like this”.')).toBeVisible();
  await page.getByLabel('Search devices').fill('');
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.getByRole('article', { name: 'Hall lamp', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expect(page.getByRole('article')).toHaveCount(0);
  expect(puts(gateway)).toEqual([]);
});

test('slider commits are debounced into a single request', async ({ page, gateway }) => {
  await connect(page, gateway);
  const desk = page.getByRole('article', { name: 'Desk light', exact: true });
  const slider = desk.getByLabel('Desk light brightness');
  await slider.fill('30');
  await slider.fill('40');
  await expect.poll(() => puts(gateway).length).toBe(1);
  await expect(state(desk)).toHaveText('40%');
  await page.waitForTimeout(600);
  expect(puts(gateway).map(call => [call.path, call.payload])).toEqual([['/api/loads/2/target_state', { bri: 4000 }]]);
  const blind = page.getByRole('article', { name: 'Office blind', exact: true });
  await blind.getByLabel('Office blind closed position').fill('75');
  await expect.poll(() => puts(gateway).length).toBe(2);
  expect(puts(gateway)[1].payload).toEqual({ level: 7500 });
  await expect(state(blind)).toHaveText('75% closed');
});

test('a command issued during a refresh is queued, not dropped', async ({ page, gateway }) => {
  await connect(page, gateway);
  gateway.control.holdStates = true;
  await refresh(page).click();
  await expect.poll(() => countCalls(gateway, '/api/loads/state')).toBe(2);
  const hall = page.getByRole('article', { name: 'Hall light', exact: true });
  await power(hall, 'Hall light').click();
  await page.waitForTimeout(400);
  expect(puts(gateway)).toEqual([]);
  gateway.control.holdStates = false;
  gateway.control.releaseStates();
  await expect.poll(() => puts(gateway).map(call => [call.path, call.payload])).toEqual([['/api/loads/1/target_state', { bri: 10000 }]]);
  await expect(page.getByText(/Target accepted for Hall light/)).toBeVisible();
  await expect(state(hall)).toHaveText('On');
});

test('weather chips show reported sensors and highlight detected rain', async ({ page, gateway }) => {
  gateway.control.installationResources = {
    sensors: [
      { id: 1, name: 'Wind speed', type: 'wind', device: '00000124', value: 0, unit: 'm/s' },
      { id: 2, name: 'Rain sensor', type: 'rain', device: '00000124', value: true, unit: 'bool' },
      { id: 3, name: 'Hail sensor', type: 'hail', device: '00000124', value: false, unit: 'bool' },
      { id: 4, name: 'Missing temperature', type: 'temperature', device: '00000124', value: null, unit: '°C' },
    ],
  };
  await connect(page, gateway);
  const weather = page.getByRole('region', { name: 'Weather and sensors', exact: true });
  const rain = weather.getByRole('listitem').filter({ hasText: 'Rain' });
  await expect(rain).toContainText('Detected');
  await expect(rain).toHaveClass(/alert/);
  const hail = weather.getByRole('listitem').filter({ hasText: 'Hail' });
  await expect(hail).toContainText('Not detected');
  await expect(hail).not.toHaveClass(/alert/);
  // Zero is a reading; a missing value is not shown as a chip.
  await expect(weather.getByRole('listitem').filter({ hasText: 'Wind speed' })).toContainText('0 m/s');
  await expect(weather.getByRole('listitem').filter({ hasText: 'Missing temperature' })).toHaveCount(0);
  await weather.getByRole('button', { name: 'All sensors' }).click();
  await expect(page.getByRole('heading', { name: 'Sensors & buttons', level: 1 })).toBeVisible();
  expect(writes(gateway)).toEqual([]);
});
