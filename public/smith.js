// Investments page: Smith Manoeuvre tracker. Everything is built with h(), so stored text is never parsed as markup.
import { h, get, post, money, fmtDate, shell, go, params, emptyState, render } from './app.js';
import { row, LABELS, editor } from './offers.js';

const lab = (m, v) => m[v] || String(v ?? '').replaceAll('_', ' ');
const stat = (k, v, sub) => h('div', {}, h('span', {}, k), h('strong', { class: 'num' }, v), sub ? h('span', { class: 'small muted' }, sub) : null);
const reload = () => render();
const TABS = [['smith', 'Smith Manoeuvre'], ['records', 'Loan and income records']];

async function smithTab() {
  const s = await get('/api/smith/summary');
  const t = s.totals; const year = new Date().getFullYear();
  const out = [];
  if (s.overdue.length) out.push(h('div', { class: 'notice warn' }, h('strong', {}, `${s.overdue.length} interest capitalization${s.overdue.length === 1 ? '' : 's'} overdue: `), s.overdue.map((r) => `${r.loan} ${r.month}`).join(', ')));
  out.push(h('div', { class: 'card' }, h('h2', {}, 'Where you stand'),
    h('div', { class: 'stat-row' }, stat('Loan balance', money(t.debt_cents)), stat('Investments', money(t.investment_cents)), stat('Net position', money(t.net_position_cents))),
    h('div', { class: 'stat-row' }, stat('Cost base', money(t.acb_cents)), stat('Unrealised', t.unrealised_cents == null ? 'n/a' : money(t.unrealised_cents)), stat('Borrowing room', t.borrowing_room_cents == null ? 'n/a' : money(t.borrowing_room_cents))),
    h('div', { class: 'stat-row' }, stat('Interest so far', money(t.interest_cumulative_cents)), stat('Estimated tax value (estimate)', money(t.tax_value_cumulative_cents)), stat('Net position with that value (estimate)', money(t.net_after_tax_value_cents))),
    h('p', { class: 'muted small' }, s.note)));
  if (s.warnings.length) out.push(h('div', { class: 'card' }, h('h2', {}, 'Things to check'), h('ul', {}, s.warnings.map((w) => h('li', {}, w.text)))));
  const reminders = s.reminders;
  out.push(h('div', { class: 'card' }, h('h2', {}, 'Monthly: capitalize the interest'),
    h('p', { class: 'muted small' }, 'A reminder stays open until you record the capitalizing advance with its amount from the statement. Mark the loan with an interest day in the loan record.'),
    reminders.length ? h('ul', { class: 'list' }, reminders.map((r) => {
      const amt = h('input', { inputmode: 'decimal', placeholder: 'Amount', 'aria-label': `Interest capitalized, ${r.loan} ${r.month}`, class: 'narrow' }); const err = h('span', { class: 'form-error', role: 'alert' });
      return h('li', {}, h('div', { class: 'item static' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, `${r.loan}: ${r.month}`), h('div', { class: 'muted small' }, `${r.overdue ? 'Overdue since' : 'Due'} ${fmtDate(r.due)}`)),
        h('div', { class: 'row' }, amt, h('button', { class: 'btn small', onclick: async () => { err.textContent = ''; try { await post(`/api/smith/loans/${r.debt_id}/capitalized`, { month: r.month, amount_cents: Math.round(parseFloat(amt.value) * 100) }); reload(); } catch (x) { err.textContent = x.message; } } }, 'Confirm'), err)));
    })) : emptyState('Nothing open', 'Reminders appear for loans tagged Smith Manoeuvre that have an interest day.')));
  out.push(h('div', { class: 'card' }, h('h2', {}, 'Interest by year'), s.per_year.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Year', 'Interest', 'Tax value (estimate)', 'Borrowed to invest', 'Principal paid', 'Income', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, s.per_year.map((y) => h('tr', {}, h('td', {}, y.year), h('td', { class: 'num' }, money(y.interest_cents)), h('td', { class: 'num' }, y.tax_value_cents == null ? 'set a rate in Tax' : money(y.tax_value_cents)), h('td', { class: 'num' }, money(y.borrowed_to_invest_cents)),
        h('td', { class: 'num' }, money(y.principal_paid_cents)), h('td', { class: 'num' }, money(y.income_cents)), h('td', {}, h('a', { class: 'btn small', href: `/api/smith/export.csv?year=${y.year}`, download: '' }, 'Download CSV'))))))) : emptyState('No records yet', 'Add loan records (advances, capitalized interest) to see interest by year.')));
  if (s.stress.length && t.debt_cents) out.push(h('div', { class: 'card' }, h('h2', {}, 'If rates rise'), h('ul', {}, s.stress.map((x) => h('li', {}, `+${x.rise_pct}%: ${money(x.extra_per_year_cents)} more interest a year${x.after_tax_extra_cents != null ? `, about ${money(x.after_tax_extra_cents)} after the estimated tax value` : ''}`)))));
  out.push(h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Loans'), h('button', { class: 'btn primary', onclick: () => editor('debts', 'debts', null, reload) }, 'Add loan')),
    s.loans.length ? h('ul', { class: 'list' }, s.loans.map((l) => row(l.name, [lab(LABELS.loan_type, l.loan_type), `${l.rate}%`, l.limit_cents != null ? `limit ${money(l.limit_cents)}` : null, l.cap_day ? `interest on day ${l.cap_day}` : 'no interest day (no reminders)'].filter(Boolean).join(' · '), money(l.balance_cents), () => editor('debts', 'debts', l, reload), l.unconfirmed?.length > 0)))
      : emptyState('No Smith Manoeuvre loans', 'Add a loan and answer "Bought with borrowed money" with Yes. Holdings are tagged the same way on the Cards and bonuses > Holdings tab.'), h('p', { class: 'muted small' }, 'Holdings (value and cost base) are edited under Cards and bonuses, Holdings and debts.')));
  return out;
}

async function recordsTab() {
  const [le, ie, debts, holds] = await Promise.all([get('/api/offers/loan_events'), get('/api/offers/income_events'), get('/api/offers/debts'), get('/api/offers/holdings')]);
  const dn = new Map(debts.items.map((d) => [d.id, d.name])), hn = new Map(holds.items.map((x) => [x.id, x.name]));
  return [h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Loan records'), h('button', { class: 'btn primary', onclick: () => editor('loan_events', 'loan_events', null, reload) }, 'Add loan record')),
    le.items.length ? h('ul', { class: 'list' }, le.items.map((e) => row(`${dn.get(e.debt_id) || 'Loan'}: ${lab(LABELS.loan_event_kind, e.kind)}`, [fmtDate(e.event_date), e.holding_id ? `bought ${hn.get(e.holding_id) || ''}` : null, e.note].filter(Boolean).join(' · '), money(e.amount_cents), () => editor('loan_events', 'loan_events', e, reload), false)))
      : emptyState('No loan records', 'Record each advance, the capitalized interest and any payment.')),
  h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Income received'), h('button', { class: 'btn primary', onclick: () => editor('income_events', 'income_events', null, reload) }, 'Add income')),
    ie.items.length ? h('ul', { class: 'list' }, ie.items.map((e) => row(`${hn.get(e.holding_id) || 'Holding'}: ${lab(LABELS.income_kind, e.kind)}`, [fmtDate(e.event_date), e.reinvested === 1 ? 'reinvested' : e.reinvested === 0 ? 'not reinvested' : null].filter(Boolean).join(' · '), money(e.amount_cents), () => editor('income_events', 'income_events', e, reload), false)))
      : emptyState('No income recorded', 'Dividends, interest and return of capital feed the tax slip check and the Smith summary.'))];
}

export async function viewInvest() {
  const tab = params().get('tab') || 'smith';
  const bar = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': k === tab ? 'true' : 'false', onclick: () => go(`/invest?tab=${k}`) }, l)));
  return shell('Investments', [bar, tab === 'records' ? await recordsTab() : await smithTab()]);
}
