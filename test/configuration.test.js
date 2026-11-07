import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMapping } from '../src/mappings.js';
import { exportConfiguration, configurationFilename, parseConfiguration, planImport, describePlan, describeDevices, CONFIGURATION_KIND } from '../src/configuration.js';

const load = (id, extra = {}) => ({ id, device: `dev-${id}`, channel: 0, type: 'dim', name: `Gateway ${id}`, room: 1, ...extra });
const mapping = (id, name = `Mine ${id}`) => makeMapping(load(id), { name, room: 'Studio', notes: '' });
const layout = (floors = [], loads = [], rooms = []) => ({ floors, favorites: { loads, rooms } });
const empty = { mappings: {}, layout: layout() };
const NOW = new Date('2026-03-04T10:20:30.000Z');
const GATEWAY = 'wiser.local';

const file = (overrides = {}) => JSON.stringify({ version: 2, kind: CONFIGURATION_KIND, gateway: GATEWAY, exported_at: NOW.toISOString(), mappings: {}, layout: layout(), ...overrides });

test('export is a versioned v2 file with mappings, layout and informational devices only', () => {
  const mappings = { 1: mapping(1) };
  const lay = layout([{ name: 'Ground', rooms: ['Kitchen'] }], [1], ['Kitchen']);
  const text = exportConfiguration(GATEWAY, { mappings, layout: lay, loads: [load(1)], rooms: [{ id: 1, name: 'Hall' }] }, NOW);
  const data = JSON.parse(text);
  assert.deepEqual(Object.keys(data), ['version', 'kind', 'gateway', 'exported_at', 'mappings', 'layout', 'devices']);
  assert.equal(data.version, 2);
  assert.equal(data.kind, 'wiser-workspace-configuration');
  assert.equal(data.gateway, GATEWAY);
  assert.equal(data.exported_at, NOW.toISOString());
  assert.deepEqual(data.mappings, mappings);
  assert.deepEqual(data.layout, lay);
  assert.deepEqual(parseConfiguration(text, GATEWAY), { version: 2, mappings, layout: lay });
  assert.equal(configurationFilename(GATEWAY, NOW), 'wiser-configuration-wiser.local-2026-03-04.json');
  assert.equal(configurationFilename('a/b:c', NOW), 'wiser-configuration-a_b_c-2026-03-04.json');
});

test('devices list shows the gateway name next to the personal name and copies no other raw data', () => {
  const loads = [load(2, { name: 'Original', room: 7, sub_type: 'tw', token: 'secret', extra: { deep: true } }), load(1, { unused: true, room: 99 })];
  const devices = describeDevices(loads, [{ id: 7, name: 'Gateway room', secret: 'x' }], { 2: mapping(2, 'Personal') });
  assert.deepEqual(devices, [
    { id: 1, type: 'dim', sub_type: null, device: 'dev-1', channel: 0, gateway_name: 'Gateway 1', gateway_room: null, personal_name: null, personal_room: null, unused: true },
    { id: 2, type: 'dim', sub_type: 'tw', device: 'dev-2', channel: 0, gateway_name: 'Original', gateway_room: 'Gateway room', personal_name: 'Personal', personal_room: 'Studio', unused: false },
  ]);
  assert.ok(!JSON.stringify(devices).includes('secret'));
  // A mapping whose physical identity changed is not shown as personal.
  assert.equal(describeDevices([load(2, { device: 'replacement' })], [], { 2: mapping(2) })[0].personal_name, null);
});

test('devices are informational: any content is tolerated and never imported', () => {
  const imported = parseConfiguration(file({ devices: [{ gateway_name: 'x', token: 'nope' }, 7, null] }), GATEWAY);
  assert.deepEqual(imported, { version: 2, mappings: {}, layout: layout() });
  assert.deepEqual(parseConfiguration(file({ devices: 'whatever' }), GATEWAY).mappings, {});
});

test('version 1 mapping files are still accepted and carry no layout', () => {
  const mappings = { 1: mapping(1) };
  const text = JSON.stringify({ version: 1, gateway: GATEWAY, mappings });
  assert.deepEqual(parseConfiguration(text, GATEWAY), { version: 1, mappings, layout: null });
  const plan = planImport(empty, parseConfiguration(text, GATEWAY));
  assert.deepEqual(plan.mappings, mappings);
  assert.equal(plan.layout, null);
});

test('invalid files are rejected with clear errors', () => {
  const mappings = { 1: mapping(1) };
  const v1 = JSON.stringify({ version: 1, gateway: GATEWAY, mappings });
  assert.throws(() => parseConfiguration(v1, 'other.local'), /for this gateway/);
  assert.throws(() => parseConfiguration(file(), 'other.local'), /for this gateway/);
  assert.throws(() => parseConfiguration('x'.repeat(1024 * 1024 + 1), GATEWAY), /too large/);
  assert.throws(() => parseConfiguration('{ nope', GATEWAY), /not valid JSON/);
  for (const bad of ['null', '[]', '"text"', '{"version":3}', file({ kind: 'other' }), file({ kind: undefined })]) assert.throws(() => parseConfiguration(bad, GATEWAY), /version 1 or 2/, bad);
  // Strict v2: no unknown top-level fields (for example a smuggled token).
  assert.throws(() => parseConfiguration(file({ token: 'abc' }), GATEWAY), /version 1 or 2/);
  assert.throws(() => parseConfiguration(file({ exported_at: 'yesterday' }), GATEWAY), /export time/);
  assert.throws(() => parseConfiguration(file({ layout: undefined }), GATEWAY), /layout/);
  assert.throws(() => parseConfiguration(file({ layout: [] }), GATEWAY), /layout/);
  assert.throws(() => parseConfiguration(file({ mappings: { 1: { ...mappings[1], token: 'x' } } }), GATEWAY));
  assert.throws(() => parseConfiguration(file({ mappings: undefined }), GATEWAY));
  // Layout rules are those of the server: unique floors, one floor per room, unique favorites.
  assert.throws(() => parseConfiguration(file({ layout: layout([{ name: 'A', rooms: [] }, { name: 'a', rooms: [] }]) }), GATEWAY), /unique/);
  assert.throws(() => parseConfiguration(file({ layout: layout([{ name: 'A', rooms: ['R'] }, { name: 'B', rooms: ['R'] }]) }), GATEWAY), /only one floor/);
  assert.throws(() => parseConfiguration(file({ layout: layout([], [1, 1]) }), GATEWAY), /unique/);
  assert.throws(() => parseConfiguration(file({ layout: { floors: [], favorites: { loads: [], rooms: [], extra: 1 } } }), GATEWAY));
});

test('merge adds only missing mappings and keeps existing entries', () => {
  const plan = planImport({ mappings: { 1: mapping(1, 'Keep me') }, layout: layout() }, { mappings: { 1: mapping(1, 'Imported'), 2: mapping(2) }, layout: null });
  assert.deepEqual(Object.keys(plan.mappings), ['2']);
  assert.equal(plan.counts.names, 1);
  assert.equal(plan.counts.kept, 1);
  assert.equal(plan.empty, false);
});

test('merge adds missing floors, appends only unplaced rooms and unions pins', () => {
  const current = { mappings: {}, layout: layout([{ name: 'Ground', rooms: ['Kitchen'] }, { name: 'Upstairs', rooms: [] }], [1, 2], ['Kitchen']) };
  const imported = { mappings: {}, layout: layout([
    { name: 'ground', rooms: ['Kitchen', 'Hall'] }, // same floor (case-insensitive); Kitchen already placed
    { name: 'Upstairs', rooms: ['Hall', 'Bedroom'] }, // Hall was just placed on Ground
    { name: 'Cellar', rooms: ['Kitchen', 'Store'] }, // new floor; Kitchen placed elsewhere
  ], [2, 3], ['Kitchen', 'Hall']) };
  const plan = planImport(current, imported);
  assert.deepEqual(plan.layout, layout([
    { name: 'Ground', rooms: ['Kitchen', 'Hall'] },
    { name: 'Upstairs', rooms: ['Bedroom'] },
    { name: 'Cellar', rooms: ['Store'] },
  ], [1, 2, 3], ['Kitchen', 'Hall']));
  assert.deepEqual(plan.counts, { names: 0, floors: 1, rooms: 3, pins: 2, kept: 7 });
  assert.equal(describePlan(plan), 'Will add 1 floor, 3 rooms placed on floors, 2 pinned items; 7 entries already exist and are kept.');
});

test('a new floor may be added empty when all of its rooms are already placed', () => {
  const plan = planImport({ mappings: {}, layout: layout([{ name: 'Ground', rooms: ['Hall'] }]) }, { mappings: {}, layout: layout([{ name: 'Extra', rooms: ['Hall'] }]) });
  assert.deepEqual(plan.layout.floors, [{ name: 'Ground', rooms: ['Hall'] }, { name: 'Extra', rooms: [] }]);
  assert.equal(plan.counts.floors, 1);
});

test('importing the same file again changes nothing', () => {
  const imported = { mappings: { 1: mapping(1) }, layout: layout([{ name: 'Ground', rooms: ['Hall'] }], [3], ['Hall']) };
  const first = planImport(empty, imported);
  assert.equal(first.empty, false);
  const stored = { mappings: first.mappings, layout: first.layout };
  const again = planImport(stored, imported);
  assert.deepEqual(again.mappings, {});
  assert.equal(again.layout, null);
  assert.equal(again.empty, true);
  assert.deepEqual(again.counts, { names: 0, floors: 0, rooms: 0, pins: 0, kept: 5 });
  assert.equal(describePlan(again), 'Nothing new to add; 5 entries already exist and are kept.');
  assert.equal(describePlan(planImport(empty, { mappings: {}, layout: layout() })), 'The file contains nothing to import.');
});

test('plan descriptions read naturally in preview and after applying', () => {
  const plan = planImport({ mappings: { 9: mapping(9) }, layout: layout() }, { mappings: { 1: mapping(1), 2: mapping(2), 3: mapping(3), 9: mapping(9) }, layout: layout([{ name: 'Up', rooms: [] }], [1, 2], []) });
  assert.equal(describePlan(plan), 'Will add 3 personal names, 1 floor, 2 pinned items; 1 entry already exists and is kept.');
  assert.equal(describePlan(plan, true), 'Added 3 personal names, 1 floor, 2 pinned items; 1 entry already existed and was kept.');
});

test('merging never produces a layout the server would reject', () => {
  const floors = Array.from({ length: 20 }, (_, index) => ({ name: `Floor ${index}`, rooms: [] }));
  assert.throws(() => planImport({ mappings: {}, layout: layout(floors) }, { mappings: {}, layout: layout([{ name: 'One more', rooms: [] }]) }), /exceed the allowed limits/);
  const pins = Array.from({ length: 200 }, (_, index) => index);
  assert.throws(() => planImport({ mappings: {}, layout: layout([], pins) }, { mappings: {}, layout: layout([], [500]) }), /exceed the allowed limits/);
});
