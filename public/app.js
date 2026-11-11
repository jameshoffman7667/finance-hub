// Finance Hub front end. No framework, no inline HTML: every node is built with h() so text is never parsed as markup.
import { viewOffers } from './offers.js';
import { viewInvest } from './smith.js';
import { viewTax } from './tax.js';
import { viewWealth } from './wealth.js';
import { receiptsTab } from './receipts.js';
import { listsView } from './lists.js';
const state = { info: null, route: '/', cache: {}, installEvent: null, swWaiting: null };
const root = document.getElementById('app');

// ---------- tiny DOM helper ----------
const SVGNS = 'http://www.w3.org/2000/svg';
function h(tag, props, ...kids) {
  const svg = ['svg', 'path', 'line', 'circle', 'polyline', 'rect', 'text', 'g'].includes(tag);
  const el = svg ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const money = (c, opts = {}) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: opts.whole ? 0 : 2 }).format(c / 100);
const fmtDate = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
const monthLabel = (ym) => new Date(ym + '-15T12:00:00').toLocaleDateString('en-CA', { year: 'numeric', month: 'long' });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());

// ---------- API ----------
async function api(method, url, body) {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(state.info?.csrf ? { 'X-CSRF-Token': state.info.csrf } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  if (res.status === 401 && state.info?.authenticated) { await loadState(); render(); }
  if (!res.ok) { const e = new Error(data?.error || `Request failed (${res.status})`); e.status = res.status; e.data = data; throw e; }
  return data;
}
const get = (u) => api('GET', u), post = (u, b = {}) => api('POST', u, b), put = (u, b) => api('PUT', u, b), patch = (u, b) => api('PATCH', u, b), del = (u, b) => api('DELETE', u, b);
async function loadState() { state.info = await get('/api/state'); }

// ---------- icons ----------
const ICONS = {
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  budget: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  cards: 'M3 6h18v12H3zM3 10h18M7 15h3',
  invest: 'M3 17l6-6 4 4 8-9M15 6h6v6',
  tax: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  accounts: 'M3 10l9-6 9 6M5 10v9h14v-9M9 19v-5h6v5',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14 3h-4l-.6 2.6a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2L10 21h4l.6-2.6a7 7 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};
const icon = (n) => h('svg', { class: 'ico', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: ICONS[n] }));

// ---------- navigation ----------
const AREAS = [
  { path: '/', label: 'Overview', icon: 'overview' },
  { path: '/budget', label: 'Budget and forecast', short: 'Budget', icon: 'budget' },
  { path: '/cards', label: 'Cards and bonuses', short: 'Cards', icon: 'cards' },
  { path: '/invest', label: 'Investments', short: 'Invest', icon: 'invest' },
  { path: '/tax', label: 'Tax', icon: 'tax' },
  { path: '/wealth', label: 'Wealth', icon: 'overview' },
  { path: '/accounts', label: 'Accounts and imports', short: 'Accounts', icon: 'accounts' },
  { path: '/settings', label: 'Settings', icon: 'settings' },
];
const MOBILE_NAV = [AREAS[0], AREAS[1], AREAS[2], AREAS[3], { path: '/more', label: 'More', icon: 'more' }];
const isCurrent = (p) => (p === '/more' ? ['/more', '/tax', '/wealth', '/accounts', '/settings'].includes(state.route) : state.route === p);

function go(path) {
  if (path === location.pathname) { render(); return; }
  history.pushState({}, '', path);
  render();
  window.scrollTo(0, 0);
}
const link = (path, ...kids) => h('a', { href: path, onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(path); } }, ...kids);
window.addEventListener('popstate', render);

// ---------- dialogs ----------
function dialog(title, build) {
  const d = h('dialog', { 'aria-labelledby': 'dlg-title' });
  const close = () => { d.close(); d.remove(); };
  d.append(h('h2', { id: 'dlg-title' }, title), build(close));
  d.addEventListener('cancel', () => setTimeout(() => d.remove()));
  document.body.append(d);
  d.showModal();
  return d;
}
function askPassword(reason) {
  return new Promise((resolve) => {
    dialog('Confirm your password', (close) => {
      const err = h('p', { class: 'form-error', role: 'alert' });
      const pw = h('input', { type: 'password', autocomplete: 'current-password', id: 'sp' });
      const form = h('form', { onsubmit: async (e) => {
        e.preventDefault();
        try { await post('/api/stepup', { password: pw.value }); close(); resolve(true); } catch (x) { err.textContent = x.message; }
      } },
      h('p', { class: 'muted' }, reason), h('div', { class: 'field' }, h('label', { for: 'sp' }, 'Password'), pw), err,
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => { close(); resolve(false); } }, 'Cancel'), h('button', { class: 'btn primary' }, 'Confirm')));
      queueMicrotask(() => pw.focus());
      return form;
    });
  });
}
async function withStepUp(reason, fn) {
  try { return await fn(); } catch (e) {
    if (e.data?.stepup && (await askPassword(reason))) return fn();
    throw e;
  }
}

// ---------- shell ----------
function shell(title, content) {
  const nav = h('nav', { class: 'bottomnav', 'aria-label': 'Main' }, MOBILE_NAV.map((a) =>
    h('a', { href: a.path, 'aria-current': isCurrent(a.path) ? 'page' : null, onclick: (e) => { e.preventDefault(); go(a.path); } }, icon(a.icon), a.short || a.label)));
  const side = h('nav', { class: 'sidebar', 'aria-label': 'Main' },
    h('div', { class: 'brand' }, h('img', { src: '/icons/icon-192.png', width: 32, height: 32, alt: '' }), 'Finance Hub'),
    AREAS.map((a) => h('a', { href: a.path, 'aria-current': state.route === a.path ? 'page' : null, onclick: (e) => { e.preventDefault(); go(a.path); } }, icon(a.icon), a.label)),
    h('div', { class: 'spacer' }),
    h('div', { class: 'ver' }, `v${state.info.version}`));
  const main = h('main', { class: 'main', id: 'main' }, content);
  const banner = state.swWaiting ? h('div', { class: 'banner', role: 'status' }, 'A new version is ready.',
    h('button', { class: 'btn small', onclick: () => state.swWaiting.postMessage('SKIP_WAITING') }, 'Reload')) : null;
  return h('div', { class: 'shell' }, side,
    h('div', { class: 'content' }, h('header', { class: 'topbar' }, h('h1', {}, title)), main), nav, banner);
}

function busy(btn, fn) {
  return async (...a) => {
    btn.disabled = true;
    try { await fn(...a); } finally { btn.disabled = false; }
  };
}

// ---------- auth screens ----------
function brand() { return h('div', { class: 'brand' }, h('img', { src: '/icons/icon-192.png', width: 48, height: 48, alt: '' }), h('div', {}, h('h1', {}, 'Finance Hub'), h('div', { class: 'muted small' }, 'Your money, one place'))); }

function authScreen(inner) { return h('div', { class: 'auth' }, h('main', { class: 'card' }, brand(), inner)); }

function enrolScreen(info) {
  const err = h('p', { class: 'form-error', role: 'alert' });
  const code = h('input', { id: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7, placeholder: '123456' });
  const grouped = info.totpSecret.match(/.{1,4}/g).join(' ');
  return authScreen(h('form', { onsubmit: async (e) => {
    e.preventDefault();
    try { await post('/api/totp/enable', { code: code.value }); await loadState(); render(); } catch (x) { err.textContent = x.message; }
  } },
  h('h2', {}, 'Set up two-step sign-in'),
  h('p', {}, 'Open your authenticator app (Google Authenticator, 1Password, Authy…) and add an account using this key, or tap the link on your phone.'),
  h('p', { class: 'secret' }, grouped),
  h('p', {}, h('a', { href: info.otpauth }, 'Open in authenticator app')),
  h('div', { class: 'field' }, h('label', { for: 'code' }, 'Enter the 6-digit code to confirm'), code), err,
  h('button', { class: 'btn primary' }, 'Finish setup')));
}

function loginScreen() {
  const setup = state.info.setupNeeded;
  const err = h('p', { class: 'form-error', role: 'alert' });
  const user = h('input', { id: 'u', autocomplete: 'username', autocapitalize: 'none', required: true });
  const pw = h('input', { id: 'p', type: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true });
  const code = h('input', { id: 'c', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7, placeholder: '123456' });
  const submit = h('button', { class: 'btn primary' }, setup ? 'Create account' : 'Sign in');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; submit.disabled = true;
    try {
      const r = await post(setup ? '/api/setup' : '/api/login', { username: user.value, password: pw.value, code: code.value });
      await loadState();
      if (r.totpSecret) { root.replaceChildren(enrolScreen(r)); return; }
      render();
    } catch (x) { err.textContent = x.message; } finally { submit.disabled = false; }
  } },
  h('h2', {}, setup ? 'Create your login' : 'Sign in'),
  setup ? h('p', { class: 'muted' }, 'First run: choose a username and a password of at least 12 characters. Two-step sign-in is set up next.') : null,
  h('div', { class: 'field' }, h('label', { for: 'u' }, 'Username'), user),
  h('div', { class: 'field' }, h('label', { for: 'p' }, 'Password'), pw),
  setup ? null : h('div', { class: 'field' }, h('label', { for: 'c' }, 'Authenticator code'), code, h('div', { class: 'muted small' }, 'First time on this account? Leave the code empty to set up two-step sign-in.')),
  err, submit);
  return authScreen(form);
}

// ---------- shared pieces ----------
function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('h2', {}, title), h('p', {}, text), action);
}

function netWorthChart(series) {
  if (series.length < 2) return null;
  const W = 600, H = 180, P = 8;
  const vals = series.map((p) => p.net_cents);
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max((hi - lo) * 0.2, Math.abs(hi) * 0.02, 100);
  const min = lo - pad, max = hi + pad;
  const x = (i) => P + (i * (W - 2 * P)) / (series.length - 1);
  const y = (v) => H - 24 - ((v - min) / (max - min || 1)) * (H - 40);
  const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.net_cents).toFixed(1)}`);
  const svg = h('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Net worth from ${fmtDate(series[0].date)} to ${fmtDate(series.at(-1).date)}` },
    h('polyline', { class: 'area', points: `${P},${H - 24} ${pts.join(' ')} ${W - P},${H - 24}` }),
    h('polyline', { class: 'line', points: pts.join(' ') }),
    h('text', { x: P, y: H - 6 }, fmtDate(series[0].date)), h('text', { x: W - P, y: H - 6, 'text-anchor': 'end' }, fmtDate(series.at(-1).date)));
  return svg;
}

function categoryBars(cats) {
  const max = Math.max(...cats.map((c) => c.spent_cents), 1);
  return h('div', { class: 'bars' }, cats.map((c) => {
    const fill = h('div', { class: 'bar-fill' });
    fill.style.width = `${Math.max(2, (c.spent_cents / max) * 100)}%`;
    return h('div', { class: 'bar-row' }, h('span', {}, c.name), h('div', { class: 'bar-track', role: 'presentation' }, fill), h('span', { class: 'num' }, money(c.spent_cents)));
  }));
}

// ---------- views ----------
async function viewOverview() {
  const o = await get('/api/overview');
  const nw = o.networth;
  const spend = await get('/api/reports/spending');
  const out = [];
  try {
    const sm = await get('/api/smith/summary');
    if (sm.overdue.length) out.push(h('div', { class: 'notice warn' }, h('span', {}, `${sm.overdue.length} Smith Manoeuvre interest capitalization${sm.overdue.length === 1 ? ' is' : 's are'} overdue.`), link('/invest', h('span', { class: 'btn small' }, 'Open'))));
  } catch { /* optional */ }
  if (o.uncategorised > 0) out.push(h('div', { class: 'notice warn' }, h('span', {}, `${o.uncategorised} transaction${o.uncategorised === 1 ? '' : 's'} need a category.`), link('/budget?tab=transactions&uncat=1', h('span', { class: 'btn small' }, 'Review'))));
  if (o.accounts === 0) {
    out.push(h('div', { class: 'card' }, emptyState('Start with an account', 'Add your first account, record its balance, then import a statement to see spending by category.', h('button', { class: 'btn primary', onclick: () => go('/accounts') }, 'Add an account'))));
    return shell('Overview', out);
  }
  const worth = h('section', { class: 'card' }, h('h2', {}, 'Net worth'), h('div', { class: 'big num' }, money(nw.net_cents)),
    h('div', { class: 'stat-row' }, h('div', {}, h('span', {}, 'Assets'), h('strong', { class: 'num' }, money(nw.assets_cents))), h('div', {}, h('span', {}, 'Debts'), h('strong', { class: 'num' }, money(nw.liabilities_cents)))),
    netWorthChart(o.series) || h('p', { class: 'muted small' }, 'Record balances on more than one date to see the trend.'));
  const month = h('section', { class: 'card' }, h('h2', {}, `Spending in ${monthLabel(o.month.from.slice(0, 7))}`), h('div', { class: 'big num' }, money(spend.total_spent_cents)),
    spend.categories.length ? categoryBars(spend.categories.slice(0, 6)) : h('p', { class: 'muted' }, 'No spending this month yet. Import a statement to fill this in.'),
    link('/budget', 'See budget'));
  out.push(h('div', { class: 'grid cols' }, worth, month));
  try {
    const lr = await get('/api/planner/report');
    if (lr.total.count > 0) out.push(h('section', { class: 'card' }, h('h2', {}, 'Bonus earnings'), h('div', { class: 'big num' }, money(lr.total.net_cents) + (lr.total.estimate ? ' (estimate)' : '')),
      h('p', { class: 'muted small' }, `${lr.total.count} offers tracked, ${money(lr.total.gross_cents)} received${lr.total.per_hour_cents != null ? `, ${money(lr.total.per_hour_cents)} per hour` : ''}.`), link('/cards?tab=ledger', 'Open the bonus ledger')));
  } catch { /* the tile is optional */ }
  if (!o.lastImport) out.push(h('div', { class: 'notice' }, h('span', {}, 'No statements imported yet.'), link('/accounts?tab=import', h('span', { class: 'btn small' }, 'Import a statement'))));
  return shell('Overview', out);
}

function params() { return new URLSearchParams(location.search); }

// A drop-down of values already in use, with a way to type a new one (it becomes part of the list once saved).
function listPick(id, values, current = '', opts = {}) {
  const NEW = '__new__';
  const all = current && !values.includes(current) ? [...values, current] : values;
  const sel = h('select', { id, 'aria-label': opts.label }, h('option', { value: '' }, opts.none ?? '(none)'), all.map((v) => h('option', { value: v, selected: v === current }, v)), h('option', { value: NEW }, 'Add new…'));
  const input = h('input', { id: `${id}-new`, placeholder: opts.placeholder || 'Type the new value', 'aria-label': `New ${opts.label || 'value'}`, maxlength: opts.max || 80 });
  input.hidden = true;
  sel.addEventListener('change', () => { input.hidden = sel.value !== NEW; if (!input.hidden) input.focus(); });
  return { el: h('div', { class: 'pick' }, sel, input), value: () => (sel.value === NEW ? input.value.trim() : sel.value) };
}
const centsOf = (v) => { const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };

async function viewBudget() {
  const tab = params().get('tab') || 'spending';
  const tabs = [['spending', 'Spending'], ['transactions', 'Transactions'], ['rules', 'Categories and rules'], ['receipts', 'Receipts'], ['forecast', 'Forecast']];
  const bar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) =>
    h('button', { role: 'tab', 'aria-selected': k === tab ? 'true' : 'false', onclick: () => go(`/budget?tab=${k}`) }, l)));
  let body;
  if (tab === 'transactions') body = await budgetTransactions();
  else if (tab === 'rules') body = await budgetRules();
  else if (tab === 'receipts') body = await receiptsTab();
  else if (tab === 'forecast') body = h('div', { class: 'card' }, emptyState('Forecast is coming', 'Run rate, planned major expenses, expected income and a wealth projection arrive in a later release. Importing statements now builds the history it will use.'));
  else body = await budgetSpending();
  return shell('Budget and forecast', [bar, body]);
}

function shiftMonth(ym, d) { const [y, m] = ym.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1 + d, 1)); return dt.toISOString().slice(0, 7); }
function monthBounds(ym) { const [y, m] = ym.split('-').map(Number); return { from: `${ym}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }; }

async function budgetSpending() {
  const ym = params().get('m') || today().slice(0, 7);
  const { from, to } = monthBounds(ym);
  const r = await get(`/api/reports/spending?from=${from}&to=${to}`);
  const nav = h('div', { class: 'row card' },
    h('button', { class: 'btn small', 'aria-label': 'Previous month', onclick: () => go(`/budget?m=${shiftMonth(ym, -1)}`) }, '‹'),
    h('strong', { class: 'grow', style: null }, monthLabel(ym)),
    h('button', { class: 'btn small', 'aria-label': 'Next month', onclick: () => go(`/budget?m=${shiftMonth(ym, 1)}`) }, '›'));
  const sum = h('div', { class: 'card' }, h('div', { class: 'stat-row' },
    h('div', {}, h('span', {}, 'Spent'), h('strong', { class: 'big num' }, money(r.total_spent_cents))),
    h('div', {}, h('span', {}, 'Income'), h('strong', { class: 'big num' }, money(r.income_cents))),
    h('div', {}, h('span', {}, 'Left over'), h('strong', { class: 'big num ' + (r.income_cents - r.total_spent_cents < 0 ? 'neg' : '') }, money(r.income_cents - r.total_spent_cents)))));
  const cats = h('section', { class: 'card' }, h('h2', {}, 'By category'),
    r.categories.length ? categoryBars(r.categories) : emptyState('Nothing here', 'No transactions in this month. Import a statement from Accounts and imports.'),
    r.uncategorised ? h('p', {}, link('/budget?tab=transactions&uncat=1', `${r.uncategorised} uncategorised`)) : null);
  const detailRows = (c) => {
    const subs = c.subs || [];
    const rows = subs.map((x) => { const tr = h('tr', { class: 'sub-row' }, h('td', {}, h('span', { class: 'muted' }, '↳ '), x.name), h('td', { class: 'right num' }, x.count), h('td', { class: 'right num' }, money(x.spent_cents))); tr.hidden = true; return tr; });
    const toggle = subs.length ? h('button', { class: 'btn small', 'aria-expanded': 'false', 'aria-label': `Show sub-categories of ${c.name}`, onclick: (e) => { const open = e.currentTarget.getAttribute('aria-expanded') !== 'true'; e.currentTarget.setAttribute('aria-expanded', String(open)); e.currentTarget.textContent = open ? '−' : '+'; rows.forEach((x) => { x.hidden = !open; }); } }, '+') : null;
    return [h('tr', {}, h('td', {}, toggle, toggle ? ' ' : '', c.name), h('td', { class: 'right num' }, c.count), h('td', { class: 'right num' }, money(c.spent_cents))), ...rows];
  };
  const list = r.categories.length ? h('section', { class: 'card' }, h('h2', {}, 'Details'), h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Category'), h('th', { class: 'right' }, 'Transactions'), h('th', { class: 'right' }, 'Spent'))),
    h('tbody', {}, r.categories.map(detailRows))))) : null;
  return h('div', {}, nav, sum, h('div', { class: 'grid two' }, cats, list));
}

let txState = { q: '', offset: 0 };
async function budgetTransactions() {
  const uncat = params().get('uncat') === '1';
  const { categories, subcategories } = await get('/api/categories');
  const q = new URLSearchParams({ limit: 100, offset: txState.offset });
  if (uncat) q.set('uncategorised', '1');
  if (txState.q) q.set('q', txState.q);
  const r = await get('/api/transactions?' + q);
  const search = h('input', { type: 'search', placeholder: 'Search description, comment or reference', value: txState.q, 'aria-label': 'Search transactions',
    onkeydown: (e) => { if (e.key === 'Enter') { txState = { q: search.value, offset: 0 }; render(); } } });
  const filter = h('div', { class: 'row card' }, h('div', { class: 'grow' }, search),
    h('div', { class: 'check' }, h('input', { type: 'checkbox', id: 'uc', checked: uncat, onchange: (e) => go(`/budget?tab=transactions${e.target.checked ? '&uncat=1' : ''}`) }), h('label', { for: 'uc' }, 'Uncategorised only')));
  const items = r.transactions.length ? h('ul', { class: 'list' }, r.transactions.map((t) => h('li', {},
    h('button', { class: 'item', onclick: () => categoriseDialog(t, categories, subcategories) },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, t.description), h('div', { class: 'muted small' }, `${fmtDate(t.posted_on)} · ${t.account_label}${t.receipt_doc ? ' · receipt filed' : ''}`),
        t.comment || t.reference ? h('div', { class: 'muted small' }, [t.comment, t.reference ? `Ref ${t.reference}` : ''].filter(Boolean).join(' · ')) : null),
      h('div', { class: 'right' }, h('div', { class: 'num ' + (t.amount_cents < 0 ? '' : 'pos') }, money(t.amount_cents)), t.category ? h('span', { class: 'pill' }, t.subcategory ? `${t.category} › ${t.subcategory}` : t.category) : h('span', { class: 'pill warn' }, 'Uncategorised')))))) :
    emptyState('No transactions', uncat ? 'Everything is categorised.' : 'Import a statement from Accounts and imports.');
  const pager = r.total > 100 ? h('div', { class: 'row' },
    h('button', { class: 'btn small', disabled: txState.offset === 0, onclick: () => { txState.offset = Math.max(0, txState.offset - 100); render(); } }, 'Newer'),
    h('span', { class: 'muted small' }, `${txState.offset + 1}-${Math.min(r.total, txState.offset + 100)} of ${r.total}`),
    h('button', { class: 'btn small', disabled: txState.offset + 100 >= r.total, onclick: () => { txState.offset += 100; render(); } }, 'Older')) : null;
  return h('div', {}, filter, h('div', { class: 'card' }, items), pager);
}

function categoriseDialog(t, categories, subcategories = []) {
  dialog('Categorise', (close) => {
    const NEW = '__new__';
    const sel = h('select', { id: 'cat' }, h('option', { value: '' }, 'Uncategorised'), categories.filter((c) => !c.archived).map((c) => h('option', { value: c.id, selected: c.id === t.category_id }, `${c.name}`)));
    // Sub-categories are optional: the row only appears for a category that has some, or when you ask to add one.
    const subWrap = h('div', { class: 'field' });
    let wantNew = false, subSel = null, subNew = null;
    const drawSub = () => {
      const cid = Number(sel.value); const subs = subcategories.filter((x) => x.category_id === cid);
      subWrap.replaceChildren(); subSel = null; subNew = null;
      if (!cid) return;
      if (!subs.length && !wantNew) { subWrap.append(h('button', { type: 'button', class: 'btn small', onclick: () => { wantNew = true; drawSub(); } }, 'Add a sub-category')); return; }
      subSel = h('select', { id: 'sub' }, h('option', { value: '' }, '(none)'), subs.map((x) => h('option', { value: x.id, selected: x.id === t.subcategory_id && cid === t.category_id }, x.name)), h('option', { value: NEW }, 'Add new…'));
      subNew = h('input', { id: 'sub-new', placeholder: 'New sub-category', 'aria-label': 'New sub-category', maxlength: 60 }); subNew.hidden = !wantNew;
      if (wantNew) subSel.value = NEW;
      subSel.addEventListener('change', () => { subNew.hidden = subSel.value !== NEW; if (!subNew.hidden) subNew.focus(); });
      subWrap.append(h('label', { for: 'sub' }, 'Sub-category (optional)'), h('div', { class: 'pick' }, subSel, subNew));
    };
    sel.addEventListener('change', () => { wantNew = false; drawSub(); }); drawSub();
    const rule = h('input', { type: 'checkbox', id: 'mk', checked: true });
    const pat = h('input', { id: 'pat', value: t.description.split(/[#\d*]/)[0].trim().slice(0, 30) || t.description.slice(0, 30), 'aria-label': 'Match text' });
    const where = h('select', { id: 'rf', 'aria-label': 'Match in' }, [['description', 'the description'], ['comment', 'the comment'], ['reference', 'the reference'], ['any', 'the description, comment or reference']].map(([v, l]) => h('option', { value: v }, l)));
    const err = h('p', { class: 'form-error', role: 'alert' });
    return h('form', { onsubmit: async (e) => {
      e.preventDefault();
      try {
        const body = { category_id: sel.value === '' ? null : Number(sel.value) };
        if (body.category_id && subSel) {
          if (subSel.value === NEW) { const name = subNew.value.trim(); if (name) body.subcategory_id = (await post('/api/subcategories', { category_id: body.category_id, name })).id; }
          else if (subSel.value) body.subcategory_id = Number(subSel.value);
        }
        if (rule.checked && sel.value !== '') { body.rule_pattern = pat.value; body.rule_field = where.value; }
        await patch(`/api/transactions/${t.id}`, body);
        close(); render();
      } catch (x) { err.textContent = x.message; }
    } },
    h('p', {}, h('strong', {}, t.description), h('br'), t.comment ? [h('span', { class: 'muted' }, t.comment), h('br')] : null, t.reference ? [h('span', { class: 'muted small' }, `Reference ${t.reference}`), h('br')] : null, h('span', { class: 'muted' }, `${fmtDate(t.posted_on)} · ${money(t.amount_cents)}`)),
    h('div', { class: 'field' }, h('label', { for: 'cat' }, 'Category'), sel), subWrap,
    h('div', { class: 'check field' }, rule, h('label', { for: 'mk' }, 'Always use this category when')),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', { for: 'rf' }, 'Match in'), where), h('div', { class: 'grow' }, h('label', { for: 'pat' }, 'Contains'), pat)), err,
    h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary' }, 'Save')));
  });
}

async function budgetRules() {
  const { categories, subcategories, rules } = await get('/api/categories');
  const live = categories.filter((c) => !c.archived);
  const pat = h('input', { id: 'rp', placeholder: 'e.g. loblaws' }), cs = h('select', { id: 'rc', 'aria-label': 'Category' }, live.map((c) => h('option', { value: c.id }, c.name)));
  const subSel = h('select', { id: 'rs', 'aria-label': 'Sub-category' }); const subRow = h('div', { class: 'grow' }, h('label', { for: 'rs' }, 'Sub-category (optional)'), subSel);
  const drawSubs = () => { const subs = subcategories.filter((x) => x.category_id === Number(cs.value)); subSel.replaceChildren(h('option', { value: '' }, '(none)'), subs.map((x) => h('option', { value: x.id }, x.name))); subRow.hidden = !subs.length; };
  cs.addEventListener('change', drawSubs); drawSubs();
  const where = h('select', { id: 'rf', 'aria-label': 'Match in' }, [['description', 'Description'], ['comment', 'Comment'], ['reference', 'Reference'], ['any', 'Description, comment or reference']].map(([v, l]) => h('option', { value: v }, l)));
  const err = h('p', { class: 'form-error', role: 'alert' });
  const addRule = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    try { await post('/api/rules', { pattern: pat.value, category_id: Number(cs.value), subcategory_id: subSel.value || null, field: where.value }); await post('/api/rules/apply'); render(); } catch (x) { err.textContent = x.message; }
  } }, h('h2', {}, 'Add a rule'), h('p', { class: 'muted small' }, 'When the chosen text contains the words, the transaction gets the category. Rules never override categories you set by hand.'),
  h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', { for: 'rf' }, 'Match in'), where), h('div', { class: 'grow' }, h('label', { for: 'rp' }, 'Contains'), pat)),
  h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', { for: 'rc' }, 'Category'), cs), subRow), err,
  h('div', { class: 'dialog-actions' }, h('button', { class: 'btn primary' }, 'Add rule')));
  const fieldWord = { description: '', comment: 'comment ', reference: 'reference ', any: 'anywhere ' };
  const ruleList = h('section', { class: 'card' }, h('h2', {}, `Rules (${rules.length})`), rules.length ? h('ul', { class: 'list' }, rules.map((r) => h('li', {},
    h('div', { class: 'grow' }, h('div', { class: 'title' }, `${fieldWord[r.field] || ''}"${r.pattern}"`), h('div', { class: 'muted small' }, r.subcategory ? `${r.category} › ${r.subcategory}` : r.category)),
    h('button', { class: 'btn small danger', onclick: async () => { await del(`/api/rules/${r.id}`); render(); } }, 'Delete')))) : h('p', { class: 'muted' }, 'No rules yet. Categorising a transaction can create one for you.'));
  const cats = h('section', { class: 'card' }, h('h2', {}, 'Categories'),
    h('p', { class: 'muted small' }, 'Categories come with the app. Add optional sub-categories, rename or remove things in ', link('/settings?tab=lists', 'Settings, Lists'), '.'),
    h('ul', { class: 'list' }, categories.map((c) => h('li', {}, h('div', { class: 'grow' }, h('span', { class: 'title' }, c.name), ' ', h('span', { class: 'pill' }, c.kind), c.archived ? h('span', { class: 'pill' }, 'archived') : null),
      h('button', { class: 'btn small', onclick: async () => { await patch(`/api/categories/${c.id}`, { archived: !c.archived }); render(); } }, c.archived ? 'Restore' : 'Archive')))));
  return h('div', { class: 'grid two' }, h('div', {}, addRule, ruleList), cats);
}

const TYPE_LABELS = { chequing: 'Chequing', savings: 'Savings', investment: 'Investment (non-registered)', registered: 'Registered (RRSP, TFSA, FHSA…)', property: 'Property', other_asset: 'Other asset', credit_card: 'Credit card', loan: 'Loan', mortgage: 'Mortgage', line_of_credit: 'Line of credit', other_liability: 'Other debt' };

async function viewAccounts() {
  const tab = params().get('tab') || 'accounts';
  const tabs = [['accounts', 'Accounts'], ['import', 'Import statement'], ['history', 'Import history']];
  const bar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': k === tab ? 'true' : 'false', onclick: () => go(`/accounts?tab=${k}`) }, l)));
  const { accounts, institutions, owners } = await get('/api/accounts');
  const lists = { institutions, owners };
  let body;
  if (tab === 'import') body = importView(accounts);
  else if (tab === 'history') body = await historyView();
  else body = accountsList(accounts, lists);
  return shell('Accounts and imports', [bar, body]);
}

// Accounts grouped by institution, then owner, with balance totals (liabilities subtracted). Groups collapse; closed accounts sit last.
const collapsed = new Set();
function accountsList(accounts, lists) {
  if (!accounts.length) return h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Accounts'), h('button', { class: 'btn primary', onclick: () => addAccountDialog(lists) }, 'Add account')),
    emptyState('No accounts yet', 'Add a bank, card, investment or property account. Balances you record here make up your net worth.'));
  const signed = (a) => (a.latest ? (a.kind === 'liability' ? -a.latest.value_cents : a.latest.value_cents) : 0);
  const sum = (list) => list.reduce((t, a) => t + (a.active ? signed(a) : 0), 0);
  const sorted = (list) => [...list].sort((x, y) => (y.active - x.active) || x.name.localeCompare(y.name));
  const byInst = new Map();
  for (const a of accounts) { const k = a.institution || 'No institution'; if (!byInst.has(k)) byInst.set(k, []); byInst.get(k).push(a); }
  const row = (a) => h('li', {}, h('button', { class: 'item', onclick: () => accountDialog(a, lists) },
    h('div', { class: 'grow' }, h('div', { class: 'title' }, a.name, a.active ? '' : ' (closed)'), h('div', { class: 'muted small' }, TYPE_LABELS[a.type] || a.type)),
    h('div', { class: 'right' }, a.latest ? [h('div', { class: 'num ' + (a.kind === 'liability' ? 'neg' : '') }, (a.kind === 'liability' ? '-' : '') + money(a.latest.value_cents)), h('div', { class: 'muted small' }, fmtDate(a.latest.as_of))] : h('span', { class: 'pill warn' }, 'No balance'))));
  const group = (key, title, list) => {
    const open = !collapsed.has(key);
    const ul = h('ul', { class: 'list' }, sorted(list).map(row)); ul.hidden = !open;
    const mark = h('span', { class: 'mark' }, open ? '▾' : '▸');
    const btn = h('button', { class: 'group-head level2', 'aria-expanded': String(open), onclick: () => { const now = btn.getAttribute('aria-expanded') !== 'true'; btn.setAttribute('aria-expanded', String(now)); ul.hidden = !now; mark.textContent = now ? '▾' : '▸'; if (now) collapsed.delete(key); else collapsed.add(key); } },
      mark, h('span', { class: 'grow title' }, title), h('span', { class: 'num' }, money(sum(list))));
    return { btn, ul };
  };
  const out = [];
  for (const [inst, list] of [...byInst.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    const instKey = 'i:' + inst, open = !collapsed.has(instKey);
    const body = h('div', { class: 'group-body' }); body.hidden = !open;
    const owners = new Map();
    for (const a of list) { const k = a.owner || 'No owner'; if (!owners.has(k)) owners.set(k, []); owners.get(k).push(a); }
    for (const [own, ol] of [...owners.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
      const g = group(`o:${inst}:${own}`, own, ol);
      body.append(g.btn, g.ul);
    }
    const mark = h('span', { class: 'mark' }, open ? '▾' : '▸');
    const head = h('button', { class: 'group-head level1', 'aria-expanded': String(open), onclick: () => { const now = head.getAttribute('aria-expanded') !== 'true'; head.setAttribute('aria-expanded', String(now)); body.hidden = !now; mark.textContent = now ? '▾' : '▸'; if (now) collapsed.delete(instKey); else collapsed.add(instKey); } },
      mark, h('span', { class: 'grow title' }, inst), h('span', { class: 'num' }, money(sum(list))));
    out.push(h('div', { class: 'group' }, head, body));
  }
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Accounts'), h('div', { class: 'num' }, h('span', { class: 'muted small' }, 'Net '), money(sum(accounts))), h('button', { class: 'btn primary', onclick: () => addAccountDialog(lists) }, 'Add account')), out);
}

function addAccountDialog(lists) {
  dialog('Add account', (close) => {
    const name = h('input', { id: 'an', required: true, placeholder: 'e.g. TD Everyday Chequing' });
    const inst = listPick('ai', lists.institutions, '', { label: 'institution', placeholder: 'e.g. TD' }), owner = listPick('ao', lists.owners, '', { label: 'owner', placeholder: 'Who owns it' });
    const type = h('select', { id: 'at' }, Object.entries(TYPE_LABELS).map(([k, l]) => h('option', { value: k }, l)));
    const err = h('p', { class: 'form-error', role: 'alert' });
    return h('form', { onsubmit: async (e) => {
      e.preventDefault();
      try { await post('/api/accounts', { name: name.value, institution: inst.value(), owner: owner.value(), type: type.value }); close(); render(); } catch (x) { err.textContent = x.message; }
    } },
    h('div', { class: 'field' }, h('label', { for: 'an' }, 'Name'), name), h('div', { class: 'field' }, h('label', { for: 'ai' }, 'Institution'), inst.el),
    h('div', { class: 'field' }, h('label', { for: 'at' }, 'Type'), type), h('div', { class: 'field' }, h('label', { for: 'ao' }, 'Owner'), owner.el), err,
    h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary' }, 'Add')));
  });
}

async function accountDialog(a, lists) {
  const { valuations } = await get(`/api/accounts/${a.id}/valuations`);
  dialog(a.label || a.name, (close) => {
    const date = h('input', { id: 'vd', type: 'date', value: today(), required: true }), val = h('input', { id: 'vv', inputmode: 'decimal', placeholder: '0.00', required: true });
    const err = h('p', { class: 'form-error', role: 'alert' });
    return h('div', {},
      h('form', { onsubmit: async (e) => {
        e.preventDefault();
        try { await post(`/api/accounts/${a.id}/valuations`, { as_of: date.value, value: val.value }); close(); render(); } catch (x) { err.textContent = x.message; }
      } },
      h('p', { class: 'muted small' }, a.kind === 'liability' ? 'Enter the amount owed as a positive number.' : 'Enter the balance or market value.'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', { for: 'vd' }, 'As of'), date), h('div', { class: 'grow' }, h('label', { for: 'vv' }, 'Balance'), val)), err,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn primary' }, 'Save balance'))),
      valuations.length ? h('div', {}, h('h3', {}, 'History'), h('ul', { class: 'list' }, valuations.slice(0, 12).map((v) => h('li', {}, h('span', { class: 'grow' }, fmtDate(v.as_of)), h('span', { class: 'num' }, money(v.value_cents)),
        h('button', { class: 'btn small danger', 'aria-label': `Delete balance from ${v.as_of}`, onclick: async () => { await del(`/api/valuations/${v.id}`); close(); render(); } }, 'Delete'))))) : null,
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn', onclick: () => { close(); editAccountDialog(a, lists); } }, 'Edit account'),
        h('button', { class: 'btn', onclick: async () => { await patch(`/api/accounts/${a.id}`, { active: !a.active }); close(); render(); } }, a.active ? 'Mark closed' : 'Reopen'),
        h('button', { class: 'btn', onclick: close }, 'Close')));
  });
}

function editAccountDialog(a, lists) {
  dialog('Edit account', (close) => {
    const name = h('input', { id: 'en', required: true, value: a.name });
    const inst = listPick('ei', lists.institutions, a.institution || '', { label: 'institution' }), owner = listPick('eo', lists.owners, a.owner || '', { label: 'owner' });
    const type = h('select', { id: 'et' }, Object.entries(TYPE_LABELS).map(([k, l]) => h('option', { value: k, selected: k === a.type }, l)));
    const closed = h('input', { type: 'checkbox', id: 'ec', checked: !a.active });
    const err = h('p', { class: 'form-error', role: 'alert' });
    const askDelete = async () => {
      err.textContent = '';
      try {
        const u = await get(`/api/accounts/${a.id}/usage`);
        const has = u.transactions || u.valuations || u.imports;
        if (!has) { if (confirm(`Delete ${a.label || a.name}?`)) { await del(`/api/accounts/${a.id}`); close(); render(); } return; }
        close();
        dialog('Delete account', (close2) => h('div', {},
          h('p', {}, `${a.label || a.name} has ${u.transactions} transaction${u.transactions === 1 ? '' : 's'}, ${u.valuations} balance${u.valuations === 1 ? '' : 's'} and ${u.imports} import${u.imports === 1 ? '' : 's'}.`),
          h('p', { class: 'muted' }, 'Closing keeps everything and hides the account from active totals. Deleting removes the account and everything attached to it for good.'),
          h('div', { class: 'dialog-actions' },
            h('button', { class: 'btn', onclick: close2 }, 'Cancel'),
            h('button', { class: 'btn', onclick: async () => { await patch(`/api/accounts/${a.id}`, { active: false }); close2(); render(); } }, 'Close it instead'),
            h('button', { class: 'btn danger', onclick: async () => { if (confirm(`Permanently delete ${a.label || a.name} with ${u.transactions} transactions, ${u.valuations} balances and ${u.imports} imports?`)) { await del(`/api/accounts/${a.id}`, { delete_data: true }); close2(); render(); } } }, 'Delete everything'))));
      } catch (x) { err.textContent = x.message; }
    };
    return h('form', { onsubmit: async (e) => {
      e.preventDefault();
      try { await patch(`/api/accounts/${a.id}`, { name: name.value, institution: inst.value(), owner: owner.value(), type: type.value, active: !closed.checked }); close(); render(); } catch (x) { err.textContent = x.message; }
    } },
    h('div', { class: 'field' }, h('label', { for: 'en' }, 'Name'), name), h('div', { class: 'field' }, h('label', { for: 'ei' }, 'Institution'), inst.el),
    h('div', { class: 'field' }, h('label', { for: 'et' }, 'Type'), type), h('p', { class: 'muted small' }, 'Changing the type between an asset and a debt changes how its balance counts in net worth.'),
    h('div', { class: 'field' }, h('label', { for: 'eo' }, 'Owner'), owner.el),
    h('div', { class: 'check field' }, closed, h('label', { for: 'ec' }, 'Closed')), err,
    h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn danger', onclick: askDelete }, 'Delete…'), h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary' }, 'Save')));
  });
}

const importDraft = { accountId: '', text: '', filename: '', mapping: null };
function importView(accounts) {
  if (!accounts.length) return h('div', { class: 'card' }, emptyState('Add an account first', 'Statements are imported into an account.', h('button', { class: 'btn primary', onclick: () => go('/accounts') }, 'Add account')));
  const err = h('p', { class: 'form-error', role: 'alert' });
  const out = h('div', {});
  const sel = h('select', { id: 'ia' }, accounts.filter((a) => a.active).map((a) => h('option', { value: a.id, selected: String(a.id) === String(importDraft.accountId) }, a.label || a.name)));
  const file = h('input', { id: 'if', type: 'file', accept: '.csv,text/csv,text/plain' });
  const doPreview = async () => {
    err.textContent = ''; out.replaceChildren();
    if (!importDraft.text) return;
    try {
      const p = await post('/api/imports/preview', { account_id: Number(sel.value), text: importDraft.text, mapping: importDraft.mapping || undefined });
      importDraft.mapping = p.mapping; importDraft.accountId = sel.value;
      out.replaceChildren(previewCard(p, sel, doPreview, err));
    } catch (x) { err.textContent = x.message; }
  };
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    importDraft.filename = f.name; importDraft.mapping = null; importDraft.text = await f.text(); doPreview();
  });
  return h('div', {}, h('section', { class: 'card' }, h('h2', {}, 'Import a statement'),
    h('p', { class: 'muted' }, 'Choose the account and a CSV file downloaded from your bank. You will see a preview before anything is saved, and an import can be rolled back later.'),
    h('div', { class: 'field' }, h('label', { for: 'ia' }, 'Account'), sel), h('div', { class: 'field' }, h('label', { for: 'if' }, 'CSV file'), file), err), out);
}

function previewCard(p, sel, redo, err) {
  const m = p.mapping;
  const colSel = (key, label, allowNone) => {
    const s = h('select', { id: 'm-' + key, 'aria-label': label, onchange: () => { importDraft.mapping = { ...importDraft.mapping, [key]: Number(s.value) }; redo(); } },
      allowNone ? h('option', { value: -1 }, '(none)') : null, p.headers.map((hd, i) => h('option', { value: i, selected: m[key] === i }, hd)));
    if (allowNone && m[key] === -1) s.value = -1;
    return h('div', { class: 'grow' }, h('label', { for: 'm-' + key }, label), s);
  };
  const order = h('select', { id: 'm-order', onchange: () => { importDraft.mapping = { ...importDraft.mapping, dateOrder: order.value }; redo(); } },
    [['YMD', 'Year-month-day'], ['MDY', 'Month/day/year'], ['DMY', 'Day/month/year']].map(([v, l]) => h('option', { value: v, selected: m.dateOrder === v }, l)));
  const flip = h('input', { type: 'checkbox', id: 'm-inv', checked: m.invert, onchange: () => { importDraft.mapping = { ...importDraft.mapping, invert: flip.checked }; redo(); } });
  const commit = h('button', { class: 'btn primary', disabled: p.newCount === 0 }, `Import ${p.newCount} transaction${p.newCount === 1 ? '' : 's'}`);
  const b = p.balance;
  const balIn = h('input', { id: 'bal', inputmode: 'decimal', 'aria-label': 'Balance', value: b && b.value_cents != null ? (b.value_cents / 100).toFixed(2) : '' });
  const balOn = h('input', { type: 'checkbox', id: 'bal-on', checked: !!(b && b.value_cents != null) });
  const balReplace = h('input', { type: 'checkbox', id: 'bal-rep' });
  const balCard = b ? h('div', { class: 'card inset' }, h('h3', {}, 'Balance'),
    h('p', { class: 'muted small' }, b.source === 'file' ? `The statement shows this balance on ${fmtDate(b.as_of)}.` : b.source === 'suggested' ? `Worked out from your last saved balance and the new lines, as of ${fmtDate(b.as_of)}. Check it against your statement.` : `Enter the balance as of ${fmtDate(b.as_of)} if you want to save one.`),
    b.note ? h('p', { class: 'form-error' }, b.note) : null,
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', { for: 'bal' }, 'Balance (liabilities as the amount owed)'), balIn), h('div', { class: 'check' }, balOn, h('label', { for: 'bal-on' }, 'Save this balance'))),
    b.existing_manual_cents != null ? h('div', { class: 'check' }, balReplace, h('label', { for: 'bal-rep' }, `You already entered ${money(b.existing_manual_cents)} for this date. Replace it?`)) : null) : null;
  commit.addEventListener('click', busy(commit, async () => {
    try {
      const body = { account_id: Number(sel.value), text: importDraft.text, filename: importDraft.filename, mapping: importDraft.mapping };
      if (b && balOn.checked) { const c = centsOf(balIn.value); if (c == null) { err.textContent = 'Enter the balance as a number, or untick Save this balance.'; return; } body.balance = { as_of: b.as_of, value_cents: c }; if (balReplace.checked) body.replace_balance = true; }
      const r = await post('/api/imports', body);
      importDraft.text = ''; importDraft.mapping = null;
      go(`/accounts?tab=history&done=${r.imported}${r.balance_saved ? '&bal=1' : ''}${r.balance_kept_manual ? '&kept=1' : ''}`);
    } catch (x) { err.textContent = x.message; }
  }));
  return h('section', { class: 'card' }, h('h2', {}, 'Preview'),
    h('div', { class: 'stat-row' }, h('div', {}, h('span', {}, 'New'), h('strong', {}, p.newCount)), h('div', {}, h('span', {}, 'Already imported'), h('strong', {}, p.duplicateCount)),
      h('div', {}, h('span', {}, 'Auto-categorised'), h('strong', {}, `${p.categorised} of ${p.newCount}`)), h('div', {}, h('span', {}, 'Problem rows'), h('strong', {}, p.errorCount))),
    h('h3', {}, 'Columns'),
    h('div', { class: 'row' }, colSel('date', 'Date', false), colSel('description', 'Description', false), colSel('amount', 'Amount', true)),
    h('div', { class: 'row' }, colSel('debit', 'Money out (if separate)', true), colSel('credit', 'Money in (if separate)', true), h('div', { class: 'grow' }, h('label', { for: 'm-order' }, 'Date format'), order)),
    h('div', { class: 'row' }, colSel('comment', 'Comment', true), colSel('reference', 'Reference', true), colSel('balance', 'Balance', true)),
    m.dateOrder !== 'YMD' ? h('p', { class: 'muted small' }, 'Check the dates in the table below. A date like 03/10/2026 can mean March 10 or 3 October; change the date format if they look wrong.') : null,
    h('div', { class: 'check field' }, flip, h('label', { for: 'm-inv' }, 'Flip signs (this statement shows spending as positive)')),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Description'), h('th', {}, 'Comment'), h('th', {}, 'Reference'), h('th', { class: 'right' }, 'Amount'), h('th', {}, 'Status'))),
      h('tbody', {}, p.sample.map((r) => h('tr', {}, h('td', { class: 'nowrap' }, r.posted_on), h('td', {}, r.description), h('td', {}, r.comment || ''), h('td', {}, r.reference || ''), h('td', { class: 'right num ' + (r.amount_cents < 0 ? '' : 'pos') }, money(r.amount_cents)), h('td', {}, r.duplicate ? 'Already imported' : 'New')))))),
    p.errorCount ? h('details', {}, h('summary', {}, `${p.errorCount} rows could not be read`), h('ul', {}, p.errors.slice(0, 10).map((e) => h('li', { class: 'small' }, `Line ${e.line}: ${e.reason}`)))) : null,
    balCard,
    h('div', { class: 'dialog-actions' }, commit));
}

async function historyView() {
  const { batches } = await get('/api/imports');
  const done = params().get('done');
  return h('div', {}, done ? h('div', { class: 'notice', role: 'status' }, `Imported ${done} transactions.${params().get('bal') ? ' Balance saved.' : ''}${params().get('kept') ? ' Your own balance for that date was kept.' : ''} `, link('/budget?tab=transactions&uncat=1', h('span', { class: 'btn small' }, 'Categorise'))) : null,
    h('div', { class: 'card' }, h('h2', {}, 'Import history'), batches.length ? h('ul', { class: 'list' }, batches.map((b) => h('li', {},
      h('div', { class: 'grow' }, h('div', { class: 'title' }, b.filename || `Import #${b.id}`), h('div', { class: 'muted small' }, `${b.account} · ${new Date(b.created_at).toLocaleString('en-CA')} · ${b.row_count} added, ${b.skipped_count} skipped`)),
      h('button', { class: 'btn small danger', onclick: async () => { if (confirm(`Remove the ${b.row_count} transactions from this import?`)) { await del(`/api/imports/${b.id}`); render(); } } }, 'Roll back')))) : h('p', { class: 'muted' }, 'No imports yet.')));
}

function viewPlaceholder(title, text, items) {
  return shell(title, h('div', { class: 'card' }, h('h2', {}, 'Coming in a later release'), h('p', {}, text), h('ul', { class: 'roadmap' }, items.map((i) => h('li', {}, i)))));
}

async function viewMore() {
  return shell('More', h('div', { class: 'card' }, h('ul', { class: 'list' }, AREAS.slice(4).map((a) => h('li', {}, h('button', { class: 'item', onclick: () => go(a.path) }, icon(a.icon), h('span', { class: 'grow title' }, a.label)))))));
}

async function viewSettings() {
  const cards = [];
  const installBtn = h('button', { class: 'btn', onclick: async () => { state.installEvent.prompt(); await state.installEvent.userChoice; state.installEvent = null; render(); } }, 'Install app');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  cards.push(h('section', { class: 'card' }, h('h2', {}, 'Install'),
    standalone ? h('p', { class: 'muted' }, 'Finance Hub is installed on this device.') :
      state.installEvent ? [h('p', {}, 'Install Finance Hub for quick access and a full-screen window.'), installBtn] :
        ios ? h('p', {}, 'On iPhone or iPad: tap the Share button, then "Add to Home Screen".') :
          h('p', { class: 'muted' }, 'Use your browser menu and choose "Install app" or "Add to Home Screen". This works on the https address only.')));
  // password
  const np = h('input', { id: 'np', type: 'password', autocomplete: 'new-password' }), perr = h('p', { class: 'form-error', role: 'alert' }), pok = h('p', { class: 'pos', role: 'status' });
  cards.push(h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault(); perr.textContent = ''; pok.textContent = '';
    try { await withStepUp('Changing your password needs your current password.', () => post('/api/password', { newPassword: np.value })); np.value = ''; pok.textContent = 'Password changed. Other devices were signed out.'; } catch (x) { perr.textContent = x.message; }
  } }, h('h2', {}, 'Password'), h('div', { class: 'field' }, h('label', { for: 'np' }, 'New password (12+ characters)'), np), perr, pok, h('button', { class: 'btn' }, 'Change password')));
  // export
  const download = async (url, name) => {
    const res = await withStepUp('Exporting your data needs your password.', async () => {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) { const d = await r.json().catch(() => ({})); const e = new Error(d.error || 'Export failed'); e.data = d; throw e; }
      return r;
    });
    const blob = await res.blob(); const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
  };
  const eerr = h('p', { class: 'form-error', role: 'alert' });
  const wrap = (fn) => async () => { eerr.textContent = ''; try { await fn(); } catch (x) { eerr.textContent = x.message; } };
  cards.push(h('section', { class: 'card' }, h('h2', {}, 'Export your data'), h('p', { class: 'muted' }, 'Everything stays on your server. Exports ask for your password again.'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: wrap(() => download('/api/export.json', 'finance-hub-export.json')) }, 'Everything (JSON)'), h('button', { class: 'btn', onclick: wrap(() => download('/api/export/transactions.csv', 'transactions.csv')) }, 'Transactions (CSV)')), eerr));
  const { entries } = await get('/api/audit');
  cards.push(h('section', { class: 'card' }, h('h2', {}, 'Security log'), h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Event'), h('th', {}, 'Detail'))),
    h('tbody', {}, entries.slice(0, 15).map((e) => h('tr', {}, h('td', { class: 'nowrap small' }, new Date(e.at).toLocaleString('en-CA')), h('td', {}, e.action.replaceAll('_', ' ')), h('td', { class: 'small muted' }, e.detail || ''))))))));
  cards.push(h('section', { class: 'card' }, h('h2', {}, 'About'), h('p', {}, `Finance Hub v${state.info.version}`), h('p', { class: 'muted small' }, `You are signed out after ${state.info.idleMinutes} minutes without activity.`),
    h('button', { class: 'btn', onclick: async () => { await post('/api/logout'); await loadState(); render(); } }, 'Sign out')));
  const stab = params().get('tab') || 'general';
  const sbar = h('div', { class: 'tabs', role: 'tablist' }, [['general', 'General'], ['lists', 'Lists']].map(([k, l]) => h('button', { role: 'tab', 'aria-selected': k === stab ? 'true' : 'false', onclick: () => go(`/settings?tab=${k}`) }, l)));
  if (stab === 'lists') return shell('Settings', [sbar, await listsView()]);
  return shell('Settings', [sbar, h('div', { class: 'grid two' }, h('div', {}, cards[0], cards[1], cards[2]), h('div', {}, cards[3], cards[4]))]);
}

// ---------- router ----------
const VIEWS = {
  '/': viewOverview, '/budget': viewBudget, '/accounts': viewAccounts, '/settings': viewSettings, '/more': viewMore,
  '/cards': viewOffers,
  '/invest': viewInvest,
  '/tax': viewTax, '/wealth': viewWealth,
};
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  try {
    if (!state.info) await loadState();
    if (!state.info.authenticated) {
      if (state.info.pending) { await post('/api/logout').catch(() => null); await loadState(); }
      root.replaceChildren(loginScreen());
      return;
    }
    state.route = location.pathname in VIEWS ? location.pathname : '/';
    const view = await VIEWS[state.route]();
    if (seq !== renderSeq) return;
    root.replaceChildren(view);
    document.title = (state.route === '/' ? '' : (AREAS.find((a) => a.path === state.route)?.label || 'More') + ' - ') + 'Finance Hub';
  } catch (e) {
    if (seq !== renderSeq) return;
    root.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'card' }, h('h2', {}, 'Could not load'), h('p', {}, e.message), h('button', { class: 'btn primary', onclick: () => render() }, 'Try again'))));
  }
}

// ---------- PWA ----------
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installEvent = e; });
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
    const waiting = (w) => { state.swWaiting = w; if (state.info?.authenticated) render(); };
    if (reg.waiting && navigator.serviceWorker.controller) waiting(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) waiting(w); });
    });
  }).catch(() => {});
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller; // first install must not reload the page
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
}
render();

export { h, get, post, put, patch, del, money, fmtDate, shell, go, params, dialog, emptyState, today, render };
