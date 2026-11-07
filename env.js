import { existsSync, statSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export const ENV_PATH = fileURLToPath(new URL('./.env', import.meta.url));

// Loads KEY=value pairs into process.env without overriding variables already set by the shell.
// The file holds a gateway token in plain text: warn when other users could read it.
export function loadEnv(path = ENV_PATH, env = process.env, warn = message => console.warn(message)) {
  if (!existsSync(path)) return false;
  const info = statSync(path);
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) warn(`${path} is readable by other users. Run: chmod 600 .env`);
  for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) if (env[key] === undefined) env[key] = value;
  return true;
}

// Both values or neither: a half-configured gateway is reported, never guessed.
export function gatewayFromEnv(env = process.env) {
  const host = (env.WISER_GATEWAY_HOST ?? '').trim();
  const token = (env.WISER_GATEWAY_TOKEN ?? '').trim();
  if (!host && !token) return null;
  if (!host || !token) throw new Error('Set both WISER_GATEWAY_HOST and WISER_GATEWAY_TOKEN in .env, or neither.');
  return { host, token };
}
