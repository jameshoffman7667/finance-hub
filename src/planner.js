// Offer evaluator and bonus ledger maths. Fixed rules, no AI. Money is integer cents, rates are percent numbers (3 = 3%).
import { addDays, daysBetween, addMonths } from './dates.js';

export const DEFAULTS = {
  benchmark: 7, worth_per_hour_cents: 5000, score_cost_cents: 0,
  effort_hours: { credit_card: 2, bank_account: 4, investment_transfer: 4 },
  points: {
    Aeroplan: { cash: 1.0, best: 2.0, source: 'Credit Card Genius; Prince of Travel 2.1', on: '2026-11-04' },
    'Amex Membership Rewards': { cash: 1.0, best: 2.0, source: 'Credit Card Genius; Prince of Travel 2.2', on: '2026-11-04' },
    'RBC Avion': { cash: 1.0, best: 2.0, source: 'Prince of Travel (to 2.33)', on: '2026-11-04' },
    'Scene+': { cash: 1.0, best: 1.0, source: 'Credit Card Genius', on: '2026-11-04' },
    'BMO Rewards': { cash: 0.67, best: 0.67, source: 'Credit Card Genius; Prince of Travel', on: '2026-11-04' },
    'Marriott Bonvoy': { cash: 0.97, best: 0.97, source: 'Credit Card Genius', on: '2026-11-04' },
    'TD Rewards': { cash: 0.4, best: 0.5, source: 'Prince of Travel (0.5 via Expedia for TD)', on: '2026-11-04' },
  },
};

const typeKey = (t) => (['rrsp', 'tfsa', 'resp', 'fhsa'].includes(t) ? 'registered' : t === 'registered' ? 'registered' : 'nonreg');
export const poolOf = typeKey;

export function parsePayouts(offer) {
  if (!offer?.payouts) return [];
  try { const a = typeof offer.payouts === 'string' ? JSON.parse(offer.payouts) : offer.payouts; return Array.isArray(a) ? a : []; } catch { return []; }
}

// Bonus for a qualifying amount: rate by pool, capped, nothing under the minimum, or the fixed amount.
export function bonusFor(offer, amounts) {
  const reg = amounts.registered || 0, non = amounts.nonreg || 0;
  const total = reg + non;
  if (offer.min_cents != null && total < offer.min_cents) return 0;
  if (offer.fixed_cents != null && offer.rate_registered == null && offer.rate_nonreg == null) return offer.fixed_cents;
  let b = Math.round(reg * (offer.rate_registered ?? 0) / 100) + Math.round(non * (offer.rate_nonreg ?? 0) / 100);
  if (offer.cap_cents != null) b = Math.min(b, offer.cap_cents);
  return b;
}

// Dated cash flows of a bonus: payout list (percent of total or explicit cents), else one payment at hold_until.
export function schedule(offer, bonus) {
  const p = parsePayouts(offer);
  if (!p.length) return bonus > 0 ? [{ date: offer.hold_until || offer.fund_by || null, cents: bonus }] : [];
  const out = p.map((x) => ({ date: x.date, cents: x.cents != null ? x.cents : Math.round(bonus * x.pct / 100) }));
  if (p.every((x) => x.pct != null)) { const diff = bonus - out.reduce((s, x) => s + x.cents, 0); if (out.length) out[out.length - 1].cents += diff; }
  return out;
}

// Annual rate (percent) whose present value of dated flows is zero. Flows: [{date, cents}] (negative = money out).
export function irr(flows) {
  const f = flows.filter((x) => x.date && x.cents);
  if (f.length < 2) return null;
  const t0 = f[0].date;
  const npv = (r) => f.reduce((s, x) => s + x.cents / Math.pow(1 + r, daysBetween(t0, x.date) / 365), 0);
  let lo = -0.9, hi = 5;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid; }
  return Math.round(((lo + hi) / 2) * 10000) / 100;
}

const yearsBetween = (a, b) => Math.max(0, daysBetween(a, b)) / 365;

// What moving capital into an offer is worth.
// opt: { offer, amounts:{registered,nonreg}, start, invested, interest_rate, debts[], bonus_value_cents (card) }
export function evaluateOffer(opt, settings = DEFAULTS) {
  const o = opt.offer; const bm = settings.benchmark ?? DEFAULTS.benchmark;
  if (o.kind === 'credit_card') return evaluateCard(opt, settings);
  const capital = (opt.amounts.registered || 0) + (opt.amounts.nonreg || 0);
  const assumptions = [];
  const bonus = bonusFor(o, opt.amounts);
  const pay = schedule(o, bonus);
  const end = o.hold_until || (pay.length ? pay[pay.length - 1].date : null);
  const start = opt.start || o.hold_from;
  const years = start && end ? yearsBetween(start, end) : null;
  const simple = years && capital ? Math.round((bonus / capital / years) * 10000) / 100 : null;
  const flows = start && end && capital ? [{ date: start, cents: -capital }, { date: end, cents: capital }, ...pay.map((x) => ({ date: x.date, cents: x.cents }))].sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
  const irrPct = flows.length ? irr(flows) : null;
  // Opportunity cost only for capital that is not still earning (cash that cannot be invested).
  const cashLike = opt.invested === false || opt.invested === 0;
  const oppRate = cashLike ? Math.max(0, bm - (opt.interest_rate || 0)) : 0;
  const opportunity = cashLike && years ? Math.round(capital * oppRate / 100 * years) : 0;
  const interestEarned = cashLike && years && o.interest_pct != null ? Math.round(capital * o.interest_pct / 100 * years) : 0;
  const fee = o.annual_fee_cents && years ? Math.round(o.annual_fee_cents * Math.max(1, Math.ceil(years))) : 0;
  const net = bonus + interestEarned - opportunity - fee;
  if (o.withdrawal_effect === 'unknown' || (!o.withdrawal_scope || o.withdrawal_scope === 'unknown') && ['reduces_qualifying_amount', 'allowed_up_to_percent', 'forfeits_all_remaining'].includes(o.withdrawal_effect)) assumptions.push('Whether a withdrawal counts per account or across all accounts is not confirmed. Treated as pooled across accounts.');
  if (!opt.actual_transfer) assumptions.push('The amount and date of the real transfer are not known yet. The result uses the figures entered here.');
  if (!o.verified) assumptions.push('These terms are not confirmed against the issuer\'s own page.');
  const debt = debtFlag({ capital, annualReturn: irrPct ?? simple, cashLike, smith: opt.smith, debts: opt.debts });
  return { kind: o.kind, bonus_cents: bonus, schedule: pay, capital_cents: capital, lock_from: start || null, lock_to: end, lock_years: years == null ? null : Math.round(years * 100) / 100,
    annual_return_pct: simple, irr_pct: irrPct, opportunity_cost_cents: opportunity, interest_earned_cents: interestEarned, fees_cents: fee, net_cents: net, debt, assumptions };
}

function debtFlag({ capital, annualReturn, cashLike, smith, debts }) {
  if (!debts?.length || smith) return null;
  if (!cashLike) return null; // invested capital is not compared with debt rates (settled rule)
  const worst = debts.reduce((m, d) => (d.rate > (m?.rate ?? -1) ? d : m), null);
  if (!worst || annualReturn == null) return null;
  return worst.rate > annualReturn ? { name: worst.name, rate: worst.rate, text: `Your ${worst.name} costs ${worst.rate}% a year, more than this offer returns (${annualReturn}%). Paying it down may be better.` } : null;
}

export function pointsValue(points, program, vals = DEFAULTS.points) {
  const v = vals[program]; if (!points) return { cash_cents: 0, best_cents: 0, known: !!v };
  if (!v) return { cash_cents: null, best_cents: null, known: false };
  return { cash_cents: Math.round(points * v.cash), best_cents: Math.round(points * v.best), known: true };
}

function evaluateCard(opt, settings) {
  const o = opt.offer; const assumptions = [];
  const pv = pointsValue(o.points, o.program, settings.points);
  let bonus = o.fixed_cents ?? 0;
  if (o.points) { if (pv.known) bonus += pv.cash_cents; else assumptions.push(`No point value is saved for "${o.program || 'this program'}", so the points are not counted.`); }
  const fee = o.annual_fee_cents || 0, interest = opt.interest_cents || 0, spend = opt.extra_spend_cents || 0;
  const score = settings.score_cost_cents ?? 0;
  const net = bonus - fee - interest - spend - score;
  if (o.spend_cents && !opt.extra_spend_cents) assumptions.push('The required spend is assumed to be spending you would do anyway.');
  assumptions.push('A hard credit check and a new account can lower your score for a while. A dollar cost per application can be set in Planner settings.');
  return { kind: 'credit_card', bonus_cents: bonus, best_bonus_cents: o.fixed_cents != null || o.points ? (o.fixed_cents ?? 0) + (pv.best_cents ?? 0) : null, fees_cents: fee, interest_cents: interest, extra_spend_cents: spend, score_cost_cents: score,
    net_cents: net, schedule: bonus ? [{ date: o.hold_until || null, cents: bonus }] : [], capital_cents: 0, lock_years: null, annual_return_pct: null, irr_pct: null, opportunity_cost_cents: 0, assumptions, debt: null };
}

// Bonus an existing offer would still pay if capital leaves on asOf. current: { offer, counted:{registered,nonreg}, move:{registered,nonreg}, asOf }
export function forfeited(cur) {
  const o = cur.offer; const asOf = cur.asOf; const assumptions = [];
  const total = bonusFor(o, cur.counted);
  const pay = schedule(o, total);
  const remaining = pay.filter((x) => x.date > asOf);
  const remainingCents = remaining.reduce((s, x) => s + x.cents, 0);
  const moveTotal = (cur.move.registered || 0) + (cur.move.nonreg || 0);
  const counted = (cur.counted.registered || 0) + (cur.counted.nonreg || 0);
  if (!o.withdrawal_scope || o.withdrawal_scope === 'unknown') assumptions.push('Whether a withdrawal counts per account or across all accounts is not confirmed. Treated as pooled across accounts.');
  const eff = o.withdrawal_effect || 'unknown';
  if (eff === 'none') return { forfeited_cents: 0, remaining_payments: remaining.length, remaining_cents: remainingCents, rule: 'Moving does not affect this offer', assumptions };
  if (eff === 'forfeits_all_remaining') return { forfeited_cents: moveTotal > 0 ? remainingCents : 0, remaining_payments: remaining.length, remaining_cents: remainingCents, rule: 'Any withdrawal forfeits everything still unpaid', assumptions };
  if (eff === 'allowed_up_to_percent') {
    const limit = Math.round(counted * (o.withdrawal_percent ?? 0) / 100);
    const over = moveTotal > limit;
    return { forfeited_cents: over ? remainingCents : 0, remaining_payments: remaining.length, remaining_cents: remainingCents, allowed_cents: limit,
      rule: `Moving more than ${o.withdrawal_percent}% (${(limit / 100).toFixed(0)} dollars) forfeits everything still unpaid`, assumptions };
  }
  if (eff === 'reduces_qualifying_amount') {
    const after = { registered: Math.max(0, (cur.counted.registered || 0) - (cur.move.registered || 0)), nonreg: Math.max(0, (cur.counted.nonreg || 0) - (cur.move.nonreg || 0)) };
    const lost = total - bonusFor(o, after);
    const frac = total ? remainingCents / total : 0;
    return { forfeited_cents: Math.round(lost * frac), remaining_payments: remaining.length, remaining_cents: remainingCents, rule: 'Moving reduces the qualifying amount, so the bonus shrinks', assumptions };
  }
  assumptions.push('The effect of moving money out of this offer is not known. Nothing is counted as forfeited until you set it.');
  return { forfeited_cents: 0, remaining_payments: remaining.length, remaining_cents: remainingCents, rule: 'Unknown', assumptions };
}

// Compare keeping a holding where it is against moving it into target offers.
// holding: { value_cents, account_type, invested, interest_rate, smith, counted_cents }; current: offer it earns under (or null)
export function compare({ holding, current, targets, start, today, debts, settings = DEFAULTS, countedAmounts, otherCounted }) {
  const pool = poolOf(holding.account_type);
  const amt = (c) => ({ registered: pool === 'registered' ? c : 0, nonreg: pool === 'nonreg' ? c : 0 });
  const capital = holding.value_cents;
  const base = (current && current.hold_until && current.hold_until >= today) ? {
    offer: current, counted: countedAmounts || amt(holding.counted_cents ?? capital),
  } : null;
  const stay = base ? (() => {
    const total = bonusFor(current, otherCounted || base.counted);
    const pay = schedule(current, total);
    return { label: 'Stay', bonus_cents: total, schedule: pay, remaining_cents: pay.filter((x) => x.date > today).reduce((s, x) => s + x.cents, 0), lock_to: current.hold_until };
  })() : { label: 'Stay', bonus_cents: 0, schedule: [], remaining_cents: 0, lock_to: null };
  const options = targets.map((t) => {
    const ev = evaluateOffer({ offer: t, amounts: amt(capital), start: start || today, invested: holding.invested, interest_rate: holding.interest_rate, debts, smith: holding.smith, actual_transfer: false }, settings);
    const fo = base ? forfeited({ offer: current, counted: base.counted, move: amt(capital), asOf: today }) : { forfeited_cents: 0, assumptions: [], remaining_cents: 0, remaining_payments: 0, rule: '' };
    const gain = ev.net_cents - fo.forfeited_cents;
    const extraYears = stay.lock_to && ev.lock_to ? Math.max(0, yearsBetween(stay.lock_to, ev.lock_to)) : ev.lock_years;
    const breakeven = gain > 0 && extraYears && capital ? Math.round((gain / capital / extraYears) * 10000) / 100 : null;
    const taxWarn = pool === 'nonreg' ? ['Moving a non-registered holding may trigger a taxable gain, and selling at a loss then buying back can be a superficial loss. Information only.'] : [];
    if (holding.smith) taxWarn.push('This holding is marked as bought with borrowed money. Moving it can break the tracing needed for the interest deduction. Information only.');
    return { offer_id: t.id, issuer: t.issuer, product: t.product, ...ev, forfeited_cents: fo.forfeited_cents, forfeited_rule: fo.rule, remaining_payments: fo.remaining_payments,
      net_vs_stay_cents: gain, breakeven_pct: breakeven, assumptions: [...new Set([...ev.assumptions, ...fo.assumptions])], warnings: taxWarn };
  }).sort((a, b) => (b.irr_pct ?? b.annual_return_pct ?? -1e9) - (a.irr_pct ?? a.annual_return_pct ?? -1e9));
  return { stay, options };
}

// ---------- ledger ----------
export function entryTotals(e, settings = DEFAULTS, effort = []) {
  const gross = e.received_cents ?? 0;
  const costs = (e.fees_cents || 0) + (e.interest_cents || 0) + (e.transfer_fee_cents || 0) + (e.fx_cents || 0);
  let years = null, opp = 0;
  if (e.capital_cents && e.locked_from && e.locked_to) {
    years = yearsBetween(e.locked_from, e.locked_to);
    if (e.capital_earning === 0) opp = Math.round(e.capital_cents * (settings.benchmark ?? 7) / 100 * years);
  }
  const net = gross - costs - opp;
  const hours = effort.reduce((s, x) => s + x.hours, 0);
  const annual = years && e.capital_cents ? Math.round((net / e.capital_cents / years) * 10000) / 100 : null;
  const per_hour = hours ? Math.round(net / hours) : null;
  return { gross_cents: gross, costs_cents: costs, opportunity_cents: opp, net_cents: net, hours, annual_return_pct: annual, per_hour_cents: per_hour,
    worth_it: per_hour == null ? null : per_hour >= (settings.worth_per_hour_cents ?? 5000), estimate: opp > 0 || e.status === 'pending' || e.status === 'partly_paid' };
}

export function report(entries, effortBy, settings = DEFAULTS) {
  const rows = entries.map((e) => ({ ...e, t: entryTotals(e, settings, effortBy.get(e.id) || []) }));
  const sum = (list) => ({ count: list.length, gross_cents: list.reduce((s, r) => s + r.t.gross_cents, 0), net_cents: list.reduce((s, r) => s + r.t.net_cents, 0), expected_cents: list.reduce((s, r) => s + (r.expected_cents || 0), 0),
    hours: list.reduce((s, r) => s + r.t.hours, 0), estimate: list.some((r) => r.t.estimate) });
  const group = (keyFn) => { const m = new Map(); for (const r of rows) { const k = keyFn(r); (m.get(k) || m.set(k, []).get(k)).push(r); } return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([k, list]) => { const s = sum(list); return { key: k, ...s, per_hour_cents: s.hours ? Math.round(s.net_cents / s.hours) : null, worth_it: s.hours ? Math.round(s.net_cents / s.hours) >= (settings.worth_per_hour_cents ?? 5000) : null }; }); };
  const done = rows.filter((r) => r.received_on);
  return { rows, total: { ...sum(rows), per_hour_cents: sum(rows).hours ? Math.round(sum(rows).net_cents / sum(rows).hours) : null },
    by_year: group((r) => (r.received_on || r.locked_from || 'No date').slice(0, 4)), by_kind: group((r) => r.kind), by_issuer: group((r) => r.issuer), received_count: done.length };
}

// Averages of finished offers, proposed as the new expected hours (owner confirms).
export function proposeEffort(entries, logs, current) {
  const byKind = {};
  for (const e of entries) {
    if (!['paid', 'clawed_back', 'forfeited'].includes(e.status)) continue;
    const h = logs.filter((l) => l.ref_type === 'ledger' && l.ref_id === e.id).reduce((s, l) => s + l.hours, 0);
    if (!h) continue;
    const k = e.kind === 'card' ? 'credit_card' : e.kind === 'bank' ? 'bank_account' : 'investment_transfer';
    (byKind[k] ||= []).push(h);
  }
  const out = {};
  for (const [k, list] of Object.entries(byKind)) {
    const avg = Math.round((list.reduce((s, x) => s + x, 0) / list.length) * 10) / 10;
    out[k] = { average: avg, samples: list.length, current: current[k], differs: Math.abs(avg - current[k]) >= 0.5 };
  }
  return out;
}

// Dated plan steps from an offer's terms.
export function planFromOffer(o) {
  const steps = [];
  const add = (date, title, note) => { if (date) steps.push({ step_date: date, title, note: note || '', remind: 1 }); };
  add(o.enrol_by, `Enrol: ${o.issuer} ${o.product}`, 'Enrol or register for the offer before this date.');
  add(o.fund_by, `Finish funding by this date: ${o.issuer} ${o.product}`, o.qualifies || '');
  add(o.hold_from, `Hold period starts: ${o.issuer}`, 'Do not withdraw or transfer out until the hold period ends.');
  for (const p of parsePayouts(o)) add(p.date, `Bonus due: ${o.issuer} ${o.product}`, 'Check that the bonus arrived.');
  add(o.hold_until, `Hold period ends: ${o.issuer} ${o.product}`, 'Money can leave without losing the bonus.');
  add(o.window_end, `Offer window closes: ${o.issuer} ${o.product}`, '');
  return steps.sort((a, b) => (a.step_date < b.step_date ? -1 : a.step_date > b.step_date ? 1 : 0));
}
export { addDays, addMonths };
