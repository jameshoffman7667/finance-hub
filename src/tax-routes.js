// Smith Manoeuvre tracker and tax support center (information only).
import { summary as smithSummary, exportRows } from './smith.js';
import { acbReport, gainsByYear, medical, expectedSlips, registeredRoom, CHECKLIST, review, toCsv } from './tax.js';

export function mountTax({ api, db, requireAuth, route, bad, HttpError, today, audit, nowIso }) {
  const yearOf = (q) => { const y = q === undefined ? +today().slice(0, 4) : Number(q); if (!Number.isInteger(y) || y < 2000 || y > 2100) throw bad('year: a four-digit year'); return y; };
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const smith = () => smithSummary({ debts: all('SELECT * FROM debts'), holdings: all('SELECT * FROM holdings'), events: all('SELECT * FROM loan_events'), income: all('SELECT * FROM income_events'), taxYears: all('SELECT * FROM tax_years'), today: today() });

  api.get('/smith/summary', requireAuth, route((req, res) => res.json(smith())));
  // Clears a monthly reminder: records the capitalizing advance with its amount, on the due date of that month.
  api.post('/smith/loans/:id/capitalized', requireAuth, route((req, res) => {
    const loan = db.prepare('SELECT * FROM debts WHERE id = ? AND smith = 1').get(+req.params.id);
    if (!loan) throw new HttpError(404, 'Loan not found or not tagged Smith Manoeuvre');
    const month = String(req.body?.month || ''); if (!/^\d{4}-\d{2}$/.test(month)) throw bad('month: YYYY-MM');
    const cents = Math.round(Number(req.body?.amount_cents)); if (!Number.isFinite(cents) || cents <= 0) throw bad('Enter the amount of interest that was capitalized');
    const date = `${month}-${String(Math.min(loan.cap_day || 28, new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).getUTCDate())).padStart(2, '0')}`;
    if (db.prepare("SELECT 1 FROM loan_events WHERE debt_id = ? AND kind = 'capitalized_interest' AND substr(event_date,1,7) = ?").get(loan.id, month)) throw new HttpError(409, 'That month already has a capitalized-interest record');
    const id = db.prepare("INSERT INTO loan_events (debt_id, event_date, kind, amount_cents, note) VALUES (?,?,?,?,?)").run(loan.id, date, 'capitalized_interest', cents, 'Confirmed by hand').lastInsertRowid;
    audit(req, req.session.user_id, 'smith.capitalized', String(id));
    res.status(201).json({ id });
  }));
  api.get('/smith/export.csv', requireAuth, route((req, res) => {
    const y = yearOf(req.query.year); const loans = all('SELECT * FROM debts WHERE smith = 1');
    audit(req, req.session.user_id, 'export', `smith ${y}`);
    res.type('text/csv').set('Content-Disposition', `attachment; filename="smith-interest-${y}.csv"`).send(toCsv(exportRows(loans, all('SELECT * FROM loan_events'), y)));
  }));

  const checklist = (y) => { const done = new Map(all('SELECT * FROM tax_checklist WHERE tax_year = ?', y).map((c) => [c.item, c.done])); return CHECKLIST.map(([item, label]) => ({ item, label, done: done.get(item) === 1 })); };
  api.post('/tax/checklist', requireAuth, route((req, res) => {
    const y = yearOf(req.body?.year); const item = String(req.body?.item || ''); if (!CHECKLIST.some(([k]) => k === item)) throw bad('Unknown checklist item');
    db.prepare('INSERT INTO tax_checklist (tax_year, item, done) VALUES (?,?,?) ON CONFLICT(tax_year, item) DO UPDATE SET done = excluded.done').run(y, item, req.body?.done ? 1 : 0);
    res.json({ ok: true });
  }));
  api.get('/tax/acb', requireAuth, route((req, res) => {
    const r = acbReport(all('SELECT * FROM acb_trades')); res.json({ ...r, years: gainsByYear(r.sales, all('SELECT * FROM carryforwards')), note: 'Average cost per security across all your non-registered accounts. Foreign amounts use the exchange rate you entered on each trade. Information only.' });
  }));
  api.get('/tax/overview', requireAuth, route((req, res) => {
    const y = yearOf(req.query.year);
    const years = all('SELECT * FROM tax_years WHERE year = ?', y);
    const trades = acbReport(all('SELECT * FROM acb_trades')); const gains = gainsByYear(trades.sales, all('SELECT * FROM carryforwards')).find((g) => g.year === y) || null;
    const receipts = all('SELECT * FROM tax_receipts WHERE tax_year = ?', y);
    const holdings = all('SELECT * FROM holdings');
    const ledger = all("SELECT * FROM ledger_entries WHERE received_on LIKE ?", `${y}%`);
    const sm = smith().per_year.find((p) => p.year === y) || null;
    res.json({ year: y, taxpayers: years, medical: medical(receipts, y, years[0]), gains, sale_warnings: trades.warnings, superficial: trades.sales.filter((s) => s.date.startsWith(String(y)) && s.superficial_warning),
      fees: { total_cents: receipts.filter((r) => r.category === 'investment_fee').reduce((s, r) => s + r.amount_cents, 0) }, donations_cents: receipts.filter((r) => r.category === 'donation').reduce((s, r) => s + r.amount_cents, 0),
      carrying_interest: sm ? { interest_cents: sm.interest_cents, tax_value_cents: sm.tax_value_cents, estimate: true } : null,
      slips: expectedSlips(all('SELECT * FROM income_events'), holdings, all('SELECT * FROM tax_slips'), y), room: registeredRoom(all('SELECT * FROM registered_room'), y),
      bonuses: ledger.map((e) => ({ id: e.id, issuer: e.issuer, title: e.title, received_cents: e.received_cents, received_on: e.received_on, tax_flag: e.tax_flag })),
      carry: all('SELECT * FROM carryforwards'), checklist: checklist(y),
      note: 'Information only. You calculate and file in accredited tax software; check every figure against your slips and with an accountant.' });
  }));
  api.get('/tax/review', requireAuth, route((req, res) => {
    const y = yearOf(req.query.year);
    res.json({ year: y, findings: review({ year: y, holdings: all('SELECT * FROM holdings'), room: all('SELECT * FROM registered_room'), receipts: all('SELECT * FROM tax_receipts'), ledger: all('SELECT * FROM ledger_entries'), taxYears: all('SELECT * FROM tax_years'),
      trades: all('SELECT * FROM acb_trades'), smithSummary: smith(), checklist: all('SELECT * FROM tax_checklist'), today: today() }), note: 'Findings only. Nothing here is advice to buy or sell.' });
  }));
  api.get('/tax/export.csv', requireAuth, route((req, res) => {
    const y = yearOf(req.query.year); const rows = [['Section', 'Item', 'Date', 'Amount', 'Detail']];
    const trades = acbReport(all('SELECT * FROM acb_trades'));
    for (const s of trades.sales.filter((x) => x.date.startsWith(String(y)))) rows.push(['Capital gains', s.security, s.date, (s.gain_cents / 100).toFixed(2), `proceeds ${(s.proceeds_cents / 100).toFixed(2)}; cost ${(s.cost_cents / 100).toFixed(2)}${s.superficial_warning ? '; check superficial loss' : ''}`]);
    for (const r of all('SELECT * FROM tax_receipts WHERE tax_year = ? ORDER BY spent_on', y)) rows.push([r.category, r.payee || '', r.spent_on, ((r.amount_cents - (r.reimbursed_cents || 0)) / 100).toFixed(2), `${r.person || ''}${r.claimed ? '; claimed' : ''}`]);
    for (const p of smith().per_year.filter((x) => x.year === y)) rows.push(['Investment loan interest', 'All Smith loans', String(y), (p.interest_cents / 100).toFixed(2), 'line 22100 if conditions are met']);
    for (const b of all('SELECT * FROM ledger_entries WHERE received_on LIKE ?', `${y}%`)) rows.push(['Bonus', `${b.issuer} ${b.title}`, b.received_on, ((b.received_cents || 0) / 100).toFixed(2), b.tax_flag || 'no flag']);
    audit(req, req.session.user_id, 'export', `tax ${y}`);
    res.type('text/csv').set('Content-Disposition', `attachment; filename="tax-${y}.csv"`).send(toCsv(rows));
  }));
}
