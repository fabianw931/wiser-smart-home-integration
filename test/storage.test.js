import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createMappingStore } from '../storage.js';

const mapping = { identity: '[1,null,null,"dim"]', name: 'Desk', room: 'Office', notes: 'Personal note' };

test('SQLite mappings survive reopen, isolate gateways and remove idempotently', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'wiser-store-')), 'nested', 'wiser.sqlite');
  let store = createMappingStore(path);
  store.put('wiser.local', '1', mapping);
  store.put('other.local', '1', { ...mapping, name: 'Other' });
  store.close();
  assert.equal(statSync(path).mode & 0o777, 0o600);
  store = createMappingStore(path);
  try {
    assert.deepEqual(store.list('wiser.local'), { 1: mapping });
    assert.equal(store.list('other.local')[1].name, 'Other');
    store.remove('wiser.local', '1');
    store.remove('wiser.local', '1');
    assert.deepEqual(store.list('wiser.local'), {});
    assert.equal(store.list('other.local')[1].name, 'Other');
  } finally { store.close(); }
});

test('import validates before writing and keeps existing personal entries', () => {
  const store = createMappingStore();
  try {
    store.put('sample-home', '1', mapping);
    assert.throws(() => store.merge('sample-home', { 2: mapping, 3: { ...mapping, token: 'must never store' } }));
    assert.deepEqual(store.list('sample-home'), { 1: mapping });
    store.merge('sample-home', { 1: { ...mapping, name: 'Imported' }, 2: mapping });
    assert.deepEqual(store.list('sample-home'), { 1: mapping, 2: mapping });
    assert.throws(() => store.put('sample-home', '3', { ...mapping, name: '' }));
  } finally { store.close(); }
});

test('newer SQLite schema is rejected without changing its version', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'wiser-version-')), 'wiser.sqlite');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA user_version = 3');
  db.close();
  assert.throws(() => createMappingStore(path), /newer schema/);
  const reopened = new DatabaseSync(path);
  try { assert.equal(reopened.prepare('PRAGMA user_version').get().user_version, 3); }
  finally { reopened.close(); }
});

const layout = {
  floors: [{ name: 'Ground floor', rooms: ['Living room', 'Kitchen'] }, { name: 'Upstairs', rooms: ['Bedroom'] }],
  favorites: { loads: [5, 1], rooms: ['Kitchen'] },
};

test('layouts default, round trip preserving order, and isolate gateways', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'wiser-layout-')), 'wiser.sqlite');
  let store = createMappingStore(path);
  assert.deepEqual(store.getLayout('wiser.local'), { floors: [], favorites: { loads: [], rooms: [] } });
  assert.deepEqual(store.putLayout('wiser.local', { floors: [{ name: ' Ground ', rooms: [' Hall '] }] }),
    { floors: [{ name: 'Ground', rooms: ['Hall'] }], favorites: { loads: [], rooms: [] } });
  store.putLayout('wiser.local', layout);
  store.close();
  store = createMappingStore(path);
  try {
    assert.deepEqual(store.getLayout('wiser.local'), layout);
    assert.deepEqual(store.getLayout('other.local'), { floors: [], favorites: { loads: [], rooms: [] } });
    store.putLayout('wiser.local', {});
    assert.deepEqual(store.getLayout('wiser.local'), { floors: [], favorites: { loads: [], rooms: [] } });
  } finally { store.close(); }
});

test('version 1 databases migrate to version 2 and keep their mappings', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'wiser-migrate-')), 'wiser.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE personal_mappings (
      gateway_key TEXT NOT NULL, load_id TEXT NOT NULL,
      identity TEXT NOT NULL, name TEXT NOT NULL, room TEXT NOT NULL,
      notes TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (gateway_key, load_id));
    INSERT INTO personal_mappings VALUES ('wiser.local', '1', '[1,null,null,"dim"]', 'Desk', 'Office', 'Personal note', 'x');
    PRAGMA user_version = 1;`);
  db.close();
  const store = createMappingStore(path);
  try {
    assert.deepEqual(store.list('wiser.local'), { 1: mapping });
    store.putLayout('wiser.local', layout);
    assert.deepEqual(store.getLayout('wiser.local'), layout);
  } finally { store.close(); }
  const reopened = new DatabaseSync(path);
  try { assert.equal(reopened.prepare('PRAGMA user_version').get().user_version, 2); }
  finally { reopened.close(); }
});

test('layout validation rejects duplicates, oversize input and unknown keys', () => {
  const store = createMappingStore();
  const bad = [
    null, [], { extra: 1 }, { floors: {} },
    { floors: [{ name: 'A', rooms: [], extra: 1 }] },
    { floors: [{ name: 'A', rooms: [] }, { name: 'a', rooms: [] }] },
    { floors: [{ name: 'A', rooms: ['Kitchen'] }, { name: 'B', rooms: ['Kitchen'] }] },
    { floors: [{ name: '  ', rooms: [] }] },
    { floors: [{ name: 'x'.repeat(101), rooms: [] }] },
    { floors: [{ name: 'A', rooms: [1] }] },
    { floors: Array.from({ length: 21 }, (_, i) => ({ name: `F${i}`, rooms: [] })) },
    { floors: [{ name: 'A', rooms: Array.from({ length: 201 }, (_, i) => `R${i}`) }] },
    { favorites: { loads: [1, 1], rooms: [] } },
    { favorites: { loads: [-1] } },
    { favorites: { loads: [1.5] } },
    { favorites: { loads: [2147483648] } },
    { favorites: { loads: Array.from({ length: 201 }, (_, i) => i) } },
    { favorites: { rooms: ['A', 'A'] } },
    { favorites: { rooms: [''] } },
    { favorites: { loads: [], rooms: [], extra: 1 } },
  ];
  try {
    for (const value of bad) assert.throws(() => store.putLayout('wiser.local', value), Error, JSON.stringify(value).slice(0, 80));
    assert.deepEqual(store.getLayout('wiser.local'), { floors: [], favorites: { loads: [], rooms: [] } });
  } finally { store.close(); }
});
