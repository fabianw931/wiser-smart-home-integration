import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHome, summarize, actionTargets, decorate, weatherChips, protectionFor, kindOf, levelOf } from '../src/home.js';

const load = (id, type, room = '', extra = {}) => ({ id, type, name: `L${id}`, room, device: `d${id}`, channel: 0, ...extra });
const layout = (floors = [], favorites = { loads: [], rooms: [] }) => ({ floors, favorites });

test('without floors rooms sort alphabetically with unassigned last', () => {
  const home = buildHome([load(1, 'onoff', 'Zed'), load(2, 'onoff', ''), load(3, 'onoff', 'Alpha')], layout());
  assert.equal(home.hasFloors, false);
  assert.deepEqual(home.floors[0].rooms.map(room => room.name), ['Alpha', 'Zed', 'Unassigned']);
});

test('floors keep layout order, skip empty rooms and collect the rest under Other rooms', () => {
  const loads = [load(1, 'onoff', 'Kitchen'), load(2, 'onoff', 'Hall'), load(3, 'onoff', 'Attic')];
  const home = buildHome(loads, layout([{ name: 'Ground', rooms: ['Kitchen', 'Ghost room', 'Hall'] }, { name: 'Empty', rooms: ['Nowhere'] }]));
  assert.equal(home.hasFloors, true);
  assert.deepEqual(home.floors.map(floor => floor.name), ['Ground', 'Other rooms']);
  assert.deepEqual(home.floors[0].rooms.map(room => room.name), ['Kitchen', 'Hall']);
  assert.deepEqual(home.floors[1].rooms.map(room => room.name), ['Attic']);
});

test('personal room overrides the gateway room only while the saved identity matches', () => {
  const loads = [{ id: 1, type: 'onoff', name: 'Gateway name', room: 5, device: 'a', channel: 0 }];
  const rooms = [{ id: 5, name: 'Gateway room' }];
  const identity = JSON.stringify([1, 'a', 0, 'onoff']);
  assert.equal(decorate(loads, {}, rooms)[0].room, 'Gateway room');
  assert.deepEqual(decorate(loads, { 1: { identity, name: 'Mine', room: 'My room', notes: '' } }, rooms).map(item => [item.name, item.room]), [['Mine', 'My room']]);
  const stale = { 1: { identity: JSON.stringify([1, 'other', 0, 'onoff']), name: 'Old', room: 'Old room', notes: '' } };
  assert.deepEqual(decorate(loads, stale, rooms).map(item => [item.name, item.room]), [['Gateway name', 'Gateway room']]);
});

test('missing or invalid readings are unknown, never counted as off or open', () => {
  const loads = [load(1, 'onoff'), load(2, 'dim'), load(3, 'motor'), load(4, 'motor'), load(5, 'dim', '', { unused: true })];
  const states = { 1: { bri: 10000 }, 2: { bri: 'nope' }, 3: { level: 0 }, 4: {} };
  assert.deepEqual(summarize(loads, states), { lightsOn: 1, lights: 2, lightsUnknown: 1, blinds: 2, blindsOpen: 1, blindsClosed: 0, blindsUnknown: 1 });
  assert.equal(levelOf(loads[1], states[2]), null);
  assert.equal(levelOf(loads[0], { bri: 10001 }), null);
});

test('quick actions target only loads with a valid reading that differs from the goal', () => {
  const loads = [load(1, 'onoff'), load(2, 'dim'), load(3, 'dim'), load(4, 'motor'), load(5, 'motor'), load(6, 'dali', '', { sub_type: 'future' })];
  const states = { 1: { bri: 10000 }, 2: { bri: 0 }, 3: {}, 4: { level: 0 }, 5: { level: 10000 }, 6: { bri: 10000 } };
  assert.deepEqual(actionTargets('lights-off', loads, states).map(item => item.id), [1]);
  assert.deepEqual(actionTargets('lights-on', loads, states).map(item => item.id), [2]);
  assert.deepEqual(actionTargets('blinds-open', loads, states).map(item => item.id), [5]);
  assert.deepEqual(actionTargets('blinds-close', loads, states).map(item => item.id), [4]);
  assert.equal(kindOf(loads[5]), 'other');
});

test('weather chips use only sensors that report a value and flag detected rain', () => {
  const chips = weatherChips({ data: [
    { id: 1, type: 'rain', name: 'Rain', value: 1, unit: 'bool' },
    { id: 2, type: 'hail', name: 'Hail', value: 0, unit: 'bool' },
    { id: 3, type: 'wind', name: 'Wind', unit: 'm/s' },
    { id: 4, type: 'temperature', name: 'Terrace', value: 0, unit: '°C' },
    { id: 5, type: 'co2', name: 'Air', value: 400, unit: 'ppm' },
  ] });
  assert.deepEqual(chips.map(chip => [chip.label, chip.value, chip.alert]), [['Rain', 'Detected', true], ['Hail', 'Not detected', false], ['Terrace', '0 °C', false]]);
});

test('protection map ignores inactive rules and non-integer load ids', () => {
  const map = protectionFor({ data: [{ id: 6, name: 'South', loads: [3, '4', 3.5], wind: { action: 'up and lock', threshold: 5.5, unit: 'm/s' }, rain: { action: 'off' } }] });
  assert.deepEqual([...map.keys()], [3]);
  assert.deepEqual(map.get(3).rules, ['wind: up and lock (threshold 5.5 m/s)']);
});
