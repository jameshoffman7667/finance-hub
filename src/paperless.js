// Read receipts from paperless-ngx and match them to card transactions. Receipt text never leaves the server and is not stored.
import { daysBetween } from './dates.js';
import { parseCents } from './money.js';

export function totalFromContent(text) {
  if (!text) return null;
  let best = null;
  for (const m of text.matchAll(/(?:grand\s+total|order\s+total|total\s+(?:charged|paid|amount)?|amount\s+(?:paid|charged)|total)\s*[:\-]?\s*(?:CAD|USD|C?\$)?\s*\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/gi)) best = parseCents(m[1].replace(/,/g, ''));
  return best;
}
export function totalFromField(v) {
  if (v == null) return null; const s = String(v).replace(/[A-Za-z$\s]/g, '').replace(/,/g, ''); if (!/^\d+(\.\d{1,2})?$/.test(s)) return null; return parseCents(s);
}

async function getJson(base, token, path, fetchImpl) {
  const r = await fetchImpl(`${base}${path}`, { headers: { Authorization: `Token ${token}`, Accept: 'application/json; version=5' } });
  if (r.status === 401 || r.status === 403) throw new Error('Paperless refused the token');
  if (!r.ok) throw new Error(`Paperless answered ${r.status}`);
  return r.json();
}
async function allPages(base, token, path, fetchImpl, maxPages) {
  const out = []; let next = path; let n = 0;
  while (next && n++ < maxPages) {
    const j = await getJson(base, token, next, fetchImpl); out.push(...(j.results || []));
    next = j.next ? j.next.replace(/^https?:\/\/[^/]+/, '') : null;
  }
  return out;
}
export async function fetchDocuments({ url, token, totalField = 'Total', since, fetchImpl = fetch, maxPages = 80 }) {
  if (!url || !token) throw new Error('Paperless is not set up on the server (PAPERLESS_URL and PAPERLESS_TOKEN)');
  const [corr, fields] = await Promise.all([allPages(url, token, '/api/correspondents/?page_size=500', fetchImpl, 10), allPages(url, token, '/api/custom_fields/?page_size=200', fetchImpl, 3).catch(() => [])]);
  const cm = new Map(corr.map((c) => [c.id, c.name])); const fid = fields.find((f) => String(f.name).toLowerCase() === totalField.toLowerCase())?.id;
  const qs = `page_size=100&ordering=-created&fields=id,title,correspondent,created,notes,custom_fields,content${since ? `&created__date__gte=${encodeURIComponent(since)}` : ''}`;
  const docs = await allPages(url, token, `/api/documents/?${qs}`, fetchImpl, maxPages);
  return docs.map((d) => {
    const cf = fid != null ? (d.custom_fields || []).find((x) => x.field === fid) : null;
    let total = cf ? totalFromField(cf.value) : null; let from = total != null ? 'field' : null;
    if (total == null) { total = totalFromContent(d.content); from = total != null ? 'text' : null; }
    const notes = Array.isArray(d.notes) ? d.notes.map((n) => n.note || '').join(' ') : String(d.notes || '');
    return { id: d.id, title: String(d.title || '').slice(0, 200), correspondent: cm.get(d.correspondent) || '', doc_date: String(d.created || '').slice(0, 10), total_cents: total, total_from: from, notes: notes.slice(0, 300) };
  });
}

const tokens = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length >= 3 && !['inc', 'ltd', 'the', 'com', 'www', 'purchase', 'payment', 'pos', 'visa', 'debit', 'credit'].includes(t)));
export function similarity(description, doc) {
  const paypal = /paypal/i.test(doc.correspondent || '');
  const a = tokens(description), b = tokens(paypal ? `${doc.title} ${doc.notes}` : `${doc.correspondent} ${doc.title} ${doc.notes}`);
  if (!a.size || !b.size) return 0;
  let hit = 0; for (const t of a) if ([...b].some((x) => x === t || (t.length >= 5 && (x.startsWith(t) || t.startsWith(x))))) hit++;
  return hit / Math.min(a.size, b.size);
}
// One best receipt per charge, one charge per receipt. Same amount and date within 5 days are required; the merchant decides linked or suggested.
export function matchAll(txns, docs, taken = { txn: new Set(), doc: new Set() }, maxDays = 5) {
  const cands = [];
  for (const t of txns) {
    if (taken.txn.has(t.id) || t.amount_cents >= 0) continue; const amt = -t.amount_cents;
    for (const d of docs) {
      if (taken.doc.has(d.id) || d.total_cents == null || !d.doc_date || Math.abs(d.total_cents - amt) > 0) continue;
      const days = Math.abs(daysBetween(t.posted_on, d.doc_date)); if (days > maxDays) continue;
      const sim = similarity(t.description, d); cands.push({ t, d, sim, days, score: Math.round((0.1 * (1 - days / (maxDays + 1)) + 0.9 * sim) * 1000) / 1000 });
    }
  }
  cands.sort((a, b) => b.score - a.score || a.days - b.days);
  const usedT = new Set(), usedD = new Set(), out = [];
  for (const c of cands) { if (usedT.has(c.t.id) || usedD.has(c.d.id)) continue; usedT.add(c.t.id); usedD.add(c.d.id); out.push({ transaction_id: c.t.id, doc_id: c.d.id, score: c.score, status: c.sim >= 0.5 ? 'linked' : 'suggested' }); }
  return out;
}
