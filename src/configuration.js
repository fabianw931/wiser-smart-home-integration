// Whole-configuration backup: personal mappings plus floors and pins for one gateway, and a read-only list of the
// gateway's own device names for reference. Pure and shared by browser and tests. Never contains credentials.
import { validateMappings, mappingMatches } from './mappings.js';
import { validateLayout } from './layout.js';

export const CONFIGURATION_KIND = 'wiser-workspace-configuration';
export const MAX_CONFIGURATION_BYTES = 1024 * 1024;
const V2_KEYS = ['version', 'kind', 'gateway', 'exported_at', 'mappings', 'layout', 'devices'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const short = value => typeof value === 'string' ? value.slice(0, 200) : null;

// Informational only: how the gateway itself names each load, next to the personal name and room (if any).
// Built from the raw loads and rooms so gateway_name is never a personal override. Ignored on import.
export function describeDevices(loads, rooms, mappings) {
  const roomNames = new Map((Array.isArray(rooms) ? rooms : []).map(room => [room?.id, room?.name]));
  return loads.map(load => {
    const personal = mappingMatches(load, mappings[load.id]) ? mappings[load.id] : null;
    return {
      id: load.id, type: short(load.type), sub_type: short(load.sub_type), device: short(load.device),
      channel: Number.isInteger(load.channel) ? load.channel : null,
      gateway_name: short(load.name), gateway_room: short(roomNames.get(load.room)),
      personal_name: personal?.name ?? null, personal_room: personal?.room || null,
      unused: load.unused === true,
    };
  }).sort((a, b) => a.id - b.id);
}

export function exportConfiguration(gateway, { mappings, layout, loads = [], rooms = [] }, now = new Date()) {
  return JSON.stringify({
    version: 2,
    kind: CONFIGURATION_KIND,
    gateway,
    exported_at: now.toISOString(),
    mappings: validateMappings(mappings),
    layout: validateLayout(layout),
    devices: describeDevices(loads, rooms, mappings),
  }, null, 2);
}

export function configurationFilename(gateway, now = new Date()) {
  return `wiser-configuration-${gateway.replace(/[^a-z0-9.-]/gi, '_')}-${now.toISOString().slice(0, 10)}.json`;
}

// Returns { version, mappings, layout } where layout is null for version 1 (mappings only).
// Throws before anything is changed if the file is oversize, malformed, or for another gateway.
export function parseConfiguration(text, gateway) {
  if (typeof text !== 'string' || text.length > MAX_CONFIGURATION_BYTES) throw new Error('Configuration file is too large (maximum 1 MB).');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('The file is not valid JSON.'); }
  if (!object(data) || (data.version !== 1 && data.version !== 2)) throw new Error('Select a Wiser configuration or mapping file (version 1 or 2).');
  if (data.version === 2) {
    if (data.kind !== CONFIGURATION_KIND || Object.keys(data).some(key => !V2_KEYS.includes(key))) throw new Error('Select a Wiser configuration or mapping file (version 1 or 2).');
    if (typeof data.exported_at !== 'string' || Number.isNaN(Date.parse(data.exported_at))) throw new Error('The file has no valid export time.');
  }
  if (data.gateway !== gateway) throw new Error('This file was exported for another gateway. Select a configuration file for this gateway.');
  const mappings = validateMappings(data.mappings);
  if (data.version === 1) return { version: 1, mappings, layout: null };
  if (!object(data.layout)) throw new Error('The file has no valid layout.');
  return { version: 2, mappings, layout: validateLayout(data.layout) };
}

// Existing data always wins. Returns what would be written and counts for a preview:
//   mappings: only the ids that are missing; layout: the merged layout, or null if unchanged.
export function planImport(current, imported) {
  const counts = { names: 0, floors: 0, rooms: 0, pins: 0, kept: 0 };
  const mappings = {};
  for (const [id, mapping] of Object.entries(imported.mappings)) {
    if (Object.hasOwn(current.mappings, id)) counts.kept++;
    else { mappings[id] = mapping; counts.names++; }
  }
  let layout = null;
  if (imported.layout) {
    const floors = current.layout.floors.map(floor => ({ name: floor.name, rooms: [...floor.rooms] }));
    const placed = new Set(floors.flatMap(floor => floor.rooms));
    for (const incoming of imported.layout.floors) {
      let target = floors.find(floor => floor.name.toLowerCase() === incoming.name.toLowerCase());
      if (target) counts.kept++;
      else { target = { name: incoming.name, rooms: [] }; floors.push(target); counts.floors++; }
      for (const room of incoming.rooms) {
        if (placed.has(room)) { counts.kept++; continue; }
        placed.add(room); target.rooms.push(room); counts.rooms++;
      }
    }
    const loads = [...current.layout.favorites.loads];
    for (const id of imported.layout.favorites.loads) {
      if (loads.includes(id)) counts.kept++;
      else { loads.push(id); counts.pins++; }
    }
    const rooms = [...current.layout.favorites.rooms];
    for (const room of imported.layout.favorites.rooms) {
      if (rooms.includes(room)) counts.kept++;
      else { rooms.push(room); counts.pins++; }
    }
    if (counts.floors || counts.rooms || counts.pins) {
      try { layout = validateLayout({ floors, favorites: { loads, rooms } }); }
      catch (failure) { throw new Error('The merged floors and pins would exceed the allowed limits: ' + failure.message); }
    }
  }
  if (Object.keys(current.mappings).length + counts.names > 1000) throw new Error('The merged personal names would exceed the limit of 1000 entries.');
  return { mappings, layout, counts, empty: !counts.names && !layout };
}

const plural = (count, one, many = one + 's') => `${count} ${count === 1 ? one : many}`;

// One-sentence summary of a plan: "Will add 3 personal names, 1 floor, 2 pinned items; 4 entries already exist and are kept."
// With past = true it reports a finished import ("Added …; … already existed and were kept.").
export function describePlan({ counts, empty }, past = false) {
  const parts = [];
  if (counts.names) parts.push(plural(counts.names, 'personal name'));
  if (counts.floors) parts.push(plural(counts.floors, 'floor'));
  if (counts.rooms) parts.push(`${plural(counts.rooms, 'room')} placed on floors`);
  if (counts.pins) parts.push(plural(counts.pins, 'pinned item'));
  const one = counts.kept === 1;
  const kept = counts.kept ? `${plural(counts.kept, 'entry', 'entries')} ${past ? (one ? 'already existed and was' : 'already existed and were') : (one ? 'already exists and is' : 'already exist and are')} kept` : '';
  if (empty) return kept ? `Nothing new to add; ${kept}.` : 'The file contains nothing to import.';
  return `${past ? 'Added' : 'Will add'} ${parts.join(', ')}${kept ? '; ' + kept : ''}.`;
}
