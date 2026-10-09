import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCredentialStore } from '../credentials.js';

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiser-credentials-'));
  const directory = path.join(root, 'credentials');
  return { directory, key: path.join(directory, 'key'), file: path.join(directory, 'gateway.json'),
    store: createCredentialStore(directory) };
};
const record = { host: '192.0.2.24', token: 'test-secret-token-123' };

test('missing storage remains absent until save; reopen decrypts only encrypted records', () => {
  const f = fixture();
  assert.equal(f.store.load(), null);
  f.store.forget();
  assert.equal(fs.existsSync(f.directory), false);
  f.store.save(record);
  assert.deepEqual(createCredentialStore(f.directory).load(), record);
  const first = fs.readFileSync(f.file, 'utf8');
  assert.equal(first.includes(record.host), false);
  assert.equal(first.includes(record.token), false);
  f.store.save(record);
  assert.notEqual(fs.readFileSync(f.file, 'utf8'), first);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(f.directory).mode & 0o777, 0o700);
    for (const file of [f.key, f.file]) assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  f.store.forget();
  assert.equal(createCredentialStore(f.directory).load(), null);
  assert.equal(fs.existsSync(f.key), true);
  assert.equal(fs.existsSync(f.file), true);
});

test('tampered ciphertext and missing keys fail without replacing storage', () => {
  const f = fixture();
  f.store.save(record);
  const envelope = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  envelope.tag = Buffer.alloc(16).toString('base64');
  fs.writeFileSync(f.file, JSON.stringify(envelope));
  assert.throws(() => f.store.load(), /Credential storage unavailable/);
  assert.throws(() => f.store.forget(), /Credential storage unavailable/);
  fs.renameSync(f.key, path.join(f.directory, 'held-key'));
  assert.throws(() => f.store.load(), /Credential storage unavailable/);
  assert.throws(() => f.store.save(record), /Credential storage unavailable/);
  assert.equal(fs.existsSync(f.key), false);
});

test('symlink directories and files are rejected', () => {
  const f = fixture();
  f.store.save(record);
  const alias = `${f.directory}-alias`;
  fs.symlinkSync(f.directory, alias, 'dir');
  assert.throws(() => createCredentialStore(alias).load());
  assert.throws(() => createCredentialStore(alias).save(record));
  const childAlias = path.join(alias, 'child');
  assert.throws(() => createCredentialStore(childAlias).load());
  assert.throws(() => createCredentialStore(childAlias).save(record));
  fs.renameSync(f.file, path.join(f.directory, 'held-record'));
  fs.symlinkSync(path.join(f.directory, 'held-record'), f.file);
  assert.throws(() => f.store.load());
  assert.throws(() => f.store.save(record));
});

test('nonregular key and record paths are rejected', () => {
  for (const target of ['key', 'file']) {
    const f = fixture();
    f.store.save(record);
    fs.renameSync(f[target], `${f[target]}-held`);
    fs.mkdirSync(f[target], { mode: 0o700 });
    assert.throws(() => f.store.load());
    assert.throws(() => f.store.save(record));
  }
});

test('insecure permissions are rejected without silently correcting them', { skip: process.platform === 'win32' }, () => {
  for (const target of ['directory', 'key', 'file']) {
    const f = fixture();
    f.store.save(record);
    fs.chmodSync(f[target], target === 'directory' ? 0o755 : 0o644);
    assert.throws(() => f.store.load());
    assert.throws(() => f.store.save(record));
    assert.equal(fs.statSync(f[target]).mode & 0o777, target === 'directory' ? 0o755 : 0o644);
  }
});

test('records must contain bounded strings and printable ASCII tokens', () => {
  const f = fixture();
  for (const invalid of [null, {}, { ...record, host: '' }, { ...record, host: 'a'.repeat(254) },
    { ...record, token: '' }, { ...record, token: 'a'.repeat(2049) }, { ...record, token: 'secret\n' },
    { ...record, token: 'é' }]) assert.throws(() => f.store.save(invalid));
  assert.equal(fs.existsSync(f.directory), false);
});
