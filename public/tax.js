// Tax support center. Information only. Everything is built with h(), so stored text is never parsed as markup.
import { h, get, post, money, fmtDate, shell, go, params, emptyState, render } from './app.js';
import { row, LABELS, editor } from './offers.js';

const lab = (m, v) => m[v] || String(v ?? '').replaceAll('_', ' ');
const reload = () => render();
const TABS = [['overview', 'Overview'], ['gains', 'Capital gains'], ['receipts', 'Receipts and medical'], ['slips', 'Slips and income'], ['room', 'Registered room'], ['years', 'Years and carry-forwards'], ['review', 'Review']];
const year = () => { const y = Number(params().get('y')); return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : new Date().getFullYear(); };
const stat = (k, v) => h('div', {}, h('span', {}, k), h('strong', { class: 'num' }, v));
const info = (t) => h('p', { class: 'muted small' }, t);
const to = (tab, y) => go(`/tax?tab=${tab}&y=${y}`);

function yearBar(tab, y) {
  return h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => to(tab, y - 1) }, `${y - 1}`), h('h2', { class: 'grow center' }, `Tax year ${y}`), h('button', { class: 'btn small', onclick: () => to(tab, y + 1) }, `${y + 1}`));
}

async function overviewTab(y) {
  const o = await get(`/api/tax/overview?year=${y}`);
  const g = o.gains;
  return [h('div', { class: 'card' }, yearBar('overview', y), info(o.note),
    h('div', { class: 'stat-row' }, stat('Net capital gain', g ? money(g.net_cents) : 'n/a'), stat('Taxable half (estimate)', g ? money(g.taxable_estimate_cents) : 'n/a'), stat('Investment fees', money(o.fees.total_cents)), stat('Donations', money(o.donations_cents))),
    h('div', { class: 'stat-row' }, stat('Loan interest paid', o.carrying_interest ? money(o.carrying_interest.interest_cents) : 'n/a'), stat('Its tax value (estimate)', o.carrying_interest && o.carrying_interest.tax_value_cents != null ? money(o.carrying_interest.tax_value_cents) : 'set a rate under Years'),
      stat('Best 12-month medical', o.medical.best_window ? money(o.medical.best_window.total_cents) : 'n/a'), stat('Medical claim (estimate)', o.medical.claim_estimate_cents != null ? money(o.medical.claim_estimate_cents) : 'n/a')),
    o.superficial.length ? h('div', { class: 'notice warn' }, `${o.superficial.length} sale${o.superficial.length === 1 ? '' : 's'} at a loss may be superficial losses: ${o.superficial.map((s) => `${s.security} ${s.date}`).join(', ')}.`) : null,
    h('a', { class: 'btn', href: `/api/tax/export.csv?year=${y}`, download: '' }, 'Download CSV for tax software')),
  h('div', { class: 'card' }, h('h2', {}, 'Checklist'), h('ul', { class: 'list' }, o.checklist.map((c) => h('li', {}, h('label', { class: 'item static check' }, h('input', { type: 'checkbox', checked: c.done, onchange: async (e) => { await post('/api/tax/checklist', { year: y, item: c.item, done: e.target.checked }); } }), ` ${c.label}`))))),
  h('div', { class: 'card' }, h('h2', {}, `Bonuses received in ${y}`), info('Amounts come from the Bonus ledger. Set the tax treatment on each bonus record; cash bonuses may be taxable and some issuers send no slip.'),
    o.bonuses.length ? h('ul', { class: 'list' }, o.bonuses.map((b) => row(`${b.issuer} ${b.title}`, `${b.received_on ? fmtDate(b.received_on) : ''} · ${b.tax_flag ? lab(LABELS.tax_flag, b.tax_flag) : 'no tax flag yet'}`, money(b.received_cents || 0), () => go('/cards?tab=ledger'), !b.tax_flag))) : emptyState('No bonuses received this year', '')),
  o.carry.length ? h('div', { class: 'card' }, h('h2', {}, 'Carry-forwards'), h('ul', { class: 'list' }, o.carry.map((c) => row(lab(LABELS.carry_kind, c.kind), `from ${c.from_year}`, money(c.amount_cents - (c.used_cents || 0)), () => editor('carry', 'carry', c, reload), false)))) : null];
}

async function gainsTab(y) {
  const [r, tr] = await Promise.all([get('/api/tax/acb'), get('/api/offers/trades')]);
  const hn = new Map();
  return [h('div', { class: 'card' }, yearBar('gains', y), info(r.note),
    r.warnings.length ? h('div', { class: 'notice warn' }, h('ul', {}, r.warnings.map((w) => h('li', {}, w)))) : null,
    h('div', { class: 'table-wrap' }, h('h3', {}, 'By year (Schedule 3 style)'), r.years.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Year', 'Proceeds', 'Cost', 'Gains', 'Losses', 'Net', 'Loss carried in', 'Taxable half (estimate)'].map((x) => h('th', {}, x)))),
      h('tbody', {}, r.years.map((z) => h('tr', {}, h('td', {}, z.year), [z.proceeds_cents, z.cost_cents, z.gains_cents, z.losses_cents, z.net_cents, z.carry_applied_cents, z.taxable_estimate_cents].map((c) => h('td', { class: 'num' }, money(c))))))) : emptyState('No sales yet', 'Add buys and sells below.'))),
  h('div', { class: 'card' }, h('h2', {}, 'Positions (average cost)'), r.positions.length ? h('ul', { class: 'list' }, r.positions.map((p) => row(p.security, `${p.qty} units · ${money(Math.round(p.acb_per_unit_cents))} each`, money(p.acb_cents), () => {}, false))) : emptyState('No positions', '')),
  h('div', { class: 'card' }, h('h2', {}, `Sales`), r.sales.length ? h('ul', { class: 'list' }, r.sales.map((s) => row(`${s.security} ${s.date}`, [s.qty ? `${s.qty} units` : null, `proceeds ${money(s.proceeds_cents)}`, `cost ${money(s.cost_cents)}`, s.note].filter(Boolean).join(' · '), [h('div', { class: 'num' }, money(s.gain_cents)), s.superficial_warning ? h('span', { class: 'pill warn' }, 'Superficial loss?') : null], () => {}, false))) : emptyState('No sales', '')),
  h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Trades'), h('button', { class: 'btn primary', onclick: () => editor('trades', 'trades', null, reload) }, 'Add trade')),
    tr.items.length ? h('ul', { class: 'list' }, tr.items.map((t) => row(`${t.security}: ${lab(LABELS.trade_kind, t.kind)}`, [fmtDate(t.trade_date), t.qty != null ? `${t.qty} units` : null, t.fx_rate ? `rate ${t.fx_rate}` : null, t.registered ? 'registered (left out)' : null].filter(Boolean).join(' · '), money(t.amount_cents), () => editor('trades', 'trades', t, reload), false)))
      : emptyState('No trades yet', 'Enter every buy, reinvested distribution, return of capital, split and sale per security, across all brokers. Moving shares between brokers keeps the cost base, so do not enter it as a sale.'))];
}

async function receiptsTab(y) {
  const [rc, ov] = await Promise.all([get('/api/offers/receipts'), get(`/api/tax/overview?year=${y}`)]);
  const mine = rc.items.filter((x) => x.tax_year === y); const m = ov.medical;
  return [h('div', { class: 'card' }, yearBar('receipts', y),
    m.best_window ? h('div', { class: 'stat-row' }, stat('Best 12-month window', `${fmtDate(m.best_window.start)} to ${fmtDate(m.best_window.end)}`), stat('Medical in that window', money(m.best_window.total_cents)), stat('Threshold', m.threshold_cents != null ? money(m.threshold_cents) : 'n/a'), stat('Claim (estimate)', m.claim_estimate_cents != null ? money(m.claim_estimate_cents) : 'n/a')) : null,
    info(m.note), Object.keys(m.by_person).length ? info(`By person: ${Object.entries(m.by_person).map(([p, c]) => `${p} ${money(c)}`).join(', ')}`) : null),
  h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Receipts'), h('button', { class: 'btn primary', onclick: () => editor('receipts', 'receipts', null, reload) }, 'Add receipt')),
    mine.length ? h('ul', { class: 'list' }, mine.map((x) => row(`${lab(LABELS.receipt_category, x.category)}: ${x.payee || ''}`.trim(), [fmtDate(x.spent_on), x.person, x.reimbursed_cents ? `${money(x.reimbursed_cents)} reimbursed` : null, x.claimed ? 'claimed' : 'not claimed'].filter(Boolean).join(' · '), money(x.amount_cents), () => editor('receipts', 'receipts', x, reload), false)))
      : emptyState('No receipts for this year', 'Medical expenses can be claimed for any 12-month period ending in the tax year; the best window is found for you. Receipt scans can be linked from paperless-ngx in a later release.'))];
}

async function slipsTab(y) {
  const [ov, sl] = await Promise.all([get(`/api/tax/overview?year=${y}`), get('/api/offers/slips')]);
  const kinds = { t5_interest: 'T5 interest', t5_dividends: 'T5 dividends', t3: 'T3' };
  return [h('div', { class: 'card' }, yearBar('slips', y), info('Expected amounts come from the income you recorded (Investments, Loan and income records) in non-registered accounts. Enter each real slip when it arrives and the difference shows.'),
    ov.slips.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Institution', 'Slip', 'Expected', 'On the slip', 'Difference'].map((x) => h('th', {}, x)))),
      h('tbody', {}, ov.slips.map((s) => h('tr', {}, h('td', {}, s.institution), h('td', {}, kinds[s.kind] || lab(LABELS.slip_kind, s.kind)), h('td', { class: 'num' }, money(s.expected_cents)), h('td', { class: 'num' }, s.actual_cents == null ? 'not entered' : money(s.actual_cents)), h('td', { class: 'num' }, s.difference_cents == null ? '' : money(s.difference_cents))))))) : emptyState('Nothing expected', '')),
  h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Slips received'), h('button', { class: 'btn primary', onclick: () => editor('slips', 'slips', null, reload) }, 'Add slip')),
    sl.items.length ? h('ul', { class: 'list' }, sl.items.map((x) => row(`${x.institution}: ${lab(LABELS.slip_kind, x.kind)}`, `Tax year ${x.tax_year}`, money(x.amount_cents), () => editor('slips', 'slips', x, reload), false))) : emptyState('No slips entered', ''))];
}

async function roomTab(y) {
  const { items } = await get('/api/offers/room'); const mine = items.filter((x) => x.tax_year === y);
  return [h('div', { class: 'card' }, yearBar('room', y), info('Enter room from your CRA My Account (and the RESP grant figures from your provider). These are your figures: the app does not look anything up.'),
    h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'Room'), h('button', { class: 'btn primary', onclick: () => editor('room', 'room', null, reload) }, 'Add room')),
    mine.length ? h('ul', { class: 'list' }, mine.map((x) => row(`${lab(LABELS.room_account, x.account)}${x.person ? ` (${x.person})` : ''}`, `Room ${money(x.room_cents)} · contributed ${money(x.contributed_cents || 0)}`, money(x.room_cents - (x.contributed_cents || 0)), () => editor('room', 'room', x, reload), false))) : emptyState('No room entered for this year', ''))];
}

async function yearsTab() {
  const [ty, cf] = await Promise.all([get('/api/offers/tax_years'), get('/api/offers/carry')]);
  return [h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Income and rates by year'), h('button', { class: 'btn primary', onclick: () => editor('tax_years', 'tax_years', null, reload) }, 'Add year')),
    info('The marginal rate turns loan interest into an estimated tax value everywhere it is shown. Rates and thresholds change each year: update them from the CRA or your tax software and check the date of the last change in the note.'),
    ty.items.length ? h('ul', { class: 'list' }, ty.items.map((x) => row(`${x.year}${x.person ? ` · ${x.person}` : ''}`, [x.marginal_pct != null ? `marginal rate ${x.marginal_pct}%` : 'no rate', x.income_cents != null ? `income ${money(x.income_cents)}` : null, x.note].filter(Boolean).join(' · '), '', () => editor('tax_years', 'tax_years', x, reload), false))) : emptyState('No years yet', 'Add the current year with your net income and marginal rate.')),
  h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Carry-forwards'), h('button', { class: 'btn primary', onclick: () => editor('carry', 'carry', null, reload) }, 'Add carry-forward')),
    cf.items.length ? h('ul', { class: 'list' }, cf.items.map((x) => row(lab(LABELS.carry_kind, x.kind), `from ${x.from_year}${x.note ? ` · ${x.note}` : ''}`, money(x.amount_cents - (x.used_cents || 0)), () => editor('carry', 'carry', x, reload), false))) : emptyState('No carry-forwards', 'Net capital losses from earlier years are applied against gains in the capital gains table.'))];
}

async function reviewTab(y) {
  const r = await get(`/api/tax/review?year=${y}`);
  return [h('div', { class: 'card' }, yearBar('review', y), info(r.note), info('Each finding shows the numbers behind it. Nothing here tells you to buy, sell or file in a particular way.')),
    ...(r.findings.length ? r.findings.map((f) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', { class: 'grow' }, f.title), h('span', { class: 'pill' + (f.level === 'check' ? ' warn' : '') }, f.level === 'check' ? 'Worth checking' : 'For information')),
      f.numbers.length ? h('ul', {}, f.numbers.map((n) => h('li', {}, n))) : null, h('p', { class: 'muted' }, f.note), h('p', { class: 'muted small' }, f.accountant))) : [h('div', { class: 'card' }, emptyState('No findings', 'Add room, receipts, holdings with cost base and tax years to give the review more to work with.'))])];
}

export async function viewTax() {
  const tab = params().get('tab') || 'overview'; const y = year();
  const bar = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': k === tab ? 'true' : 'false', onclick: () => to(k, y) }, l)));
  const body = tab === 'gains' ? await gainsTab(y) : tab === 'receipts' ? await receiptsTab(y) : tab === 'slips' ? await slipsTab(y) : tab === 'room' ? await roomTab(y) : tab === 'years' ? await yearsTab() : tab === 'review' ? await reviewTab(y) : await overviewTab(y);
  return shell('Tax', [bar, body]);
}
