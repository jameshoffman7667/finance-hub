// Offer planner and bonus ledger: settings, comparison, plans, effort and reports.
import { DEFAULTS, evaluateOffer, compare, report, proposeEffort, planFromOffer } from './planner.js';
import { ENUMS } from './entities.js';

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const KIND_OF = { investment_transfer: 'investment', bank_account: 'bank', credit_card: 'card' };

export function mountPlanner({ api, db, requireAuth, route, bad, HttpError, today, audit, nowIso, notifier }) {
  const loadSettings = () => {
    let saved = {}; try { saved = JSON.parse(notifier.getSetting('planner') || '{}'); } catch { saved = {}; }
    return { benchmark: saved.benchmark ?? DEFAULTS.benchmark, worth_per_hour_cents: saved.worth_per_hour_cents ?? DEFAULTS.worth_per_hour_cents, score_cost_cents: saved.score_cost_cents ?? DEFAULTS.score_cost_cents,
      effort_hours: { ...DEFAULTS.effort_hours, ...(saved.effort_hours || {}) }, points: { ...DEFAULTS.points, ...(saved.points || {}) } };
  };
  const offerRow = (id) => { const o = db.prepare('SELECT * FROM offer_terms WHERE id = ?').get(id); if (!o) throw new HttpError(404, 'Offer not found'); return o; };
  const num = (v, name, min, max) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name}: a number from ${min} to ${max}`); return n; };

  api.get('/planner/settings', requireAuth, route((req, res) => {
    const s = loadSettings();
    const entries = db.prepare('SELECT * FROM ledger_entries').all(); const logs = db.prepare("SELECT * FROM effort_logs WHERE ref_type = 'ledger'").all();
    res.json({ ...s, proposals: proposeEffort(entries, logs, s.effort_hours), debts: db.prepare('SELECT * FROM debts ORDER BY rate DESC').all() });
  }));
  api.put('/planner/settings', requireAuth, route((req, res) => {
    const b = req.body || {}; const cur = loadSettings(); const next = { ...cur };
    if (b.benchmark != null) next.benchmark = num(b.benchmark, 'benchmark', 0, 50);
    if (b.worth_per_hour_cents != null) next.worth_per_hour_cents = Math.round(num(b.worth_per_hour_cents, 'worth per hour', 0, 1e7));
    if (b.score_cost_cents != null) next.score_cost_cents = Math.round(num(b.score_cost_cents, 'score cost', 0, 1e7));
    if (b.effort_hours) for (const k of Object.keys(DEFAULTS.effort_hours)) if (b.effort_hours[k] != null) next.effort_hours[k] = num(b.effort_hours[k], `hours for ${k}`, 0, 500);
    if (b.points) {
      if (typeof b.points !== 'object' || Object.keys(b.points).length > 60) throw bad('points: too many programs');
      next.points = {};
      for (const [name, v] of Object.entries(b.points)) {
        if (!name || name.length > 60) throw bad('Program name is required (60 characters at most)');
        next.points[name] = { cash: num(v.cash, `${name} cash value`, 0, 20), best: num(v.best, `${name} best-use value`, 0, 20), source: String(v.source || '').slice(0, 200), on: isDate(v.on) ? v.on : today() };
      }
    }
    notifier.setSetting('planner', JSON.stringify(next));
    audit(req, req.session.user_id, 'planner.settings', '');
    res.json({ ok: true });
  }));

  // Evaluate one offer for a given amount.
  api.post('/planner/evaluate', requireAuth, route((req, res) => {
    const b = req.body || {}; const o = offerRow(+b.offer_id);
    const cap = Math.round(num(b.capital_cents ?? 0, 'capital', 0, 1e12));
    const pool = ENUMS.holding_type.includes(b.account_type) && ['rrsp', 'tfsa', 'resp', 'fhsa'].includes(b.account_type) ? 'registered' : 'nonreg';
    const start = isDate(b.start) ? b.start : today();
    const debts = db.prepare('SELECT * FROM debts').all();
    res.json(evaluateOffer({ offer: o, amounts: { registered: pool === 'registered' ? cap : 0, nonreg: pool === 'nonreg' ? cap : 0 }, start, invested: b.invested === false ? false : true, interest_rate: Number(b.interest_rate) || 0, debts, smith: !!b.smith,
      interest_cents: b.interest_cents || 0, extra_spend_cents: b.extra_spend_cents || 0 }, loadSettings()));
  }));

  // Compare staying with moving a holding into other offers.
  api.post('/planner/compare', requireAuth, route((req, res) => {
    const b = req.body || {};
    const h = db.prepare('SELECT * FROM holdings WHERE id = ?').get(+b.holding_id);
    if (!h) throw new HttpError(404, 'Holding not found');
    const ids = Array.isArray(b.offer_ids) ? b.offer_ids.map(Number).filter(Boolean).slice(0, 12) : [];
    if (!ids.length) throw bad('Choose at least one offer to compare');
    const targets = ids.map(offerRow);
    const current = h.offer_id ? db.prepare('SELECT * FROM offer_terms WHERE id = ?').get(h.offer_id) : null;
    const asOf = isDate(b.start) ? b.start : today();
    // Money already counted under the same offer elsewhere (pooled) stays in the base.
    let countedAmounts;
    if (current) {
      const mates = db.prepare('SELECT * FROM holdings WHERE offer_id = ?').all(current.id); countedAmounts = { registered: 0, nonreg: 0 };
      for (const m of mates) countedAmounts[['rrsp', 'tfsa', 'resp', 'fhsa'].includes(m.account_type) ? 'registered' : 'nonreg'] += m.counted_cents ?? m.value_cents;
    }
    const out = compare({ holding: { ...h, invested: h.invested === 0 ? false : true }, current, targets, start: asOf, today: asOf, debts: db.prepare('SELECT * FROM debts').all(), settings: loadSettings(), countedAmounts });
    res.json({ holding: { id: h.id, name: h.name, value_cents: h.value_cents, account_type: h.account_type }, current: current ? { id: current.id, issuer: current.issuer, product: current.product } : null, ...out });
  }));

  // ---------- plans ----------
  const plans = () => {
    const ps = db.prepare('SELECT * FROM plans ORDER BY id DESC').all(); const steps = db.prepare('SELECT * FROM plan_steps ORDER BY step_date IS NULL, step_date, id').all();
    return ps.map((p) => ({ ...p, steps: steps.filter((s) => s.plan_id === p.id) }));
  };
  api.get('/planner/plans', requireAuth, route((req, res) => res.json({ items: plans() })));
  api.post('/planner/plans', requireAuth, route((req, res) => {
    const b = req.body || {}; const name = String(b.name || '').trim().slice(0, 120);
    const o = b.offer_id ? offerRow(+b.offer_id) : null;
    if (!name && !o) throw bad('Give the plan a name');
    let id;
    db.transaction(() => {
      id = db.prepare('INSERT INTO plans (name, offer_id, created_at) VALUES (?,?,?)').run(name || `${o.issuer} ${o.product}`, o?.id ?? null, nowIso()).lastInsertRowid;
      if (o) for (const s of planFromOffer(o)) db.prepare('INSERT INTO plan_steps (plan_id, step_date, title, remind, note) VALUES (?,?,?,?,?)').run(id, s.step_date, s.title, s.remind, s.note);
    })();
    audit(req, req.session.user_id, 'plan.create', String(id));
    res.status(201).json({ id });
  }));
  api.delete('/planner/plans/:id', requireAuth, route((req, res) => {
    if (!db.prepare('DELETE FROM plans WHERE id = ?').run(+req.params.id).changes) throw new HttpError(404, 'Not found');
    res.json({ ok: true });
  }));
  const stepBody = (b, partial) => {
    const o = {};
    if (!partial || 'title' in b) { const t = String(b.title || '').trim(); if (!t || t.length > 200) throw bad('Step needs a title (200 characters at most)'); o.title = t; }
    if ('step_date' in b) { if (b.step_date && !isDate(b.step_date)) throw bad('Step date must be a date'); o.step_date = b.step_date || null; }
    if ('done' in b) o.done = b.done ? 1 : 0;
    if ('remind' in b) o.remind = b.remind ? 1 : 0;
    if ('note' in b) o.note = String(b.note || '').slice(0, 1000);
    return o;
  };
  api.post('/planner/plans/:id/steps', requireAuth, route((req, res) => {
    if (!db.prepare('SELECT 1 FROM plans WHERE id = ?').get(+req.params.id)) throw new HttpError(404, 'Plan not found');
    const s = stepBody(req.body || {}, false);
    const id = db.prepare('INSERT INTO plan_steps (plan_id, step_date, title, done, remind, note) VALUES (?,?,?,?,?,?)').run(+req.params.id, s.step_date ?? null, s.title, s.done ?? 0, s.remind ?? 1, s.note ?? '').lastInsertRowid;
    res.status(201).json({ id });
  }));
  api.patch('/planner/steps/:id', requireAuth, route((req, res) => {
    const s = stepBody(req.body || {}, true); const keys = Object.keys(s);
    if (!keys.length) throw bad('Nothing to change');
    if (!db.prepare(`UPDATE plan_steps SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => s[k]), +req.params.id).changes) throw new HttpError(404, 'Not found');
    res.json({ ok: true });
  }));
  api.delete('/planner/steps/:id', requireAuth, route((req, res) => {
    if (!db.prepare('DELETE FROM plan_steps WHERE id = ?').run(+req.params.id).changes) throw new HttpError(404, 'Not found');
    res.json({ ok: true });
  }));

  // ---------- effort ----------
  api.get('/planner/effort', requireAuth, route((req, res) => {
    const ref = String(req.query.ref_type || ''), id = +req.query.ref_id;
    res.json({ items: db.prepare('SELECT * FROM effort_logs WHERE ref_type = ? AND ref_id = ? ORDER BY logged_on DESC, id DESC').all(ref, id) });
  }));
  api.post('/planner/effort', requireAuth, route((req, res) => {
    const b = req.body || {};
    if (!['ledger', 'offer'].includes(b.ref_type)) throw bad('ref_type must be ledger or offer');
    const table = b.ref_type === 'ledger' ? 'ledger_entries' : 'offer_terms';
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(+b.ref_id)) throw new HttpError(404, 'Not found');
    const hours = num(b.hours, 'hours', 0.05, 200);
    const on = isDate(b.logged_on) ? b.logged_on : today();
    const id = db.prepare('INSERT INTO effort_logs (ref_type, ref_id, hours, logged_on, note) VALUES (?,?,?,?,?)').run(b.ref_type, +b.ref_id, hours, on, String(b.note || '').slice(0, 300)).lastInsertRowid;
    res.status(201).json({ id });
  }));
  api.delete('/planner/effort/:id', requireAuth, route((req, res) => {
    if (!db.prepare('DELETE FROM effort_logs WHERE id = ?').run(+req.params.id).changes) throw new HttpError(404, 'Not found');
    res.json({ ok: true });
  }));

  // ---------- ledger ----------
  const ledgerReport = () => {
    const s = loadSettings(); const entries = db.prepare('SELECT * FROM ledger_entries').all();
    const logs = db.prepare("SELECT * FROM effort_logs WHERE ref_type = 'ledger'").all(); const by = new Map();
    for (const l of logs) (by.get(l.ref_id) || by.set(l.ref_id, []).get(l.ref_id)).push(l);
    const r = report(entries, by, s);
    // Expected hours for entries with no time logged yet.
    for (const row of r.rows) { row.expected_hours = s.effort_hours[row.kind === 'card' ? 'credit_card' : row.kind === 'bank' ? 'bank_account' : 'investment_transfer']; row.unconfirmed = JSON.parse(row.unconfirmed || '[]'); }
    return { ...r, settings: { benchmark: s.benchmark, worth_per_hour_cents: s.worth_per_hour_cents }, taxes: 'Cash bonuses may be taxable income and some issuers send no slip. Information only: ask a tax professional.' };
  };
  api.get('/planner/report', requireAuth, route((req, res) => res.json(ledgerReport())));
  api.post('/planner/ledger/from-offer/:id', requireAuth, route((req, res) => {
    const o = offerRow(+req.params.id);
    const expected = Number.isInteger(req.body?.expected_cents) ? req.body.expected_cents : (o.fixed_cents ?? o.paid_cents ?? null);
    const id = db.prepare('INSERT INTO ledger_entries (kind, issuer, title, status, expected_cents, offer_id) VALUES (?,?,?,?,?,?)').run(KIND_OF[o.kind], o.issuer, o.product, 'pending', expected, o.id).lastInsertRowid;
    audit(req, req.session.user_id, 'ledger.from_offer', String(id));
    res.status(201).json({ id });
  }));
  return { ledgerReport, loadSettings, planSteps: () => db.prepare('SELECT s.*, p.name AS plan_name FROM plan_steps s JOIN plans p ON p.id = s.plan_id WHERE s.done = 0 AND s.remind = 1 AND s.step_date IS NOT NULL').all() };
}
