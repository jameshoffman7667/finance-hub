import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const VERSION = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;

// Read configuration from the environment once; tests pass overrides.
export function loadConfig(env = process.env) {
  const secret = env.APP_SECRET_KEY || '';
  if (secret.length < 32) {
    throw new Error('APP_SECRET_KEY is required and must be at least 32 characters (generate with: openssl rand -hex 32)');
  }
  return {
    version: VERSION,
    root,
    port: Number(env.PORT || 8080),
    dataDir: env.DATA_DIR || '/data',
    filesDir: env.FILES_DIR || '/files',
    secret,
    appUrl: env.APP_URL || '',
    cookieSecure: (env.COOKIE_SECURE ?? 'true') === 'true',
    adminUsername: env.ADMIN_USERNAME || '',
    adminPasswordHash: env.ADMIN_PASSWORD_HASH || '',
    maxUploadMb: Number(env.MAX_UPLOAD_MB || 50),
    cfTeamDomain: env.CF_ACCESS_TEAM_DOMAIN || '',
    cfAud: env.CF_ACCESS_AUD || '',
    trustProxy: env.TRUST_PROXY || 'loopback, linklocal, uniquelocal',
    idleMinutes: Number(env.SESSION_IDLE_MINUTES || 30),
    logLevel: env.LOG_LEVEL || 'info',
    tz: env.TZ || 'America/Toronto',
  };
}

const levels = { error: 0, warn: 1, info: 2, debug: 3 };
export function makeLogger(level = 'info') {
  const max = levels[level] ?? 2;
  const out = (l, msg, extra) => {
    if (levels[l] > max) return;
    const line = `${new Date().toISOString()} ${l.toUpperCase()} ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`;
    (l === 'error' ? console.error : console.log)(line);
  };
  return { error: (m, e) => out('error', m, e), warn: (m, e) => out('warn', m, e), info: (m, e) => out('info', m, e), debug: (m, e) => out('debug', m, e) };
}
