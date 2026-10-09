import test from 'node:test';
import assert from 'node:assert/strict';
import { sensorReading, registeredButton, identifiableButton, resourceStatus, resourceItems } from '../src/installation.js';

test('weather readings preserve zero and false without guessing missing values', () => {
  assert.equal(sensorReading({ type: 'wind', value: 0, unit: 'm/s' }), '0 m/s');
  for (const value of [false, 0]) assert.equal(sensorReading({ type: 'rain', value }), 'Not detected');
  for (const value of [true, 1]) assert.equal(sensorReading({ type: 'hail', value }), 'Detected');
  for (const value of [null, undefined, '0', {}, 2]) assert.equal(sensorReading({ type: 'rain', value }), 'Unavailable');
  for (const value of [null, undefined, 'warm', {}, NaN, Infinity]) assert.equal(sensorReading({ type: 'temperature', value }), 'Unavailable');
  assert.equal(sensorReading({ value: -2.5, unit: '°C' }), '-2.5 °C');
});

test('resource status distinguishes unsupported, missing, malformed and stale data', () => {
  assert.equal(resourceStatus(undefined), 'Not loaded');
  assert.equal(resourceStatus({ error: 'no', unsupported: true }), 'Unsupported by gateway');
  assert.equal(resourceStatus({ error: 'no' }), 'Unavailable');
  assert.equal(resourceStatus({ data: {} }), 'Invalid response');
  assert.equal(resourceStatus({ data: [null] }), 'Invalid response');
  assert.equal(resourceStatus({ data: [] }), 'Stale');
  assert.equal(resourceStatus({ data: [], observedAt: 1 }, 90002), 'Stale');
  assert.equal(resourceStatus({ data: [], observedAt: 1 }, 90001), 'Reported');
  assert.equal(resourceStatus(undefined, 0, true), 'Sample data');
  assert.deepEqual(resourceItems({ data: [null, {}, 1] }), [{}]);
});

test('button registration is distinct from physical identification', () => {
  const button = { id: null, device: '0000a98f', channel: 0 };
  assert.equal(registeredButton(button), false);
  assert.equal(identifiableButton(button), true);
  assert.equal(registeredButton({ id: 0 }), true);
  assert.equal(registeredButton({ id: '1' }), false);
  assert.equal(identifiableButton({ ...button, device: '../x' }), false);
  assert.equal(identifiableButton({ ...button, channel: -1 }), false);
});
