// Lists you can manage in Settings: institutions, owners, categories and sub-categories; deleting accounts.
import { SUGGESTED_SUBS } from './suggestions.js';
import { GROUPS } from './wealth.js';

export const TYPE_LABELS = { chequing: 'Chequing', savings: 'Savings', investment: 'Investment (non-registered)', registered: 'Registered (RRSP, TFSA, FHSA…)', property: 'Property', other_asset: 'Other asset', credit_card: 'Credit card', loan: 'Loan', mortgage: 'Mortgage', line_of_credit: 'Line of credit', other_liability: 'Other debt' };
export const accountLabel = (a) => [a.name, a.institution, TYPE_LABELS[a.type] || a.type, a.owner].filter((x) => x && String(x).trim()).join(', ');

export function mountLists({ api, db, requireAuth, route, bad, HttpError, audit, nowIso }) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const name = (v, max = 60) => { const s = String(v ?? '').trim().replace(/\s+/g, ' '); if (!s) throw bad('Enter a name'); if (s.length > max) throw bad(`Keep it to ${max} characters`); return s; };
  const unique = (fn) => { try { return fn(); } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'That name already exists'); throw e; } };

  // ---- accounts: usage and delete ----
  const usage = (id) => ({
    transactions: one('SELECT COUNT(*) n FROM transactions WHERE account_id = ?', id).n,
    valuations: one('SELECT COUNT(*) n FROM valuations WHERE account_id = ?', id).n,
    imports: one('SELECT COUNT(*) n FROM import_batches WHERE account_id = ?', id).n,
    receipt_links: one('SELECT COUNT(*) n FROM receipt_links WHERE transaction_id IN (SELECT id FROM transactions WHERE account_id = ?)', id).n,
  });
  api.get('/accounts/:id/usage', requireAuth, route((req, res) => {
    if (!one('SELECT 1 FROM accounts WHERE id = ?', +req.params.id)) throw new HttpError(404, 'Account not found');
    const u = usage(+req.params.id); res.json({ ...u, has_data: u.transactions + u.valuations + u.imports > 0 });
  }));
  api.delete('/accounts/:id', requireAuth, route((req, res) => {
    const a = one('SELECT * FROM accounts WHERE id = ?', +req.params.id); if (!a) throw new HttpError(404, 'Account not found');
    const u = usage(a.id);
    if (u.transactions + u.valuations + u.imports > 0 && req.body?.delete_data !== true) throw new HttpError(409, 'This account has data. Close it instead, or confirm deleting everything attached.');
    db.transaction(() => {
      db.prepare('DELETE FROM transactions WHERE account_id = ?').run(a.id);
      db.prepare('DELETE FROM import_batches WHERE account_id = ?').run(a.id);
      db.prepare('DELETE FROM valuations WHERE account_id = ?').run(a.id);
      db.prepare('DELETE FROM accounts WHERE id = ?').run(a.id);
    })();
    audit(req, req.session.user_id, 'account_deleted', `${a.id} (${u.transactions} transactions, ${u.valuations} balances)`);
    res.json({ ok: true, removed: u });
  }));

  // ---- lists overview ----
  const subRows = () => all(`SELECT s.id, s.category_id, s.name, s.flow_group, (SELECT COUNT(*) FROM transactions t WHERE t.subcategory_id = s.id) AS count FROM subcategories s ORDER BY s.name`);
  api.get('/lists', requireAuth, route((req, res) => {
    const subs = subRows();
    res.json({
      institutions: all("SELECT institution AS value, COUNT(*) AS count FROM accounts WHERE institution != '' GROUP BY institution ORDER BY lower(institution)"),
      owners: all("SELECT owner AS value, COUNT(*) AS count FROM accounts WHERE owner != '' GROUP BY owner ORDER BY lower(owner)"),
      categories: all('SELECT c.id, c.name, c.kind, c.archived, c.flow_group, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS count, (SELECT COUNT(*) FROM rules r WHERE r.category_id = c.id) AS rules FROM categories c ORDER BY c.kind, c.name')
        .map((c) => ({ ...c, subs: subs.filter((s) => s.category_id === c.id), suggested: (SUGGESTED_SUBS[c.name] || []).filter((n) => !subs.some((s) => s.category_id === c.id && s.name.toLowerCase() === n.toLowerCase())) })),
      groups: Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, g.label])),
    });
  }));

  // ---- institution and owner values (they live on the accounts) ----
  const col = (l) => { if (l === 'institution') return ['institution', 80]; if (l === 'owner') return ['owner', 60]; throw new HttpError(404, 'Unknown list'); };
  api.post('/lists/:list/rename', requireAuth, route((req, res) => {
    const [c, max] = col(req.params.list); const to = name(req.body?.to, max); const from = String(req.body?.from ?? '');
    const r = db.prepare(`UPDATE accounts SET ${c} = ? WHERE ${c} = ?`).run(to, from);
    if (!r.changes) throw new HttpError(404, 'No account uses that value'); res.json({ updated: r.changes });
  }));
  api.post('/lists/:list/remove', requireAuth, route((req, res) => {
    const [c, max] = col(req.params.list); const from = String(req.body?.value ?? '');
    const to = req.body?.move_to == null || req.body.move_to === '' ? '' : name(req.body.move_to, max);
    if (to === from) throw bad('Choose a different value');
    const r = db.prepare(`UPDATE accounts SET ${c} = ? WHERE ${c} = ?`).run(to, from); res.json({ updated: r.changes });
  }));

  // ---- categories: rename, archive, delete with a decision ----
  api.delete('/categories/:id', requireAuth, route((req, res) => {
    const c = one('SELECT * FROM categories WHERE id = ?', +req.params.id); if (!c) throw new HttpError(404, 'Category not found');
    const moveTo = req.body?.move_to == null || req.body.move_to === '' ? null : +req.body.move_to;
    if (moveTo === c.id) throw bad('Choose a different category');
    let target = null;
    if (moveTo != null) { target = one('SELECT * FROM categories WHERE id = ?', moveTo); if (!target) throw bad('That category does not exist'); }
    const counts = { transactions: one('SELECT COUNT(*) n FROM transactions WHERE category_id = ?', c.id).n, rules: one('SELECT COUNT(*) n FROM rules WHERE category_id = ?', c.id).n };
    db.transaction(() => {
      db.prepare("UPDATE transactions SET category_id = ?, subcategory_id = NULL, category_source = ? WHERE category_id = ?").run(target?.id ?? null, target ? 'manual' : 'none', c.id);
      if (target) db.prepare('UPDATE rules SET category_id = ?, subcategory_id = NULL WHERE category_id = ?').run(target.id, c.id); else db.prepare('DELETE FROM rules WHERE category_id = ?').run(c.id);
      db.prepare('UPDATE categories SET nets_into_id = NULL WHERE nets_into_id = ?').run(c.id);
      db.prepare('DELETE FROM categories WHERE id = ?').run(c.id);
    })();
    audit(req, req.session.user_id, 'category_deleted', `${c.name}: ${counts.transactions} transactions ${target ? 'moved to ' + target.name : 'left uncategorised'}`);
    res.json({ ok: true, ...counts });
  }));

  // ---- sub-categories (optional, one level) ----
  const groupOf = (g) => { if (g == null || g === '') return null; if (!(g in GROUPS)) throw bad('Unknown cash flow group'); return g; };
  api.post('/subcategories', requireAuth, route((req, res) => {
    const cat = one('SELECT id FROM categories WHERE id = ?', +req.body?.category_id); if (!cat) throw bad('Choose a category');
    const info = unique(() => db.prepare('INSERT INTO subcategories (category_id, name, flow_group) VALUES (?,?,?)').run(cat.id, name(req.body?.name), groupOf(req.body?.flow_group)));
    res.status(201).json({ id: info.lastInsertRowid });
  }));
  api.patch('/subcategories/:id', requireAuth, route((req, res) => {
    const s = one('SELECT * FROM subcategories WHERE id = ?', +req.params.id); if (!s) throw new HttpError(404, 'Not found');
    unique(() => db.prepare('UPDATE subcategories SET name = ?, flow_group = ? WHERE id = ?').run(req.body?.name !== undefined ? name(req.body.name) : s.name, req.body?.flow_group !== undefined ? groupOf(req.body.flow_group) : s.flow_group, s.id));
    res.json({ ok: true });
  }));
  api.delete('/subcategories/:id', requireAuth, route((req, res) => {
    const s = one('SELECT * FROM subcategories WHERE id = ?', +req.params.id); if (!s) throw new HttpError(404, 'Not found');
    const moveTo = req.body?.move_to == null || req.body.move_to === '' ? null : +req.body.move_to;
    if (moveTo != null && !one('SELECT 1 FROM subcategories WHERE id = ? AND category_id = ? AND id != ?', moveTo, s.category_id, s.id)) throw bad('Choose another sub-category of the same category');
    const n = one('SELECT COUNT(*) n FROM transactions WHERE subcategory_id = ?', s.id).n;
    db.transaction(() => {
      db.prepare('UPDATE transactions SET subcategory_id = ? WHERE subcategory_id = ?').run(moveTo, s.id);
      db.prepare('UPDATE rules SET subcategory_id = ? WHERE subcategory_id = ?').run(moveTo, s.id);
      db.prepare('DELETE FROM subcategories WHERE id = ?').run(s.id);
    })();
    res.json({ ok: true, transactions: n });
  }));
  api.post('/categories/:id/suggested', requireAuth, route((req, res) => {
    const c = one('SELECT * FROM categories WHERE id = ?', +req.params.id); if (!c) throw new HttpError(404, 'Category not found');
    const ins = db.prepare('INSERT OR IGNORE INTO subcategories (category_id, name) VALUES (?,?)'); let added = 0;
    db.transaction(() => { for (const n of SUGGESTED_SUBS[c.name] || []) added += ins.run(c.id, n).changes; })();
    res.json({ added });
  }));
}
