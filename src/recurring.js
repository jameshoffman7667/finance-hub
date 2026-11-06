import { addDays, addMonths, daysBetween } from './dates.js';

export const FREQUENCIES = {
  weekly: { days: 7, perYear: 52, label: 'Weekly' }, biweekly: { days: 14, perYear: 26, label: 'Every 2 weeks' },
  monthly: { months: 1, perYear: 12, label: 'Monthly' }, bimonthly: { months: 2, perYear: 6, label: 'Every 2 months' },
  quarterly: { months: 3, perYear: 4, label: 'Quarterly' }, semiannual: { months: 6, perYear: 2, label: 'Every 6 months' },
  yearly: { months: 12, perYear: 1, label: 'Yearly' },
};

// First charge on or after `today`, counting forward from any known charge date. Null when ended or not active.
export function nextCharge(r, today) {
  const f = FREQUENCIES[r.frequency];
  if (!f || !r.anchor_date || r.status !== 'active') return null;
  let d;
  if (f.days) {
    const gap = daysBetween(r.anchor_date, today);
    d = gap <= 0 ? r.anchor_date : addDays(r.anchor_date, Math.ceil(gap / f.days) * f.days);
  } else {
    d = r.anchor_date;
    for (let k = 0; d < today && k < 2000; k++) d = addMonths(r.anchor_date, f.months * (k + 1));
  }
  return r.end_date && d > r.end_date ? null : d;
}
export const yearlyCents = (r) => Math.round(r.amount_cents * (FREQUENCIES[r.frequency]?.perYear ?? 0));
export const monthlyCents = (r) => Math.round(yearlyCents(r) / 12);
