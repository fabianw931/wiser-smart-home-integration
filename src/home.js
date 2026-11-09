// Pure helpers that turn raw loads, states, layout and sensors into what the Home view shows.
import { mappingMatches } from './mappings.js';
import { resourceItems, sensorReading, record } from './installation.js';

export const DALI_SUBTYPES = ['', 'tw', 'rgb'];
export const loadName = load => load.name || `Load ${load.id}`;

export function kindOf(load) {
  if (load.unused) return 'unused';
  if (load.type === 'motor') return 'blind';
  if (['onoff', 'dim'].includes(load.type)) return 'light';
  if (load.type === 'dali' && DALI_SUBTYPES.includes(load.sub_type ?? '')) return 'light';
  return 'other';
}

const validLevel = value => Number.isInteger(value) && value >= 0 && value <= 10000;
// Reported primary value, or null when missing or invalid. Never guessed.
export function levelOf(load, state) {
  const value = state?.[load.type === 'motor' ? 'level' : 'bri'];
  return validLevel(value) ? value : null;
}
export const percent = raw => `${Number.isInteger(raw / 100) ? raw / 100 : (raw / 100).toFixed(1)}%`;

// Apply personal names/rooms where the saved identity still matches the load.
export function decorate(loads, mappings, rooms) {
  return loads.map(load => {
    const local = mappingMatches(load, mappings[load.id]) ? mappings[load.id] : null;
    const gatewayRoom = Array.isArray(rooms) ? rooms.find(room => room?.id === load.room)?.name : '';
    return { ...load, name: local?.name ?? load.name, room: local?.room ?? gatewayRoom ?? '', roomId: load.room, notes: local?.notes ?? '' };
  });
}

export const UNASSIGNED = 'Unassigned';

// Rooms in layout order inside each floor; rooms without a floor follow under "Other rooms".
export function buildHome(loads, layout) {
  const byRoom = new Map();
  for (const load of loads) {
    const key = load.room || '';
    if (!byRoom.has(key)) byRoom.set(key, []);
    byRoom.get(key).push(load);
  }
  const room = key => ({ key, name: key || UNASSIGNED, loads: byRoom.get(key) });
  const order = [...byRoom.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
  if (!layout.floors.length) return { floors: [{ name: '', rooms: order.map(room) }], hasFloors: false };
  const placed = new Set();
  const floors = layout.floors.map(floor => {
    const rooms = floor.rooms.filter(name => byRoom.has(name)).map(room);
    rooms.forEach(item => placed.add(item.key));
    return { name: floor.name, rooms };
  }).filter(floor => floor.rooms.length);
  const rest = order.filter(key => !placed.has(key)).map(room);
  if (rest.length) floors.push({ name: 'Other rooms', rooms: rest, other: true });
  return { floors, hasFloors: true };
}

// Counts for a set of loads. "unknown" loads have no valid reading and are never counted as off/open.
export function summarize(loads, states) {
  const out = { lightsOn: 0, lights: 0, lightsUnknown: 0, blinds: 0, blindsOpen: 0, blindsClosed: 0, blindsUnknown: 0 };
  for (const load of loads) {
    const kind = kindOf(load);
    if (kind !== 'light' && kind !== 'blind') continue;
    const level = levelOf(load, states[load.id]);
    if (kind === 'light') {
      out.lights++;
      if (level === null) out.lightsUnknown++; else if (level > 0) out.lightsOn++;
    } else {
      out.blinds++;
      if (level === null) out.blindsUnknown++; else if (level === 0) out.blindsOpen++; else if (level >= 10000) out.blindsClosed++;
    }
  }
  return out;
}

// One glyph per controllable load for the room strip: fill is 0..1 or null when unknown.
export function glyphs(loads, states) {
  return loads.filter(load => ['light', 'blind'].includes(kindOf(load))).map(load => {
    const level = levelOf(load, states[load.id]);
    return { id: load.id, kind: kindOf(load), fill: level === null ? null : level / 10000, name: loadName(load) };
  });
}

// Targets for a quick action. Only controllable loads whose reported value differs from the goal.
export const ACTIONS = {
  'lights-off': { kind: 'light', field: 'bri', value: 0, label: 'Lights off' },
  'lights-on': { kind: 'light', field: 'bri', value: 10000, label: 'Lights on' },
  'blinds-open': { kind: 'blind', field: 'level', value: 0, label: 'Open blinds', confirm: true },
  // Level 5000 = halfway: lets daylight in. Wiser levels run from 0 (open) to 10000 (closed).
  'blinds-half': { kind: 'blind', field: 'level', value: 5000, label: 'Half-open blinds', confirm: true },
  'blinds-close': { kind: 'blind', field: 'level', value: 10000, label: 'Close blinds', confirm: true },
};
export function actionTargets(action, loads, states) {
  const spec = ACTIONS[action];
  return loads.filter(load => kindOf(load) === spec.kind).filter(load => {
    const level = levelOf(load, states[load.id]);
    if (level === null) return false;
    // A blind that is still travelling away from the goal reports its start level (e.g. level 0 while moving down), so level alone would skip it.
    const moving = states[load.id]?.moving;
    if (spec.kind === 'blind' && (spec.value === 5000 ? moving === 'up' || moving === 'down' : moving === (spec.value === 0 ? 'down' : 'up'))) return true;
    return level !== spec.value;
  });
}

// Weather: show only sensor types the gateway reports; station membership is never inferred.
export function weatherChips(sensorsResult) {
  const chips = [];
  for (const sensor of resourceItems(sensorsResult)) {
    const reading = sensorReading(sensor);
    if (reading === 'Unavailable') continue;
    const type = sensor.type;
    const label = sensor.name || type;
    if (['rain', 'hail'].includes(type)) chips.push({ key: `${sensor.id}-${type}`, label: type === 'rain' ? 'Rain' : 'Hail', value: reading, alert: reading === 'Detected' });
    else if (['wind', 'temperature', 'illuminance'].includes(type)) chips.push({ key: `${sensor.id}-${type}`, label, value: reading, alert: false });
  }
  return chips;
}

// Which blinds have a configured weather-protection group, with the rules as reported.
export function protectionFor(westgroupsResult) {
  const out = new Map();
  for (const group of resourceItems(westgroupsResult)) {
    if (!Array.isArray(group.loads)) continue;
    const rules = ['wind', 'rain', 'hail', 'temperature'].filter(field => record(group[field]) && typeof group[field].action === 'string' && group[field].action !== 'off')
      .map(field => `${field}: ${group[field].action}${Number.isFinite(group[field].threshold) ? ` (threshold ${group[field].threshold}${typeof group[field].unit === 'string' ? ' ' + group[field].unit : ''})` : ''}`);
    for (const id of group.loads.filter(Number.isSafeInteger)) out.set(id, { group: group.name || `Group ${group.id ?? ''}`.trim(), rules });
  }
  return out;
}
