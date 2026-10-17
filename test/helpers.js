import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, makeLogger } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { newTotpSecret, totpAt } from '../src/crypto.js';

export async function startApp(extraEnv = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fh-'));
  const config = loadConfig({ APP_SECRET_KEY: 'x'.repeat(40), DATA_DIR: dir, COOKIE_SECURE: 'false', TZ: 'America/Toronto', ...extraEnv });
  const log = makeLogger('error');
  const db = openDb(dir, log);
  const app = createApp({ db, config, log });
  app.locals.seedAdmin();
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, db, config, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => { db.close(); r(); }); }) };
}

// Minimal cookie-aware client
export function client(base) {
  let cookie = '', csrf = '';
  const call = async (method, url, body, opts = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(opts.headers || {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), patch: (u, b) => call('PATCH', u, b), del: (u) => call('DELETE', u),
    refreshCsrf: async () => { csrf = (await call('GET', '/api/state')).json.csrf || ''; },
    raw: call,
  };
}

export async function signUp(c, username = 'james', password = 'correct horse battery') {
  const r = await c.post('/api/setup', { username, password });
  await c.refreshCsrf();
  const step = Math.floor(Date.now() / 30000);
  const e = await c.post('/api/totp/enable', { code: totpAt(r.json.totpSecret, step) });
  if (e.status !== 200) throw new Error('enable failed ' + e.text);
  return { secret: r.json.totpSecret, password, username };
}
export { newTotpSecret, totpAt };
