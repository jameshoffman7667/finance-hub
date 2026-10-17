import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { nowIso } from './db.js';
import { encrypt, decrypt, sha256, randomToken, newTotpSecret, verifyTotp } from './crypto.js';
import { parseStatement, loadRules, categorize } from './importer.js';
import { parseCents, parseDate } from './money.js';
import { toCsv } from './csv.js';

const ACCOUNT_TYPES = {
  chequing: 'asset', savings: 'asset', investment: 'asset', registered: 'asset', property: 'asset', other_asset: 'asset',
  credit_card: 'liability', loan: 'liability', mortgage: 'liability', line_of_credit: 'liability', other_liability: 'liability',
};
const PASSWORD_MIN = 12;
const argonOpts = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);

function todayLocal(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const isDate = (s) => typeof s === 'string' && parseDate(s) === s;
const str = (v, max = 200) => {
  if (typeof v !== 'string') throw bad('Expected text');
  const s = v.trim();
  if (!s || s.length > max) throw bad(`Text must be 1-${max} characters`);
  return s;
};

export function createApp({ db, config, log }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  // ---------- rate limiting (in memory, per key) ----------
  const hits = new Map();
  const limited = (key, max, windowMs) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    hits.set(key, arr);
    return arr.length >= max;
  };
  const noteHit = (key) => { const a = hits.get(key) || []; a.push(Date.now()); hits.set(key, a); };
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k); }, 600e3);
  sweep.unref();

  const audit = (req, userId, action, detail = '') =>
    db.prepare('INSERT INTO audit_log (at, user_id, action, detail, ip) VALUES (?,?,?,?,?)').run(nowIso(), userId ?? null, action, detail, req.ip);

  // ---------- security headers ----------
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    next();
  });

  // ---------- health (no auth, no Access) ----------
  app.get('/healthz', (req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.set('Cache-Control', 'no-store').json({ status: 'ok', version: config.version });
    } catch (e) {
      log.error('healthz failed', { err: e.message });
      res.status(503).json({ status: 'error', version: config.version });
    }
  });

  // ---------- Cloudflare Access JWT (only when configured) ----------
  let jwks = null;
  if (config.cfTeamDomain && config.cfAud) jwks = createRemoteJWKSet(new URL(`https://${config.cfTeamDomain}/cdn-cgi/access/certs`));
  const requireAccess = async (req, res, next) => {
    if (!jwks) return next();
    try {
      const token = req.get('Cf-Access-Jwt-Assertion');
      if (!token) throw new Error('missing token');
      await jwtVerify(token, jwks, { audience: config.cfAud, issuer: `https://${config.cfTeamDomain}` });
      next();
    } catch (e) {
      log.warn('cloudflare access check failed', { ip: req.ip, err: e.message });
      res.status(403).json({ error: 'Access denied' });
    }
  };

  // ---------- static PWA shell (before auth: manifest, icons, worker must be public) ----------
  const pub = path.join(config.root, 'public');
  app.use(express.static(pub, {
    index: false,
    setHeaders(res, file) {
      if (/sw\.js$|manifest\.webmanifest$|\.html$/.test(file)) res.set('Cache-Control', 'no-cache');
      else res.set('Cache-Control', 'public, max-age=3600');
      if (/manifest\.webmanifest$/.test(file)) res.type('application/manifest+json');
      if (/sw\.js$/.test(file)) res.set('Service-Worker-Allowed', '/');
    },
  }));

  // ---------- API plumbing ----------
  const api = express.Router();
  api.use(requireAccess);
  const smallJson = express.json({ limit: '1mb' });
  api.use((req, res, next) => (req.method === 'POST' && req.path.startsWith('/imports') ? next() : smallJson(req, res, next)));
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Mutating requests must come from our own origin.
  api.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('Origin');
    if (origin) {
      let host;
      try { host = new URL(origin).host; } catch { host = ''; }
      if (host !== req.get('Host') && host !== (config.appUrl ? new URL(config.appUrl).host : '')) return res.status(403).json({ error: 'Cross-origin request refused' });
    }
    next();
  });

  const cookieName = 'fh_sid';
  const readCookie = (req) => {
    const m = new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`).exec(req.get('Cookie') || '');
    return m ? decodeURIComponent(m[1]) : null;
  };
  const setCookie = (res, value, maxAge) => {
    const parts = [`${cookieName}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`];
    if (config.cookieSecure) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  };
  const startSession = (req, res, userId, pending) => {
    const sid = randomToken(32);
    const t = nowIso();
    db.prepare('INSERT INTO sessions (id_hash, user_id, csrf, pending, created_at, last_seen) VALUES (?,?,?,?,?,?)')
      .run(sha256(sid), userId, randomToken(24), pending ? 1 : 0, t, t);
    setCookie(res, sid, 12 * 3600);
  };
  const loadSession = (req) => {
    const sid = readCookie(req);
    if (!sid) return null;
    const s = db.prepare('SELECT s.*, u.username, u.totp_enabled FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?').get(sha256(sid));
    if (!s) return null;
    const idleMs = config.idleMinutes * 60e3;
    if (Date.now() - Date.parse(s.last_seen) > idleMs || Date.now() - Date.parse(s.created_at) > 12 * 3600e3) {
      db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(s.id_hash);
      return null;
    }
    if (Date.now() - Date.parse(s.last_seen) > 30e3) db.prepare('UPDATE sessions SET last_seen = ? WHERE id_hash = ?').run(nowIso(), s.id_hash);
    return s;
  };
  api.use((req, res, next) => { req.session = loadSession(req); next(); });

  const csrfOk = (req) => ['GET', 'HEAD'].includes(req.method) || (req.session && req.get('X-CSRF-Token') === req.session.csrf);
  const requireAuth = (req, res, next) => {
    if (!req.session || req.session.pending) return res.status(401).json({ error: 'Sign in required' });
    if (!csrfOk(req)) return res.status(403).json({ error: 'Bad CSRF token' });
    next();
  };
  const requireStepUp = (req, res, next) => {
    const until = req.session.stepup_until;
    if (!until || Date.parse(until) < Date.now()) return res.status(403).json({ error: 'Re-enter your password to continue', stepup: true });
    next();
  };
  const route = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      log.error('request failed', { path: req.path, err: e.message });
      res.status(500).json({ error: 'Something went wrong' });
    }
  };

  const userCount = () => db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const otpauth = (username, secret) =>
    `otpauth://totp/Finance%20Hub:${encodeURIComponent(username)}?secret=${secret}&issuer=Finance%20Hub`;

  // ---------- session / auth routes ----------
  api.get('/state', route((req, res) => {
    const s = req.session;
    res.json({
      version: config.version,
      setupNeeded: userCount() === 0 && !(config.adminUsername && config.adminPasswordHash),
      authenticated: !!s && !s.pending,
      pending: !!s?.pending,
      username: s?.username ?? null,
      csrf: s?.csrf ?? null,
      idleMinutes: config.idleMinutes,
    });
  }));

  const checkPassword = (pw) => {
    if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) throw bad(`Password must be at least ${PASSWORD_MIN} characters`);
    if (pw.length > 200) throw bad('Password is too long');
  };

  api.post('/setup', route(async (req, res) => {
    if (userCount() > 0 || (config.adminUsername && config.adminPasswordHash)) throw new HttpError(409, 'Setup is already complete');
    if (limited(`setup:${req.ip}`, 10, 3600e3)) throw new HttpError(429, 'Too many attempts');
    noteHit(`setup:${req.ip}`);
    const username = str(req.body?.username, 60);
    checkPassword(req.body?.password);
    const secret = newTotpSecret();
    const pwHash = await argonHash(req.body.password, argonOpts);
    const info = db.prepare('INSERT INTO users (username, password_hash, totp_secret_enc, created_at) VALUES (?,?,?,?)')
      .run(username, pwHash, encrypt(config.secret, secret), nowIso());
    startSession(req, res, info.lastInsertRowid, true);
    audit(req, info.lastInsertRowid, 'setup', 'first user created');
    res.json({ totpSecret: secret, otpauth: otpauth(username, secret) });
  }));

  api.post('/login', route(async (req, res) => {
    const username = str(req.body?.username ?? '', 60);
    const key = `login:${req.ip}:${username.toLowerCase()}`;
    if (limited(key, 5, 15 * 60e3) || limited(`login-ip:${req.ip}`, 20, 15 * 60e3)) {
      audit(req, null, 'login_blocked', username);
      throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
    }
    const fail = () => { noteHit(key); noteHit(`login-ip:${req.ip}`); audit(req, null, 'login_failed', username); throw new HttpError(401, 'Incorrect username, password or code'); };
    const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
    const pw = typeof req.body?.password === 'string' ? req.body.password : '';
    // Always do one hash verification so timing does not reveal valid usernames.
    const ok = await argonVerify(user?.password_hash ?? '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$' + 'A'.repeat(43), pw).catch(() => false);
    if (!user || !ok) return fail();
    if (user.totp_enabled) {
      const step = verifyTotp(decrypt(config.secret, user.totp_secret_enc), req.body?.code, user.totp_last_step);
      if (!step) return fail();
      db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, user.id);
      startSession(req, res, user.id, false);
      audit(req, user.id, 'login');
      return res.json({ ok: true });
    }
    // Two-step sign-in is mandatory: enrol before getting in.
    let secret;
    if (user.totp_secret_enc) secret = decrypt(config.secret, user.totp_secret_enc);
    else { secret = newTotpSecret(); db.prepare('UPDATE users SET totp_secret_enc = ? WHERE id = ?').run(encrypt(config.secret, secret), user.id); }
    startSession(req, res, user.id, true);
    audit(req, user.id, 'login_enrol');
    res.json({ enrol: true, totpSecret: secret, otpauth: otpauth(user.username, secret) });
  }));

  api.post('/totp/enable', route((req, res) => {
    const s = req.session;
    if (!s || !s.pending) throw new HttpError(401, 'Sign in required');
    if (!csrfOk(req)) throw new HttpError(403, 'Bad CSRF token');
    if (limited(`totp:${s.user_id}`, 10, 15 * 60e3)) throw new HttpError(429, 'Too many attempts');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
    const step = verifyTotp(decrypt(config.secret, user.totp_secret_enc), req.body?.code, user.totp_last_step);
    if (!step) { noteHit(`totp:${s.user_id}`); throw bad('That code did not match. Check the clock on your phone and try again.'); }
    db.prepare('UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?').run(step, user.id);
    db.prepare('UPDATE sessions SET pending = 0 WHERE id_hash = ?').run(s.id_hash);
    audit(req, user.id, 'totp_enabled');
    res.json({ ok: true });
  }));

  api.post('/logout', route((req, res) => {
    if (req.session) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(req.session.id_hash);
    setCookie(res, '', 0);
    res.json({ ok: true });
  }));

  api.post('/stepup', requireAuth, route(async (req, res) => {
    if (limited(`stepup:${req.session.user_id}`, 5, 15 * 60e3)) throw new HttpError(429, 'Too many attempts');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user_id);
    const ok = await argonVerify(user.password_hash, String(req.body?.password ?? '')).catch(() => false);
    if (!ok) { noteHit(`stepup:${req.session.user_id}`); audit(req, user.id, 'stepup_failed'); throw new HttpError(401, 'Incorrect password'); }
    const until = new Date(Date.now() + 5 * 60e3).toISOString();
    db.prepare('UPDATE sessions SET stepup_until = ? WHERE id_hash = ?').run(until, req.session.id_hash);
    audit(req, user.id, 'stepup');
    res.json({ until });
  }));

  api.post('/password', requireAuth, requireStepUp, route(async (req, res) => {
    checkPassword(req.body?.newPassword);
    const pwHash = await argonHash(req.body.newPassword, argonOpts);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(pwHash, req.session.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?').run(req.session.user_id, req.session.id_hash);
    audit(req, req.session.user_id, 'password_changed');
    res.json({ ok: true });
  }));

  // ---------- accounts and valuations ----------
  const accountRow = (id) => {
    const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    if (!a) throw new HttpError(404, 'Account not found');
    return a;
  };
  const latestVal = db.prepare('SELECT as_of, value_cents FROM valuations WHERE account_id = ? ORDER BY as_of DESC LIMIT 1');

  api.get('/accounts', requireAuth, route((req, res) => {
    const rows = db.prepare('SELECT * FROM accounts ORDER BY active DESC, kind, name').all()
      .map((a) => ({ ...a, latest: latestVal.get(a.id) ?? null }));
    res.json({ accounts: rows, types: ACCOUNT_TYPES });
  }));

  api.post('/accounts', requireAuth, route((req, res) => {
    const b = req.body || {};
    const type = b.type;
    if (!ACCOUNT_TYPES[type]) throw bad('Unknown account type');
    const info = db.prepare('INSERT INTO accounts (name, institution, type, kind, owner, currency, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(str(b.name, 80), (b.institution ?? '').toString().slice(0, 80), type, ACCOUNT_TYPES[type], (b.owner ?? '').toString().slice(0, 60), 'CAD', nowIso());
    audit(req, req.session.user_id, 'account_created', String(info.lastInsertRowid));
    res.status(201).json({ id: info.lastInsertRowid });
  }));

  api.patch('/accounts/:id', requireAuth, route((req, res) => {
    const a = accountRow(+req.params.id);
    const b = req.body || {};
    db.prepare('UPDATE accounts SET name = ?, institution = ?, owner = ?, active = ? WHERE id = ?').run(
      b.name !== undefined ? str(b.name, 80) : a.name,
      b.institution !== undefined ? String(b.institution).slice(0, 80) : a.institution,
      b.owner !== undefined ? String(b.owner).slice(0, 60) : a.owner,
      b.active !== undefined ? (b.active ? 1 : 0) : a.active,
      a.id);
    res.json({ ok: true });
  }));

  api.get('/accounts/:id/valuations', requireAuth, route((req, res) => {
    accountRow(+req.params.id);
    res.json({ valuations: db.prepare('SELECT * FROM valuations WHERE account_id = ? ORDER BY as_of DESC LIMIT 500').all(+req.params.id) });
  }));

  api.post('/accounts/:id/valuations', requireAuth, route((req, res) => {
    const a = accountRow(+req.params.id);
    const as_of = req.body?.as_of;
    if (!isDate(as_of)) throw bad('Date must be YYYY-MM-DD');
    const cents = parseCents(req.body?.value);
    if (cents == null) throw bad('Enter the balance as a number');
    if (cents < 0) throw bad('Enter balances as positive numbers; the account type decides whether it counts as an asset or a debt');
    db.prepare(`INSERT INTO valuations (account_id, as_of, value_cents, source, note) VALUES (?,?,?,?,?)
      ON CONFLICT(account_id, as_of) DO UPDATE SET value_cents = excluded.value_cents, note = excluded.note`)
      .run(a.id, as_of, cents, 'manual', String(req.body?.note ?? '').slice(0, 200));
    res.status(201).json({ ok: true });
  }));

  api.delete('/valuations/:id', requireAuth, route((req, res) => {
    db.prepare('DELETE FROM valuations WHERE id = ?').run(+req.params.id);
    res.json({ ok: true });
  }));

  // ---------- categories and rules ----------
  api.get('/categories', requireAuth, route((req, res) => {
    res.json({
      categories: db.prepare('SELECT * FROM categories ORDER BY archived, kind, name').all(),
      rules: db.prepare('SELECT r.*, c.name AS category FROM rules r JOIN categories c ON c.id = r.category_id ORDER BY r.priority, r.id').all(),
    });
  }));
  api.post('/categories', requireAuth, route((req, res) => {
    const kind = req.body?.kind;
    if (!['expense', 'income', 'transfer'].includes(kind)) throw bad('Unknown category kind');
    try {
      const info = db.prepare('INSERT INTO categories (name, kind) VALUES (?,?)').run(str(req.body?.name, 60), kind);
      res.status(201).json({ id: info.lastInsertRowid });
    } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'That category already exists'); throw e; }
  }));
  api.patch('/categories/:id', requireAuth, route((req, res) => {
    const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(+req.params.id);
    if (!c) throw new HttpError(404, 'Category not found');
    db.prepare('UPDATE categories SET name = ?, archived = ? WHERE id = ?').run(
      req.body?.name !== undefined ? str(req.body.name, 60) : c.name, req.body?.archived !== undefined ? (req.body.archived ? 1 : 0) : c.archived, c.id);
    res.json({ ok: true });
  }));
  api.post('/rules', requireAuth, route((req, res) => {
    const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(+req.body?.category_id);
    if (!cat) throw bad('Choose a category');
    const info = db.prepare('INSERT INTO rules (pattern, category_id, priority) VALUES (?,?,?)').run(str(req.body?.pattern, 100), cat.id, Number.isInteger(req.body?.priority) ? req.body.priority : 100);
    res.status(201).json({ id: info.lastInsertRowid });
  }));
  api.delete('/rules/:id', requireAuth, route((req, res) => {
    db.prepare('DELETE FROM rules WHERE id = ?').run(+req.params.id);
    res.json({ ok: true });
  }));
  // Re-run rules over transactions that were never categorised by hand.
  const applyRules = () => {
    const rules = loadRules(db);
    const rows = db.prepare("SELECT id, description FROM transactions WHERE category_source != 'manual'").all();
    const upd = db.prepare("UPDATE transactions SET category_id = ?, category_source = ? WHERE id = ?");
    let changed = 0;
    db.transaction(() => {
      for (const r of rows) {
        const c = categorize(rules, r.description);
        upd.run(c, c ? 'rule' : 'none', r.id);
        changed++;
      }
    })();
    return changed;
  };
  api.post('/rules/apply', requireAuth, route((req, res) => res.json({ checked: applyRules() })));

  // ---------- imports ----------
  const bigBody = express.json({ limit: `${config.maxUploadMb}mb` });
  const prepareImport = (req) => {
    const account = accountRow(+req.body?.account_id);
    if (typeof req.body?.text !== 'string' || !req.body.text.trim()) throw bad('The file is empty');
    const parsed = parseStatement(req.body.text, req.body.mapping);
    if (!parsed.rows.length && !parsed.errors.length) throw bad('No transactions found');
    const existing = db.prepare('SELECT 1 FROM transactions WHERE account_id = ? AND hash = ? AND seq = ?');
    const rules = loadRules(db);
    for (const t of parsed.rows) {
      t.duplicate = !!existing.get(account.id, t.hash, t.seq);
      t.category_id = categorize(rules, t.description);
    }
    return { account, parsed };
  };

  api.post('/imports/preview', requireAuth, bigBody, route((req, res) => {
    const { parsed } = prepareImport(req);
    const fresh = parsed.rows.filter((r) => !r.duplicate);
    res.json({
      mapping: parsed.mapping, headers: parsed.headers,
      total: parsed.rows.length, newCount: fresh.length, duplicateCount: parsed.rows.length - fresh.length,
      categorised: fresh.filter((r) => r.category_id).length, errors: parsed.errors.slice(0, 50), errorCount: parsed.errors.length,
      sample: parsed.rows.slice(0, 25),
    });
  }));

  api.post('/imports', requireAuth, bigBody, route((req, res) => {
    const { account, parsed } = prepareImport(req);
    const fresh = parsed.rows.filter((r) => !r.duplicate);
    if (!fresh.length) throw bad('Nothing new to import');
    const result = db.transaction(() => {
      const b = db.prepare('INSERT INTO import_batches (account_id, filename, created_at, row_count, skipped_count) VALUES (?,?,?,?,?)')
        .run(account.id, String(req.body.filename ?? '').slice(0, 200), nowIso(), fresh.length, parsed.rows.length - fresh.length + parsed.errors.length);
      const ins = db.prepare('INSERT INTO transactions (account_id, batch_id, posted_on, description, amount_cents, category_id, category_source, hash, seq) VALUES (?,?,?,?,?,?,?,?,?)');
      for (const t of fresh) ins.run(account.id, b.lastInsertRowid, t.posted_on, t.description, t.amount_cents, t.category_id, t.category_id ? 'rule' : 'none', t.hash, t.seq);
      return b.lastInsertRowid;
    })();
    audit(req, req.session.user_id, 'import', `batch ${result}: ${fresh.length} rows`);
    log.info('statement imported', { batch: result, rows: fresh.length });
    res.status(201).json({ batch_id: result, imported: fresh.length, skipped: parsed.rows.length - fresh.length, errors: parsed.errors.length });
  }));

  api.get('/imports', requireAuth, route((req, res) => {
    res.json({ batches: db.prepare(`SELECT b.*, a.name AS account FROM import_batches b JOIN accounts a ON a.id = b.account_id ORDER BY b.id DESC LIMIT 200`).all() });
  }));

  // Rollback removes exactly the rows that batch created.
  api.delete('/imports/:id', requireAuth, route((req, res) => {
    const b = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(+req.params.id);
    if (!b) throw new HttpError(404, 'Import not found');
    db.transaction(() => {
      db.prepare('DELETE FROM transactions WHERE batch_id = ?').run(b.id);
      db.prepare('DELETE FROM import_batches WHERE id = ?').run(b.id);
    })();
    audit(req, req.session.user_id, 'import_rolled_back', `batch ${b.id}`);
    res.json({ ok: true, removed: b.row_count });
  }));

  // ---------- transactions ----------
  api.get('/transactions', requireAuth, route((req, res) => {
    const q = req.query, where = [], args = [];
    if (isDate(q.from)) { where.push('t.posted_on >= ?'); args.push(q.from); }
    if (isDate(q.to)) { where.push('t.posted_on <= ?'); args.push(q.to); }
    if (q.account) { where.push('t.account_id = ?'); args.push(+q.account); }
    if (q.category) { where.push('t.category_id = ?'); args.push(+q.category); }
    if (q.uncategorised === '1') where.push('t.category_id IS NULL');
    if (q.q) { where.push("t.description LIKE ? ESCAPE '\\'"); args.push('%' + String(q.q).replace(/[%_\\]/g, '\\$&') + '%'); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const limit = Math.min(Math.max(+q.limit || 100, 1), 500), offset = Math.max(+q.offset || 0, 0);
    const total = db.prepare(`SELECT COUNT(*) c FROM transactions t ${w}`).get(...args).c;
    const rows = db.prepare(`SELECT t.*, a.name AS account, c.name AS category FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id ${w} ORDER BY t.posted_on DESC, t.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    res.json({ total, transactions: rows });
  }));

  api.patch('/transactions/:id', requireAuth, route((req, res) => {
    const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(+req.params.id);
    if (!t) throw new HttpError(404, 'Transaction not found');
    const catId = req.body?.category_id === null ? null : +req.body?.category_id;
    if (catId !== null && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(catId)) throw bad('Choose a category');
    db.prepare("UPDATE transactions SET category_id = ?, category_source = ? WHERE id = ?").run(catId, catId === null ? 'none' : 'manual', t.id);
    let updated = 1;
    if (req.body?.rule_pattern && catId !== null) {
      const pat = str(req.body.rule_pattern, 100);
      db.prepare('INSERT INTO rules (pattern, category_id) VALUES (?,?)').run(pat, catId);
      updated += db.prepare("UPDATE transactions SET category_id = ?, category_source = 'rule' WHERE category_source = 'none' AND instr(lower(description), lower(?)) > 0").run(catId, pat).changes;
    }
    res.json({ updated });
  }));

  // ---------- reports ----------
  const monthRange = (tz) => {
    const t = todayLocal(tz);
    return { from: t.slice(0, 8) + '01', to: t };
  };

  api.get('/reports/spending', requireAuth, route((req, res) => {
    const def = monthRange(config.tz);
    const from = isDate(req.query.from) ? req.query.from : def.from;
    const to = isDate(req.query.to) ? req.query.to : def.to;
    const byCat = db.prepare(`
      SELECT c.id AS category_id, COALESCE(c.name, 'Uncategorised') AS name, COALESCE(c.kind, 'expense') AS kind,
             SUM(t.amount_cents) AS net_cents, COUNT(*) AS count
      FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.posted_on BETWEEN ? AND ? GROUP BY c.id ORDER BY net_cents`).all(from, to);
    // Spending = money out net of refunds in expense categories; transfers are ignored.
    const spend = byCat.filter((r) => r.kind === 'expense' && (r.net_cents < 0 || r.category_id === null))
      .map((r) => ({ category_id: r.category_id, name: r.name, spent_cents: -r.net_cents, count: r.count }))
      .filter((r) => r.spent_cents > 0).sort((a, b) => b.spent_cents - a.spent_cents);
    const income = byCat.filter((r) => r.kind === 'income' || (r.kind === 'expense' && r.net_cents > 0 && r.category_id !== null))
      .reduce((s, r) => s + r.net_cents, 0);
    const byMonth = db.prepare(`
      SELECT substr(t.posted_on,1,7) AS month,
             -SUM(CASE WHEN COALESCE(c.kind,'expense')='expense' THEN t.amount_cents ELSE 0 END) AS spent_cents,
             SUM(CASE WHEN c.kind='income' THEN t.amount_cents ELSE 0 END) AS income_cents
      FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.posted_on BETWEEN ? AND ? GROUP BY month ORDER BY month`).all(from, to);
    const uncategorised = db.prepare('SELECT COUNT(*) c FROM transactions WHERE category_id IS NULL').get().c;
    res.json({ from, to, total_spent_cents: spend.reduce((s, r) => s + r.spent_cents, 0), income_cents: income, categories: spend, months: byMonth, uncategorised });
  }));

  const netWorthSeries = () => {
    const accounts = db.prepare('SELECT id, kind FROM accounts').all();
    const vals = db.prepare('SELECT account_id, as_of, value_cents FROM valuations ORDER BY as_of').all();
    const byAcc = new Map();
    for (const v of vals) { if (!byAcc.has(v.account_id)) byAcc.set(v.account_id, []); byAcc.get(v.account_id).push(v); }
    const today = todayLocal(config.tz);
    const points = [];
    const [ty, tm] = today.split('-').map(Number);
    for (let i = 23; i >= 0; i--) {
      const d = new Date(Date.UTC(ty, tm - 1 - i + 1, 0)); // last day of that month
      const day = d.toISOString().slice(0, 10);
      points.push(day > today ? today : day);
    }
    const at = (date) => {
      let assets = 0, liabilities = 0;
      for (const a of accounts) {
        const list = byAcc.get(a.id) || [];
        let last = null;
        for (const v of list) { if (v.as_of <= date) last = v; else break; }
        if (!last) continue;
        if (a.kind === 'asset') assets += last.value_cents; else liabilities += last.value_cents;
      }
      return { date, assets_cents: assets, liabilities_cents: liabilities, net_cents: assets - liabilities };
    };
    const series = points.map(at);
    const first = series.findIndex((p) => p.assets_cents || p.liabilities_cents);
    return { current: at(today), series: first < 0 ? [] : series.slice(first) };
  };
  api.get('/reports/networth', requireAuth, route((req, res) => res.json(netWorthSeries())));

  api.get('/overview', requireAuth, route((req, res) => {
    const nw = netWorthSeries();
    const rng = monthRange(config.tz);
    const spent = db.prepare(`SELECT -COALESCE(SUM(t.amount_cents),0) AS s FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.posted_on BETWEEN ? AND ? AND COALESCE(c.kind,'expense')='expense'`).get(rng.from, rng.to).s;
    res.json({
      networth: nw.current, series: nw.series, month: { from: rng.from, to: rng.to, spent_cents: spent },
      uncategorised: db.prepare('SELECT COUNT(*) c FROM transactions WHERE category_id IS NULL').get().c,
      accounts: db.prepare('SELECT COUNT(*) c FROM accounts WHERE active = 1').get().c,
      lastImport: db.prepare('SELECT created_at FROM import_batches ORDER BY id DESC LIMIT 1').get()?.created_at ?? null,
    });
  }));

  // ---------- export (needs recent password re-entry) ----------
  api.get('/export.json', requireAuth, requireStepUp, route((req, res) => {
    audit(req, req.session.user_id, 'export', 'json');
    const dump = {};
    for (const t of ['accounts', 'valuations', 'categories', 'rules', 'import_batches', 'transactions']) dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
    res.set('Content-Disposition', 'attachment; filename="finance-hub-export.json"').json({ app: 'finance-hub', version: config.version, exported_at: nowIso(), ...dump });
  }));
  api.get('/export/transactions.csv', requireAuth, requireStepUp, route((req, res) => {
    audit(req, req.session.user_id, 'export', 'transactions csv');
    const rows = db.prepare('SELECT t.posted_on, a.name, t.description, t.amount_cents, COALESCE(c.name,\'\') FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.id=t.category_id ORDER BY t.posted_on, t.id').all();
    const out = [['date', 'account', 'description', 'amount', 'category'], ...Object.values(rows).map((r) => { const v = Object.values(r); v[3] = (v[3] / 100).toFixed(2); return v; })];
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="transactions.csv"').send(toCsv(out));
  }));

  api.get('/audit', requireAuth, route((req, res) => {
    res.json({ entries: db.prepare('SELECT at, action, detail, ip FROM audit_log ORDER BY id DESC LIMIT 200').all() });
  }));

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // ---------- SPA fallback ----------
  app.get('*', (req, res) => {
    res.set('Cache-Control', 'no-cache').sendFile(path.join(pub, 'index.html'));
  });
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: `File is larger than the ${config.maxUploadMb} MB limit` });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request body' });
    log.error('unhandled error', { err: err.message });
    res.status(500).json({ error: 'Something went wrong' });
  });

  app.locals.seedAdmin = () => {
    if (userCount() === 0 && config.adminUsername && config.adminPasswordHash) {
      db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)').run(config.adminUsername, config.adminPasswordHash, nowIso());
      log.info('admin user created from environment; two-step enrolment happens at first sign-in');
    }
  };
  app.locals.applyRules = applyRules;
  return app;
}
