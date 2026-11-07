// Smith Manoeuvre tracker maths. Informational only: not tax advice.
import { addMonths, daysBetween } from './dates.js';

const REGISTERED = ['rrsp', 'tfsa', 'fhsa', 'resp'];
const clampDay = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate())).padStart(2, '0')}`;
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);

// Tax value of interest: interest x marginal rate for that year. Null when no rate is saved for the year.
export function taxValue(year, interestCents, taxYears) {
  const t = taxYears.find((y) => y.year === year && y.marginal_pct != null) || null;
  return t ? Math.round(interestCents * t.marginal_pct / 100) : null;
}

// Monthly interest-capitalizing reminders per Smith loan. Open and overdue until an event for that month exists.
export function capitalizationReminders(loans, events, today, months = 6) {
  const out = [];
  for (const l of loans) {
    if (!l.cap_day) continue;
    const [ty, tm] = today.split('-').map(Number);
    for (let k = -months; k <= 1; k++) {
      const t = ty * 12 + (tm - 1) + k; const y = Math.floor(t / 12), m = (t - y * 12) + 1;
      const due = clampDay(y, m, l.cap_day);
      if (l.opened_on && due < l.opened_on) continue;
      const ym = due.slice(0, 7);
      const done = events.find((e) => e.debt_id === l.id && e.kind === 'capitalized_interest' && e.event_date.slice(0, 7) === ym);
      if (done) continue;
      out.push({ debt_id: l.id, loan: l.name, month: ym, due, overdue: due < today, days: daysBetween(today, due) });
    }
  }
  return out.sort((a, b) => (a.due < b.due ? -1 : 1));
}

export function summary({ debts, holdings, events, income, taxYears, today, rise = [1, 2] }) {
  const loans = debts.filter((d) => d.smith);
  const inv = holdings.filter((h) => h.smith);
  const warnings = [];
  const debtTotal = sum(loans, (l) => l.balance_cents), invValue = sum(inv, (h) => h.value_cents), acb = sum(inv, (h) => h.acb_cents ?? 0);
  const years = [...new Set([...events.map((e) => +e.event_date.slice(0, 4)), +today.slice(0, 4)])].sort((a, b) => b - a);
  const byLoan = new Map(loans.map((l) => [l.id, l]));
  const smithEvents = events.filter((e) => byLoan.has(e.debt_id));
  const interestOf = (list) => sum(list.filter((e) => e.kind === 'capitalized_interest' || e.kind === 'interest_paid'), (e) => e.amount_cents);
  const perYear = years.map((y) => {
    const ev = smithEvents.filter((e) => +e.event_date.slice(0, 4) === y); const interest = interestOf(ev);
    const inc = income.filter((i) => +i.event_date.slice(0, 4) === y && inv.some((h) => h.id === i.holding_id));
    const tv = taxValue(y, interest, taxYears);
    return { year: y, interest_cents: interest, borrowed_to_invest_cents: sum(ev.filter((e) => e.kind === 'advance_invest'), (e) => e.amount_cents), principal_paid_cents: sum(ev.filter((e) => e.kind === 'principal_paid'), (e) => e.amount_cents),
      income_cents: sum(inc, (i) => i.amount_cents), dividends_cents: sum(inc.filter((i) => i.kind === 'dividend'), (i) => i.amount_cents), roc_cents: sum(inc.filter((i) => i.kind === 'return_of_capital'), (i) => i.amount_cents),
      tax_value_cents: tv, tax_value_is_estimate: true };
  });
  const cumulative = interestOf(smithEvents);
  const cumTv = perYear.reduce((s, y) => s + (y.tax_value_cents ?? 0), 0);
  const unrated = perYear.filter((y) => y.interest_cents > 0 && y.tax_value_cents == null).map((y) => y.year);
  const net = invValue - debtTotal;
  for (const h of inv) if (REGISTERED.includes(h.account_type)) warnings.push({ level: 'check', text: `${h.name} is a registered account (${h.account_type.toUpperCase()}) but is tagged as Smith Manoeuvre. Interest on money borrowed to invest inside RRSP, TFSA, FHSA or RESP accounts is not deductible.` });
  for (const e of smithEvents.filter((e) => e.kind === 'advance_other')) warnings.push({ level: 'check', text: `${e.event_date}: ${e.amount_cents / 100} advanced for something other than investing. Mixing personal use into the investment loan can break the link between the borrowing and the investment.` });
  for (const e of smithEvents.filter((e) => e.kind === 'advance_invest' && !e.holding_id)) warnings.push({ level: 'check', text: `${e.event_date}: an investing advance of ${e.amount_cents / 100} is not matched to a purchase. Choose the holding it bought so the trail is kept.` });
  for (const i of income.filter((x) => x.kind === 'return_of_capital' && x.reinvested === 0 && inv.some((h) => h.id === x.holding_id))) warnings.push({ level: 'info', text: `${i.event_date}: return of capital of ${i.amount_cents / 100} was not reinvested. Money taken out of the investment can weaken the link to the loan.` });
  const overdue = capitalizationReminders(loans, events, today).filter((r) => r.overdue);
  if (unrated.length) warnings.push({ level: 'info', text: `No marginal tax rate is saved for ${unrated.join(', ')}, so the estimated refund is not shown for those years (set it in Tax).` });
  const stress = rise.map((r) => ({ rise_pct: r, extra_per_year_cents: Math.round(sum(loans, (l) => l.balance_cents * r / 100)), after_tax_extra_cents: null }));
  const rate = taxYears.find((y) => y.year === +today.slice(0, 4))?.marginal_pct;
  if (rate != null) for (const s of stress) s.after_tax_extra_cents = Math.round(s.extra_per_year_cents * (1 - rate / 100));
  const limit = sum(loans.filter((l) => l.limit_cents != null), (l) => l.limit_cents), used = sum(loans.filter((l) => l.limit_cents != null), (l) => l.balance_cents);
  const mortgage = loans.filter((l) => l.loan_type === 'mortgage');
  const pu = (x) => { try { return typeof x === 'string' ? JSON.parse(x) : x || []; } catch { return []; } };
  return { loans: loans.map((l) => ({ ...l, unconfirmed: pu(l.unconfirmed), room_cents: l.limit_cents != null ? l.limit_cents - l.balance_cents : null })), holdings: inv,
    totals: { debt_cents: debtTotal, investment_cents: invValue, acb_cents: acb, unrealised_cents: acb ? invValue - acb : null, net_position_cents: net, borrowing_room_cents: limit ? limit - used : null, mortgage_cents: sum(mortgage, (l) => l.balance_cents),
      interest_cumulative_cents: cumulative, tax_value_cumulative_cents: cumTv, net_after_tax_value_cents: net + cumTv },
    per_year: perYear, warnings, overdue, reminders: capitalizationReminders(loans, events, today), stress,
    note: 'Information only, not tax advice. Interest is deductible only when the borrowed money is used to earn income from a non-registered investment and the trail from loan to investment is clear. The refund figure is an estimate at the marginal rate you saved for each year.' };
}

export function exportRows(loans, events, year) {
  const rows = [['Loan', 'Date', 'Kind', 'Amount', 'Matched holding', 'Note']];
  for (const e of events.filter((x) => +x.event_date.slice(0, 4) === year).sort((a, b) => (a.event_date < b.event_date ? -1 : 1))) {
    const l = loans.find((x) => x.id === e.debt_id); if (!l) continue;
    rows.push([l.name, e.event_date, e.kind, (e.amount_cents / 100).toFixed(2), e.holding_id ?? '', e.note || '']);
  }
  return rows;
}
export { addMonths };
