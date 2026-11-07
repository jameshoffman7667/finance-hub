// Wealth overview: balance sheet, cash flow, projection, potential spends. Everything is built with h().
import { h, get, put, patch, money, fmtDate, shell, go, params, emptyState, today, render } from './app.js';
import { row, LABELS, editor } from './offers.js';

const reload = () => render();
const TABS = [['balance', 'Balance sheet'], ['cashflow', 'Cash flow'], ['projection', 'Projection'], ['spends', 'Planned and potential spends'], ['settings', 'Settings and categories']];
const stat = (k, v, sub) => h('div', {}, h('span', {}, k), h('strong', { class: 'num' }, v), sub ? h('span', { class: 'small muted' }, sub) : null);
const info = (t) => h('p', { class: 'muted small' }, t);
const iso = (d) => d.toISOString().slice(0, 10);
const monthLabel = (m) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function chart(series, label) {
  const W = 600, H = 200, P = 8; const all = series.flatMap((s) => s.points);
  if (all.length < 2) return null;
  const lo = Math.min(...all), hi = Math.max(...all), pad = Math.max((hi - lo) * 0.1, 100); const min = lo - pad, max = hi + pad; const n = series[0].points.length;
  const x = (i) => P + (i * (W - 2 * P)) / (n - 1), y = (v) => H - 24 - ((v - min) / (max - min || 1)) * (H - 40);
  return h('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label },
    ...series.map((s) => h('polyline', { class: s.cls, points: s.points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') })),
    h('text', { x: P, y: H - 6 }, series[0].from), h('text', { x: W - P, y: H - 6, 'text-anchor': 'end' }, series[0].to));
}

function group(title, map, totalKey, rows) {
  const items = Object.entries(map).filter(([, l]) => l.length);
  return items.length ? h('div', {}, h('h3', {}, title), items.map(([k, l]) => h('div', {}, h('div', { class: 'row' }, h('strong', { class: 'grow' }, k.replaceAll('_', ' ')), h('span', { class: 'num' }, money(rows[k]))), h('ul', { class: 'list' }, l.map((r) => h('li', {}, h('div', { class: 'item static' }, h('div', { class: 'grow' }, r.name, h('span', { class: 'muted small' }, r.as_of ? ` · as of ${fmtDate(r.as_of)}` : '')), h('span', { class: 'num' }, money(r.cents))))))))) : null;
}

async function balanceTab() {
  const q = params(); const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get('d') || '') ? q.get('d') : today();
  const b = await get(`/api/wealth/balance?date=${date}`);
  const di = h('input', { type: 'date', id: 'bsd', value: date, onchange: (e) => go(`/wealth?tab=balance&d=${e.target.value}`) });
  const pl = b.planner_loans;
  return [h('div', { class: 'card' }, h('div', { class: 'formgrid' }, h('div', { class: 'field' }, h('label', { for: 'bsd' }, 'As of'), di)),
    h('div', { class: 'stat-row' }, stat('Assets', money(b.total_assets_cents)), stat('Debts', money(b.total_liabilities_cents)), stat('Net worth', money(b.net_worth_cents))),
    h('div', { class: 'stat-row' }, stat('Smith Manoeuvre investments', money(b.smith_investments_cents)), stat('Smith Manoeuvre loans', money(pl.smith_cents)), stat('Tied up in offers', money(b.tied_up_in_offers_cents))), info(b.note)),
  h('div', { class: 'card' }, h('h2', {}, 'What you own'), group('Assets', b.assets, 'asset_totals', b.asset_totals) || emptyState('No account values yet', 'Record balances under Accounts and imports.')),
  h('div', { class: 'card' }, h('h2', {}, 'What you owe'), group('Debts', b.liabilities, 'liability_totals', b.liability_totals),
    pl.smith.length || pl.other.length ? h('div', {}, h('h3', {}, 'Loans in the planner'), [...pl.smith.map((x) => ({ ...x, tag: 'Smith Manoeuvre' })), ...pl.other.map((x) => ({ ...x, tag: 'Other' }))].map((x) => h('div', { class: 'row' }, h('span', { class: 'grow' }, `${x.name} · ${x.tag}`), h('span', { class: 'num' }, money(x.cents))))) : null)];
}

async function cashflowTab() {
  const q = params(); const t = today();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.get('from') || '') ? q.get('from') : `${t.slice(0, 7)}-01`, to = /^\d{4}-\d{2}-\d{2}$/.test(q.get('to') || '') ? q.get('to') : t;
  const f = await get(`/api/wealth/cashflow?from=${from}&to=${to}`);
  const preset = (label, a, b) => h('button', { class: 'btn small', onclick: () => go(`/wealth?tab=cashflow&from=${a}&to=${b}`) }, label);
  const y = new Date().getUTCFullYear();
  const fi = h('input', { type: 'date', id: 'cff', value: from }), ti = h('input', { type: 'date', id: 'cft', value: to });
  const sect = (side, title) => h('div', {}, h('h3', {}, title), f.groups.filter((g) => g.side === side).map((g) => h('details', { open: g.total_cents !== 0 }, h('summary', {}, `${g.label}: ${money(g.total_cents)}`),
    g.lines.length ? h('ul', { class: 'list' }, g.lines.map((l) => h('li', {}, h('div', { class: 'item static' }, h('span', { class: 'grow' }, l.label), h('span', { class: 'num' }, money(l.cents)))))) : h('p', { class: 'muted small' }, 'Nothing in this range'))));
  return [h('div', { class: 'card' }, h('div', { class: 'row' }, preset('This month', `${t.slice(0, 7)}-01`, t), preset('Last 12 months', iso(new Date(Date.UTC(y, new Date().getUTCMonth() - 11, 1))), t), preset(`${y}`, `${y}-01-01`, t), preset(`${y - 1}`, `${y - 1}-01-01`, `${y - 1}-12-31`)),
    h('div', { class: 'formgrid' }, h('div', { class: 'field' }, h('label', { for: 'cff' }, 'From'), fi), h('div', { class: 'field' }, h('label', { for: 'cft' }, 'To'), ti)), h('button', { class: 'btn', onclick: () => go(`/wealth?tab=cashflow&from=${fi.value}&to=${ti.value}`) }, 'Show'),
    h('div', { class: 'stat-row' }, stat('Income', money(f.income_cents)), stat('Spending and debt service', money(f.spend_cents)), stat('Net cash flow', money(f.net_cash_flow_cents))),
    h('div', { class: 'stat-row' }, stat('Loan principal repaid (not spending)', money(f.principal_repaid_cents)), stat('Investment growth (unrealised, not cash)', f.growth.accounts ? money(f.growth.cents) : 'n/a'), stat('Net including growth (estimate)', f.growth.accounts ? money(f.net_with_growth_cents) : 'n/a')),
    f.warnings.map((w) => h('div', { class: 'notice' }, w)), f.notes.map(info)),
  h('div', { class: 'card' }, sect('income', 'Income'), sect('spend', 'Spending'))];
}

async function projectionTab() {
  const p = await get('/api/wealth/projection');
  const n = p.months.length; const step = Math.max(1, Math.floor(n / 12));
  const ch = chart([{ points: p.with_considering.map((m) => m.wealth_cents), cls: 'line line2', from: monthLabel(p.months[0].month), to: monthLabel(p.months.at(-1).month) }, { points: p.months.map((m) => m.wealth_cents), cls: 'line', from: monthLabel(p.months[0].month), to: monthLabel(p.months.at(-1).month) }], `Projected wealth to ${monthLabel(p.months.at(-1).month)}`);
  return [h('div', { class: 'card' }, h('div', { class: 'stat-row' }, stat('Wealth today', money(p.start.net_worth_cents)), stat(`In ${p.settings.horizon_years} years`, money(p.end_wealth_cents)), stat('With the ones you are considering', money(p.end_wealth_with_cents))),
    h('div', { class: 'stat-row' }, stat('Average monthly income', money(p.averages.income_cents)), stat('Average monthly spending', money(p.averages.spend_cents)), stat('Rate +1% on the HELOC costs', money(p.rate_rise_test.difference_cents), 'change in end wealth')),
    p.note ? h('div', { class: 'notice' }, p.note) : null, ch, h('p', { class: 'small muted' }, 'Solid line: plan as it stands. Second line: with spends you are only considering.'),
    p.negative_months.length ? h('div', { class: 'notice warn' }, `Months where cash flow turns negative (with considering spends): ${p.negative_months.slice(0, 12).map(monthLabel).join(', ')}${p.negative_months.length > 12 ? '…' : ''}`) : null),
  h('div', { class: 'card' }, h('h2', {}, 'Assumptions'), h('ul', {}, p.assumptions.map((a) => h('li', {}, a))), p.payouts.length ? h('p', { class: 'muted small' }, `Bonus payouts included: ${p.payouts.map((x) => `${x.label} ${money(x.cents)} on ${fmtDate(x.date)}`).join('; ')}`) : null),
  h('div', { class: 'card' }, h('h2', {}, 'Month by month (first 24)'), h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Month', 'Income', 'Spending', 'Special', 'Net cash flow', 'Growth', 'Wealth'].map((x) => h('th', {}, x)))),
    h('tbody', {}, p.months.filter((_, i) => i < 24).map((m) => h('tr', {}, h('td', {}, monthLabel(m.month)), [m.income_cents, m.spend_cents, m.special_cents, m.net_cash_flow_cents, m.growth_cents, m.wealth_cents].map((c) => h('td', { class: 'num' }, money(c)))))))))];
}

async function spendsTab() {
  const [{ items }, ] = await Promise.all([get('/api/wealth/items')]);
  const st = { considering: 'Considering', approved: 'Approved', dropped: 'Dropped' };
  const li = (x) => h('li', {}, row(x.name, [LABELS.plan_kind?.[x.kind] || x.kind.replaceAll('_', ' '), x.recurrence, fmtDate(x.start_date), x.card ? `${x.card.label}: ${x.card.still_needed_cents != null ? `${money(x.card.still_needed_cents)} of spend still needed` : 'no spend target'}` : null].filter(Boolean).join(' · '), [h('div', { class: 'num' }, money(x.amount_cents)), h('span', { class: 'pill' + (x.status === 'approved' ? ' ok' : '') }, st[x.status])], () => editor('plan_items', 'plan_items', x, reload), false),
    x.status === 'considering' ? h('div', { class: 'row actions' }, h('button', { class: 'btn small', onclick: async () => { await patch(`/api/offers/plan_items/${x.id}`, { status: 'approved' }); reload(); } }, 'Approve'), h('button', { class: 'btn small', onclick: async () => { await patch(`/api/offers/plan_items/${x.id}`, { status: 'dropped' }); reload(); } }, 'Drop')) : null);
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Planned and potential spends'), h('button', { class: 'btn primary', onclick: () => editor('plan_items', 'plan_items', { status: 'considering', kind: 'potential', recurrence: 'once', start_date: today() }, reload) }, 'Add')),
    info('Annual special items (insurance, fuel, business costs) repeat each year in their month. Extraordinary items and potential spends count once approved. Spends you are only considering show in the "with" line of the projection. Link a card to see its remaining minimum spend.'),
    items.length ? h('ul', { class: 'list' }, items.map(li)) : emptyState('Nothing planned yet', 'Add yearly costs, big purchases and spends you are considering.'));
}

async function settingsTab() {
  const [s, c] = await Promise.all([get('/api/wealth/settings'), get('/api/wealth/categories')]);
  const err = h('p', { class: 'form-error', role: 'alert' });
  const f = (id, v) => h('input', { id, inputmode: 'decimal', value: v });
  const lb = f('wl', s.lookback_months), hz = f('wh', s.horizon_years), gr = f('wg', s.growth_pct), rr = f('wr', s.rate_rise_pct);
  const sur = h('input', { type: 'checkbox', id: 'ws', checked: s.invest_surplus }), ig = h('input', { type: 'checkbox', id: 'wi', checked: s.include_growth });
  const save = async () => { err.className = 'form-error'; err.textContent = ''; try { await put('/api/wealth/settings', { lookback_months: Number(lb.value), horizon_years: Number(hz.value), growth_pct: Number(gr.value), rate_rise_pct: Number(rr.value), invest_surplus: sur.checked, include_growth: ig.checked }); err.className = 'muted'; err.textContent = 'Saved'; } catch (x) { err.textContent = x.message; } };
  const groupsFor = (kind) => Object.entries(s.groups).filter(([k]) => (kind === 'income') === k.startsWith('income'));
  return [h('div', { class: 'card' }, h('h2', {}, 'Projection settings'), h('div', { class: 'formgrid' },
    h('div', { class: 'field' }, h('label', { for: 'wl' }, 'Look-back for averages (months)'), lb), h('div', { class: 'field' }, h('label', { for: 'wh' }, 'Projection length (years)'), hz),
    h('div', { class: 'field' }, h('label', { for: 'wg' }, 'Assumed investment return (% a year; 0 turns growth off)'), gr), h('div', { class: 'field' }, h('label', { for: 'wr' }, 'Extra HELOC rate to test (%)'), rr)),
    h('label', { class: 'check' }, sur, ' Cash left over each month is invested'), h('label', { class: 'check' }, ig, ' Show totals including unrealised investment growth'), err, h('button', { class: 'btn primary', onclick: save }, 'Save')),
  h('div', { class: 'card' }, h('h2', {}, 'Where each category goes in cash flow'), info('Income categories default to Employment and spending categories to Run rate. Move a category to put it under another group. Transfers are always left out.'),
    c.items.filter((x) => x.kind !== 'transfer' && !x.archived).length ? h('ul', { class: 'list' }, c.items.filter((x) => x.kind !== 'transfer' && !x.archived).map((x) => {
      const sel = h('select', { 'aria-label': `Group for ${x.name}`, onchange: async (e) => { try { await patch(`/api/wealth/categories/${x.id}`, { flow_group: e.target.value || null }); } catch (er) { alert(er.message); reload(); } } }, h('option', { value: '' }, 'Default'), groupsFor(x.kind).map(([k, l]) => h('option', { value: k, selected: x.flow_group === k }, l)));
      return h('li', {}, h('div', { class: 'item static' }, h('span', { class: 'grow' }, `${x.name} (${x.kind})`), sel));
    })) : emptyState('No categories yet', 'Categories come from your budget.'))];
}

export async function viewWealth() {
  const tab = params().get('tab') || 'balance';
  const bar = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': k === tab ? 'true' : 'false', onclick: () => go(`/wealth?tab=${k}`) }, l)));
  const body = tab === 'cashflow' ? await cashflowTab() : tab === 'projection' ? await projectionTab() : tab === 'spends' ? await spendsTab() : tab === 'settings' ? await settingsTab() : await balanceTab();
  return shell('Wealth', [bar, body]);
}
