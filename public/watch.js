// Offer watchlist: things you noticed, where you saw them, fetched only when you ask.
import { h, get, post, money, fmtDate, dialog, emptyState, render } from './app.js';
import { row, LABELS, editor } from './offers.js';

const pill = (t, c = '') => h('span', { class: `pill ${c}` }, t);
const reload = () => render();

function fetchDialog(w) {
  dialog(`Check ${w.issuer} ${w.product}`, (close) => {
    const out = h('div', {}); const err = h('p', { class: 'form-error', role: 'alert' });
    const url = h('input', { id: 'wu', type: 'url', value: w.source_url || '', placeholder: 'https://…' });
    const go = h('button', { class: 'btn primary', onclick: async () => {
      err.textContent = ''; go.disabled = true;
      try {
        const r = await post(`/api/watch/${w.id}/fetch`, { url: url.value });
        out.replaceChildren(r.blocked ? h('p', { class: 'form-error' }, r.message) : h('div', {},
          h('p', { class: 'muted small' }, r.note), h('p', { class: 'small' }, r.excerpt),
          r.candidates.length ? h('ul', { class: 'list' }, r.candidates.map((c) => h('li', {}, h('span', { class: 'pill' }, c.kind), h('strong', { class: 'num' }, ` ${c.value} `), h('span', { class: 'muted small' }, c.context)))) : h('p', { class: 'muted' }, 'Nothing that looks like an amount, points, date or fee was found. Some pages need a browser to show their offers.')));
      } catch (e) { err.textContent = e.message; } finally { go.disabled = false; }
    } }, 'Fetch the page now');
    return [h('label', { for: 'wu' }, 'Page address'), url, h('p', { class: 'muted small' }, 'The page is read once, only now, only if the site’s robots.txt allows it. Nothing is saved to the offer; copy the figures you trust into Edit.'), err, h('div', { class: 'row' }, go, h('button', { class: 'btn', onclick: close }, 'Close')), out];
  });
}
function feedDialog() {
  dialog('Check a deals feed', (close) => {
    const out = h('div', {}); const err = h('p', { class: 'form-error', role: 'alert' });
    const url = h('input', { id: 'fu', type: 'url', placeholder: 'https://… (RSS feed address)' });
    const go = h('button', { class: 'btn primary', onclick: async () => {
      err.textContent = ''; go.disabled = true;
      try {
        const r = await post('/api/watch/feed', { url: url.value });
        out.replaceChildren(r.blocked ? h('p', { class: 'form-error' }, r.message) : h('div', {}, h('p', { class: 'muted small' }, `${r.items.length} of ${r.total} items mention something on your watchlist. ${r.note}`),
          h('ul', { class: 'list' }, r.items.map((i) => h('li', {}, h('div', { class: 'grow' }, h('div', { class: 'title' }, i.title), h('div', { class: 'muted small' }, i.matches.join(', '))), h('a', { href: i.link, target: '_blank', rel: 'noopener noreferrer' }, 'Open'))))));
      } catch (e) { err.textContent = e.message; } finally { go.disabled = false; }
    } }, 'Read the feed now');
    return [h('label', { for: 'fu' }, 'Feed address'), url, h('p', { class: 'muted small' }, 'Forum posts are leads, not facts. Only items naming a watched issuer or product are shown.'), err, h('div', { class: 'row' }, go, h('button', { class: 'btn', onclick: close }, 'Close')), out];
  });
}

export async function watchTab() {
  const [{ items }, cmp] = await Promise.all([get('/api/offers/watch'), get('/api/watch/compare')]);
  const add = h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Watchlist'),
    h('button', { class: 'btn', onclick: feedDialog }, 'Check a feed'), h('button', { class: 'btn primary', onclick: () => editor('watch', 'watch', { status: 'watching' }, reload) }, 'Add')),
    h('p', { class: 'muted small' }, 'Nothing here is fetched on a schedule. Add what you see, and press Check page when you want the current wording.'));
  const best = cmp.groups.length ? h('section', { class: 'card' }, h('h2', {}, 'Compared'), h('p', { class: 'muted small' }, cmp.note),
    cmp.groups.map((g) => h('div', { class: 'table-wrap' }, h('h3', {}, `${g.issuer} ${g.product}`, ' ', g.verified ? pill('Seen on issuer site', 'ok') : pill('Unverified', 'warn')),
      h('table', {}, h('thead', {}, h('tr', {}, ['Source', 'Seen', 'Ends', 'Bonus', 'Fee', 'Net', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, g.rows.map((r) => h('tr', { class: r.expired ? 'muted' : '' }, h('td', {}, r.source || '—', r.own_site ? '' : ' (not issuer)'), h('td', {}, r.seen_on ? fmtDate(r.seen_on) : ''), h('td', {}, r.expires_on ? fmtDate(r.expires_on) : ''), h('td', { class: 'num' }, money(r.bonus_cents) + (r.points_known ? '' : '*')), h('td', { class: 'num' }, money(r.fee_cents)), h('td', { class: 'num' }, money(r.net_cents)), h('td', {}, r.expired ? pill('Ended') : r.id === g.best_id ? pill('Best', 'ok') : null)))))))) : null;
  const list = items.length ? h('ul', { class: 'list' }, items.map((w) => h('li', {},
    row(`${w.issuer} ${w.product}`, [w.source_name, w.seen_on ? `seen ${fmtDate(w.seen_on)}` : null, w.bonus_text, LABELS.watch_status[w.status] || w.status].filter(Boolean).join(' · '),
      [w.own_site ? pill('Issuer site', 'ok') : pill('Unverified', 'warn')], () => editor('watch', 'watch', w, reload), (w.unconfirmed || []).length > 0),
    h('div', { class: 'row actions' }, w.source_url ? h('button', { class: 'btn small', onclick: () => fetchDialog(w) }, 'Check page') : null)))) : emptyState('Nothing watched', 'Add an offer you noticed, with where you saw it.');
  return [add, h('div', { class: 'card' }, list), best];
}
