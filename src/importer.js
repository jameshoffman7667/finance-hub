import { parseCsv } from './csv.js';
import { parseCents, parseDate } from './money.js';
import { sha256 } from './crypto.js';

const find = (headers, re) => headers.findIndex((h) => re.test(h));

// Guess which columns hold date, description and amount from the header row.
export function guessMapping(rows) {
  const headers = (rows[0] || []).map((h) => String(h).trim().toLowerCase());
  const hasHeader = headers.length > 0 && !parseDate(rows[0][0]) ;
  const m = { hasHeader, date: -1, description: -1, amount: -1, debit: -1, credit: -1, dateOrder: 'YMD', invert: false };
  if (hasHeader) {
    m.date = find(headers, /date|posted|transaction/);
    m.description = find(headers, /desc|memo|payee|details|merchant|name/);
    m.amount = find(headers, /^(amount|amt|value)|cad\$?$/);
    m.debit = find(headers, /debit|withdraw|paid out|money out/);
    m.credit = find(headers, /credit|deposit|paid in|money in/);
    if (m.amount >= 0 && (m.amount === m.debit || m.amount === m.credit)) m.amount = -1;
  } else {
    const n = rows[0].length;
    m.date = 0; m.description = Math.min(1, n - 1); m.amount = n - 1;
  }
  // Day/month order: if any first-part value exceeds 12 it is the day.
  const sample = rows.slice(m.hasHeader ? 1 : 0, 200);
  let dmy = false, mdy = false;
  for (const r of sample) {
    const x = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}/.exec(String(r[m.date] ?? ''));
    if (x) { if (+x[1] > 12) dmy = true; if (+x[2] > 12) mdy = true; }
  }
  m.dateOrder = dmy && !mdy ? 'DMY' : 'MDY';
  return m;
}

export function parseStatement(text, mappingIn) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { mapping: null, headers: [], rows: [], errors: ['The file has no rows'] };
  const guessed = guessMapping(rows);
  const mapping = { ...guessed, ...(mappingIn || {}) };
  const headers = mapping.hasHeader ? rows[0] : rows[0].map((_, i) => `Column ${i + 1}`);
  const body = mapping.hasHeader ? rows.slice(1) : rows;
  const out = [];
  const errors = [];
  body.forEach((r, i) => {
    const line = i + (mapping.hasHeader ? 2 : 1);
    const date = parseDate(r[mapping.date], mapping.dateOrder);
    const description = String(r[mapping.description] ?? '').trim().replace(/\s+/g, ' ');
    let cents = null;
    if (mapping.amount >= 0) cents = parseCents(r[mapping.amount]);
    else if (mapping.debit >= 0 || mapping.credit >= 0) {
      const d = mapping.debit >= 0 ? parseCents(r[mapping.debit]) : null;
      const c = mapping.credit >= 0 ? parseCents(r[mapping.credit]) : null;
      if (d != null || c != null) cents = (c ? Math.abs(c) : 0) - (d ? Math.abs(d) : 0);
    }
    if (cents != null && mapping.invert) cents = -cents;
    if (!date || cents == null || !description) {
      errors.push({ line, reason: !date ? 'bad date' : cents == null ? 'bad amount' : 'missing description', raw: r.join(' | ').slice(0, 120) });
      return;
    }
    out.push({ line, posted_on: date, description, amount_cents: cents });
  });
  // Identical rows within one file get a sequence number so genuine repeats are kept.
  const seen = new Map();
  for (const t of out) {
    t.hash = sha256(`${t.posted_on}|${t.description.toLowerCase()}|${t.amount_cents}`);
    const n = seen.get(t.hash) ?? 0;
    t.seq = n;
    seen.set(t.hash, n + 1);
  }
  return { mapping, headers, rows: out, errors };
}

export function loadRules(db) {
  return db.prepare('SELECT r.pattern, r.category_id FROM rules r ORDER BY r.priority, length(r.pattern) DESC, r.id').all()
    .map((r) => ({ p: r.pattern.toLowerCase(), c: r.category_id }));
}
export const categorize = (rules, description) => {
  const d = description.toLowerCase();
  return rules.find((r) => d.includes(r.p))?.c ?? null;
};
