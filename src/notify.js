// Turns upcoming events into notifications: an inbox entry always, plus e-mail and web push when switched on.
import nodemailer from 'nodemailer';
import webpush from 'web-push';
import { buildEvents, KINDS } from './events.js';
import { addDays, daysBetween } from './dates.js';

export function createNotifier({ db, config, log, view, today, nowIso }) {
  const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null;
  const setSetting = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);

  const prefs = () => {
    const rows = new Map(db.prepare('SELECT * FROM notify_prefs').all().map((r) => [r.kind, r]));
    return Object.entries(KINDS).filter(([, v]) => !v.history).map(([kind, v]) => {
      const r = rows.get(kind);
      return { kind, label: v.label, enabled: r ? !!r.enabled : true, lead_days: r ? r.lead_days : v.lead, email: r ? !!r.email : false, push: r ? !!r.push : false };
    });
  };
  const savePref = (kind, p) => {
    if (!KINDS[kind] || KINDS[kind].history) throw new Error('Unknown kind');
    const lead = Number(p.lead_days);
    if (!Number.isInteger(lead) || lead < 0 || lead > 365) throw new Error('Lead days must be 0 to 365');
    db.prepare('INSERT INTO notify_prefs (kind, enabled, lead_days, email, push) VALUES (?,?,?,?,?) ON CONFLICT(kind) DO UPDATE SET enabled = excluded.enabled, lead_days = excluded.lead_days, email = excluded.email, push = excluded.push')
      .run(kind, p.enabled ? 1 : 0, lead, p.email ? 1 : 0, p.push ? 1 : 0);
  };

  const smtpReady = () => !!(config.smtp.host && config.smtp.from);
  let transport = null;
  const mail = async (to, subject, text) => {
    if (!smtpReady() || !to) return false;
    transport ||= nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined });
    await transport.sendMail({ from: config.smtp.from, to, subject, text });
    return true;
  };

  // ---- web push: keys are made once and kept in the database
  const vapid = () => {
    let v = getSetting('vapid');
    if (!v) { v = JSON.stringify(webpush.generateVAPIDKeys()); setSetting('vapid', v); }
    const k = JSON.parse(v);
    webpush.setVapidDetails(`mailto:${config.smtp.from || 'admin@localhost.invalid'}`, k.publicKey, k.privateKey);
    return k;
  };
  const push = async (payload) => {
    vapid();
    let n = 0;
    for (const s of db.prepare('SELECT * FROM push_subs').all()) {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload)); n++; } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE id = ?').run(s.id); else log.warn('push failed', { err: e.message });
      }
    }
    return n;
  };

  const run = async () => {
    const t = today();
    const events = buildEvents({ cards: view('cards'), accounts: view('accounts'), recurring: view('recurring') }, t, addDays(t, 120));
    const pm = new Map(prefs().map((p) => [p.kind, p]));
    const to = getSetting('notify_email');
    let created = 0;
    for (const ev of events) {
      const p = pm.get(ev.kind);
      if (!p || !p.enabled || daysBetween(t, ev.date) > p.lead_days) continue;
      const r = db.prepare('INSERT OR IGNORE INTO notifications (key, kind, title, body, event_date, created_at) VALUES (?,?,?,?,?,?)').run(ev.key, ev.kind, ev.title, ev.detail, ev.date, nowIso());
      if (!r.changes) continue;
      created++;
      const id = r.lastInsertRowid;
      const when = ev.date === t ? 'today' : `on ${ev.date}`;
      if (p.email) { try { if (await mail(to, ev.title, `${ev.title} ${when}.\n${ev.detail}`.trim())) db.prepare('UPDATE notifications SET emailed = 1 WHERE id = ?').run(id); } catch (e) { log.warn('e-mail failed', { err: e.message }); } }
      if (p.push) { try { if (await push({ title: ev.title, body: `${when}. ${ev.detail}`.trim(), url: '/cards?tab=reminders' })) db.prepare('UPDATE notifications SET pushed = 1 WHERE id = ?').run(id); } catch (e) { log.warn('push failed', { err: e.message }); } }
    }
    return { created };
  };
  return { prefs, savePref, getSetting, setSetting, smtpReady, mail, vapid, push, run };
}
