import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMappings } from './src/mappings.js';
import { validateLayout } from './src/layout.js';

export const DEFAULT_DB_PATH = fileURLToPath(new URL('./data/wiser.sqlite', import.meta.url));

// Only personal annotations belong here. Credentials use a separate opt-in encrypted store.
export function createMappingStore(dbPath = ':memory:') {
  const path = dbPath === ':memory:' ? dbPath : resolve(dbPath);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  try {
    if (path !== ':memory:') chmodSync(path, 0o600);
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 2) throw new Error('Mapping database uses a newer schema version.');
    db.exec(`BEGIN;
      CREATE TABLE IF NOT EXISTS personal_mappings (
        gateway_key TEXT NOT NULL, load_id TEXT NOT NULL,
        identity TEXT NOT NULL, name TEXT NOT NULL, room TEXT NOT NULL,
        notes TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (gateway_key, load_id)
      );
      CREATE TABLE IF NOT EXISTS personal_layouts (
        gateway_key TEXT PRIMARY KEY, layout TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 2;
      COMMIT;`);
    const getLayout = db.prepare('SELECT layout FROM personal_layouts WHERE gateway_key = ?');
    const putLayout = db.prepare(`INSERT INTO personal_layouts VALUES (?, ?, ?)
      ON CONFLICT(gateway_key) DO UPDATE SET layout=excluded.layout, updated_at=excluded.updated_at`);
    const list = db.prepare('SELECT load_id, identity, name, room, notes FROM personal_mappings WHERE gateway_key = ? ORDER BY load_id');
    const put = db.prepare(`INSERT INTO personal_mappings VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(gateway_key, load_id) DO UPDATE SET identity=excluded.identity,
      name=excluded.name, room=excluded.room, notes=excluded.notes, updated_at=excluded.updated_at`);
    const insert = db.prepare('INSERT INTO personal_mappings VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(gateway_key, load_id) DO NOTHING');
    const remove = db.prepare('DELETE FROM personal_mappings WHERE gateway_key = ? AND load_id = ?');
    const write = (statement, gateway, id, mapping) => statement.run(gateway, id, mapping.identity, mapping.name, mapping.room, mapping.notes, new Date().toISOString());
    return {
      list(gateway) { return Object.fromEntries(list.all(gateway).map(({ load_id, ...mapping }) => [load_id, { ...mapping }])); },
      put(gateway, id, mapping) { write(put, gateway, String(id), validateMappings({ [id]: mapping })[id]); },
      remove(gateway, id) { remove.run(gateway, String(id)); },
      merge(gateway, mappings) {
        const validated = validateMappings(mappings);
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const [id, mapping] of Object.entries(validated)) write(insert, gateway, id, mapping);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      },
      getLayout(gateway) {
        const row = getLayout.get(gateway);
        return validateLayout(row ? JSON.parse(row.layout) : {});
      },
      putLayout(gateway, layout) {
        const validated = validateLayout(layout);
        putLayout.run(gateway, JSON.stringify(validated), new Date().toISOString());
        return validated;
      },
      close() { db.close(); },
    };
  } catch (error) { db.close(); throw error; }
}
