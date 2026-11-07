// Receipts from paperless-ngx matched to card charges.
import { h, get, post, money, fmtDate, go, params, dialog, emptyState, render } from './app.js';

const pill = (t, c = '') => h('span', { class: `pill ${c}` }, t);
const reload = () => render();
const docLink = (r, text) => (r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, text) : h('span', {}, text));

export async function receiptsTab() {
  const st = await get('/api/receipts/status');
  if (!st.configured) return h('div', { class: 'card' }, emptyState('Paperless is not connected', 'Set PAPERLESS_URL and PAPERLESS_TOKEN on the server (see the release notes), restart, and come back.'));
  const min = Number(params().get('min')) || 0;
  const [rv, un] = await Promise.all([get('/api/receipts/review'), get(`/api/receipts/unmatched?min_cents=${Math.round(min * 100)}`)]);
  const msg = h('p', { class: 'muted small', role: 'status' }, st.last_sync ? `Last synced ${fmtDate(st.last_sync.slice(0, 10))}.` : 'Not synced yet.');
  const sync = h('button', { class: 'btn primary', onclick: async () => {
    sync.disabled = true; msg.textContent = 'Reading receipts…';
    try { const r = await post('/api/receipts/sync', {}); msg.textContent = `${r.documents} receipts read (${r.without_total} without a total), ${r.linked} linked, ${r.to_review} to review.`; setTimeout(reload, 1200); }
    catch (e) { msg.textContent = e.message; sync.disabled = false; }
  } }, 'Sync now');
  const top = h('div', { class: 'card' }, h('div', { class: 'stat-row' }, h('div', {}, h('span', {}, 'Receipts'), h('strong', {}, st.docs)), h('div', {}, h('span', {}, 'Linked'), h('strong', {}, st.linked)), h('div', {}, h('span', {}, 'To review'), h('strong', {}, st.to_review))), h('div', { class: 'row' }, sync), msg,
    h('p', { class: 'muted small' }, 'Only card charges are matched: same amount, receipt dated within 5 days, merchant name similar. The receipt text stays in Paperless; only title, name, date and total are kept here.'));
  const review = rv.items.length ? h('section', { class: 'card' }, h('h2', {}, 'Is this the right receipt?'), h('ul', { class: 'list' }, rv.items.map((r) => h('li', {},
    h('div', { class: 'grow' }, h('div', { class: 'title' }, `${r.description} · ${money(-r.amount_cents)}`), h('div', { class: 'muted small' }, `${fmtDate(r.posted_on)} ↔ `, docLink(r, `${r.correspondent || 'Receipt'}: ${r.title}`), ` (${fmtDate(r.doc_date)})`)),
    h('div', { class: 'row actions' }, h('button', { class: 'btn small primary', onclick: async () => { await post(`/api/receipts/links/${r.id}/accept`); reload(); } }, 'Yes'), h('button', { class: 'btn small', onclick: async () => { await post(`/api/receipts/links/${r.id}/reject`); reload(); } }, 'No'))))) ) : null;
  const minIn = h('input', { type: 'number', min: 0, step: 1, value: min, 'aria-label': 'Only charges of at least this many dollars', class: 'amt-min' });
  const charges = h('section', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Card charges with no receipt'), h('label', { class: 'small' }, 'At least $ '), minIn, h('button', { class: 'btn small', onclick: () => go(`/budget?tab=receipts&min=${Number(minIn.value) || 0}`) }, 'Filter')),
    un.charges.length ? h('ul', { class: 'list' }, un.charges.map((t) => h('li', {}, h('div', { class: 'grow' }, h('div', { class: 'title' }, t.description), h('div', { class: 'muted small' }, fmtDate(t.posted_on))), h('div', { class: 'num' }, money(-t.amount_cents)),
      un.documents.length ? h('button', { class: 'btn small', onclick: () => pickDoc(t, un.documents) }, 'Link') : null))) : emptyState('All matched', 'Every card charge at this size has a receipt.'));
  const docs = un.documents.length ? h('section', { class: 'card' }, h('h2', {}, 'Receipts with no charge'), h('ul', { class: 'list' }, un.documents.slice(0, 100).map((d) => h('li', {}, h('div', { class: 'grow' }, h('div', { class: 'title' }, docLink(d, `${d.correspondent || 'Receipt'}: ${d.title}`)), h('div', { class: 'muted small' }, fmtDate(d.doc_date))), h('div', { class: 'num' }, d.total_cents != null ? money(d.total_cents) : 'no total'))))) : null;
  return [top, review, charges, docs];
}

function pickDoc(t, docs) {
  dialog(`Link a receipt to ${t.description}`, (close) => {
    const near = docs.filter((d) => d.total_cents === -t.amount_cents).concat(docs.filter((d) => d.total_cents !== -t.amount_cents)).slice(0, 40);
    const err = h('p', { class: 'form-error', role: 'alert' });
    return [h('p', { class: 'muted small' }, 'Same-amount receipts are listed first.'), err, h('ul', { class: 'list' }, near.map((d) => h('li', {}, h('div', { class: 'grow' }, h('div', { class: 'title' }, `${d.correspondent || 'Receipt'}: ${d.title}`), h('div', { class: 'muted small' }, fmtDate(d.doc_date))), h('div', { class: 'num' }, d.total_cents != null ? money(d.total_cents) : 'no total'),
      h('button', { class: 'btn small primary', onclick: async () => { try { await post('/api/receipts/link', { transaction_id: t.id, doc_id: d.id }); close(); reload(); } catch (e) { err.textContent = e.message; } } }, 'Use')))), h('button', { class: 'btn', onclick: close }, 'Cancel')];
  });
}
