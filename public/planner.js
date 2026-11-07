// Offer planner and bonus ledger screens. Everything is built with h(), so stored text is never parsed as markup.
import { h, get, post, put, patch, del, money, fmtDate, go, params, dialog, emptyState, today, render } from './app.js';
import { schema, row, LABELS, editor } from './offers.js';

const pct = (v) => (v == null ? 'n/a' : `${v}%`);
const lab = (map, v) => map[v] || String(v ?? '').replaceAll('_', ' ');
const reload = () => render();
const lines = (arr, cls = 'small muted') => (arr && arr.length ? h('ul', { class: cls }, arr.map((x) => h('li', {}, x))) : null);
const pill = (t, c = '') => h('span', { class: `pill ${c}` }, t);

// ---------- offers ----------
export async function offersTab() {
  const { items } = await get('/api/offers/offers');
  const li = (o) => h('li', {},
    h('button', { class: 'item', onclick: () => editor('offers', 'offers', o, reload) },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, `${o.issuer} ${o.product}`),
        h('div', { class: 'muted small' }, [lab(LABELS.offer_kind, o.kind), o.window_end ? `ends ${fmtDate(o.window_end)}` : null, o.hold_until ? `hold to ${fmtDate(o.hold_until)}` : null, o.verified ? null : 'unverified'].filter(Boolean).join(' · '))),
      h('div', { class: 'right' }, pill(lab(LABELS.offer_status, o.status), o.status === 'earning' || o.status === 'paid' ? 'ok' : ''))),
    h('div', { class: 'row actions' },
      h('button', { class: 'btn small', onclick: async () => { await post('/api/planner/plans', { offer_id: o.id }); go('/cards?tab=plans'); } }, 'Make a plan'),
      h('button', { class: 'btn small', onclick: async () => { await post(`/api/planner/ledger/from-offer/${o.id}`, {}); go('/cards?tab=ledger'); } }, 'Track the bonus')));
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Offers and their terms'), h('button', { class: 'btn primary', onclick: () => editor('offers', 'offers', null, reload) }, 'Add offer')),
    h('p', { class: 'muted small' }, 'Save the terms of an offer as you read them, with the link. Anything you are not sure about, leave blank: the comparison lists it as an assumption. Terms change, so check the issuer\'s page before acting.'),
    items.length ? h('ul', { class: 'list' }, items.map(li)) : emptyState('No offers yet', 'Add the terms of an offer you are weighing or already in.'));
}

// ---------- holdings and debts ----------
export async function holdingsTab() {
  const [hs, ds] = await Promise.all([get('/api/offers/holdings'), get('/api/offers/debts')]);
  const total = hs.items.reduce((s, x) => s + x.value_cents, 0);
  return [h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Holdings'), h('button', { class: 'btn primary', onclick: () => editor('holdings', 'holdings', null, reload) }, 'Add holding')),
    h('p', { class: 'muted small' }, 'Accounts whose money could move to an offer. Use rounded amounts if you prefer. Only the last 4 digits of any account number belong anywhere in this app.'),
    hs.items.length ? [h('ul', { class: 'list' }, hs.items.map((x) => row(`${x.institution || ''} ${x.name}`.trim(), [lab(LABELS.holding_type, x.account_type), x.invested === 0 ? 'cash (not invested)' : 'invested', x.smith ? 'borrowed money' : null].filter(Boolean).join(' · '), h('div', { class: 'num' }, money(x.value_cents)), () => editor('holdings', 'holdings', x, reload), x.unconfirmed.length > 0))), h('p', { class: 'muted small' }, `Total ${money(total)}`)] : emptyState('No holdings yet', 'Add the accounts you might move.')),
  h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Debts'), h('button', { class: 'btn primary', onclick: () => editor('debts', 'debts', null, reload) }, 'Add debt')),
    ds.items.length ? h('ul', { class: 'list' }, ds.items.map((x) => row(x.name, [x.kind, `${x.rate}% a year`, x.smith ? 'borrowed to invest' : null].filter(Boolean).join(' · '), h('div', { class: 'num' }, money(x.balance_cents)), () => editor('debts', 'debts', x, reload), false)))
      : emptyState('No debts recorded', 'Offers paying less than your debt costs are flagged when you add them here.'))];
}

// ---------- compare ----------
function resultCard(o, stay) {
  return h('div', { class: 'cmp card' }, h('h3', {}, `${o.issuer} ${o.product}`),
    h('dl', { class: 'kv' },
      ...[['Bonus', money(o.bonus_cents)], ['Return per year', pct(o.irr_pct ?? o.annual_return_pct)], ['Locked', o.lock_years != null ? `${o.lock_years} years` : 'n/a'], ['Gives up by leaving', money(o.forfeited_cents)],
        ['Opportunity cost', money(o.opportunity_cost_cents)], ['Net versus staying', money(o.net_vs_stay_cents)], ['Break-even', o.breakeven_pct != null ? `${o.breakeven_pct}% a year` : 'n/a']].flatMap(([k, v]) => [h('dt', {}, k), h('dd', { class: 'num' }, v)])),
    o.schedule.length ? h('p', { class: 'small muted' }, `Paid: ${o.schedule.map((s) => `${money(s.cents)} ${s.date ? fmtDate(s.date) : ''}`).join(', ')}`) : null,
    o.forfeited_rule ? h('p', { class: 'small muted' }, o.forfeited_rule) : null,
    o.debt ? h('div', { class: 'notice warn' }, o.debt.text) : null,
    (o.warnings || []).map((w) => h('div', { class: 'notice' }, w)),
    o.assumptions.length ? h('details', {}, h('summary', {}, `${o.assumptions.length} assumption${o.assumptions.length === 1 ? '' : 's'} to confirm`), lines(o.assumptions)) : null);
}
export async function compareTab() {
  const [hs, os] = await Promise.all([get('/api/offers/holdings'), get('/api/offers/offers')]);
  const out = h('div', {}); const err = h('p', { class: 'form-error', role: 'alert' });
  if (!hs.items.length || !os.items.length) return h('div', { class: 'card' }, h('h2', {}, 'Compare'), emptyState('Add a holding and at least one offer first', 'The comparison weighs staying where you are against moving a holding into each offer.'));
  const pick = h('select', { id: 'cmph' }, hs.items.map((x) => h('option', { value: x.id }, `${x.institution || ''} ${x.name} (${money(x.value_cents)})`)));
  const start = h('input', { id: 'cmps', type: 'date', value: today() });
  const checks = os.items.filter((o) => ['potential', 'enrolled', 'earning'].includes(o.status)).map((o) => ({ o, cb: h('input', { type: 'checkbox', value: o.id, 'aria-label': `${o.issuer} ${o.product}` }) }));
  const go1 = async () => {
    err.textContent = ''; out.replaceChildren();
    try {
      const ids = checks.filter((c) => c.cb.checked).map((c) => c.o.id);
      const r = await post('/api/planner/compare', { holding_id: Number(pick.value), offer_ids: ids, start: start.value });
      const best = r.options[0];
      out.replaceChildren(
        h('p', { class: 'muted' }, r.current ? `Today this holding counts toward ${r.current.issuer} ${r.current.product}: ${money(r.stay.bonus_cents)} bonus, ${money(r.stay.remaining_cents)} still to be paid.` : 'This holding is not counted toward an offer today.'),
        best ? h('div', { class: 'notice' }, `Highest return per year: ${best.issuer} ${best.product} at ${pct(best.irr_pct ?? best.annual_return_pct)}. Net versus staying: ${money(best.net_vs_stay_cents)}.`) : null,
        // Phone: stacked cards. Desktop: one table, options side by side.
        h('div', { class: 'only-phone' }, r.options.map((o) => resultCard(o, r.stay))),
        h('div', { class: 'only-desktop table-wrap' }, h('table', { class: 'cmp-table' },
          h('thead', {}, h('tr', {}, h('th', {}, ''), r.options.map((o) => h('th', {}, `${o.issuer} ${o.product}`)))),
          h('tbody', {}, [['Bonus', (o) => money(o.bonus_cents)], ['Return per year (IRR)', (o) => pct(o.irr_pct ?? o.annual_return_pct)], ['Locked', (o) => (o.lock_years != null ? `${o.lock_years} yr` : 'n/a')], ['Gives up by leaving', (o) => money(o.forfeited_cents)],
            ['Opportunity cost', (o) => money(o.opportunity_cost_cents)], ['Net versus staying', (o) => money(o.net_vs_stay_cents)], ['Break-even per year', (o) => (o.breakeven_pct != null ? `${o.breakeven_pct}%` : 'n/a')],
            ['Assumptions', (o) => (o.assumptions.length ? o.assumptions.join(' ') : 'None')]].map(([k, f]) => h('tr', {}, h('th', {}, k), r.options.map((o) => h('td', { class: 'num' }, f(o)))))))),
        h('p', { class: 'muted small' }, 'Offers are ranked by return per year, not total cash. This is arithmetic on the terms you saved, not advice.'));
    } catch (x) { err.textContent = x.message; }
  };
  return h('div', { class: 'card' }, h('h2', {}, 'Compare staying with moving'),
    h('div', { class: 'formgrid' }, h('div', { class: 'field' }, h('label', { for: 'cmph' }, 'Holding'), pick), h('div', { class: 'field' }, h('label', { for: 'cmps' }, 'Date the money would move'), start)),
    h('fieldset', {}, h('legend', {}, 'Offers to compare'), checks.length ? checks.map(({ o, cb }) => h('label', { class: 'check' }, cb, ` ${o.issuer} ${o.product}`)) : h('p', { class: 'muted' }, 'No potential, enrolled or earning offers.')),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: go1 }, 'Compare')), err, out);
}

// ---------- plans ----------
export async function plansTab() {
  const [{ items }, os] = await Promise.all([get('/api/planner/plans'), get('/api/offers/offers')]);
  const name = h('input', { id: 'pn', placeholder: 'Plan name' }); const offer = h('select', { id: 'po' }, h('option', { value: '' }, 'No offer (blank plan)'), os.items.map((o) => h('option', { value: o.id }, `${o.issuer} ${o.product}`)));
  const err = h('p', { class: 'form-error', role: 'alert' });
  const planCard = (p) => {
    const t = new Date().toISOString().slice(0, 10);
    return h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, p.name), h('button', { class: 'btn small danger', onclick: async () => { if (confirm('Delete this plan?')) { await del(`/api/planner/plans/${p.id}`); reload(); } } }, 'Delete')),
      p.steps.length ? h('ul', { class: 'list' }, p.steps.map((s) => h('li', {}, h('div', { class: 'item static' },
        h('input', { type: 'checkbox', checked: !!s.done, 'aria-label': `Done: ${s.title}`, onchange: async (e) => { await patch(`/api/planner/steps/${s.id}`, { done: e.target.checked }); reload(); } }),
        h('div', { class: 'grow' }, h('div', { class: 'title' + (s.done ? ' struck' : '') }, s.title), h('div', { class: 'muted small' }, [s.step_date ? fmtDate(s.step_date) : 'No date', s.note].filter(Boolean).join(' · '))),
        h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: !!s.remind, onchange: async (e) => { await patch(`/api/planner/steps/${s.id}`, { remind: e.target.checked }); } }), ' Remind'),
        h('button', { class: 'btn small', 'aria-label': 'Delete step', onclick: async () => { await del(`/api/planner/steps/${s.id}`); reload(); } }, 'Remove'))))) : emptyState('No steps yet', ''),
      (() => { const d = h('input', { type: 'date', 'aria-label': 'Step date', value: t }), ti = h('input', { placeholder: 'New step', 'aria-label': 'New step' });
        return h('div', { class: 'row' }, d, ti, h('button', { class: 'btn small', onclick: async () => { if (!ti.value.trim()) return; await post(`/api/planner/plans/${p.id}/steps`, { title: ti.value, step_date: d.value }); reload(); } }, 'Add step')); })());
  };
  return [h('div', { class: 'card' }, h('h2', {}, 'Make a plan'),
    h('p', { class: 'muted small' }, 'A plan turns an offer\'s dates into steps. Steps with Remind on appear in Reminders and on the Calendar.'),
    h('div', { class: 'formgrid' }, h('div', { class: 'field' }, h('label', { for: 'po' }, 'From offer'), offer), h('div', { class: 'field' }, h('label', { for: 'pn' }, 'Name (optional with an offer)'), name)),
    err, h('button', { class: 'btn primary', onclick: async () => { err.textContent = ''; try { await post('/api/planner/plans', { name: name.value, offer_id: offer.value ? Number(offer.value) : undefined }); reload(); } catch (x) { err.textContent = x.message; } } }, 'Create plan')),
  ...items.map(planCard)];
}

// ---------- ledger ----------
function effortDialog(entry, onDone) {
  dialog(`Time spent: ${entry.issuer} ${entry.title}`, (close) => {
    const hours = h('input', { id: 'ehr', inputmode: 'decimal', placeholder: '0.5' }), note = h('input', { id: 'enote', placeholder: 'What you did' }), on = h('input', { id: 'eon', type: 'date', value: today() });
    const err = h('p', { class: 'form-error', role: 'alert' }); const box = h('div', {});
    const loadLogs = async () => { const { items } = await get(`/api/planner/effort?ref_type=ledger&ref_id=${entry.id}`); box.replaceChildren(items.length ? h('ul', { class: 'list' }, items.map((l) => h('li', {}, h('div', { class: 'item static' }, h('div', { class: 'grow' }, `${l.hours} h on ${fmtDate(l.logged_on)}`, l.note ? ` · ${l.note}` : ''), h('button', { class: 'btn small', onclick: async () => { await del(`/api/planner/effort/${l.id}`); loadLogs(); } }, 'Remove'))))) : h('p', { class: 'muted' }, `No time logged yet. Expected: ${entry.expected_hours} hours.`)); };
    loadLogs();
    return h('div', {}, box, h('div', { class: 'formgrid' }, h('div', { class: 'field' }, h('label', { for: 'ehr' }, 'Hours'), hours), h('div', { class: 'field' }, h('label', { for: 'eon' }, 'Date'), on), h('div', { class: 'field' }, h('label', { for: 'enote' }, 'Note'), note)), err,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', onclick: () => { close(); onDone(); } }, 'Done'),
        h('button', { class: 'btn primary', onclick: async () => { err.textContent = ''; try { await post('/api/planner/effort', { ref_type: 'ledger', ref_id: entry.id, hours: hours.value, logged_on: on.value, note: note.value }); hours.value = ''; note.value = ''; loadLogs(); } catch (x) { err.textContent = x.message; } } }, 'Add time')));
  });
}
const tag = (r) => (r.estimate ? ' (estimate)' : '');
export async function ledgerTab() {
  const r = await get('/api/planner/report');
  const line = (g) => h('tr', {}, h('td', {}, lab(LABELS.ledger_kind, g.key)), h('td', { class: 'num' }, g.count), h('td', { class: 'num' }, money(g.gross_cents)), h('td', { class: 'num' }, money(g.net_cents) + tag(g)), h('td', { class: 'num' }, g.hours || ''), h('td', { class: 'num' }, g.per_hour_cents != null ? money(g.per_hour_cents) : ''), h('td', {}, g.worth_it == null ? '' : g.worth_it ? 'Worth it' : 'Below your line'));
  const table = (title, groups, kindLabels) => h('div', { class: 'table-wrap' }, h('h3', {}, title), h('table', {}, h('thead', {}, h('tr', {}, ['', 'Offers', 'Received', 'Net', 'Hours', 'Per hour', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, groups.map((g) => { const tr = line(g); if (!kindLabels) tr.firstChild.textContent = g.key; return tr; }))));
  const tot = r.total;
  return [h('div', { class: 'card' }, h('div', { class: 'stat-row' }, h('div', {}, h('span', {}, 'Received'), h('strong', { class: 'num' }, money(tot.gross_cents))), h('div', {}, h('span', {}, `Net${tot.estimate ? ' (estimate)' : ''}`), h('strong', { class: 'num' }, money(tot.net_cents))),
    h('div', {}, h('span', {}, 'Per hour'), h('strong', { class: 'num' }, tot.per_hour_cents != null ? money(tot.per_hour_cents) : 'n/a')), h('div', {}, h('span', {}, 'Expected, not yet received'), h('strong', { class: 'num' }, money(Math.max(0, tot.expected_cents - tot.gross_cents))))),
    h('p', { class: 'muted small' }, `Worth-it line: ${money(r.settings.worth_per_hour_cents)} per hour. Net takes off fees, interest, transfer and exchange costs, and the benchmark (${r.settings.benchmark}%) on locked money that was not earning. ${r.taxes}`)),
  h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Bonus records'), h('button', { class: 'btn primary', onclick: () => editor('ledger', 'ledger', null, reload) }, 'Add bonus')),
    r.rows.length ? h('ul', { class: 'list' }, r.rows.map((e) => h('li', {}, row(`${e.issuer} ${e.title}`,
      [lab(LABELS.ledger_kind, e.kind), lab(LABELS.ledger_status, e.status), e.received_on ? `received ${fmtDate(e.received_on)}` : null, e.t.hours ? `${e.t.hours} h` : `${e.expected_hours} h expected`, e.t.annual_return_pct != null ? `${e.t.annual_return_pct}% a year` : null].filter(Boolean).join(' · '),
      [h('div', { class: 'num' }, money(e.t.net_cents) + (e.t.estimate ? '*' : '')), e.t.worth_it == null ? null : pill(e.t.worth_it ? 'Worth it' : 'Below line', e.t.worth_it ? 'ok' : 'warn')],
      () => editor('ledger', 'ledger', e, reload), e.unconfirmed.length > 0),
      h('div', { class: 'row actions' }, h('button', { class: 'btn small', onclick: () => effortDialog(e, reload) }, 'Log time'))))) : emptyState('No bonuses tracked', 'Add one by hand or press "Track the bonus" on an offer.')),
  r.rows.length ? h('div', { class: 'card' }, table('By type', r.by_kind, true), table('By year', r.by_year, false), table('By issuer', r.by_issuer, false)) : null];
}

// ---------- settings ----------
export async function plannerSettingsTab() {
  const s = await get('/api/planner/settings');
  const err = h('p', { class: 'form-error', role: 'alert' });
  const bm = h('input', { id: 'sbm', inputmode: 'decimal', value: s.benchmark }), wp = h('input', { id: 'swp', inputmode: 'decimal', value: s.worth_per_hour_cents / 100 }), sc = h('input', { id: 'ssc', inputmode: 'decimal', value: s.score_cost_cents / 100 });
  const eff = Object.entries({ credit_card: 'Credit card', bank_account: 'Bank account', investment_transfer: 'Investment transfer' }).map(([k, l]) => ({ k, l, i: h('input', { id: `se-${k}`, inputmode: 'decimal', value: s.effort_hours[k] }) }));
  const pts = Object.entries(s.points).map(([name, v]) => ({ name, cash: h('input', { inputmode: 'decimal', value: v.cash, 'aria-label': `${name} cash cents per point` }), best: h('input', { inputmode: 'decimal', value: v.best, 'aria-label': `${name} best-use cents per point` }), src: h('input', { value: v.source || '', 'aria-label': `${name} source` }), on: v.on }));
  const save = async () => {
    err.textContent = ''; err.className = 'form-error';
    try {
      await put('/api/planner/settings', { benchmark: Number(bm.value), worth_per_hour_cents: Math.round(Number(wp.value) * 100), score_cost_cents: Math.round(Number(sc.value) * 100), effort_hours: Object.fromEntries(eff.map((e) => [e.k, Number(e.i.value)])),
        points: Object.fromEntries(pts.map((p) => [p.name, { cash: Number(p.cash.value), best: Number(p.best.value), source: p.src.value, on: today() }])) });
      err.className = 'muted'; err.textContent = 'Saved';
    } catch (x) { err.textContent = x.message; }
  };
  const props = Object.entries(s.proposals);
  return [h('div', { class: 'card' }, h('h2', {}, 'Planner settings'),
    h('div', { class: 'formgrid' },
      h('div', { class: 'field' }, h('label', { for: 'sbm' }, 'Benchmark return (% a year)'), bm), h('div', { class: 'field' }, h('label', { for: 'swp' }, 'Worth it from ($ per hour)'), wp), h('div', { class: 'field' }, h('label', { for: 'ssc' }, 'Cost of a credit check ($ per application)'), sc),
      eff.map((e) => h('div', { class: 'field' }, h('label', { for: `se-${e.k}` }, `Expected hours: ${e.l}`), e.i))),
    props.length ? h('div', { class: 'notice' }, h('div', {}, h('strong', {}, 'Averages from your finished offers'), props.map(([k, p]) => h('div', { class: 'row' }, h('span', { class: 'grow' }, `${lab({ credit_card: 'Credit card', bank_account: 'Bank account', investment_transfer: 'Investment transfer' }, k)}: ${p.average} h over ${p.samples} offer${p.samples === 1 ? '' : 's'} (now ${p.current} h)`),
      p.differs ? h('button', { class: 'btn small', onclick: () => { eff.find((e) => e.k === k).i.value = p.average; } }, 'Use this') : null)))) : null,
    h('h3', {}, 'Points: cents per point'), h('p', { class: 'muted small' }, 'Cash value is used in the numbers. Best use is shown beside it. Values come from public sources and go stale: check them every quarter and edit here. Nothing changes until you press Save.'),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Program', 'Cash', 'Best use', 'Source', 'Checked'].map((x) => h('th', {}, x)))), h('tbody', {}, pts.map((p) => h('tr', {}, h('td', {}, p.name), h('td', {}, p.cash), h('td', {}, p.best), h('td', {}, p.src), h('td', {}, fmtDate(p.on))))))),
    err, h('button', { class: 'btn primary', onclick: save }, 'Save'))];
}
