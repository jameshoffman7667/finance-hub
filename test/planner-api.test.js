import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client, signUp } from './helpers.js';

test('planner: offers, compare, plans, calendar, effort, ledger report', async () => {
  const app = await startApp(); const c = client(app.base);
  try {
    await signUp(c);
    const mk = async (path, body) => { const r = await c.post(path, body); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.id; };
    const scotia = await mk('/api/offers/offers', { kind: 'investment_transfer', issuer: 'Scotia', product: 'iTRADE', status: 'potential', rate_registered: 3, rate_nonreg: 1, cap_cents: '15000', hold_from: '2026-11-03', hold_until: '2029-02-28',
      enrol_by: '2027-04-01', fund_by: '2027-05-31', payouts: '2028-04-28 40%\n2029-03-30 60%', withdrawal_effect: 'reduces_qualifying_amount', withdrawal_scope: 'pooled', verified: true });
    const td = await mk('/api/offers/offers', { kind: 'investment_transfer', issuer: 'TD', product: 'Spring', status: 'earning', rate_registered: 2, rate_nonreg: 1, cap_cents: '10000', min_cents: '10000', hold_until: '2027-07-31', payouts: '2027-08-31 100%',
      withdrawal_effect: 'reduces_qualifying_amount', withdrawal_scope: 'pooled', verified: true });
    const bad = await c.post('/api/offers/offers', { kind: 'investment_transfer', issuer: 'X', product: 'Y', status: 'potential', payouts: 'next spring' });
    assert.equal(bad.status, 400);
    const list = (await c.get('/api/offers/offers')).json.items;
    assert.deepEqual(JSON.parse(list.find((o) => o.id === scotia).payouts), [{ date: '2028-04-28', pct: 40 }, { date: '2029-03-30', pct: 60 }]);

    const holding = await mk('/api/offers/holdings', { name: 'RRSP', institution: 'TD', account_type: 'rrsp', value_cents: '100000', invested: true, offer_id: td, counted_cents: '100000' });
    await mk('/api/offers/debts', { name: 'Line of credit', balance_cents: '5000', rate: 8 });
    const cmp = await c.post('/api/planner/compare', { holding_id: holding, offer_ids: [scotia], start: '2027-04-05' });
    assert.equal(cmp.status, 200, cmp.text);
    const o = cmp.json.options[0];
    assert.equal(o.bonus_cents, 300000); assert.equal(o.forfeited_cents, 200000); assert.equal(o.net_vs_stay_cents, 100000);
    assert.ok(o.breakeven_pct > 0.5 && o.breakeven_pct < 0.9);
    assert.equal((await c.post('/api/planner/compare', { holding_id: holding, offer_ids: [] })).status, 400);
    assert.equal((await c.post('/api/planner/compare', { holding_id: 999, offer_ids: [scotia] })).status, 404);

    // plan from the offer, steps feed the calendar
    const plan = await mk('/api/planner/plans', { offer_id: scotia });
    const plans = (await c.get('/api/planner/plans')).json.items;
    assert.ok(plans[0].steps.length >= 5);
    const cal = await c.get('/api/calendar?from=2027-03-01&to=2027-06-30');
    assert.ok(cal.json.events.some((e) => e.kind === 'plan_step' && /Enrol/.test(e.title)));
    const step = plans[0].steps.find((s) => /Enrol/.test(s.title));
    assert.equal((await c.patch(`/api/planner/steps/${step.id}`, { remind: false })).status, 200);
    const cal2 = await c.get('/api/calendar?from=2027-03-01&to=2027-06-30');
    assert.ok(!cal2.json.events.some((e) => e.kind === 'plan_step' && /Enrol/.test(e.title)));
    assert.equal((await c.patch(`/api/planner/steps/${step.id}`, { step_date: 'tomorrow' })).status, 400);
    assert.equal((await c.del(`/api/planner/plans/${plan}`)).status, 200);

    // ledger and effort
    const entry = await mk('/api/planner/ledger/from-offer/' + scotia, {});
    assert.equal((await c.patch(`/api/offers/ledger/${entry}`, { status: 'paid', received_cents: '1000', received_on: '2026-12-01', fees_cents: '100' })).status, 200);
    assert.equal((await c.post('/api/planner/effort', { ref_type: 'ledger', ref_id: entry, hours: 4, logged_on: '2026-11-20', note: 'Transfer forms' })).status, 201);
    assert.equal((await c.post('/api/planner/effort', { ref_type: 'ledger', ref_id: entry, hours: 0 })).status, 400);
    assert.equal((await c.post('/api/planner/effort', { ref_type: 'ledger', ref_id: 999, hours: 1 })).status, 404);
    const rep = (await c.get('/api/planner/report')).json;
    assert.equal(rep.total.gross_cents, 100000); assert.equal(rep.total.net_cents, 90000); assert.equal(rep.total.hours, 4);
    assert.equal(rep.total.per_hour_cents, 22500); assert.equal(rep.rows[0].t.worth_it, true);
    assert.equal(rep.by_year[0].key, '2026');

    // settings round trip, validation
    const s0 = (await c.get('/api/planner/settings')).json;
    assert.equal(s0.benchmark, 7); assert.equal(s0.worth_per_hour_cents, 5000); assert.equal(s0.effort_hours.credit_card, 2);
    assert.equal((await c.put('/api/planner/settings', { benchmark: 90 })).status, 400);
    assert.equal((await c.put('/api/planner/settings', { benchmark: 6, worth_per_hour_cents: 7500 })).status, 200);
    const s1 = (await c.get('/api/planner/settings')).json; assert.equal(s1.benchmark, 6); assert.equal(s1.worth_per_hour_cents, 7500);
    assert.equal((await c.get('/api/planner/report')).json.rows[0].t.worth_it, true);

    // export includes the new tables; unauthenticated access refused
    assert.equal((await client(app.base).get('/api/planner/report')).status, 401);
  } finally { await app.close(); }
});
