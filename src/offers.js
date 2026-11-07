// Cards, bank and investment accounts, bonuses, recurring payments and re-application rules.
import express from 'express';
import { SPECS, ENUMS, clean, FieldError } from './entities.js';
import { addMonths, daysBetween } from './dates.js';
import { evaluate, fromCard, fromAccount } from './eligibility.js';
import { nextCharge, yearlyCents, monthlyCents, FREQUENCIES } from './recurring.js';
import { previewWorkbook, applyWorkbook } from './workbook.js';

const nextDayOfMonth = (day, today) => {
  if (!day) return null;
  const [y, m] = today.split('-').map(Number);
  for (let k = 0; k < 3; k++) {
    const t = y * 12 + (m - 1) + k; const ny = Math.floor(t / 12), nm = t - ny * 12;
    const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    const d = `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
    if (d >= today) return d;
  }
  return null;
};
const cleanList = (s) => { try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch { return []; } };

export function mountOffers({ api, db, requireAuth, route, bad, HttpError, today, bigBody, audit, nowIso }) {
  const specList = (name) => SPECS[name].fields.map(({ pattern, ...rest }) => rest);

  api.get('/offers/schema', requireAuth, route((req, res) => {
    res.json({
      enums: ENUMS, frequencies: Object.fromEntries(Object.entries(FREQUENCIES).map(([k, v]) => [k, v.label])),
      specs: Object.fromEntries(Object.keys(SPECS).map((k) => [k, {
        fields: specList(k),
        children: SPECS[k].children ? Object.fromEntries(Object.entries(SPECS[k].children).map(([ck, cv]) => [ck, { max: cv.max, fields: cv.fields.map(({ pattern, ...r }) => r) }])) : undefined,
      }])),
    });
  }));

  // ---------- loading with children ----------
  const loadAll = (name) => {
    const spec = SPECS[name];
    const rows = db.prepare(`SELECT * FROM ${spec.table} ORDER BY ${spec.order}`).all();
    for (const r of rows) r.unconfirmed = cleanList(r.unconfirmed);
    if (spec.children) {
      for (const [ck, cs] of Object.entries(spec.children)) {
        const kids = db.prepare(`SELECT * FROM ${cs.table} ORDER BY ${cs.fk}, ${cs.fields.some((x) => x.key === 'slot') ? 'slot' : 'id'}`).all();
        const by = new Map();
        for (const k of kids) { k.unconfirmed = cleanList(k.unconfirmed); (by.get(k[cs.fk]) || by.set(k[cs.fk], []).get(k[cs.fk])).push(k); }
        for (const r of rows) r[ck] = by.get(r.id) || [];
      }
    }
    return rows;
  };

  // ---------- derived values ----------
  const decorateCards = (cards, rules, t) => {
    const items = cards.map((c) => fromCard(c, c.bonuses));
    return cards.map((c, i) => {
      const earned = c.bonuses.filter((b) => b.outcome === 'earned');
      const points = earned.reduce((s, b) => s + (b.amount || 0), 0);
      const pending = c.bonuses.filter((b) => b.outcome === 'in_progress' && c.approved_on && b.months_to_qualify != null)
        .map((b) => ({ ...b, qualify_by: addMonths(c.approved_on, b.months_to_qualify) })).sort((a, b) => (a.qualify_by < b.qualify_by ? -1 : 1));
      const next = pending[0] || null;
      const need = next && next.spend_required_cents != null ? Math.max(0, next.spend_required_cents - (c.spend_progress_cents || 0)) : null;
      const days = next ? daysBetween(t, next.qualify_by) : null;
      const claw = earned.filter((b) => b.received_on && c.clawback_months).map((b) => addMonths(b.received_on, c.clawback_months)).sort().pop() || null;
      const bonuses = c.bonuses.map((b) => ({ ...b, qualify_by: c.approved_on && b.months_to_qualify != null ? addMonths(c.approved_on, b.months_to_qualify) : null }));
      return {
        ...c, bonuses, points_earned: points,
        bonus_cash_cents: c.cpp_cash != null ? Math.round(points * c.cpp_cash) : null, bonus_best_cents: c.cpp_best != null ? Math.round(points * c.cpp_best) : null,
        next_deadline: next ? next.qualify_by : null, days_to_deadline: days, spend_still_needed_cents: need,
        alert: next ? (days < 0 ? 'Qualify-by date has passed' : days <= 30 ? `Qualify by ${next.qualify_by}${need ? `, ${need / 100} still to spend` : ''}` : null) : null,
        keep_until: claw, clawback_status: claw ? (claw >= t ? `Keep the card until ${claw}` : 'Clawback period is over') : null,
        next_payment_due: ['open', 'frozen'].includes(c.status) ? nextDayOfMonth(c.due_day, t) : null,
        eligibility: evaluate(items[i], rules, items, t),
      };
    });
  };
  const decorateAccounts = (accts, rules, t) => {
    const items = accts.map((a) => fromAccount(a, a.bonuses));
    return accts.map((a, i) => {
      const bonuses = a.bonuses.map((b) => {
        const keep = b.received_on && b.months_keep_funds ? addMonths(b.received_on, b.months_keep_funds) : null;
        return { ...b, qualify_by: a.opened_on && b.months_to_qualify != null ? addMonths(a.opened_on, b.months_to_qualify) : null, keep_until: keep, clawback_status: keep ? (keep >= t ? `Keep funds until ${keep}` : 'Clawback period is over') : null };
      });
      return { ...a, bonuses, bonus_received_cents: bonuses.filter((b) => b.outcome === 'earned').reduce((s, b) => s + (b.received_cents || 0), 0), eligibility: evaluate(items[i], rules, items, t) };
    });
  };
  const decorateRecurring = (rows, cards, accts, t) => rows.map((r) => {
    const card = cards.find((c) => c.id === r.card_id), acct = accts.find((a) => a.id === r.acct_id);
    const nc = nextCharge(r, t);
    return { ...r, next_charge: nc, days_until: nc ? daysBetween(t, nc) : null, yearly_cents: yearlyCents(r), monthly_cents: monthlyCents(r),
      method: card ? `${card.issuer} ${card.product}${card.last4 ? ` ${card.last4}` : ''}` : acct ? `${acct.institution} ${acct.account_type}` : r.other_method || '' };
  });

  const view = (name) => {
    const t = today(); const rules = db.prepare('SELECT * FROM issuer_rules').all();
    if (name === 'cards') return decorateCards(loadAll('cards'), rules, t);
    if (name === 'accounts') return decorateAccounts(loadAll('accounts'), rules, t);
    if (name === 'recurring') return decorateRecurring(loadAll('recurring'), loadAll('cards'), loadAll('accounts'), t);
    if (name === 'plan_steps') return db.prepare('SELECT s.*, p.name AS plan_name FROM plan_steps s JOIN plans p ON p.id = s.plan_id WHERE s.done = 0 AND s.remind = 1 AND s.step_date IS NOT NULL').all();
    return loadAll(name);
  };

  // ---------- generic CRUD ----------
  const parseBody = (spec, body, partial) => {
    try {
      const row = clean(spec.fields, body || {}, partial);
      if (spec.table === 'issuer_rules' && 'verified' in row && row.verified == null) row.verified = 0;
      if (spec.table === 'issuer_rules' && !partial && row.verified === undefined) row.verified = 0;
      return row;
    } catch (e) { if (e instanceof FieldError) throw bad(e.message); throw e; }
  };
  const nextLabel = (prefix, table, where = '') => {
    const rows = db.prepare(`SELECT label FROM ${table} ${where}`).all();
    const max = rows.reduce((m, r) => Math.max(m, Number(/-(\d+)$/.exec(r.label)?.[1] || 0)), 0);
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  };
  const writeChildren = (parentId, cs, items) => {
    if (!Array.isArray(items)) throw bad('Bonuses must be a list');
    if (items.length > cs.max) throw bad(`At most ${cs.max} bonuses`);
    db.prepare(`DELETE FROM ${cs.table} WHERE ${cs.fk} = ?`).run(parentId);
    items.forEach((it, i) => {
      const row = parseBody(cs, { ...it, slot: i + 1 }, false);
      const cols = Object.keys(row);
      db.prepare(`INSERT INTO ${cs.table} (${cs.fk}, ${cols.join(',')}) VALUES (?,${cols.map(() => '?').join(',')})`).run(parentId, ...cols.map((c) => row[c]));
    });
  };
  const checkRefs = (spec, row) => {
    for (const fd of spec.fields) if (fd.ref && row[fd.key] != null && !db.prepare(`SELECT 1 FROM ${fd.ref} WHERE id = ?`).get(row[fd.key])) throw bad(`${fd.key}: not found`);
  };
  const unique = (e) => { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'That ID or name is already used'); throw e; };

  for (const [name, spec] of Object.entries(SPECS)) {
    api.get(`/offers/${name}`, requireAuth, route((req, res) => res.json({ items: view(name) })));
    api.post(`/offers/${name}`, requireAuth, route((req, res) => {
      const body = { ...(req.body || {}) };
      if (name === 'cards' && !body.label) body.label = nextLabel('C', 'cards');
      if (name === 'accounts' && !body.label) body.label = nextLabel(body.kind === 'invest' ? 'I' : 'B', 'inst_accounts', `WHERE kind = '${body.kind === 'invest' ? 'invest' : 'bank'}'`);
      const row = parseBody(spec, body, false);
      checkRefs(spec, row);
      const extra = ['cards', 'accounts'].includes(name) ? { created_at: nowIso() } : {};
      const all = { ...row, ...extra }; const keys = Object.keys(all);
      let id;
      try {
        db.transaction(() => {
          id = db.prepare(`INSERT INTO ${spec.table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => all[k])).lastInsertRowid;
          for (const [ck, cs] of Object.entries(spec.children || {})) if (body[ck]) writeChildren(id, cs, body[ck]);
        })();
      } catch (e) { if (e instanceof HttpError) throw e; unique(e); }
      audit(req, req.session.user_id, `${name}.create`, String(id));
      res.status(201).json({ id });
    }));
    api.patch(`/offers/${name}/:id`, requireAuth, route((req, res) => {
      const id = +req.params.id;
      const cur = db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(id);
      if (!cur) throw new HttpError(404, 'Not found');
      const body = req.body || {};
      const row = parseBody(spec, body, true);
      checkRefs(spec, row);
      // A field you edit by hand is no longer "unconfirmed".
      const unconfirmed = cleanList(cur.unconfirmed).filter((k) => !(k in row && String(row[k] ?? '') !== String(cur[k] ?? '')) );
      try {
        db.transaction(() => {
          const keys = Object.keys(row);
          db.prepare(`UPDATE ${spec.table} SET ${[...keys.map((k) => `${k} = ?`), 'unconfirmed = ?'].join(', ')} WHERE id = ?`).run(...keys.map((k) => row[k]), JSON.stringify(unconfirmed), id);
          for (const [ck, cs] of Object.entries(spec.children || {})) if (ck in body) writeChildren(id, cs, body[ck]);
        })();
      } catch (e) { if (e instanceof HttpError) throw e; unique(e); }
      audit(req, req.session.user_id, `${name}.update`, String(id));
      res.json({ ok: true });
    }));
    api.post(`/offers/${name}/:id/confirm`, requireAuth, route((req, res) => {
      const r = db.prepare(`UPDATE ${spec.table} SET unconfirmed = '[]' WHERE id = ?`).run(+req.params.id);
      if (!r.changes) throw new HttpError(404, 'Not found');
      res.json({ ok: true });
    }));
    api.delete(`/offers/${name}/:id`, requireAuth, route((req, res) => {
      const r = db.prepare(`DELETE FROM ${spec.table} WHERE id = ?`).run(+req.params.id);
      if (!r.changes) throw new HttpError(404, 'Not found');
      audit(req, req.session.user_id, `${name}.delete`, String(req.params.id));
      res.json({ ok: true });
    }));
  }

  // ---------- one overview for the Cards page ----------
  api.get('/offers/summary', requireAuth, route((req, res) => {
    const cards = view('cards'), accts = view('accounts'), rec = view('recurring');
    const t = today();
    const count = (s) => cards.filter((c) => c.status === s).length;
    res.json({
      today: t,
      cards: { open: count('open'), frozen: count('frozen'), closed: count('closed') + count('downgraded'), pending: count('pending') },
      alerts: [
        ...cards.filter((c) => c.alert).map((c) => ({ kind: 'bonus', label: `${c.label} ${c.product}`, text: c.alert, date: c.next_deadline })),
        ...cards.filter((c) => c.keep_until && c.keep_until >= t).map((c) => ({ kind: 'clawback', label: `${c.label} ${c.product}`, text: c.clawback_status, date: c.keep_until })),
        ...accts.flatMap((a) => a.bonuses.filter((b) => b.keep_until && b.keep_until >= t).map((b) => ({ kind: 'clawback', label: `${a.label} ${a.institution}`, text: b.clawback_status, date: b.keep_until }))),
        ...rec.filter((r) => r.days_until != null && r.days_until <= (r.remind_days ?? 3)).map((r) => ({ kind: 'recurring', label: r.name, text: `Charge ${r.next_charge}`, date: r.next_charge })),
      ].sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1),
      recurring: { monthly_cents: rec.filter((r) => r.status === 'active').reduce((s, r) => s + r.monthly_cents, 0), yearly_cents: rec.filter((r) => r.status === 'active').reduce((s, r) => s + r.yearly_cents, 0) },
    });
  }));

  // ---------- workbook import ----------
  const readUpload = (req) => {
    const b64 = req.body?.file_base64;
    if (typeof b64 !== 'string' || !b64) throw bad('Choose a workbook (.xlsx)');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 100 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw bad('That does not look like an .xlsx file');
    return buf;
  };
  api.post('/workbook/preview', requireAuth, bigBody, route(async (req, res) => {
    let parsed;
    try { parsed = await previewWorkbook(readUpload(req)); } catch (e) { if (e instanceof HttpError) throw e; throw bad(`Could not read the workbook: ${e.message}`); }
    res.json({ counts: parsed.counts, warnings: parsed.warnings.slice(0, 100), existing: parsed.existingCounts(db) });
  }));
  api.post('/workbook/import', requireAuth, bigBody, route(async (req, res) => {
    const mode = req.body?.mode === 'overwrite' ? 'overwrite' : 'add_only';
    let parsed;
    try { parsed = await previewWorkbook(readUpload(req)); } catch (e) { throw bad(`Could not read the workbook: ${e.message}`); }
    const result = applyWorkbook(db, parsed, mode, nowIso());
    audit(req, req.session.user_id, 'workbook.import', JSON.stringify({ mode, ...result.added }));
    res.json(result);
  }));
  return { view };
}
