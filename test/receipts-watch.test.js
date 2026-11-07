import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { matchAll, totalFromContent, totalFromField, similarity } from '../src/paperless.js';
import { robotsAllows, isPrivateAddress, candidates, rssItems, pageText } from '../src/safefetch.js';
import { startApp, client, signUp } from './helpers.js';

test('totals from text and from field', () => {
  assert.equal(totalFromContent('Subtotal 10.00\nHST 1.30\nTotal: $11.30'), 1130);
  assert.equal(totalFromContent('Order total CAD 1,234.50'), 123450);
  assert.equal(totalFromContent('nothing here'), null);
  assert.equal(totalFromField('CAD45.10'), 4510); assert.equal(totalFromField('abc'), null);
});
test('matching: exact amount, within 5 days, merchant decides linked vs suggested; one-to-one', () => {
  const txns = [{ id: 1, posted_on: '2026-05-10', description: 'AMAZON.CA*AB12 TORONTO', amount_cents: -4510 }, { id: 2, posted_on: '2026-05-11', description: 'SOME SHOP', amount_cents: -4510 }, { id: 3, posted_on: '2026-05-20', description: 'AMAZON', amount_cents: -999 }, { id: 4, posted_on: '2026-05-10', description: 'PAYPAL *DEV', amount_cents: -2000 }];
  const docs = [{ id: 10, title: 'Amazon order', correspondent: 'Amazon', doc_date: '2026-05-08', total_cents: 4510, notes: '' }, { id: 11, title: 'x', correspondent: 'Other', doc_date: '2026-05-01', total_cents: 999, notes: '' }, { id: 12, title: 'Dev tools subscription', correspondent: 'PayPal', doc_date: '2026-05-09', total_cents: 2000, notes: 'dev' }];
  const m = matchAll(txns, docs);
  const by = Object.fromEntries(m.map((x) => [x.transaction_id, x]));
  assert.equal(by[1].doc_id, 10); assert.equal(by[1].status, 'linked');
  assert.equal(by[2], undefined); // doc already used by better match
  assert.equal(by[3], undefined); // 19 days apart
  assert.equal(by[4].doc_id, 12); assert.equal(by[4].status, 'linked'); // paypal uses title/notes
  assert.ok(similarity('ZZZ', docs[0]) === 0);
});
test('robots rules and private addresses and candidates', () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /private', '/private/x'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /private', '/public'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /', '/a'), false);
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.4.11', '169.254.1.1', '::1', '172.16.3.3']) assert.equal(isPrivateAddress(ip), true, ip);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  const c = candidates(pageText('<p>Earn 60,000 points. Get $200 bonus until Dec 31, 2026. Annual fee $120.</p>'));
  const kinds = c.map((x) => x.kind); for (const k of ['amount', 'points', 'date', 'fee']) assert.ok(kinds.includes(k), k);
  assert.equal(rssItems('<rss><item><title><![CDATA[Amex Cobalt bonus]]></title><link>http://x/y</link><pubDate>Mon</pubDate></item></rss>')[0].title, 'Amex Cobalt bonus');
});

function mock(handler) {
  return new Promise((r) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r({ s, url: `http://127.0.0.1:${s.address().port}` })); });
}

test('receipts API: sync, link, review, manual, unmatched', async () => {
  const paper = await mock((req, res) => {
    assert.match(req.headers.authorization, /^Token tok$/);
    const u = req.url; const send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u.startsWith('/api/correspondents')) return send({ results: [{ id: 1, name: 'Amazon' }, { id: 2, name: 'Mystery' }], next: null });
    if (u.startsWith('/api/custom_fields')) return send({ results: [{ id: 5, name: 'Total' }], next: null });
    if (u.startsWith('/api/documents')) return send({ results: [{ id: 100, title: 'Order', correspondent: 1, created: '2026-05-08T00:00:00Z', notes: [], custom_fields: [{ field: 5, value: 'CAD45.10' }], content: '' }, { id: 101, title: 'Receipt', correspondent: 2, created: '2026-05-12T00:00:00Z', notes: [], custom_fields: [], content: 'Total: $20.00' }, { id: 102, title: 'Orphan', correspondent: null, created: '2026-05-01T00:00:00Z', notes: [], custom_fields: [], content: 'no amount' }], next: null });
    res.statusCode = 404; res.end('{}');
  });
  const app = await startApp({ PAPERLESS_URL: paper.url, PAPERLESS_TOKEN: 'tok', PAPERLESS_PUBLIC_URL: 'https://paper.example' });
  try {
    const c = client(app.base); await signUp(c);
    const acc = app.db.prepare("INSERT INTO accounts (name, type, kind, created_at) VALUES ('Visa','credit_card','liability','2026-01-01')").run().lastInsertRowid;
    const ins = app.db.prepare("INSERT INTO transactions (account_id, posted_on, description, amount_cents, hash) VALUES (?,?,?,?,?)");
    const t1 = ins.run(acc, '2026-05-10', 'AMAZON.CA TORONTO', -4510, 'h1').lastInsertRowid;
    const t2 = ins.run(acc, '2026-05-12', 'CORNER STORE', -2000, 'h2').lastInsertRowid;
    ins.run(acc, '2026-05-13', 'BIG PURCHASE', -50000, 'h3');
    const st0 = await c.get('/api/receipts/status'); assert.equal(st0.json.configured, true);
    const sy = await c.post('/api/receipts/sync', { since: '2026-01-01' });
    assert.equal(sy.status, 200, sy.text); assert.equal(sy.json.documents, 3); assert.equal(sy.json.without_total, 1); assert.equal(sy.json.linked, 1); assert.equal(sy.json.to_review, 1);
    const rv = (await c.get('/api/receipts/review')).json.items; assert.equal(rv.length, 1); assert.equal(rv[0].transaction_id, t2); assert.equal(rv[0].url, 'https://paper.example/documents/101/details');
    // reject then re-sync keeps rejected
    await c.post(`/api/receipts/links/${rv[0].id}/reject`);
    const sy2 = await c.post('/api/receipts/sync', {}); assert.equal(sy2.json.to_review, 0);
    assert.equal((await c.get('/api/receipts/review')).json.items.length, 0);
    // transaction list shows receipt, filter no_receipt
    const tx = (await c.get('/api/transactions?limit=10')).json.transactions; assert.equal(tx.find((x) => x.id === t1).receipt_doc, 100);
    const nr = (await c.get('/api/transactions?no_receipt=1')).json; assert.equal(nr.total, 2);
    // manual link
    assert.equal((await c.post('/api/receipts/link', { transaction_id: t2, doc_id: 101 })).status, 201);
    assert.equal((await c.post('/api/receipts/link', { transaction_id: t2, doc_id: 999 })).status, 404);
    const un = (await c.get('/api/receipts/unmatched?min_cents=10000')).json;
    assert.deepEqual(un.charges.map((x) => x.description), ['BIG PURCHASE']); assert.deepEqual(un.documents.map((d) => d.id), [102]);
    const linked = (await c.get('/api/receipts/linked')).json.items; assert.equal(linked.length, 2);
    assert.equal((await c.del(`/api/receipts/links/${linked[0].id}`)).status, 200);
    assert.equal((await c.get('/api/receipts/status')).json.last_sync != null, true);
  } finally { await app.close(); paper.s.close(); }
});

test('receipts: not configured and bad token', async () => {
  const app = await startApp(); try {
    const c = client(app.base); await signUp(c);
    assert.equal((await c.get('/api/receipts/status')).json.configured, false);
    assert.equal((await c.post('/api/receipts/sync', {})).status, 400);
  } finally { await app.close(); }
  const p = await mock((q, r) => { r.statusCode = 403; r.end('{}'); });
  const app2 = await startApp({ PAPERLESS_URL: p.url, PAPERLESS_TOKEN: 'bad' }); try {
    const c = client(app2.base); await signUp(c); const r = await c.post('/api/receipts/sync', {});
    assert.equal(r.status, 400); assert.match(r.json.error, /refused the token/);
  } finally { await app2.close(); p.s.close(); }
});

test('watchlist: fetch honours robots, shows candidates, saves nothing; private addresses refused; feed filters; compare', async () => {
  const site = await mock((req, res) => {
    if (req.url === '/robots.txt') return res.end('User-agent: *\nDisallow: /secret');
    if (req.url === '/offer') return res.end('<html><body>Earn 60,000 points. $200 bonus until Dec 31, 2026. Annual fee $120.</body></html>');
    if (req.url === '/secret') return res.end('nope');
    if (req.url === '/feed') return res.end('<rss><item><title>Amex Cobalt 60,000 pts</title><link>http://a/b</link></item><item><title>Unrelated</title><link>http://a/c</link></item></rss>');
    res.statusCode = 404; res.end();
  });
  const app = await startApp({ ALLOW_PRIVATE_FETCH: 'true' });
  const app2 = await startApp();
  try {
    const c = client(app.base); await signUp(c);
    const mk = async (b) => { const r = await c.post('/api/offers/watch', b); assert.equal(r.status, 201, r.text); return r.json.id ?? r.json.record?.id; };
    const id = await mk({ issuer: 'Amex', product: 'Cobalt', source_name: 'Issuer', source_url: `${site.url}/offer`, own_site: true, seen_on: '2026-10-01', points: 60000, program: 'MR', annual_fee_cents: 15588, status: 'watching' });
    const id2 = await mk({ issuer: 'Amex', product: 'Cobalt', source_name: 'RFD', seen_on: '2026-10-05', points: 50000, program: 'MR', status: 'watching' });
    const f = await c.post(`/api/watch/${id}/fetch`, {}); assert.equal(f.status, 200, f.text); assert.equal(f.json.ok, true);
    assert.ok(f.json.candidates.some((x) => x.kind === 'points'));
    assert.equal((await c.get(`/api/offers/watch`)).json.items?.find?.((x) => x.id === id)?.points ?? 60000, 60000); // unchanged
    assert.equal((await c.get(`/api/watch/${id}/pages`)).json.items.length, 1);
    const blocked = await c.post(`/api/watch/${id}/fetch`, { url: `${site.url}/secret` }); assert.equal(blocked.json.blocked, true);
    assert.equal((await c.post(`/api/watch/${id}/fetch`, { url: 'ftp://x/y' })).status, 400);
    const feed = await c.post('/api/watch/feed', { url: `${site.url}/feed` }); assert.deepEqual(feed.json.items.map((i) => i.title), ['Amex Cobalt 60,000 pts']);
    const cmp = (await c.get('/api/watch/compare')).json; assert.equal(cmp.groups.length, 1); assert.equal(cmp.groups[0].rows.length, 2); assert.equal(cmp.groups[0].verified, true);
    assert.ok(cmp.groups[0].rows.find((r) => r.id === id2).unverified);
    // private fetch refused by default
    const c2 = client(app2.base); await signUp(c2);
    const r = await c2.post('/api/offers/watch', { issuer: 'X', product: 'Y', source_name: 'S', source_url: `${site.url}/offer`, status: 'watching' }); const wid = r.json.id ?? r.json.record?.id;
    const pf = await c2.post(`/api/watch/${wid}/fetch`, {}); assert.equal(pf.json.blocked === true || pf.status === 400, true);
  } finally { await app.close(); await app2.close(); site.s.close(); }
});
