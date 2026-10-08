import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMapping, mappingMatches, readMappings, saveMappings, exportMappings, importMappings, MAPPING_KEY } from '../src/mappings.js';

const load = { id: 1, device: 'fixture-device', channel: 0, type: 'dali', name: 'Original', room: 1 };
const fields = { name: 'My pendant', room: 'My custom room', notes: 'By the window' };
function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
test('personal mappings match hardware identity regardless of installer labels', () => {
  const mapping = makeMapping(load, fields);
  assert.equal(mappingMatches({ ...load, name: 'Installer rename', room: 5 }, mapping), true);
  assert.equal(mappingMatches({ ...load, device: 'replacement-device' }, mapping), false);
  assert.equal(mappingMatches(undefined, mapping), false);
});
test('local mappings are isolated by gateway and survive independent reads', () => {
  const store = storage(), mapping = makeMapping(load, fields);
  saveMappings(store, 'gateway-a', { 1: mapping });
  assert.deepEqual(readMappings(store, 'gateway-a'), { 1: mapping });
  assert.deepEqual(readMappings(store, 'gateway-b'), {});
  saveMappings(store, 'gateway-a', {});
  assert.equal(store.getItem(MAPPING_KEY), null);
});
test('portable mapping files validate gateway, fields and size', () => {
  const mappings = { 1: makeMapping(load, fields) };
  assert.deepEqual(importMappings(exportMappings('gateway-a', mappings), 'gateway-a'), mappings);
  assert.throws(() => importMappings(exportMappings('gateway-a', mappings), 'gateway-b'));
  assert.throws(() => importMappings(JSON.stringify({ version: 1, gateway: 'gateway-a', mappings: { 1: { ...mappings[1], token: 'unwanted-field' } } }), 'gateway-a'));
  assert.throws(() => importMappings('x'.repeat(1024 * 1024 + 1), 'gateway-a'));
});
test('invalid storage is reported rather than silently overwritten', () => {
  const store = storage();
  store.setItem(MAPPING_KEY, 'broken');
  assert.throws(() => readMappings(store, 'gateway'));
  assert.throws(() => saveMappings(store, 'gateway', {}));
  assert.equal(store.getItem(MAPPING_KEY), 'broken');
  assert.throws(() => makeMapping(load, { ...fields, name: ' ' }));
});
