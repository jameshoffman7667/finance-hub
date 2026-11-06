// Re-application rules: when can a card or account earn a new sign-up bonus again?
// Pure functions over plain records so they are easy to test.
import { addMonths, addDays, maxDate } from './dates.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const ALIASES = { 'american express': 'amex', 'amex canada': 'amex', 'bank of montreal': 'bmo', 'royal bank': 'rbc', 'royal bank of canada': 'rbc', 'toronto-dominion': 'td', 'td bank': 'td', 'scotia': 'scotiabank', 'bank of nova scotia': 'scotiabank' };
const sameInstitution = (a, b) => { const x = ALIASES[norm(a)] || norm(a); const y = ALIASES[norm(b)] || norm(b); return !!x && x === y; };
const tokens = (s) => String(s ?? '').split(/[,;/]/).map(norm).filter(Boolean);
const matchesAppliesTo = (appliesTo, text) => { const t = tokens(appliesTo); return !t.length || t.some((x) => norm(text).includes(x)); };

// Normalise a card or an account into the shape the rules work on.
export function fromCard(c, bonuses = []) {
  return {
    kind: 'card', id: c.id, rule_name: c.rule_name || '', issuer: c.issuer, product: c.product, family: c.family || '', text: `${c.product} ${c.family || ''}`,
    held: ['open', 'frozen', 'pending'].includes(c.status), counted: c.status !== 'declined' && c.status !== 'pending' && !!c.approved_on,
    applied_on: c.applied_on || c.approved_on || null, approved_on: c.approved_on || null,
    closed_on: c.closed_on || null, downgraded_on: c.downgraded_on || null,
    received: bonuses.filter((b) => b.outcome === 'earned' && b.received_on).map((b) => b.received_on),
    earned: bonuses.some((b) => b.outcome === 'earned'),
  };
}
export function fromAccount(a, bonuses = []) {
  return {
    kind: a.kind, id: a.id, rule_name: a.rule_name || '', issuer: a.institution, product: a.account_type, family: '', text: `${a.account_type} ${a.name || ''}`,
    held: a.status === 'open', counted: !!a.opened_on,
    applied_on: a.opened_on || null, approved_on: a.opened_on || null,
    closed_on: a.closed_on || null, downgraded_on: a.status === 'converted' ? a.closed_on || null : null,
    received: bonuses.filter((b) => b.outcome === 'earned' && b.received_on).map((b) => b.received_on),
    earned: bonuses.some((b) => b.outcome === 'earned'),
  };
}

// The most specific rule for this item: one naming the product beats a blanket issuer rule.
export function ruleFor(item, rules) {
  if (item.rule_name) { const named = rules.find((r) => norm(r.name) === norm(item.rule_name)); if (named) return named; }
  const cands = rules.filter((r) => sameInstitution(r.issuer, item.issuer) && matchesAppliesTo(r.applies_to, item.text));
  return cands.find((r) => tokens(r.applies_to).length) || cands[0] || null;
}

// Every item the rule treats as "the same thing" as this one.
export function covered(rule, item, all) {
  return all.filter((o) => {
    if (!sameInstitution(o.issuer, item.issuer)) return false;
    if (rule.scope === 'same_card') return norm(o.product) === norm(item.product);
    if (rule.scope === 'same_family') return norm(o.family || o.product) === norm(item.family || item.product);
    return true; // any_card, any_account
  });
}

function anchorDate(rule, group) {
  switch (rule.counted_from) {
    case 'application': return maxDate(group.map((g) => g.applied_on));
    case 'approval': return maxDate(group.map((g) => g.approved_on));
    case 'bonus_received': return maxDate(group.flatMap((g) => g.received));
    case 'closed': return maxDate(group.flatMap((g) => [g.closed_on, g.downgraded_on])); // a downgrade closes the old product
    case 'downgrade': return maxDate(group.map((g) => g.downgraded_on));
    default: return null;
  }
}

export function evaluate(item, rules, all, today) {
  const rule = ruleFor(item, rules);
  if (!rule) return { rule: null, code: 'no_rule', text: 'No rule on file', eligibleFrom: null, nextApplication: null };
  const group = covered(rule, item, all);
  const nextApplication = rule.min_days_between != null ? ((d) => (d ? addDays(d, rule.min_days_between) : null))(maxDate(group.map((g) => g.applied_on))) : null;
  const base = { rule: rule.name, verified: !!rule.verified, nextApplication };
  if (rule.once_per_lifetime) {
    if (group.some((g) => g.counted || g.earned)) return { ...base, code: 'once', text: 'Once per lifetime: already used', eligibleFrom: null };
    return { ...base, code: 'eligible', text: 'Eligible now', eligibleFrom: null };
  }
  if (rule.blocked_while_held && group.some((g) => g.held)) return { ...base, code: 'held', text: 'You still hold a matching account or card', eligibleFrom: null };
  if (rule.wait_months == null) return { ...base, code: 'unknown_wait', text: 'Rule has no wait period set', eligibleFrom: null };
  const anchor = anchorDate(rule, group);
  if (!anchor) return { ...base, code: 'missing_date', text: 'Missing the date the wait counts from', eligibleFrom: null };
  const eligibleFrom = addMonths(anchor, rule.wait_months);
  return eligibleFrom <= today
    ? { ...base, code: 'eligible', text: 'Eligible now', eligibleFrom }
    : { ...base, code: 'wait', text: `Eligible from ${eligibleFrom}`, eligibleFrom };
}
