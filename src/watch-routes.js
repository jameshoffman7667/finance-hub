// Offer watchlist: fetch a page or feed only when asked, show what was found, save nothing automatically.
import { fetchPage, robotsCheck, pageText, candidates, rssItems } from './safefetch.js';
import { DEFAULTS, pointsValue } from './planner.js';

export function mountWatch({ api, db, config, requireAuth, route, bad, HttpError, today, audit, nowIso, notifier }) {
  const opts = () => ({ allowPrivate: config.allowPrivateFetch, version: config.version });
  const plannerPoints = () => { let s = {}; try { s = JSON.parse(notifier.getSetting('planner') || '{}'); } catch { s = {}; } return { ...DEFAULTS.points, ...(s.points || {}) }; };
  const cleanUrl = (u) => { let x; try { x = new URL(String(u || '')); } catch { throw bad('Enter a full web address'); } if (!/^https?:$/.test(x.protocol)) throw bad('Only http and https addresses'); return x.href; };

  api.post('/watch/:id/fetch', requireAuth, route(async (req, res) => {
    const o = db.prepare('SELECT * FROM watch_offers WHERE id = ?').get(+req.params.id);
    if (!o) throw new HttpError(404, 'Not found');
    const url = cleanUrl(req.body?.url || o.source_url);
    if (!(await robotsCheck(url, opts()))) return res.json({ ok: false, blocked: true, message: 'That site asks automated tools not to read this page (or its rules could not be read), so it was not fetched. Open it yourself and type the details in.' });
    let page;
    try { page = await fetchPage(url, opts()); } catch (e) { throw bad(`Could not fetch: ${e.message}`); }
    if (page.status !== 200) throw bad(`The site answered ${page.status}`);
    const text = pageText(page.body); const cands = candidates(text);
    db.prepare('INSERT INTO watch_pages (offer_id, url, fetched_at, excerpt, candidates) VALUES (?,?,?,?,?)').run(o.id, url, nowIso(), text.slice(0, 600), JSON.stringify(cands));
    db.prepare('DELETE FROM watch_pages WHERE offer_id = ? AND id NOT IN (SELECT id FROM watch_pages WHERE offer_id = ? ORDER BY id DESC LIMIT 5)').run(o.id, o.id);
    audit(req, req.session.user_id, 'watch.fetch', new URL(url).host);
    res.json({ ok: true, url, fetched_at: nowIso(), excerpt: text.slice(0, 600), candidates: cands, note: 'Nothing was saved to the offer. Check these against the page and enter what is right.' });
  }));
  api.get('/watch/:id/pages', requireAuth, route((req, res) => {
    res.json({ items: db.prepare('SELECT id, url, fetched_at, excerpt, candidates FROM watch_pages WHERE offer_id = ? ORDER BY id DESC').all(+req.params.id).map((p) => ({ ...p, candidates: JSON.parse(p.candidates || '[]') })) });
  }));

  api.post('/watch/feed', requireAuth, route(async (req, res) => {
    const url = cleanUrl(req.body?.url);
    if (!(await robotsCheck(url, opts()))) return res.json({ ok: false, blocked: true, items: [], message: 'That site asks automated tools not to read this feed, so it was not fetched.' });
    let page; try { page = await fetchPage(url, opts()); } catch (e) { throw bad(`Could not fetch: ${e.message}`); }
    if (page.status !== 200) throw bad(`The site answered ${page.status}`);
    const words = db.prepare('SELECT issuer, product FROM watch_offers WHERE status = ?').all('watching').flatMap((w) => [w.issuer, w.product]).filter(Boolean).map((s) => s.toLowerCase());
    const items = rssItems(page.body).map((i) => ({ ...i, matches: words.filter((w) => i.title.toLowerCase().includes(w)) }));
    res.json({ ok: true, items: items.filter((i) => i.matches.length), total: items.length, note: 'Items from a forum feed are leads only. Confirm on the issuer site before relying on them.' });
  }));

  // Same card seen in several places: group, value, and say which figures are verified on the issuer's own site.
  api.get('/watch/compare', requireAuth, route((req, res) => {
    const vals = plannerPoints(); const t = today(); const groups = new Map();
    for (const w of db.prepare("SELECT * FROM watch_offers WHERE status != 'ignored' ORDER BY issuer, product, id").all()) {
      const key = `${w.issuer || ''}|${w.product || ''}`.toLowerCase();
      const pv = pointsValue(w.points, w.program, vals);
      const bonus = (w.bonus_cents || 0) + (pv.cash_cents || 0);
      const row = { id: w.id, source: w.source_name || '', own_site: !!w.own_site, seen_on: w.seen_on, expires_on: w.expires_on, expired: !!(w.expires_on && w.expires_on < t), stale_days: w.seen_on ? Math.round((Date.parse(t) - Date.parse(w.seen_on)) / 864e5) : null, bonus_cents: bonus, points_known: pv.known, fee_cents: w.annual_fee_cents || 0, net_cents: bonus + (w.rebate_cents || 0) - (w.annual_fee_cents || 0), status: w.status, unverified: !w.own_site };
      if (!groups.has(key)) groups.set(key, { issuer: w.issuer, product: w.product, rows: [] });
      groups.get(key).rows.push(row);
    }
    const out = [...groups.values()].map((g) => { const live = g.rows.filter((r) => !r.expired); const best = live.reduce((a, r) => (!a || r.net_cents > a.net_cents ? r : a), null); return { ...g, best_id: best?.id ?? null, verified: g.rows.some((r) => r.own_site && !r.expired) }; });
    out.sort((a, b) => ((b.rows.find((r) => r.id === b.best_id)?.net_cents ?? -1e12) - (a.rows.find((r) => r.id === a.best_id)?.net_cents ?? -1e12)));
    res.json({ groups: out, note: 'Figures not seen on the issuer’s own site are unverified. Points use your Planner settings values; * means no value is saved for that points program, so its points are not counted.' });
  }));
}
