import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const failure = () => new Error('Credential storage unavailable');
const missing = (error) => error?.code === 'ENOENT';
const validRecord = (record) => record !== null && typeof record === 'object'
  && typeof record.host === 'string' && record.host.length >= 1 && record.host.length <= 253
  && typeof record.token === 'string' && /^[\x21-\x7e]{1,2048}$/.test(record.token);

export function createCredentialStore(directory) {
  if (typeof directory !== 'string' || !directory) throw failure();
  const keyPath = path.join(directory, 'key');
  const recordPath = path.join(directory, 'gateway.json');
  const check = (target, isDirectory = false) => {
    if (isDirectory) {
      // Reject aliases in every existing path component, without changing caller paths.
      let ancestor = path.resolve(target);
      while (true) {
        try { if (fs.lstatSync(ancestor).isSymbolicLink()) throw failure(); }
        catch (error) { if (!missing(error)) throw error; }
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
    }
    let stat;
    try { stat = fs.lstatSync(target); } catch (error) { if (missing(error)) return null; throw error; }
    if (stat.isSymbolicLink() || !(isDirectory ? stat.isDirectory() : stat.isFile())) throw failure();
    if (process.platform !== 'win32' && (stat.uid !== process.getuid()
      || (stat.mode & 0o777) !== (isDirectory ? 0o700 : 0o600))) throw failure();
    return stat;
  };
  const read = (target, maximum) => {
    if (!check(target)) return null;
    const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > maximum || (process.platform !== 'win32'
        && (stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600))) throw failure();
      return fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
  };
  const guarded = (operation) => {
    try { return operation(); } catch { throw failure(); }
  };
  const load = () => guarded(() => {
    if (!check(directory, true)) return null;
    const encrypted = read(recordPath, 16384);
    const key = read(keyPath, 32);
    if (!encrypted) return null;
    if (!key || key.length !== 32) throw failure();
    const envelope = JSON.parse(encrypted.toString('utf8'));
    if (envelope.version !== 1 || !['iv', 'tag', 'data'].every((field) =>
      typeof envelope[field] === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(envelope[field]))) throw failure();
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    if (iv.length !== 12 || tag.length !== 16) throw failure();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from('wiser-credentials-v1'));
    decipher.setAuthTag(tag);
    const record = JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final(),
    ]).toString('utf8'));
    if (record !== null && !validRecord(record)) throw failure();
    return record === null ? null : { host: record.host, token: record.token };
  });
  const write = (record) => guarded(() => {
    if (!check(directory, true)) {
      fs.mkdirSync(directory, { mode: 0o700 });
      check(directory, true);
    }
    const existing = check(recordPath);
    let key = read(keyPath, 32);
    if (!key) {
      if (existing) throw failure();
      key = randomBytes(32);
      const fd = fs.openSync(keyPath, fs.constants.O_WRONLY | fs.constants.O_CREAT
        | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
      try { fs.writeFileSync(fd, key); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    if (key.length !== 32) throw failure();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('wiser-credentials-v1'));
    const data = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
    const envelope = JSON.stringify({ version: 1, iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
    const temporary = path.join(directory, `.gateway-${randomBytes(16).toString('hex')}.tmp`);
    const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT
      | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try { fs.writeFileSync(fd, envelope); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    check(directory, true);
    check(recordPath);
    fs.renameSync(temporary, recordPath);
  });
  return {
    load,
    save(record) {
      if (!validRecord(record)) throw failure();
      write({ host: record.host, token: record.token });
    },
    forget() {
      // Authenticate existing storage before replacing it with an encrypted tombstone.
      if (load() !== null) write(null);
    },
  };
}
