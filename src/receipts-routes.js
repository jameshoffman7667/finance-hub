// Receipts from paperless-ngx linked to card transactions.
import { fetchDocuments, matchAll } from './paperless.js';
import { addDays } from './dates.js';

export function mountReceipts({ api, db, config, requireAuth, route, bad, HttpError, today, audit, nowIso, notifier, fetchImpl = fetch }) {
  const p = config.paperless;
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const docUrl = (id) => (p.publicUrl ? `${p.publicUrl}/documents/${id}/details` : null);
  const cardTxns = () => all("SELECT t.id, t.account_id, t.posted_on, t.description, t.amount_cents FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.type = 'credit_card'");

  api.get('/receipts/status', requireAuth, route((req, res) => {
    const c = (s) => db.prepare(`SELECT COUNT(*) n FROM receipt_links WHERE status = ?`).get(s).n;
    res.json({ configured: !!(p.url && p.token), docs: db.prepare('SELECT COUNT(*) n FROM paperless_docs').get().n, linked: c('linked') + c('manual'), to_review: c('suggested'), last_sync: notifier.getSetting('paperless_last_sync'), total_field: p.totalField });
  }));

  api.post('/receipts/sync', requireAuth, route(async (req, res) => {
    const since = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.since || '') ? req.body.since : addDays(today(), -400);
    let docs;
    try { docs = await fetchDocuments({ url: p.url, token: p.token, totalField: p.totalField, since, fetchImpl }); } catch (e) { throw bad(e.message); }
    const t = nowIso();
    db.transaction(() => {
      const up = db.prepare('INSERT INTO paperless_docs (id, title, correspondent, doc_date, total_cents, notes, fetched_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, correspondent=excluded.correspondent, doc_date=excluded.doc_date, total_cents=excluded.total_cents, notes=excluded.notes, fetched_at=excluded.fetched_at');
      for (const d of docs) up.run(d.id, d.title, d.correspondent, d.doc_date, d.total_cents, d.notes, t);
      // Suggestions are recomputed each time; decisions (linked by you, rejected) are never touched.
      db.prepare("DELETE FROM receipt_links WHERE status IN ('suggested','linked') AND score IS NOT NULL").run();
    })();
    const stored = all('SELECT * FROM paperless_docs');
    const decided = all("SELECT transaction_id, doc_id, status FROM receipt_links WHERE status IN ('manual','rejected','accepted')");
    const taken = { txn: new Set(decided.filter((x) => x.status !== 'rejected').map((x) => x.transaction_id)), doc: new Set(decided.filter((x) => x.status !== 'rejected').map((x) => x.doc_id)) };
    const rejected = new Set(decided.filter((x) => x.status === 'rejected').map((x) => `${x.transaction_id}:${x.doc_id}`));
    const matches = matchAll(cardTxns(), stored.filter(() => true), taken).filter((m) => !rejected.has(`${m.transaction_id}:${m.doc_id}`));
    const ins = db.prepare('INSERT OR IGNORE INTO receipt_links (transaction_id, doc_id, status, score, decided_at) VALUES (?,?,?,?,?)');
    db.transaction(() => { for (const m of matches) ins.run(m.transaction_id, m.doc_id, m.status, m.score, t); })();
    notifier.setSetting('paperless_last_sync', t);
    audit(req, req.session.user_id, 'receipts.sync', `${docs.length} documents`);
    res.json({ documents: docs.length, without_total: docs.filter((d) => d.total_cents == null).length, linked: matches.filter((m) => m.status === 'linked').length, to_review: matches.filter((m) => m.status === 'suggested').length });
  }));

  const linkRows = (where, ...a) => all(`SELECT l.id, l.status, l.score, l.transaction_id, l.doc_id, t.posted_on, t.description, t.amount_cents, d.title, d.correspondent, d.doc_date, d.total_cents FROM receipt_links l JOIN transactions t ON t.id = l.transaction_id LEFT JOIN paperless_docs d ON d.id = l.doc_id ${where} ORDER BY t.posted_on DESC`, ...a).map((r) => ({ ...r, url: docUrl(r.doc_id) }));
  api.get('/receipts/review', requireAuth, route((req, res) => res.json({ items: linkRows("WHERE l.status = 'suggested'") })));
  api.get('/receipts/linked', requireAuth, route((req, res) => res.json({ items: linkRows("WHERE l.status IN ('linked','manual','accepted')").slice(0, 500) })));
  api.post('/receipts/links/:id/accept', requireAuth, route((req, res) => {
    const r = db.prepare("UPDATE receipt_links SET status = 'manual', decided_at = ? WHERE id = ? AND status IN ('suggested','linked')").run(nowIso(), +req.params.id);
    if (!r.changes) throw new HttpError(404, 'Not found'); res.json({ ok: true });
  }));
  api.post('/receipts/links/:id/reject', requireAuth, route((req, res) => {
    const r = db.prepare("UPDATE receipt_links SET status = 'rejected', decided_at = ? WHERE id = ?").run(nowIso(), +req.params.id);
    if (!r.changes) throw new HttpError(404, 'Not found'); res.json({ ok: true });
  }));
  api.post('/receipts/link', requireAuth, route((req, res) => {
    const tid = +req.body?.transaction_id, did = +req.body?.doc_id;
    if (!db.prepare('SELECT 1 FROM transactions WHERE id = ?').get(tid)) throw new HttpError(404, 'Transaction not found');
    if (!db.prepare('SELECT 1 FROM paperless_docs WHERE id = ?').get(did)) throw new HttpError(404, 'Receipt not found (sync first)');
    db.transaction(() => { db.prepare("DELETE FROM receipt_links WHERE transaction_id = ? AND status IN ('suggested','linked')").run(tid); db.prepare("INSERT INTO receipt_links (transaction_id, doc_id, status, score, decided_at) VALUES (?,?, 'manual', NULL, ?) ON CONFLICT(transaction_id, doc_id) DO UPDATE SET status = 'manual', decided_at = excluded.decided_at").run(tid, did, nowIso()); })();
    res.status(201).json({ ok: true });
  }));
  api.delete('/receipts/links/:id', requireAuth, route((req, res) => {
    if (!db.prepare('DELETE FROM receipt_links WHERE id = ?').run(+req.params.id).changes) throw new HttpError(404, 'Not found'); res.json({ ok: true });
  }));
  api.get('/receipts/unmatched', requireAuth, route((req, res) => {
    const min = Math.max(0, Math.round(Number(req.query.min_cents) || 0));
    const charges = all(`SELECT t.id, t.posted_on, t.description, t.amount_cents FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.type = 'credit_card' AND t.amount_cents < 0 AND -t.amount_cents >= ? AND NOT EXISTS (SELECT 1 FROM receipt_links l WHERE l.transaction_id = t.id AND l.status IN ('linked','manual','accepted')) ORDER BY t.posted_on DESC LIMIT 300`, min);
    const docs = all("SELECT d.id, d.title, d.correspondent, d.doc_date, d.total_cents FROM paperless_docs d WHERE NOT EXISTS (SELECT 1 FROM receipt_links l WHERE l.doc_id = d.id AND l.status IN ('linked','manual','accepted')) ORDER BY d.doc_date DESC LIMIT 300").map((d) => ({ ...d, url: docUrl(d.id) }));
    res.json({ charges, documents: docs });
  }));
}
