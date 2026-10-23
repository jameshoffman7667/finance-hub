import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp, client, signUp, totpAt } from './helpers.js';

const csv = 'Date,Description,Amount\n2026-10-01,LOBLAWS #123,-85.20\n2026-10-02,SHELL GAS,-40.00\n2026-10-03,PAYROLL ACME,2500.00\n2026-10-03,MYSTERY SHOP,-12.00\n';

test('health endpoint reports version without auth', async () => {
  const a = await startApp();
  const r = await client(a.base).get('/healthz');
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'ok');
  assert.match(r.json.version, /^\d+\.\d+\.\d+$/);
  await a.close();
});

test('healthz is exactly {status, version}, equals the image tag, needs no login and leaks nothing', async () => {
  const a = await startApp();
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const res = await fetch(a.base + '/healthz');
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.equal(body, JSON.stringify({ status: 'ok', version: pkg.version }));
  assert.equal(res.headers.get('set-cookie'), null);
  assert.match(res.headers.get('content-type'), /application\/json/);
  await a.close();
});

test('API requires sign-in, first-run setup works, totp is mandatory', async () => {
  const a = await startApp();
  const c = client(a.base);
  assert.equal((await c.get('/api/accounts')).status, 401);
  assert.equal((await c.get('/api/state')).json.setupNeeded, true);
  assert.equal((await c.post('/api/setup', { username: 'j', password: 'short' })).status, 400);
  const u = await signUp(c);
  assert.equal((await c.get('/api/accounts')).status, 200);
  assert.equal((await c.get('/api/state')).json.setupNeeded, false);
  assert.equal((await client(a.base).post('/api/setup', { username: 'x', password: 'another long password' })).status, 409);
  // logout, then login needs password AND code
  await c.post('/api/logout');
  const c2 = client(a.base);
  assert.equal((await c2.post('/api/login', { username: u.username, password: u.password })).status, 401);
  const c3 = client(a.base);
  assert.equal((await c3.post('/api/login', { username: u.username, password: u.password, code: '123456' })).status, 401);
  const step = Math.floor(Date.now() / 30000) + 1; // next window; previous one was consumed at enrolment
  const ok = await c3.post('/api/login', { username: u.username, password: u.password, code: totpAt(u.secret, step) });
  assert.equal(ok.status, 200);
  await a.close();
});

test('CSRF token is required for writes and cross-origin is refused', async () => {
  const a = await startApp();
  const c = client(a.base);
  await signUp(c);
  const noCsrf = await c.raw('POST', '/api/accounts', { name: 'x', type: 'chequing' }, { headers: { 'X-CSRF-Token': 'wrong' } });
  assert.equal(noCsrf.status, 403);
  const xo = await c.raw('POST', '/api/accounts', { name: 'x', type: 'chequing' }, { headers: { Origin: 'https://evil.example' } });
  assert.equal(xo.status, 403);
  await a.close();
});

test('login is rate limited', async () => {
  const a = await startApp();
  const c = client(a.base);
  await signUp(c);
  const c2 = client(a.base);
  for (let i = 0; i < 5; i++) assert.equal((await c2.post('/api/login', { username: 'james', password: 'wrong password here' })).status, 401);
  assert.equal((await c2.post('/api/login', { username: 'james', password: 'wrong password here' })).status, 429);
  await a.close();
});

test('accounts, valuations and net worth', async () => {
  const a = await startApp();
  const c = client(a.base);
  await signUp(c);
  const chq = (await c.post('/api/accounts', { name: 'TD Chequing', institution: 'TD', type: 'chequing' })).json.id;
  const card = (await c.post('/api/accounts', { name: 'Visa', type: 'credit_card' })).json.id;
  assert.equal((await c.post(`/api/accounts/${chq}/valuations`, { as_of: '2026-10-01', value: '10,000.50' })).status, 201);
  await c.post(`/api/accounts/${card}/valuations`, { as_of: '2026-10-01', value: '1500' });
  assert.equal((await c.post(`/api/accounts/${card}/valuations`, { as_of: '2026-10-01', value: '-5' })).status, 400);
  const nw = (await c.get('/api/reports/networth')).json;
  assert.equal(nw.current.assets_cents, 1000050);
  assert.equal(nw.current.liabilities_cents, 150000);
  assert.equal(nw.current.net_cents, 850050);
  await a.close();
});

test('import: preview, commit, duplicate protection, rules, spending report, rollback', async () => {
  const a = await startApp();
  const c = client(a.base);
  await signUp(c);
  const acc = (await c.post('/api/accounts', { name: 'Chequing', type: 'chequing' })).json.id;
  const cats = (await c.get('/api/categories')).json.categories;
  const groceries = cats.find((x) => x.name === 'Groceries').id;
  const salary = cats.find((x) => x.name === 'Salary').id;
  await c.post('/api/rules', { pattern: 'loblaws', category_id: groceries });
  await c.post('/api/rules', { pattern: 'payroll', category_id: salary });
  const pv = (await c.post('/api/imports/preview', { account_id: acc, text: csv })).json;
  assert.equal(pv.newCount, 4);
  assert.equal(pv.categorised, 2);
  const im = await c.post('/api/imports', { account_id: acc, text: csv, filename: 'oct.csv' });
  assert.equal(im.status, 201);
  assert.equal(im.json.imported, 4);
  // same file again: nothing new
  assert.equal((await c.post('/api/imports', { account_id: acc, text: csv })).status, 400);
  const sp = (await c.get('/api/reports/spending?from=2026-10-01&to=2026-10-31')).json;
  assert.equal(sp.income_cents, 250000);
  assert.equal(sp.total_spent_cents, 8520 + 4000 + 1200);
  assert.equal(sp.uncategorised, 2);
  // categorise by hand and create a rule that sweeps similar rows
  const txs = (await c.get('/api/transactions?uncategorised=1')).json.transactions;
  const shell = txs.find((t) => t.description.startsWith('SHELL'));
  const transport = cats.find((x) => x.name === 'Transport').id;
  assert.equal((await c.patch(`/api/transactions/${shell.id}`, { category_id: transport, rule_pattern: 'shell' })).status, 200);
  assert.equal((await c.get('/api/transactions?uncategorised=1')).json.total, 1);
  // rollback removes only that batch
  assert.equal((await c.del(`/api/imports/${im.json.batch_id}`)).status, 200);
  assert.equal((await c.get('/api/transactions')).json.total, 0);
  assert.equal((await c.post('/api/imports', { account_id: acc, text: csv })).status, 201);
  await a.close();
});

test('identical rows within a file are both kept; overlapping file only adds new rows', async () => {
  const a = await startApp();
  const c = client(a.base);
  await signUp(c);
  const acc = (await c.post('/api/accounts', { name: 'Chequing', type: 'chequing' })).json.id;
  const f1 = 'Date,Description,Amount\n2026-10-01,COFFEE,-4.50\n2026-10-01,COFFEE,-4.50\n';
  assert.equal((await c.post('/api/imports', { account_id: acc, text: f1 })).json.imported, 2);
  const f2 = f1 + '2026-10-02,LUNCH,-12.00\n';
  const r = await c.post('/api/imports', { account_id: acc, text: f2 });
  assert.equal(r.json.imported, 1);
  assert.equal(r.json.skipped, 2);
  await a.close();
});

test('export needs password step-up', async () => {
  const a = await startApp();
  const c = client(a.base);
  const u = await signUp(c);
  const denied = await c.get('/api/export.json');
  assert.equal(denied.status, 403);
  assert.equal(denied.json.stepup, true);
  assert.equal((await c.post('/api/stepup', { password: 'nope nope nope' })).status, 401);
  assert.equal((await c.post('/api/stepup', { password: u.password })).status, 200);
  const ok = await c.get('/api/export.json');
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.json.accounts));
  assert.equal((await c.get('/api/export/transactions.csv')).status, 200);
  await a.close();
});

test('static shell: manifest type, no-cache service worker, SPA fallback, security headers', async () => {
  const a = await startApp();
  const m = await fetch(a.base + '/manifest.webmanifest', { redirect: 'manual' });
  assert.equal(m.status, 200);
  assert.match(m.headers.get('content-type'), /application\/manifest\+json/);
  assert.match(m.headers.get('cache-control'), /no-cache/);
  const sw = await fetch(a.base + '/sw.js', { redirect: 'manual' });
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('cache-control'), /no-cache/);
  const page = await fetch(a.base + '/budget');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  await a.close();
});

test('env-seeded admin must still enrol two-step sign-in', async () => {
  const { hash } = await import('@node-rs/argon2');
  const h = await hash('a long admin password', { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const a = await startApp({ ADMIN_USERNAME: 'root', ADMIN_PASSWORD_HASH: h });
  const c = client(a.base);
  assert.equal((await c.get('/api/state')).json.setupNeeded, false);
  const r = await c.post('/api/login', { username: 'root', password: 'a long admin password' });
  assert.equal(r.json.enrol, true);
  assert.equal((await c.get('/api/accounts')).status, 401);
  await a.close();
});

test('missing APP_SECRET_KEY fails fast', async () => {
  const { loadConfig } = await import('../src/config.js');
  assert.throws(() => loadConfig({}), /APP_SECRET_KEY/);
});
