// Everything with a date: the source for the calendar, the .ics feed and notifications.
import { addDays, daysBetween } from './dates.js';
import { nextCharge } from './recurring.js';

export const KINDS = {
  recurring: { label: 'Recurring payment due', lead: 3 },
  card_payment: { label: 'Credit card payment due', lead: 3 },
  bonus_deadline: { label: 'Bonus qualify-by date', lead: 14 },
  clawback_end: { label: 'Bonus clawback period ends', lead: 14 },
  eligible_again: { label: 'Eligible for a new bonus again', lead: 14 },
  next_application: { label: 'Next application allowed', lead: 7 },
  bonus_received: { label: 'Bonus received', lead: 0, history: true },
  plan_step: { label: 'Offer plan step', lead: 7 },
  smith_cap: { label: 'Capitalize Smith Manoeuvre interest', lead: 3 },
};

const monthsBetween = (from, to) => {
  const out = []; let [y, m] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push([y, m]); m++; if (m > 12) { m = 1; y++; } }
  return out;
};
const clampDay = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate())).padStart(2, '0')}`;

// views: the decorated cards, accounts and recurring lists. Returns events with from <= date <= to, sorted.
export function buildEvents({ cards, accounts, recurring, planSteps = [], smith = [] }, from, to, opts = {}) {
  const out = [];
  const add = (kind, ref, id, date, title, detail) => { if (date && date >= from && date <= to) out.push({ key: `${kind}:${ref}${id}:${date}`, kind, date, title, detail: detail || '' }); };
  for (const r of recurring) {
    if (r.status !== 'active') continue;
    let d = nextCharge(r, from), guard = 0;
    while (d && d <= to && guard++ < 400) { add('recurring', 'r', r.id, d, `${r.name} due`, `Paid by ${r.method || 'not set'}`); d = nextCharge(r, addDays(d, 1)); }
  }
  for (const c of cards) {
    const name = `${c.label} ${c.issuer} ${c.product}`;
    if (['open', 'frozen'].includes(c.status) && c.due_day) for (const [y, m] of monthsBetween(from, to)) add('card_payment', 'c', c.id, clampDay(y, m, c.due_day), `Payment due: ${name}`);
    for (const b of c.bonuses) {
      if (b.outcome === 'in_progress') add('bonus_deadline', 'c', `${c.id}-${b.slot}`, b.qualify_by, `Qualify by: ${name}`, b.offer_text || '');
      if (b.outcome === 'earned') add('bonus_received', 'c', `${c.id}-${b.slot}`, b.received_on, `Bonus received: ${name}`);
    }
    add('clawback_end', 'c', c.id, c.keep_until, `Clawback period ends: ${name}`, 'After this date the card can be closed without losing the bonus');
    add('eligible_again', 'c', c.id, c.eligibility?.eligibleFrom, `Eligible again: ${c.issuer} ${c.product}`, c.eligibility?.rule || '');
    add('next_application', 'c', c.id, c.eligibility?.nextApplication, `Next application allowed: ${c.issuer}`, c.eligibility?.rule || '');
  }
  for (const a of accounts) {
    const name = `${a.label} ${a.institution} ${a.account_type}`;
    for (const b of a.bonuses) {
      if (b.outcome === 'in_progress') add('bonus_deadline', 'a', `${a.id}-${b.id}`, b.qualify_by, `Qualify by: ${name}`, b.requirement || '');
      add('clawback_end', 'a', `${a.id}-${b.id}`, b.keep_until, `Funds can leave: ${name}`, 'Keep-funds period ends');
      if (b.outcome === 'earned') add('bonus_received', 'a', `${a.id}-${b.id}`, b.received_on, `Bonus received: ${name}`);
    }
    add('eligible_again', 'a', a.id, a.eligibility?.eligibleFrom, `Eligible again: ${a.institution}`, a.eligibility?.rule || '');
  }
  for (const st of planSteps) add('plan_step', 'p', st.id, st.step_date, st.title, st.note || st.plan_name || '');
  // Open reminders stay on the list, even when overdue, until the capitalizing advance is recorded.
  for (const r of smith) if (r.due <= to && ((opts.overdue && r.overdue) || (r.due >= from))) out.push({ key: `smith_cap:${r.debt_id}:${r.month}`, kind: 'smith_cap', date: r.due, title: `${r.overdue ? 'Overdue: ' : ''}Capitalize interest on ${r.loan} (${r.month})`, detail: 'Record the capitalizing advance in Investments to clear this reminder' });
  return out.sort((x, y) => (x.date === y.date ? x.title.localeCompare(y.title) : x.date < y.date ? -1 : 1));
}

// ---- iCalendar
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line) => { const b = Buffer.from(line); if (b.length <= 74) return line; const parts = []; let cur = ''; for (const ch of line) { if (Buffer.byteLength(cur + ch) > 73) { parts.push(cur); cur = ' ' + ch; } else cur += ch; } parts.push(cur); return parts.join('\r\n'); };
export function toIcs(events, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Finance Hub//Cards and bonuses//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Finance Hub', 'REFRESH-INTERVAL;VALUE=DURATION:PT12H'];
  for (const e of events) {
    const d = e.date.replaceAll('-', ''); const next = addDays(e.date, 1).replaceAll('-', '');
    lines.push('BEGIN:VEVENT', `UID:${e.key.replace(/[^A-Za-z0-9:_-]/g, '_')}@finance-hub`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`, `SUMMARY:${esc(e.title)}`);
    if (e.detail) lines.push(`DESCRIPTION:${esc(e.detail)}`);
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
export { daysBetween };
