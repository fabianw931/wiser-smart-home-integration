const MAX_FLOORS = 20;
const MAX_ITEMS = 200;
const MAX_LABEL = 100;
const MAX_LOAD_ID = 2147483647;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function onlyKeys(value, allowed, what) {
  if (!isObject(value)) throw new Error(`${what} must be an object.`);
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${what} has unknown fields.`);
}

function label(value, what) {
  if (typeof value !== 'string') throw new Error(`${what} must be text.`);
  const text = value.trim();
  if (!text || text.length > MAX_LABEL) throw new Error(`${what} must contain 1 to ${MAX_LABEL} characters.`);
  return text;
}

function list(value, max, what) {
  if (!Array.isArray(value)) throw new Error(`${what} must be a list.`);
  if (value.length > max) throw new Error(`${what} may contain at most ${max} entries.`);
  return value;
}

// Pure validation shared by the server and the browser. Returns a normalized copy.
export function validateLayout(value) {
  onlyKeys(value, ['floors', 'favorites'], 'Layout');
  const floors = [];
  const floorNames = new Set();
  const placed = new Set();
  for (const floor of list(value.floors ?? [], MAX_FLOORS, 'Floors')) {
    onlyKeys(floor, ['name', 'rooms'], 'Floor');
    const name = label(floor.name, 'Floor name');
    if (floorNames.has(name.toLowerCase())) throw new Error('Floor names must be unique.');
    floorNames.add(name.toLowerCase());
    const rooms = list(floor.rooms ?? [], MAX_ITEMS, 'Floor rooms').map(room => label(room, 'Room'));
    for (const room of rooms) {
      if (placed.has(room)) throw new Error('A room may appear on only one floor.');
      placed.add(room);
    }
    floors.push({ name, rooms });
  }
  const input = value.favorites ?? {};
  onlyKeys(input, ['loads', 'rooms'], 'Favorites');
  const loads = list(input.loads ?? [], MAX_ITEMS, 'Favorite loads');
  for (const id of loads) {
    if (!Number.isSafeInteger(id) || id < 0 || id > MAX_LOAD_ID) throw new Error(`Favorite loads must be integers from 0 to ${MAX_LOAD_ID}.`);
  }
  if (new Set(loads).size !== loads.length) throw new Error('Favorite loads must be unique.');
  const rooms = list(input.rooms ?? [], MAX_ITEMS, 'Favorite rooms').map(room => label(room, 'Favorite room'));
  if (new Set(rooms).size !== rooms.length) throw new Error('Favorite rooms must be unique.');
  return { floors, favorites: { loads: [...loads], rooms } };
}
