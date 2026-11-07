import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, gatewayFromEnv } from '../env.js';

const dir = () => mkdtempSync(join(tmpdir(), 'wiser-env-'));

test('gatewayFromEnv needs host and token together, or neither', () => {
  assert.equal(gatewayFromEnv({}), null);
  assert.deepEqual(gatewayFromEnv({ WISER_GATEWAY_HOST: ' 192.168.1.5 ', WISER_GATEWAY_TOKEN: ' abc ' }), { host: '192.168.1.5', token: 'abc' });
  assert.throws(() => gatewayFromEnv({ WISER_GATEWAY_HOST: '192.168.1.5' }), /both/i);
  assert.throws(() => gatewayFromEnv({ WISER_GATEWAY_TOKEN: 'abc' }), /both/i);
  assert.equal(gatewayFromEnv({ WISER_GATEWAY_HOST: '  ', WISER_GATEWAY_TOKEN: '' }), null);
});

test('loadEnv reads a missing file as absent and never overrides variables already set', () => {
  assert.equal(loadEnv(join(dir(), 'none.env'), {}, () => {}), false);
  const path = join(dir(), '.env');
  writeFileSync(path, 'WISER_ENV_TEST_A=from-file\nWISER_ENV_TEST_B="quoted value"\n');
  chmodSync(path, 0o600);
  const env = { WISER_ENV_TEST_A: 'from-shell' };
  const warnings = [];
  assert.equal(loadEnv(path, env, message => warnings.push(message)), true);
  assert.equal(env.WISER_ENV_TEST_A, 'from-shell');
  assert.equal(env.WISER_ENV_TEST_B, 'quoted value');
  assert.deepEqual(warnings, []);
});

test('loadEnv warns when the file is readable by other users', { skip: process.platform === 'win32' }, () => {
  const path = join(dir(), '.env');
  writeFileSync(path, 'WISER_ENV_TEST_C=1\n');
  chmodSync(path, 0o644);
  const warnings = [];
  loadEnv(path, {}, message => warnings.push(message));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /chmod 600/);
  assert.ok(!warnings[0].includes('WISER_ENV_TEST_C'));
});
