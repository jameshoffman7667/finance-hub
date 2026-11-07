// Reads a card statement exported as CSV and works out what it means for a bonus:
// eligible spend, bonus point lines and charges that repeat. It only proposes; nothing is saved here.
import { parseCsv } from './csv.js';
import { parseCents, parseDate } from './money.js';
import { daysBetween } from './dates.js';

const norm = (h) => String(h ?? '').trim().toLowerCase();
const EXCLUDE = /\b(interest|annual fee|fee|cash advance|balance transfer|foreign currency conversion|nsf)\b/i;
const PAYMENT = /\b(payment|thank you|paiement|autopay)\b/i;
const BONUS = /\b(bonus|welcome|sign[- ]?up|award)\b/i;

export function analyzeStatement(text, { since = null, charges = 'auto', dateOrder = 'YMD' } = {}) {
  const rows = parseCsv(text);
  const warnings = [];
  const hi = rows.findIndex((r) => r.some((c) => /date/.test(norm(c))) && r.some((c) => /(desc|merchant|detail|payee|name)/.test(norm(c))));
  if (hi < 0) throw new Error('Could not find a header row with a date and a description column');
  const head = rows[hi].map(norm);
  const col = (re) => head.findIndex((c) => re.test(c));
  const cDate = col(/^(transaction |trans\.? |posting |post )?date/), cDesc = col(/(desc|merchant|detail|payee|name)/);
  const cAmt = col(/^(amount|cad\$?|amount \(cad\))/), cDebit = col(/(debit|charge|withdrawal)/), cCredit = col(/(credit|deposit|payment)/);
  if (cDate < 0 || cDesc < 0 || (cAmt < 0 && cDebit < 0)) throw new Error('Need date, description and amount (or debit / credit) columns');
  const lines = [];
  for (const r of rows.slice(hi + 1)) {
    const date = parseDate(r[cDate], dateOrder);
    if (!date) { if (r.some((c) => c.trim())) warnings.push(`Skipped a row with an unreadable date: ${String(r[cDate]).slice(0, 20)}`); continue; }
    let cents;
    if (cAmt >= 0) cents = parseCents(r[cAmt]?.replace(/[()]/g, (m) => (m === '(' ? '-' : '')));
    else { const d = parseCents(r[cDebit]) ?? 0, c = cCredit >= 0 ? parseCents(r[cCredit]) ?? 0 : 0; cents = d ? d : -c; if (!d && !c) cents = null; }
    if (cents == null) { warnings.push(`Skipped a row with no amount on ${date}`); continue; }
    lines.push({ date, description: String(r[cDesc] ?? '').trim(), cents });
  }
  // Which sign is a charge? Card exports differ: use the sign most lines have unless told.
  let sign = charges === 'negative' ? -1 : charges === 'positive' ? 1 : 0;
  if (!sign) { const pos = lines.filter((l) => l.cents > 0).length, neg = lines.filter((l) => l.cents < 0).length; sign = pos >= neg ? 1 : -1; }
  const used = lines.filter((l) => !since || l.date >= since);
  let spend = 0, refunds = 0, excluded = 0, purchases = 0;
  const bonus = [], buys = [];
  for (const l of used) {
    const amt = l.cents * sign; // positive = a charge
    if (amt < 0) {
      if (PAYMENT.test(l.description)) continue;
      if (BONUS.test(l.description)) { const m = /([\d,]+)\s*(pts|points)/i.exec(l.description); bonus.push({ date: l.date, description: l.description, points: m ? Number(m[1].replace(/,/g, '')) : null, cents: -amt }); continue; }
      refunds += -amt; continue;
    }
    if (EXCLUDE.test(l.description)) { excluded += amt; continue; }
    spend += amt; purchases++; buys.push({ ...l, amt });
  }
  const eligible = Math.max(0, spend - refunds);
  // Repeating charges: same merchant text, similar amount, about a month apart.
  const key = (d) => d.toLowerCase().replace(/[0-9#*]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 28);
  const groups = new Map();
  for (const b of buys) { const k = key(b.description); if (k.length >= 3) (groups.get(k) || groups.set(k, []).get(k)).push(b); }
  const recurring = [];
  for (const [k, g] of groups) {
    if (g.length < 2) continue;
    g.sort((a, b) => (a.date < b.date ? -1 : 1));
    const gaps = g.slice(1).map((x, i) => daysBetween(g[i].date, x.date));
    const monthly = gaps.every((d) => d >= 26 && d <= 35);
    const amts = g.map((x) => x.amt).sort((a, b) => a - b); const med = amts[Math.floor(amts.length / 2)];
    const similar = amts.every((a) => Math.abs(a - med) <= Math.max(150, med * 0.1));
    const exact = amts.every((a) => a === amts[0]);
    if (monthly && similar && (g.length >= 3 || exact)) recurring.push({ name: g[g.length - 1].description.slice(0, 60), amount_cents: med, frequency: 'monthly', anchor_date: g[g.length - 1].date, count: g.length, key: k });
  }
  const dates = used.map((l) => l.date).sort();
  return { period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null, lines: used.length, charge_sign: sign === 1 ? 'positive' : 'negative', spend_cents: eligible, gross_cents: spend, refunds_cents: refunds, excluded_cents: excluded, purchases, bonus, recurring, warnings };
}
