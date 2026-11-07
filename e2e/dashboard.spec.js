import { test, expect } from './gateway-fixture.js';

async function connect(page, gateway) {
  await page.goto(gateway.url);
  await page.getByLabel(/Gateway IP or hostname/).fill('127.0.0.1');
  await page.getByLabel('Gateway token').fill(gateway.token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
}

test('token connection discovers and controls lights and blinds, then forgets credentials', async ({ page, gateway }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await connect(page, gateway);
  await expect(page.getByLabel('Gateway token')).toHaveCount(0);
  const hall = page.getByRole('article', { name: 'Hall light' });
  const desk = page.getByRole('article', { name: 'Desk light' });
  const blind = page.getByRole('article', { name: 'Office blind' });
  await expect(hall.getByTestId('reported-state')).toHaveText('Off');
  await hall.getByRole('checkbox', { name: 'Hall light power' }).click();
  await expect(hall.getByTestId('reported-state')).toHaveText('On');
  await desk.getByLabel('Desk light brightness').fill('40');
  await expect(desk.getByTestId('reported-state')).toHaveText('40%');
  await blind.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(blind.getByTestId('reported-state')).toHaveText('Open');
  expect(gateway.control.calls.filter(call => call.method === 'PUT').map(call => call.payload)).toEqual([
    { bri: 10000 }, { bri: 4000 }, { level: 0 },
  ]);
  await page.getByText('Unused & unsupported').click();
  await expect(page.getByRole('article', { name: 'Unknown device' })).toContainText('Read-only');
  await expect(page.getByRole('article', { name: 'Unused channel' })).toContainText('unused channel');
  await page.getByText('Gateway & diagnostics').click();
  await expect(page.locator('summary').filter({ hasText: 'sensors' })).toContainText('Unsupported');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.getByRole('button', { name: 'Disconnect' }).click();
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
  await expect(page.getByText(/Stand next to the gateway/)).toBeVisible();
  const response = page.waitForResponse(`${gateway.url}/api/connect`);
  await page.getByRole('button', { name: 'Start pairing' }).click();
  expect(await (await response).text()).not.toContain(gateway.token);
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  const claim = gateway.control.calls.find(call => call.path === '/api/account/claim');
  expect(claim.payload.user).toMatch(/^local-poc-[0-9a-f-]+$/);
  expect(await page.content()).not.toContain(gateway.token);
});

test('accepted commands do not become reported state and refresh failure is visibly stale', async ({ page, gateway }) => {
  await connect(page, gateway);
  const hall = page.getByRole('article', { name: 'Hall light' });
  gateway.control.applyTargets = false;
  await hall.getByRole('checkbox', { name: 'Hall light power' }).click();
  await expect(page.getByText(/Target accepted for Hall light/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await expect(hall.getByTestId('reported-state')).toHaveText('Off');
  gateway.control.failAfterTarget = true;
  await hall.getByRole('checkbox', { name: 'Hall light power' }).click();
  await expect(page.getByRole('alert')).toContainText('Gateway request failed');
  await expect(page.getByText(/Target accepted for Hall light/)).toBeVisible();
  await expect(hall).toContainText('Stale or unavailable');
  await expect(page.getByRole('alert')).toContainText('Gateway request failed');
  await expect(hall.getByRole('checkbox', { name: 'Hall light power' })).toBeDisabled();
  gateway.control.failStates = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(hall.getByRole('checkbox', { name: 'Hall light power' })).toBeEnabled();
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
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
});

test('narrow-screen form supports keyboard submission without horizontal overflow', async ({ page, gateway }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(gateway.url);
  await page.getByLabel(/Gateway IP or hostname/).fill('127.0.0.1');
  await page.getByLabel('Gateway token').fill(gateway.token);
  await page.getByLabel('Gateway token').press('Enter');
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-mobile.png'), fullPage: true });
});

test('loads are grouped by room and can be filtered and searched', async ({ page, gateway }) => {
  await connect(page, gateway);
  await expect(page.getByRole('heading', { level: 2, name: /^Hall/ })).toBeVisible();
  const office = page.getByRole('region', { name: /^Office/ });
  await expect(office.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Overview' })).toContainText('Lights on');
  await page.getByRole('button', { name: /^Blinds/ }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article', { name: 'Office blind' })).toBeVisible();
  await page.getByRole('button', { name: /^All/ }).click();
  await page.getByLabel('Search loads').fill('desk');
  await expect(page.getByRole('article', { name: 'Desk light' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Hall light' })).toHaveCount(0);
});
