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
  db.exec('PRAGMA user_version = 2');
  db.close();
  assert.throws(() => createMappingStore(path), /newer schema/);
  const reopened = new DatabaseSync(path);
  try { assert.equal(reopened.prepare('PRAGMA user_version').get().user_version, 2); }
  finally { reopened.close(); }
});
