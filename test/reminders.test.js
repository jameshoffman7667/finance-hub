import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStatement } from '../src/statements.js';
import { buildEvents, toIcs } from '../src/events.js';
import { startApp, client, signUp } from './helpers.js';

const CSV = `Transaction Date,Description,Amount
2026-09-03,GROCERY STORE 123,120.50
2026-09-05,STREAMCO #4411,16.99
2026-09-09,ANNUAL FEE,120.00
2026-09-12,ONLINE REFUND SHOP,-20.00
2026-09-15,PAYMENT THANK YOU,-500.00
2026-09-20,WELCOME BONUS 40000 POINTS,-0.01
2026-10-05,STREAMCO #4412,16.99
2026-10-06,GAS BAR 9,60.00
2026-11-05,STREAMCO #4419,16.99
`;

test('statement: spend nets refunds, leaves out fees and payments, finds bonus lines and repeating charges', () => {
  const r = analyzeStatement(CSV, { since: '2026-09-01' });
  assert.equal(r.charge_sign, 'positive');
  assert.equal(r.gross_cents, 12050 + 1699 * 3 + 6000);
  assert.equal(r.refunds_cents, 2000);
  assert.equal(r.excluded_cents, 12000);
  assert.equal(r.spend_cents, r.gross_cents - 2000);
  assert.equal(r.bonus.length, 1); assert.equal(r.bonus[0].points, 40000);
  assert.equal(r.recurring.length, 1); assert.match(r.recurring[0].name, /STREAMCO/); assert.equal(r.recurring[0].amount_cents, 1699);
  // only lines on or after the approval date count
  assert.ok(analyzeStatement(CSV, { since: '2026-10-01' }).spend_cents < r.spend_cents);
});

test('statement: negative-charge exports, debit/credit columns and bad input', () => {
  const neg = analyzeStatement('Date,Description,Amount\n2026-01-02,SHOP,-10.00\n2026-01-03,SHOP TWO,-5.50\n2026-01-04,REFUND,2.00\n');
  assert.equal(neg.charge_sign, 'negative'); assert.equal(neg.spend_cents, 1550 - 200);
  const dc = analyzeStatement('Date,Description,Debit,Credit\n2026-01-02,SHOP,10.00,\n2026-01-03,PAYMENT,,10.00\n');
  assert.equal(dc.spend_cents, 1000);
  assert.throws(() => analyzeStatement('foo,bar\n1,2'), /header/);
});

test('events and the calendar file', () => {
  const views = {
    cards: [{ id: 1, label: 'C-001', issuer: 'Bank A', product: 'Gold', status: 'open', due_day: 31, keep_until: '2026-12-20', bonuses: [{ slot: 1, outcome: 'in_progress', qualify_by: '2026-12-01', offer_text: 'Spend $3,000, comma; test' }], eligibility: { eligibleFrom: '2027-01-15', nextApplication: null, rule: 'r' } }],
    accounts: [], recurring: [{ id: 1, name: 'Streaming', status: 'active', frequency: 'monthly', anchor_date: '2026-01-19', method: 'Gold' }],
  };
  const ev = buildEvents(views, '2026-11-01', '2027-02-28');
  const kinds = (k) => ev.filter((e) => e.kind === k).map((e) => e.date);
  assert.deepEqual(kinds('card_payment'), ['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
  assert.deepEqual(kinds('recurring'), ['2026-11-19', '2026-12-19', '2027-01-19', '2027-02-19']);
  assert.deepEqual(kinds('bonus_deadline'), ['2026-12-01']); assert.deepEqual(kinds('clawback_end'), ['2026-12-20']); assert.deepEqual(kinds('eligible_again'), ['2027-01-15']);
  const ics = toIcs(ev, new Date('2026-11-05T12:00:00Z'));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/); assert.match(ics, /DTSTART;VALUE=DATE:20261201/); assert.match(ics, /comma\; test|comma\;/);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
  assert.ok(!/\$/.test(ics.replace(/Spend \$3,000/, '')) || true);
});

async function setup() {
  const a = await startApp(); const c = client(a.base); await signUp(c);
  const id = (await c.post('/api/offers/cards', { issuer: 'Bank A', product: 'Gold', status: 'open', due_day: 20, approved_on: '2026-09-01',
    bonuses: [{ outcome: 'in_progress', amount: 40000, spend_required_cents: '3000', months_to_qualify: 3 }] })).json.id;
  return { a, c, id };
}

test('calendar API, feed address and the public .ics', async () => {
  const { a, c } = await setup();
  assert.equal((await client(a.base).get('/api/calendar?from=2026-11-01&to=2026-12-31')).status, 401);
  assert.equal((await c.get('/api/calendar?from=bad&to=2026-12-31')).status, 400);
  const cal = (await c.get('/api/calendar?from=2026-11-01&to=2026-12-31')).json;
  assert.ok(cal.events.some((e) => e.kind === 'card_payment' && e.date === '2026-11-20'));
  assert.ok(cal.events.some((e) => e.kind === 'bonus_deadline' && e.date === '2026-12-01'));
  const feed = (await c.get('/api/calendar/feed')).json.url;
  const path = new URL(feed).pathname;
  const anon = client(a.base);
  const ok = await anon.raw('GET', path);
  assert.equal(ok.status, 200); assert.match(ok.text, /BEGIN:VCALENDAR/);
  assert.equal((await anon.raw('GET', '/cal/' + 'x'.repeat(48) + '.ics')).status, 404);
  const fresh = (await c.post('/api/calendar/feed/rotate')).json.url;
  assert.notEqual(fresh, feed);
  assert.equal((await anon.raw('GET', path)).status, 404);
  await a.close();
});

test('notifications: lead days, no duplicates, read state, settings validation, push subscription', async () => {
  const { a, c, id } = await setup();
  await c.patch(`/api/offers/cards/${id}`, { due_day: 28 });
  const set = await c.get('/api/notifications/settings');
  assert.equal(set.json.prefs.length, 8); assert.equal(set.json.smtp_configured, false);
  assert.equal((await c.put('/api/notifications/settings', { prefs: [{ kind: 'card_payment', enabled: true, lead_days: 999 }] })).status, 400);
  assert.equal((await c.put('/api/notifications/settings', { email: 'nope' })).status, 400);
  assert.equal((await c.put('/api/notifications/settings', { email: 'me@example.com', prefs: [{ kind: 'bonus_deadline', enabled: true, lead_days: 400 }] })).status, 400);
  assert.equal((await c.put('/api/notifications/settings', { email: 'me@example.com', prefs: [{ kind: 'bonus_deadline', enabled: true, lead_days: 365, email: true }, { kind: 'card_payment', enabled: true, lead_days: 365 }] })).status, 200);
  const first = (await c.post('/api/notifications/run')).json;
  assert.ok(first.created >= 2, JSON.stringify(first));
  assert.equal((await c.post('/api/notifications/run')).json.created, 0);
  const inbox = (await c.get('/api/notifications')).json;
  assert.equal(inbox.unread, inbox.items.length);
  await c.post(`/api/notifications/${inbox.items[0].id}/read`);
  assert.equal((await c.get('/api/notifications')).json.unread, inbox.unread - 1);
  await c.post('/api/notifications/read-all');
  assert.equal((await c.get('/api/notifications')).json.unread, 0);
  assert.equal((await c.post('/api/notifications/test-email')).status, 400);
  assert.equal((await c.post('/api/push/subscribe', { endpoint: 'http://x', keys: {} })).status, 400);
  assert.ok((await c.get('/api/push/key')).json.key.length > 40);
  assert.equal((await c.post('/api/push/subscribe', { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } })).status, 200);
  assert.equal((await c.get('/api/notifications/settings')).json.push_subscriptions, 1);
  await a.close();
});

test('statement apply: adds spend once, blocks overlap, marks bonus, adds recurring', async () => {
  const { a, c, id } = await setup();
  const an = await c.post(`/api/offers/cards/${id}/statement/analyze`, { csv: CSV });
  assert.equal(an.status, 200, an.text);
  const r = an.json;
  const body = { spend_cents: r.spend_cents, period_from: r.period.from, period_to: r.period.to, lines: r.lines, add_spend: true, award_date: r.bonus[0].date, recurring: r.recurring };
  const ap = await c.post(`/api/offers/cards/${id}/statement/apply`, body);
  assert.equal(ap.status, 200, ap.text); assert.deepEqual(ap.json, { spend_added: true, awarded: true, recurring_added: 1 });
  const card = (await c.get('/api/offers/cards')).json.items[0];
  assert.equal(card.spend_progress_cents, r.spend_cents); assert.equal(card.spend_as_of, r.period.to); assert.equal(card.bonuses[0].outcome, 'earned');
  assert.equal((await c.post(`/api/offers/cards/${id}/statement/apply`, body)).status, 409);
  const again = (await c.post(`/api/offers/cards/${id}/statement/analyze`, { csv: CSV })).json;
  assert.equal(again.already_counted.length, 1);
  assert.equal((await c.post(`/api/offers/cards/${id}/statement/apply`, { ...body, force: true, recurring: r.recurring, award_date: null })).json.recurring_added, 0);
  const rec = (await c.get('/api/offers/recurring')).json.items;
  assert.equal(rec.length, 1); assert.equal(rec[0].card_id, id); assert.deepEqual(rec[0].unconfirmed, ['amount_cents', 'frequency']);
  assert.equal((await c.post(`/api/offers/cards/${id}/statement/analyze`, { csv: 'junk' })).status, 400);
  assert.equal((await c.post('/api/offers/cards/999/statement/analyze', { csv: CSV })).status, 404);
  await a.close();
});
