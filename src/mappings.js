// Personal labels only: never credentials, commands, or gateway configuration.
export const MAPPING_KEY = 'wiser-personal-mappings-v1';
export const identity = load => JSON.stringify([load.id, load.device ?? null, load.channel ?? null, load.type]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const mappingMatches = (load, mapping) => !!load && mapping?.identity === identity(load);

export function validateMappings(value) {
  if (!object(value) || Object.keys(value).length > 1000) throw new Error('Invalid mapping collection.');
  const result = {};
  for (const [id, item] of Object.entries(value)) {
    if (!/^\d{1,10}$/.test(id) || !object(item) || typeof item.identity !== 'string' || item.identity.length > 1024
      || Object.keys(item).some(key => !['identity', 'name', 'room', 'notes'].includes(key))) throw new Error('Invalid mapping entry.');
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100
      || typeof item.room !== 'string' || item.room.length > 100
      || typeof item.notes !== 'string' || item.notes.length > 1000) throw new Error('Invalid mapping fields.');
    result[id] = { identity: item.identity, name: item.name.trim(), room: item.room.trim(), notes: item.notes };
  }
  return result;
}
export function makeMapping(load, fields) {
  return validateMappings({ [load.id]: { identity: identity(load), ...fields } })[load.id];
}
export function readMappings(storage, gateway) {
  const saved = JSON.parse(storage.getItem(MAPPING_KEY) || '{}');
  if (!object(saved)) throw new Error('Invalid saved mapping file.');
  return validateMappings(saved[gateway] ?? {});
}
export function saveMappings(storage, gateway, mappings) {
  const saved = JSON.parse(storage.getItem(MAPPING_KEY) || '{}');
  if (!object(saved)) throw new Error('Invalid saved mapping file.');
  const next = { ...saved, [gateway]: validateMappings(mappings) };
  if (!Object.keys(mappings).length) delete next[gateway];
  if (Object.keys(next).length) storage.setItem(MAPPING_KEY, JSON.stringify(next));
  else storage.removeItem(MAPPING_KEY);
}
export function exportMappings(gateway, mappings) {
  return JSON.stringify({ version: 1, gateway, mappings: validateMappings(mappings) }, null, 2);
}
export function importMappings(text, gateway) {
  if (text.length > 1024 * 1024) throw new Error('Mapping file is too large (maximum 1 MB).');
  const data = JSON.parse(text);
  if (!object(data) || data.version !== 1 || data.gateway !== gateway) throw new Error('Select a mapping file for this gateway.');
  return validateMappings(data.mappings);
}
