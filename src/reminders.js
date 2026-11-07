// Calendar, .ics feed, notification inbox and settings, statement analysis.
import crypto from 'node:crypto';
import { buildEvents, toIcs, KINDS } from './events.js';
import { addDays } from './dates.js';
import { analyzeStatement } from './statements.js';

export function mountReminders({ bigBody, app, api, db, config, requireAuth, route, bad, HttpError, today, audit, nowIso, notifier, view }) {
  const ensureToken = () => {
    let t = notifier.getSetting('ical_token');
    if (!t) { t = crypto.randomBytes(24).toString('hex'); notifier.setSetting('ical_token', t); }
    return t;
  };
  const events = (from, to) => buildEvents({ cards: view('cards'), accounts: view('accounts'), recurring: view('recurring'), planSteps: view('plan_steps') }, from, to);

  // The feed has no sign-in: the long random address is the secret. Titles carry no amounts.
  app.get('/cal/:token.ics', (req, res) => {
    const t = notifier.getSetting('ical_token');
    const a = Buffer.from(req.params.token), b = Buffer.from(t || '');
    if (!t || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(404).type('text/plain').send('Not found');
    const now = today();
    res.set({ 'Cache-Control': 'private, max-age=300', 'Content-Type': 'text/calendar; charset=utf-8' }).send(toIcs(events(addDays(now, -30), addDays(now, 540))));
  });

  api.get('/calendar', requireAuth, route((req, res) => {
    const from = req.query.from, to = req.query.to;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || to < from) throw bad('from and to must be dates');
    res.json({ events: events(from, to).slice(0, 2000), kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.label])) });
  }));
  api.get('/calendar/feed', requireAuth, route((req, res) => {
    const base = config.appUrl || `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${base.replace(/\/$/, '')}/cal/${ensureToken()}.ics` });
  }));
  api.post('/calendar/feed/rotate', requireAuth, route((req, res) => {
    notifier.setSetting('ical_token', crypto.randomBytes(24).toString('hex'));
    audit(req, req.session.user_id, 'calendar.feed_rotated', '');
    const base = config.appUrl || `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${base.replace(/\/$/, '')}/cal/${ensureToken()}.ics` });
  }));

  // ---- notifications
  api.get('/notifications', requireAuth, route((req, res) => {
    const items = db.prepare('SELECT * FROM notifications ORDER BY (read_at IS NULL) DESC, event_date, id DESC LIMIT 200').all();
    res.json({ items, unread: items.filter((i) => !i.read_at).length });
  }));
  api.post('/notifications/read-all', requireAuth, route((req, res) => { db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(nowIso()); res.json({ ok: true }); }));
  api.post('/notifications/run', requireAuth, route(async (req, res) => res.json(await notifier.run())));
  api.post('/notifications/:id/read', requireAuth, route((req, res) => { db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(nowIso(), +req.params.id); res.json({ ok: true }); }));
  api.get('/notifications/settings', requireAuth, route((req, res) => res.json({ prefs: notifier.prefs(), email: notifier.getSetting('notify_email') || '', smtp_configured: notifier.smtpReady(), push_subscriptions: db.prepare('SELECT COUNT(*) n FROM push_subs').get().n })));
  api.put('/notifications/settings', requireAuth, route((req, res) => {
    const b = req.body || {};
    if (b.email !== undefined) {
      const e = String(b.email).trim();
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('That does not look like an e-mail address');
      notifier.setSetting('notify_email', e);
    }
    try { for (const p of b.prefs || []) notifier.savePref(p.kind, p); } catch (e) { throw bad(e.message); }
    res.json({ ok: true });
  }));
  api.post('/notifications/test-email', requireAuth, route(async (req, res) => {
    if (!notifier.smtpReady()) throw bad('E-mail is not set up on the server (SMTP_HOST and SMTP_FROM)');
    const to = notifier.getSetting('notify_email');
    if (!to) throw bad('Enter an e-mail address first');
    try { await notifier.mail(to, 'Finance Hub test', 'Reminders by e-mail are working.'); } catch (e) { throw new HttpError(502, `Could not send: ${e.message}`); }
    res.json({ ok: true });
  }));
  api.get('/push/key', requireAuth, route((req, res) => res.json({ key: notifier.vapid().publicKey })));
  api.post('/push/subscribe', requireAuth, route((req, res) => {
    const s = req.body || {};
    if (typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) throw bad('Not a valid push subscription');
    db.prepare('INSERT INTO push_subs (endpoint, p256dh, auth, created_at) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth').run(s.endpoint, s.keys.p256dh, s.keys.auth, nowIso());
    res.json({ ok: true });
  }));
  api.post('/push/unsubscribe', requireAuth, route((req, res) => { db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(String(req.body?.endpoint || '')); res.json({ ok: true }); }));

  // ---- statements
  api.post('/offers/cards/:id/statement/analyze', requireAuth, bigBody, route((req, res) => {
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(+req.params.id);
    if (!card) throw new HttpError(404, 'Not found');
    const csv = req.body?.csv;
    if (typeof csv !== 'string' || csv.length < 10) throw bad('Choose a statement CSV');
    if (csv.length > 5_000_000) throw bad('That file is too large');
    let r;
    try { r = analyzeStatement(csv, { since: card.approved_on || null, charges: ['positive', 'negative'].includes(req.body.charges) ? req.body.charges : 'auto', dateOrder: ['YMD', 'DMY', 'MDY'].includes(req.body.date_order) ? req.body.date_order : 'YMD' }); } catch (e) { throw bad(e.message); }
    const overlap = r.period ? db.prepare('SELECT period_from, period_to FROM statement_runs WHERE card_id = ? AND period_from <= ? AND period_to >= ?').all(card.id, r.period.to, r.period.from) : [];
    res.json({ ...r, already_counted: overlap, current_progress_cents: card.spend_progress_cents || 0 });
  }));
  api.post('/offers/cards/:id/statement/apply', requireAuth, route((req, res) => {
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(+req.params.id);
    if (!card) throw new HttpError(404, 'Not found');
    const b = req.body || {};
    const spend = Number(b.spend_cents), from = b.period_from, to = b.period_to;
    if (!Number.isInteger(spend) || spend < 0) throw bad('spend_cents must be a whole number of cents');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw bad('period dates are required');
    const out = { spend_added: false, awarded: false, recurring_added: 0 };
    db.transaction(() => {
      if (b.add_spend) {
        const clash = db.prepare('SELECT 1 FROM statement_runs WHERE card_id = ? AND period_from <= ? AND period_to >= ?').get(card.id, to, from);
        if (clash && !b.force) throw new HttpError(409, 'This period overlaps a statement already counted for this card');
        db.prepare('INSERT INTO statement_runs (card_id, period_from, period_to, spend_cents, lines, applied_at) VALUES (?,?,?,?,?,?)').run(card.id, from, to, spend, Number(b.lines) || 0, nowIso());
        db.prepare('UPDATE cards SET spend_progress_cents = COALESCE(spend_progress_cents, 0) + ?, spend_as_of = MAX(COALESCE(spend_as_of, ?), ?), unconfirmed = ? WHERE id = ?')
          .run(spend, to, to, JSON.stringify(JSON.parse(card.unconfirmed || '[]').filter((k) => !['spend_progress_cents', 'spend_as_of'].includes(k))), card.id);
        out.spend_added = true;
      }
      if (b.award_date && /^\d{4}-\d{2}-\d{2}$/.test(b.award_date)) {
        const open = db.prepare("SELECT id FROM card_bonuses WHERE card_id = ? AND outcome = 'in_progress' ORDER BY slot LIMIT 1").get(card.id);
        if (open) { db.prepare("UPDATE card_bonuses SET outcome = 'earned', received_on = ? WHERE id = ?").run(b.award_date, open.id); out.awarded = true; }
      }
      for (const r of Array.isArray(b.recurring) ? b.recurring.slice(0, 50) : []) {
        const name = String(r.name || '').trim().slice(0, 100);
        const cents = Number(r.amount_cents);
        if (!name || !Number.isInteger(cents) || cents <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(r.anchor_date || '')) continue;
        if (db.prepare('SELECT 1 FROM recurring WHERE lower(name) = lower(?)').get(name)) continue;
        db.prepare("INSERT INTO recurring (name, amount_cents, currency, frequency, anchor_date, card_id, status, auto_pay, unconfirmed) VALUES (?,?,?,?,?,?,'active',NULL,'[\"amount_cents\",\"frequency\"]')").run(name, cents, 'CAD', 'monthly', r.anchor_date, card.id);
        out.recurring_added++;
      }
    })();
    audit(req, req.session.user_id, 'statement.apply', String(card.id));
    res.json(out);
  }));
}
