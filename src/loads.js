// Pure helpers that turn raw gateway loads into what the dashboard shows.

export const loadName = load => load.name || `Load ${load.id}`;

export function kindOf(load) {
  if (load.unused) return 'unused';
  if (load.type === 'motor') return 'blind';
  if (load.type === 'onoff' || load.type === 'dim') return 'light';
  return 'other';
}

const asList = value => (Array.isArray(value) ? value : []);

// Room association field names are not confirmed against a real gateway; accept the
// plausible spellings on the load, then on its physical device. No match → null.
export function roomOf(load, rooms, devices) {
  const device = asList(devices).find(item => item?.id === load.device);
  const id = load.room ?? load.room_id ?? device?.room ?? device?.room_id;
  if (id === undefined || id === null) return null;
  return asList(rooms).find(room => room?.id === id)?.name ?? null;
}

// Reported value for the load's primary field, or null when the gateway gave none.
export function reading(load, state) {
  const value = state?.[load.type === 'motor' ? 'level' : 'bri'];
  return Number.isFinite(value) ? value : null;
}

export const formatPercent = raw => `${Number.isInteger(raw / 100) ? raw / 100 : (raw / 100).toFixed(1)}%`;

export function groupByRoom(loads, rooms, devices) {
  const groups = new Map();
  for (const load of loads) {
    const name = roomOf(load, rooms, devices) ?? 'Other';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(load);
  }
  // Named rooms alphabetically; the catch-all last.
  return [...groups].sort(([a], [b]) => (a === 'Other') - (b === 'Other') || a.localeCompare(b))
    .map(([name, items]) => ({ name, items }));
}
