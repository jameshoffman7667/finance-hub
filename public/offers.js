// Cards, bank and investment accounts, bonuses, recurring payments and re-application rules.
// Loaded by app.js. Everything is built with h(), so text from the database is never parsed as markup.
import { offersTab, holdingsTab, compareTab, plansTab, ledgerTab, plannerSettingsTab } from './planner.js';
import { h, get, post, put, patch, del, money, fmtDate, shell, go, params, dialog, emptyState, today, render } from './app.js';

const TABS = [['cards', 'Credit cards'], ['bank', 'Bank accounts'], ['invest', 'Investment accounts'], ['recurring', 'Recurring payments'], ['rules', 'Re-apply rules'], ['calendar', 'Calendar'], ['reminders', 'Reminders'], ['statements', 'Statements'], ['offers', 'Offers'], ['holdings', 'Holdings and debts'], ['compare', 'Compare'], ['plans', 'Plans'], ['ledger', 'Bonus ledger'], ['psettings', 'Planner settings'], ['import', 'Import workbook']];
const ENTITY_OF = { cards: 'cards', bank: 'accounts', invest: 'accounts', recurring: 'recurring', rules: 'rules' };
const LABELS = {
  card_status: { open: 'Open', frozen: 'Frozen (zero balance, locked)', closed: 'Closed', downgraded: 'Downgraded / product-changed', pending: 'Pending', declined: 'Declined' },
  acct_status: { open: 'Open', closed_me: 'Closed by me', closed_inst: 'Closed by institution', converted: 'Converted to another product', transferred_out: 'Transferred out', dormant: 'Dormant' },
  confidence: { exact: 'Exact date', month: 'Month only', estimate: 'Estimate' },
  close_reason: { not_closed: 'Not closed', bonus_complete: 'Bonus complete', avoid_fee: 'Avoided annual fee', issuer_closed: 'Issuer closed it', inactive: 'Inactive', moved_better: 'Moved to better card', other: 'Other' },
  outcome: { in_progress: 'In progress', earned: 'Earned', missed: 'Missed', forfeited: 'Forfeited' },
  card_bonus_type: { welcome: 'Welcome / spend', anniversary: 'Anniversary', second_year: 'Second year', category: 'Category / other', referral: 'Referral', retention: 'Retention offer' },
  scope: { same_card: 'Same card', same_family: 'Same card family', any_card: 'Any card from the issuer', any_account: 'Any account from the institution' },
  counted_from: { application: 'Application date', approval: 'Approval date', bonus_received: 'Bonus received date', closed: 'Closed or downgraded date', downgrade: 'Downgrade date' },
  consumed: { no: 'No', partly: 'Partly', yes: 'Yes' },
  offer_kind: { investment_transfer: 'Investment transfer', bank_account: 'Bank account', credit_card: 'Credit card' },
  offer_status: { potential: 'Potential', enrolled: 'Enrolled', earning: 'Earning', paid: 'Paid', forfeited: 'Forfeited' },
  withdrawal_effect: { reduces_qualifying_amount: 'Reduces the qualifying amount', forfeits_all_remaining: 'Forfeits everything still unpaid', allowed_up_to_percent: 'Allowed up to a percent, more forfeits all', none: 'No effect', unknown: 'Not known' },
  withdrawal_scope: { pooled: 'Pooled across accounts', per_account: 'Per account', unknown: 'Not confirmed' },
  holding_type: { rrsp: 'RRSP', tfsa: 'TFSA', resp: 'RESP', fhsa: 'FHSA', nonreg: 'Non-registered', chequing: 'Chequing', savings: 'Savings' },
  ledger_kind: { card: 'Credit card', bank: 'Bank account', investment: 'Investment transfer' },
  loan_type: { mortgage: 'Mortgage', heloc: 'Home equity line (HELOC)', loan: 'Loan', other: 'Other' },
  loan_event_kind: { advance_invest: 'Advance used to invest', advance_other: 'Advance used for something else', capitalized_interest: 'Interest capitalized (added to the loan)', interest_paid: 'Interest paid', principal_paid: 'Principal paid' },
  income_kind: { dividend: 'Dividend', interest: 'Interest', return_of_capital: 'Return of capital', distribution: 'Distribution (T3)' },
  receipt_category: { medical: 'Medical', investment_fee: 'Investment fees', donation: 'Donation', other: 'Other' },
  trade_kind: { buy: 'Buy', sell: 'Sell', reinvest: 'Reinvested distribution', return_of_capital: 'Return of capital', split: 'Split (enter the multiple, 2 for two-for-one)' },
  slip_kind: { t5_interest: 'T5 interest', t5_dividends: 'T5 dividends', t3: 'T3', t5008: 'T5008', t4: 'T4', other: 'Other' },
  room_account: { rrsp: 'RRSP', tfsa: 'TFSA', fhsa: 'FHSA', resp: 'RESP' },
  tax_flag: { taxable: 'Taxable', not_taxable: 'Not taxable', unsure: 'Not sure' },
  carry_kind: { net_capital_loss: 'Net capital loss', donation: 'Donations', tuition: 'Tuition', other: 'Other' },
  ledger_status: { pending: 'Pending', partly_paid: 'Partly paid', paid: 'Paid', clawed_back: 'Clawed back', forfeited: 'Forfeited' },
};
const FIELD = {
  label: 'ID', owner: 'Owner', issuer: 'Issuer', product: 'Card product', family: 'Card family (for same-product rules)', holder: 'Personal or business', last4: 'Last 4 digits only',
  locked: 'Card locked?', applied_on: 'Application date', approved_on: 'Approval date', date_confidence: 'Date confidence', credit_limit_cents: 'Credit limit ($)', annual_fee_cents: 'Annual fee ($)',
  fee_waived_first_year: 'First-year fee waived?', hard_check: 'Hard credit check?', referral_used: 'Referral used?', rewards_program: 'Rewards program', cpp_cash: 'Point value: cash (cents per point)',
  cpp_best: 'Point value: best use (cents per point)', statement_day: 'Statement closes (day of month)', due_day: 'Payment due (day of month)', downgraded_on: 'Downgrade / product-change date',
  downgraded_to: 'Downgraded to (card)', closed_on: 'Closed date', balance_settled_on: 'Final balance settled date', close_reason: 'Why closed', credit_balance_cents: 'Credit (negative) balance to spend ($)',
  spend_progress_cents: 'Minimum spend progress ($)', spend_as_of: 'Spend as of', signup_cashback_cents: 'Sign-up cashback received ($)', bonus_consumed: 'Bonus consumed?', consumed_on: 'Bonus consumed on',
  clawback_months: 'Clawback period (months from opening)', rule_name: 'Re-apply rule', institution: 'Institution', account_type: 'Account type', name: 'Name', opened_on: 'Opened date',
  monthly_fee_cents: 'Monthly fee ($)', min_balance_cents: 'Minimum balance to avoid fee ($)', currency: 'Currency', bonus_type: 'Bonus type', offer_text: 'What the offer said', amount: 'Points or cash offered',
  spend_required_cents: 'Spend required ($)', months_to_qualify: 'Months from approval/opening to qualify', received_on: 'Date received', offer_url: 'Offer link', offer_start: 'Offer starts', offer_end: 'Offer ends',
  terms_text: 'Saved offer terms', offered_cents: 'Bonus offered ($)', requirement: 'What you had to do', min_deposit_cents: 'Minimum deposit / transfer ($)', deposited_cents: 'Amount you actually deposited ($)',
  fee_reimbursed_cents: 'Transfer fee reimbursed ($)', months_keep_funds: 'Months funds must stay (clawback)', received_cents: 'Bonus received ($)', category: 'Category', amount_cents: 'Price ($)',
  frequency: 'Frequency', anchor_date: 'A date it was or will be charged', card_id: 'Paid by card', acct_id: 'Paid from account', other_method: 'Other payment method', auto_pay: 'Auto-pay?', end_date: 'End date',
  remind_days: 'Remind me (days before)', applies_to: 'Applies to (products or family, comma separated)', scope: 'Scope', once_per_lifetime: 'Bonus only once per lifetime?', wait_months: 'Wait before a new bonus (months)',
  counted_from: 'Months counted from', blocked_while_held: 'Blocked while you still hold a matching card?', min_days_between: 'Min days between applications', source: 'Source / how sure are you', last_checked: 'Rule last checked',
  verified: 'Confirmed against the issuer\'s official terms?',
  loan_type: 'Loan type', limit_cents: 'Credit limit ($)', cap_day: 'Interest is capitalized on (day of month)', opened_on: 'Opened', debt_id: 'Loan', holding_id: 'Holding it bought / paid into', event_date: 'Date',
  acb_cents: 'Adjusted cost base ($)', foreign_prop: 'Foreign property?', year: 'Tax year', person: 'Person', income_cents: 'Net income ($)', marginal_pct: 'Marginal tax rate (%)', medical_threshold_cents: 'Fixed medical threshold for the year ($)',
  tax_year: 'Tax year', spent_on: 'Date', payee: 'Paid to', reimbursed_cents: 'Reimbursed by insurance ($)', claimed: 'Already claimed?', security: 'Security', trade_date: 'Date', qty: 'Quantity', fx_rate: 'Exchange rate to CAD (blank for CAD)',
  registered: 'In a registered account (left out of cost base)?', account: 'Account', room_cents: 'Room for the year ($)', contributed_cents: 'Contributed so far ($)', from_year: 'Year it arose', used_cents: 'Used so far ($)', reinvested: 'Reinvested?', tax_flag: 'Tax treatment',
  window_start: 'Offer window starts', window_end: 'Offer window ends', source_url: 'Source link', seen_on: 'Date seen', qualifies: 'What qualifies', min_cents: 'Minimum to qualify ($)', cap_cents: 'Largest bonus ($)',
  rate_registered: 'Rate, registered accounts (%)', rate_nonreg: 'Rate, non-registered accounts (%)', fixed_cents: 'Fixed cash bonus ($)', points: 'Points offered', program: 'Rewards program (as named in Planner settings)', spend_cents: 'Spend required ($)',
  interest_pct: 'Interest rate on the balance (%)', enrol_by: 'Enrol by', fund_by: 'Fund by', hold_from: 'Hold period starts', hold_until: 'Hold period ends', payouts: 'Payout dates (one per line: date, then 40% or $500)',
  paid_cents: 'Total paid so far ($)', withdrawal_effect: 'What a withdrawal does', withdrawal_scope: 'Does that apply per account or across all accounts?', withdrawal_percent: 'Withdrawal allowed up to (% of qualifying amount)',
  exemptions: 'Exemptions', combinable: 'Can be combined with other offers?', tax_note: 'Tax note', value_cents: 'Current value ($)', invested: 'Invested in the market?', interest_rate: 'Interest rate (%)', offer_id: 'Offer it counts toward',
  counted_cents: 'Amount counted as transferred in ($)', smith: 'Bought with borrowed money (Smith Manoeuvre)?', balance_cents: 'Balance owing ($)', rate: 'Interest rate (%)', title: 'Title', expected_cents: 'Bonus expected ($)',
  capital_cents: 'Money locked in ($)', locked_from: 'Locked from', locked_to: 'Locked until', capital_earning: 'Was that money still earning meanwhile?', fees_cents: 'Fees ($)', interest_cents: 'Interest paid ($)',
  transfer_fee_cents: 'Transfer fees, net of reimbursement ($)', fx_cents: 'Foreign exchange cost ($)', network: 'Network', kind: 'Kind', notes: 'Notes', status: 'Status',
};
const prettify = (k) => FIELD[k] || (k.charAt(0).toUpperCase() + k.slice(1)).replaceAll('_', ' ');
let schemaCache = null;
async function schema() { return (schemaCache ||= await get('/api/offers/schema')); }
const enumLabel = (schemaObj, fd, v) => {
  const map = LABELS[fd.enum] || (fd.enum === 'frequency' ? schemaObj.frequencies : null);
  if (map && map[v]) return map[v];
  return String(v).charAt(0).toUpperCase() + String(v).slice(1).replaceAll('_', ' ');
};
const cents = (c) => (c == null ? '' : (c / 100).toFixed(2));
const dollarsFmt = (c) => (c == null ? '' : money(c));

// ---------- generic form widgets ----------
function widget(sc, fd, value, opts = {}) {
  const id = `${opts.prefix || 'f'}-${fd.key}`;
  let input; let read;
  const sel = (choices) => h('select', { id }, h('option', { value: '' }, '—'), choices.map(([v, l]) => h('option', { value: v, selected: String(value) === String(v) }, l)));
  if (fd.type === 'enum') { input = sel(sc.enums[fd.enum].map((v) => [v, enumLabel(sc, fd, v)])); read = () => input.value; }
  else if (fd.type === 'bool') { input = sel([['yes', 'Yes'], ['no', 'No']].map((x) => x)); input.value = value === 1 ? 'yes' : value === 0 ? 'no' : ''; read = () => (input.value === 'yes' ? true : input.value === 'no' ? false : null); }
  else if (fd.type === 'payouts') {
    let lines = ''; try { lines = JSON.parse(value || '[]').map((p) => `${p.date} ${p.pct != null ? `${p.pct}%` : `$${(p.cents / 100).toFixed(2)}`}`).join('\n'); } catch { lines = ''; }
    input = h('textarea', { id, rows: 4, placeholder: '2028-04-28 40%\n2029-03-30 60%' }, lines); read = () => input.value;
  }
  else if (fd.type === 'longtext') { input = h('textarea', { id, rows: 2 }, value ?? ''); read = () => input.value; }
  else if (fd.type === 'date') { input = h('input', { id, type: 'date', value: value ?? '' }); read = () => input.value; }
  else if (fd.type === 'money') { input = h('input', { id, inputmode: 'decimal', placeholder: '0.00', value: value == null ? '' : cents(value) }); read = () => input.value; }
  else if (fd.type === 'int' || fd.type === 'real') { input = h('input', { id, inputmode: 'decimal', value: value ?? '' }); read = () => input.value; }
  else { input = h('input', { id, value: value ?? '', maxlength: fd.max || 200 }); read = () => input.value; }
  if (opts.choices) { input = sel(opts.choices); input.value = value ?? ''; read = () => input.value; }
  const flagged = opts.unconfirmed?.includes(fd.key);
  const field = h('div', { class: 'field' + (flagged ? ' unconf' : '') },
    h('label', { for: id }, prettify(fd.key), fd.optional ? '' : ' *', flagged ? h('span', { class: 'small' }, ' (filled in for you: check it)') : null), input);
  return { field, read, key: fd.key, type: fd.type, optional: fd.optional };
}
const payload = (ws) => Object.fromEntries(ws.map((w) => [w.key, w.read()]));

async function editor(entity, kindTab, record, onDone) {
  const sc = await schema();
  const spec = sc.specs[entity];
  const isNew = !record;
  const rec = record || { status: entity === 'recurring' ? 'active' : entity === 'accounts' ? 'open' : entity === 'cards' ? 'open' : undefined, kind: kindTab === 'invest' ? 'invest' : 'bank', scope: 'same_card', counted_from: 'approval', frequency: 'monthly', currency: 'CAD' };
  const [cardsList, acctList, rulesList] = await Promise.all([
    entity === 'recurring' ? get('/api/offers/cards') : null, entity === 'recurring' ? get('/api/offers/accounts') : null, entity === 'cards' || entity === 'accounts' ? get('/api/offers/rules') : null]);
  const skip = new Set(entity === 'accounts' ? ['label', 'kind'] : ['label']);
  const offersList = ['holdings', 'ledger'].includes(entity) ? await get('/api/offers/offers') : null;
  const holdList = ['loan_events', 'income_events', 'trades'].includes(entity) ? await get('/api/offers/holdings') : null;
  const debtList = entity === 'loan_events' ? await get('/api/offers/debts') : null;
  const un = rec.unconfirmed || [];
  dialog(`${isNew ? 'Add' : 'Edit'} ${{ cards: 'credit card', recurring: 'recurring payment', rules: 'rule', offers: 'offer', holdings: 'holding', debts: 'debt', ledger: 'bonus record', loan_events: 'loan record', income_events: 'income record', tax_years: 'tax year', receipts: 'receipt', trades: 'trade', slips: 'slip', room: 'registered room', carry: 'carry-forward' }[entity] || (rec.kind === 'invest' ? 'investment account' : 'bank account')}`, (close) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const ws = spec.fields.filter((fd) => !skip.has(fd.key)).map((fd) => {
      const opts = { unconfirmed: un, prefix: 'e' };
      if (fd.key === 'status' && entity === 'cards') fd = { ...fd, enum: 'card_status' };
      if (fd.key === 'status' && entity === 'accounts') fd = { ...fd, type: 'enum', enum: 'acct_status' };
      if (fd.key === 'holding_id' && holdList) opts.choices = holdList.items.map((x) => [String(x.id), `${x.institution || ''} ${x.name}`.trim()]);
      if (fd.key === 'debt_id' && debtList) opts.choices = debtList.items.map((x) => [String(x.id), x.name]);
      if (fd.key === 'offer_id' && offersList) opts.choices = offersList.items.map((o) => [String(o.id), `${o.issuer} ${o.product}`]);
      if (fd.key === 'rule_name' && rulesList) opts.choices = rulesList.items.map((r) => [r.name, r.name]);
      if (fd.key === 'card_id' && cardsList) opts.choices = cardsList.items.map((c) => [String(c.id), `${c.label} ${c.issuer} ${c.product}`]);
      if (fd.key === 'acct_id' && acctList) opts.choices = acctList.items.map((a) => [String(a.id), `${a.label} ${a.institution} ${a.account_type}`]);
      return widget(sc, fd, rec[fd.key], opts);
    });
    // bonus rows
    const bonusSpec = spec.children?.bonuses;
    const bonusRows = [];
    const bonusBox = h('div', {});
    const addBonus = (b = {}) => {
      const bws = bonusSpec.fields.filter((fd) => fd.key !== 'slot').map((fd) => {
        if (fd.key === 'bonus_type' && entity === 'accounts') return widget(sc, fd, b[fd.key], { prefix: `b${bonusRows.length}`, unconfirmed: b.unconfirmed, choices: ['Sign-up', 'Savings / funding', 'Referral', 'Direct deposit', 'Retention', 'Transfer-in', 'Cash deposit', 'Trading credit', 'Cash back on assets', 'Other'].map((x) => [x, x]) });
        return widget(sc, fd, b[fd.key], { prefix: `b${bonusRows.length}`, unconfirmed: b.unconfirmed });
      });
      const wrap = h('fieldset', { class: 'bonus' }, h('legend', {}, entity === 'cards' ? `Bonus ${bonusRows.length + 1}` : 'Bonus'), h('div', { class: 'formgrid' }, bws.map((w) => w.field)),
        h('button', { type: 'button', class: 'btn small danger', onclick: () => { const i = bonusRows.findIndex((x) => x.wrap === wrap); bonusRows.splice(i, 1); wrap.remove(); } }, 'Remove this bonus'));
      bonusRows.push({ wrap, bws });
      bonusBox.append(wrap);
    };
    if (bonusSpec) (rec.bonuses || []).forEach(addBonus);
    const addBtn = bonusSpec ? h('button', { type: 'button', class: 'btn', onclick: () => { if (bonusRows.length >= bonusSpec.max) { err.textContent = `At most ${bonusSpec.max} bonuses`; return; } addBonus(); } }, 'Add a bonus') : null;
    const form = h('form', { class: 'wideform', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      try {
        const body = payload(ws);
        for (const w of ws) if (w.type === 'int' && (body[w.key] === '' || body[w.key] == null)) body[w.key] = null; else if ((w.key === 'card_id' || w.key === 'acct_id' || w.key === 'offer_id' || w.key === 'holding_id' || w.key === 'debt_id') && body[w.key]) body[w.key] = Number(body[w.key]);
        for (const w of ws) if (w.type === 'real' && body[w.key] !== '') body[w.key] = body[w.key] === null ? null : Number(body[w.key]);
        if (isNew && entity === 'accounts') body.kind = rec.kind;
        if (bonusSpec) body.bonuses = bonusRows.map((r) => payload(r.bws));
        if (isNew) await post(`/api/offers/${entity}`, body); else await patch(`/api/offers/${entity}/${rec.id}`, body);
        close(); onDone();
      } catch (x) { err.textContent = x.message; }
    } },
    un.length ? h('div', { class: 'notice warn' }, h('span', {}, 'Fields in red were filled in by Claude from public information. Check them, edit what is wrong, then confirm.'),
      h('button', { type: 'button', class: 'btn small', onclick: async () => { await post(`/api/offers/${entity}/${rec.id}/confirm`); close(); onDone(); } }, 'Mark all as checked')) : null,
    h('div', { class: 'formgrid' }, ws.map((w) => w.field)),
    bonusSpec ? h('div', {}, h('h3', {}, entity === 'cards' ? 'Bonuses (up to 4)' : 'Bonuses'), bonusBox, addBtn) : null,
    err,
    h('div', { class: 'dialog-actions' },
      !isNew ? h('button', { type: 'button', class: 'btn danger', onclick: async () => { if (confirm('Delete this record?')) { await del(`/api/offers/${entity}/${rec.id}`); close(); onDone(); } } }, 'Delete') : null,
      h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary' }, 'Save')));
    return form;
  }).classList.add('wide');
}

// ---------- list views ----------
const STATUS_PILL = { open: '', frozen: 'Frozen', closed: 'Closed', downgraded: 'Downgraded', pending: 'Pending', declined: 'Declined' };
function eligPill(e) {
  if (!e || e.code === 'no_rule') return h('span', { class: 'pill' }, 'No rule yet');
  const cls = e.code === 'eligible' ? 'pill ok' : e.code === 'wait' ? 'pill' : 'pill warn';
  return h('span', { class: cls, title: e.rule + (e.verified ? '' : ' (not yet checked against official terms)') }, e.text);
}
const row = (main, sub, right, onclick, flagged) => h('li', {}, h('button', { class: 'item', onclick },
  h('div', { class: 'grow' }, h('div', { class: 'title' }, main), h('div', { class: 'muted small' }, sub)), h('div', { class: 'right' }, right, flagged ? h('div', {}, h('span', { class: 'pill red' }, 'To check')) : null)));

async function cardsTab(sc, reload) {
  const { items } = await get('/api/offers/cards');
  const sum = await get('/api/offers/summary');
  const top = h('div', { class: 'card' }, h('div', { class: 'stat-row' },
    h('div', {}, h('span', {}, 'Open'), h('strong', {}, sum.cards.open)), h('div', {}, h('span', {}, 'Frozen'), h('strong', {}, sum.cards.frozen)), h('div', {}, h('span', {}, 'Closed'), h('strong', {}, sum.cards.closed))),
  sum.alerts.length ? h('ul', { class: 'list' }, sum.alerts.slice(0, 8).map((a) => h('li', {}, h('span', { class: 'grow' }, `${a.label}: ${a.text}`), h('span', { class: 'muted small' }, a.date ? fmtDate(a.date) : '')))) : null);
  const list = items.length ? h('ul', { class: 'list' }, items.map((c) => row(
    `${c.label} ${c.issuer} ${c.product}`,
    [LABELS.card_status[c.status], c.last4 ? `ending ${c.last4}` : null, c.locked ? 'locked' : null, c.next_payment_due ? `payment due ${c.next_payment_due}` : null, c.bonus_best_cents != null && c.bonus_cash_cents != null && c.points_earned ? `bonus ${dollarsFmt(c.bonus_cash_cents)} cash, ${dollarsFmt(c.bonus_best_cents)} best use` : null, c.alert].filter(Boolean).join(' · '),
    [eligPill(c.eligibility), c.eligibility?.nextApplication ? h('div', { class: 'muted small' }, `next application ${c.eligibility.nextApplication}`) : null],
    () => editor('cards', 'cards', c, reload), c.unconfirmed.length > 0))) : emptyState('No cards yet', 'Add a card, or import your workbook on the last tab.');
  return [top, h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Credit cards'), h('button', { class: 'btn primary', onclick: () => editor('cards', 'cards', null, reload) }, 'Add card')), list)];
}
async function acctTab(kind, sc, reload) {
  const { items } = await get('/api/offers/accounts');
  const mine = items.filter((a) => a.kind === kind);
  const list = mine.length ? h('ul', { class: 'list' }, mine.map((a) => row(
    `${a.label} ${a.institution} ${a.account_type}${a.name ? ` · ${a.name}` : ''}`,
    [LABELS.acct_status[a.status], a.opened_on ? `opened ${fmtDate(a.opened_on)}` : null, `${a.bonuses.length} bonus${a.bonuses.length === 1 ? '' : 'es'}`, a.bonus_received_cents ? `${money(a.bonus_received_cents)} received` : null, ...a.bonuses.filter((b) => b.clawback_status && b.keep_until >= (new Date().toISOString().slice(0, 10))).map((b) => b.clawback_status)].filter(Boolean).join(' · '),
    eligPill(a.eligibility), () => editor('accounts', kind, a, reload), a.unconfirmed.length > 0))) : emptyState('Nothing here yet', 'Add an account, or import your workbook on the last tab.');
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, kind === 'bank' ? 'Bank accounts and bonuses' : 'Investment accounts and transfer / deposit bonuses'),
    h('button', { class: 'btn primary', onclick: () => editor('accounts', kind, null, reload) }, 'Add account')), list);
}
async function recurringTab(sc, reload) {
  const { items } = await get('/api/offers/recurring');
  const sum = await get('/api/offers/summary');
  const list = items.length ? h('ul', { class: 'list' }, items.map((r) => row(
    r.name, [sc.frequencies[r.frequency], r.method, r.auto_pay ? 'auto-pay' : null, r.status !== 'active' ? r.status : null, r.category].filter(Boolean).join(' · '),
    [h('div', { class: 'num' }, money(r.amount_cents)), r.next_charge ? h('div', { class: 'muted small' }, `next ${fmtDate(r.next_charge)}${r.days_until === 0 ? ' (today)' : ''}`) : null],
    () => editor('recurring', 'recurring', r, reload), r.unconfirmed.length > 0))) : emptyState('No recurring payments', 'Add subscriptions, bills and insurance. Charges found in uploaded statements will be proposed here in a later release.');
  return [h('div', { class: 'card' }, h('div', { class: 'stat-row' }, h('div', {}, h('span', {}, 'Per month'), h('strong', {}, money(sum.recurring.monthly_cents))), h('div', {}, h('span', {}, 'Per year'), h('strong', {}, money(sum.recurring.yearly_cents, { whole: true }))))),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Recurring payments'), h('button', { class: 'btn primary', onclick: () => editor('recurring', 'recurring', null, reload) }, 'Add payment')), list)];
}
async function rulesTab(sc, reload) {
  const { items } = await get('/api/offers/rules');
  const list = items.length ? h('ul', { class: 'list' }, items.map((r) => row(r.name,
    [LABELS.scope[r.scope], r.once_per_lifetime ? 'once per lifetime' : r.wait_months != null ? `wait ${r.wait_months} months from ${LABELS.counted_from[r.counted_from].toLowerCase()}` : 'no wait period set', r.blocked_while_held ? 'blocked while held' : null, r.min_days_between != null ? `${r.min_days_between} days between applications` : null].filter(Boolean).join(' · '),
    r.verified ? h('span', { class: 'pill ok' }, 'Official terms') : h('span', { class: 'pill warn' }, 'Unverified'), () => editor('rules', 'rules', r, reload), r.unconfirmed.length > 0))) : emptyState('No rules yet', 'A rule says how long you must wait before the same card, or any card from the issuer, can pay a sign-up bonus again.');
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Re-apply rules'), h('button', { class: 'btn primary', onclick: () => editor('rules', 'rules', null, reload) }, 'Add rule')),
    h('p', { class: 'muted small' }, 'Rules marked Unverified come from forums or memory. Check the issuer\'s own terms for the offer you apply under, because terms change per offer.'), list);
}

const bytesToB64 = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
function importTab(reload) {
  const out = h('div', {}); const err = h('p', { class: 'form-error', role: 'alert' });
  const file = h('input', { type: 'file', id: 'wbf', accept: '.xlsx' });
  const mode = h('select', { id: 'wbm' }, h('option', { value: 'add_only' }, 'Add new records only (keep what I already edited here)'), h('option', { value: 'overwrite' }, 'Replace records that already exist with the workbook version'));
  let b64 = '';
  const stat = (k, v) => h('div', {}, h('span', {}, k), h('strong', {}, v));
  file.addEventListener('change', async () => {
    err.textContent = ''; out.replaceChildren(); const f = file.files[0]; if (!f) return;
    try {
      b64 = bytesToB64(await f.arrayBuffer());
      const p = await post('/api/workbook/preview', { file_base64: b64 });
      out.replaceChildren(h('div', { class: 'stat-row' }, stat('Cards', p.counts.cards), stat('Bank / invest accounts', p.counts.accounts), stat('Bonuses', p.counts.bonuses + p.counts.account_bonuses), stat('Recurring', p.counts.recurring), stat('Rules', p.counts.rules)),
        h('p', { class: 'muted' }, `Already here: ${p.existing.cards} cards, ${p.existing.accounts} accounts, ${p.existing.recurring} recurring, ${p.existing.rules} rules.`),
        p.warnings.length ? h('div', { class: 'notice warn' }, h('div', {}, h('strong', {}, `${p.warnings.length} things to look at`), h('ul', {}, p.warnings.slice(0, 15).map((w) => h('li', {}, w))))) : null,
        h('div', { class: 'field' }, h('label', { for: 'wbm' }, 'If a record already exists'), mode),
        h('button', { class: 'btn primary', onclick: async (e) => {
          e.target.disabled = true;
          try { const r = await post('/api/workbook/import', { file_base64: b64, mode: mode.value }); out.replaceChildren(h('div', { class: 'notice' }, `Imported. Added ${r.added.cards} cards, ${r.added.accounts} accounts, ${r.added.recurring} recurring, ${r.added.rules} rules. Replaced ${r.replaced.cards + r.replaced.accounts + r.replaced.recurring + r.replaced.rules}, skipped ${r.skipped.cards + r.skipped.accounts + r.skipped.recurring + r.skipped.rules}. Red text in the workbook is shown as "to check".`), h('button', { class: 'btn', onclick: reload }, 'See the cards')); } catch (x) { err.textContent = x.message; e.target.disabled = false; }
        } }, 'Import'));
    } catch (x) { err.textContent = x.message; }
  });
  return h('div', { class: 'card' }, h('h2', {}, 'Import your workbook'),
    h('p', { class: 'muted' }, 'Choose the filled-in card, bank and investment history workbook (.xlsx). It is read on your server and stored in your own database only. Cells with red text are kept as "to check" until you confirm them. Only the last 4 digits of any card or account are kept.'),
    h('div', { class: 'field' }, h('label', { for: 'wbf' }, 'Workbook'), file), err, out);
}


// ---------- calendar ----------
const KIND_CLASS = { recurring: 'k-rec', card_payment: 'k-pay', bonus_deadline: 'k-due', clawback_end: 'k-claw', eligible_again: 'k-elig', next_application: 'k-elig', bonus_received: 'k-got' };
const iso = (d) => d.toISOString().slice(0, 10);
async function calendarTab() {
  const q = params();
  const ym = /^\d{4}-\d{2}$/.test(q.get('m') || '') ? q.get('m') : today().slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first); start.setUTCDate(1 - first.getUTCDay());
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + 41);
  const { events, kinds } = await get(`/api/calendar?from=${iso(start)}&to=${iso(end)}`);
  const feed = await get('/api/calendar/feed');
  const by = new Map(); for (const e of events) (by.get(e.date) || by.set(e.date, []).get(e.date)).push(e);
  const sel = q.get('d') || (today().startsWith(ym) ? today() : `${ym}-01`);
  const shift = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); const id = iso(d); const evs = by.get(id) || [];
    cells.push(h('button', { class: 'daycell' + (id.slice(0, 7) !== ym ? ' other' : '') + (id === today() ? ' today' : '') + (id === sel ? ' picked' : ''), 'aria-label': `${id}, ${evs.length} events`, onclick: () => go(`/cards?tab=calendar&m=${ym}&d=${id}`) },
      h('span', { class: 'dnum' }, d.getUTCDate()), h('span', { class: 'dots' }, evs.slice(0, 4).map((e) => h('i', { class: KIND_CLASS[e.kind] || '' })))));
  }
  const chosen = by.get(sel) || [];
  const urlInput = h('input', { readonly: true, value: feed.url, 'aria-label': 'Calendar feed address', onfocus: (e) => e.target.select() });
  return [h('div', { class: 'card' },
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => go(`/cards?tab=calendar&m=${shift(-1)}`) }, 'Previous'), h('h2', { class: 'grow center' }, new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' })), h('button', { class: 'btn small', onclick: () => go(`/cards?tab=calendar&m=${today().slice(0, 7)}`) }, 'Today'), h('button', { class: 'btn small', onclick: () => go(`/cards?tab=calendar&m=${shift(1)}`) }, 'Next')),
    h('div', { class: 'calgrid' }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => h('div', { class: 'dow' }, d)), cells),
    h('div', { class: 'legend small muted' }, Object.entries(kinds).map(([k, l]) => h('span', {}, h('i', { class: KIND_CLASS[k] || '' }), ` ${l}`)))),
  h('div', { class: 'card' }, h('h2', {}, fmtDate(sel)), chosen.length ? h('ul', { class: 'list' }, chosen.map((e) => h('li', {}, h('div', { class: 'item static' }, h('i', { class: 'kdot ' + (KIND_CLASS[e.kind] || '') }), h('div', { class: 'grow' }, h('div', { class: 'title' }, e.title), e.detail ? h('div', { class: 'muted small' }, e.detail) : null))))) : emptyState('Nothing on this day', 'Dates come from your cards, bonuses, accounts and recurring payments.')),
  h('div', { class: 'card' }, h('h2', {}, 'Google Calendar'),
    h('p', { class: 'muted' }, 'In Google Calendar choose Other calendars > From URL and paste this address. It is a private address: anyone with it can see the event names (no amounts). Google refreshes subscribed calendars every few hours, so a new event can take a while to show up.'),
    h('div', { class: 'field' }, h('label', { for: 'feedurl' }, 'Calendar feed address'), urlInput),
    h('p', { class: 'muted small' }, 'Your Cloudflare Access rule must let Google reach the /cal/ path without signing in, or Google cannot read the feed.'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(urlInput.value); } catch { urlInput.select(); } } }, 'Copy address'),
      h('button', { class: 'btn danger', onclick: async () => { if (confirm('Make a new address? Google will stop updating from the old one.')) { const r = await post('/api/calendar/feed/rotate'); urlInput.value = r.url; } } }, 'Make a new address')))];
}

// ---------- reminders ----------
const b64ToBytes = (b64) => { const p = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + p).replaceAll('-', '+').replaceAll('_', '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
async function remindersTab(reload) {
  const [{ items, unread }, st] = await Promise.all([get('/api/notifications'), get('/api/notifications/settings')]);
  const msg = h('p', { class: 'form-error', role: 'alert' });
  const email = h('input', { id: 'nemail', type: 'email', value: st.email, placeholder: 'you@example.com' });
  const rows = st.prefs.map((p) => {
    const en = h('input', { type: 'checkbox', checked: p.enabled, 'aria-label': `${p.label} on` }), lead = h('input', { type: 'number', min: 0, max: 365, value: p.lead_days, 'aria-label': `${p.label} lead days`, class: 'narrow' });
    const em = h('input', { type: 'checkbox', checked: p.email, 'aria-label': `${p.label} e-mail` }), pu = h('input', { type: 'checkbox', checked: p.push, 'aria-label': `${p.label} push` });
    return { p, en, lead, em, pu, tr: h('tr', {}, h('td', {}, p.label), h('td', {}, en), h('td', {}, lead), h('td', {}, em), h('td', {}, pu)) };
  });
  const save = async () => {
    msg.textContent = '';
    try { await put('/api/notifications/settings', { email: email.value, prefs: rows.map((r) => ({ kind: r.p.kind, enabled: r.en.checked, lead_days: Number(r.lead.value), email: r.em.checked, push: r.pu.checked })) }); msg.textContent = 'Saved'; msg.className = 'muted'; } catch (e) { msg.className = 'form-error'; msg.textContent = e.message; }
  };
  const enablePush = async () => {
    msg.className = 'form-error'; msg.textContent = '';
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This browser cannot receive push notifications. On iPhone, add the app to the Home Screen first.');
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were not allowed on this device');
      const { key } = await get('/api/push/key'); const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      await post('/api/push/subscribe', sub.toJSON()); msg.className = 'muted'; msg.textContent = 'Push is on for this device';
    } catch (e) { msg.textContent = e.message; }
  };
  return [h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, `Inbox${unread ? ` (${unread} new)` : ''}`),
    h('button', { class: 'btn small', onclick: async () => { await post('/api/notifications/run'); reload(); } }, 'Check now'), unread ? h('button', { class: 'btn small', onclick: async () => { await post('/api/notifications/read-all'); reload(); } }, 'Mark all read') : null),
    items.length ? h('ul', { class: 'list' }, items.map((n) => h('li', {}, h('button', { class: 'item', onclick: async () => { await post(`/api/notifications/${n.id}/read`); reload(); } },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, n.title), h('div', { class: 'muted small' }, `${fmtDate(n.event_date)}${n.body ? ` · ${n.body}` : ''}`)), n.read_at ? null : h('span', { class: 'pill warn' }, 'New'))))) : emptyState('No reminders yet', 'They appear here when a date comes within its lead time.')),
  h('div', { class: 'card' }, h('h2', {}, 'What to remind me about'),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Event'), h('th', {}, 'On'), h('th', {}, 'Days before'), h('th', {}, 'E-mail'), h('th', {}, 'Push'))), h('tbody', {}, rows.map((r) => r.tr)))),
    h('div', { class: 'field' }, h('label', { for: 'nemail' }, 'Send e-mail reminders to'), email),
    st.smtp_configured ? null : h('p', { class: 'muted small' }, 'E-mail is not set up on the server yet (SMTP settings), so e-mail reminders are held back.'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, 'Save'), h('button', { class: 'btn', onclick: async () => { msg.className = 'form-error'; try { await save(); await post('/api/notifications/test-email'); msg.className = 'muted'; msg.textContent = 'Test e-mail sent'; } catch (e) { msg.textContent = e.message; } } }, 'Send a test e-mail'), h('button', { class: 'btn', onclick: enablePush }, `Turn on push on this device${st.push_subscriptions ? ` (${st.push_subscriptions} on)` : ''}`)), msg)];
}

// ---------- statements ----------
async function statementsTab(reload) {
  const { items } = await get('/api/offers/cards');
  const cardsOpen = items.filter((c) => ['open', 'frozen', 'pending'].includes(c.status));
  const out = h('div', {}); const err = h('p', { class: 'form-error', role: 'alert' });
  const pick = h('select', { id: 'stc' }, cardsOpen.map((c) => h('option', { value: c.id }, `${c.label} ${c.issuer} ${c.product}`)));
  const file = h('input', { type: 'file', id: 'stf', accept: '.csv,text/csv' });
  const sign = h('select', { id: 'sts' }, h('option', { value: 'auto' }, 'Work it out'), h('option', { value: 'positive' }, 'Charges are positive'), h('option', { value: 'negative' }, 'Charges are negative'));
  const order = h('select', { id: 'std' }, h('option', { value: 'YMD' }, 'Year-month-day'), h('option', { value: 'MDY' }, 'Month/day/year'), h('option', { value: 'DMY' }, 'Day/month/year'));
  let text = '';
  const analyse = async () => {
    err.textContent = ''; out.replaceChildren(); if (!text) return;
    try {
      const r = await post(`/api/offers/cards/${pick.value}/statement/analyze`, { csv: text, charges: sign.value, date_order: order.value });
      const add = h('input', { type: 'checkbox', id: 'stadd', checked: !r.already_counted.length }), award = r.bonus.length ? h('input', { type: 'checkbox', id: 'staw', checked: true }) : null;
      const recs = r.recurring.map((x) => ({ x, cb: h('input', { type: 'checkbox', checked: true, 'aria-label': `Add ${x.name}` }) }));
      const force = h('input', { type: 'checkbox', id: 'stforce' });
      out.replaceChildren(h('div', { class: 'stat-row' }, h('div', {}, h('span', {}, 'Eligible spend'), h('strong', {}, money(r.spend_cents))), h('div', {}, h('span', {}, 'Refunds netted'), h('strong', {}, money(r.refunds_cents))), h('div', {}, h('span', {}, 'Fees and interest left out'), h('strong', {}, money(r.excluded_cents)))),
        h('p', { class: 'muted' }, `${r.lines} lines from ${r.period ? `${r.period.from} to ${r.period.to}` : 'no dates'}, counted since approval. Progress on the card is ${money(r.current_progress_cents)}. This is an estimate: card terms decide what counts.`),
        r.warnings.length ? h('div', { class: 'notice warn' }, r.warnings.slice(0, 5).join(' · ')) : null,
        r.already_counted.length ? h('div', { class: 'notice warn' }, h('span', {}, `Part of this period was already counted (${r.already_counted.map((a) => `${a.period_from} to ${a.period_to}`).join(', ')}).`), h('label', {}, force, ' Count it anyway')) : null,
        h('label', { class: 'check' }, add, ` Add ${money(r.spend_cents)} to the spend progress`),
        r.bonus.length ? h('div', {}, h('h3', {}, 'Bonus lines found'), h('ul', {}, r.bonus.map((b) => h('li', {}, `${b.date}: ${b.description}${b.points ? ` (${b.points} points)` : ''}`))), h('label', { class: 'check' }, award, ' Mark the first in-progress bonus as earned on that date')) : null,
        recs.length ? h('div', {}, h('h3', {}, 'Charges that repeat'), recs.map(({ x, cb }) => h('label', { class: 'check' }, cb, ` ${x.name}: ${money(x.amount_cents)} monthly (${x.count} times)`))) : null,
        h('button', { class: 'btn primary', onclick: async (e) => {
          e.target.disabled = true; err.textContent = '';
          try {
            const res = await post(`/api/offers/cards/${pick.value}/statement/apply`, { spend_cents: r.spend_cents, period_from: r.period.from, period_to: r.period.to, lines: r.lines, add_spend: add.checked, force: force.checked,
              award_date: award?.checked ? r.bonus[0].date : null, recurring: recs.filter((z) => z.cb.checked).map((z) => z.x) });
            out.replaceChildren(h('div', { class: 'notice' }, `Saved. ${res.spend_added ? 'Spend progress updated. ' : ''}${res.awarded ? 'Bonus marked earned. ' : ''}${res.recurring_added ? `${res.recurring_added} recurring payment(s) added (check them). ` : ''}`), h('button', { class: 'btn', onclick: reload }, 'Done'));
          } catch (x) { err.textContent = x.message; e.target.disabled = false; }
        } }, 'Save these'));
    } catch (x) { err.textContent = x.message; }
  };
  file.addEventListener('change', async () => { text = file.files[0] ? await file.files[0].text() : ''; analyse(); });
  for (const el of [pick, sign, order]) el.addEventListener('change', analyse);
  return h('div', { class: 'card' }, h('h2', {}, 'Read a card statement'),
    h('p', { class: 'muted' }, 'Choose a card and its statement as a CSV from online banking. Nothing is kept except the covered dates and the amount added, so the same statement is not counted twice. You see the result before anything is saved.'),
    cardsOpen.length ? h('div', { class: 'formgrid' }, h('div', { class: 'field' }, h('label', { for: 'stc' }, 'Card'), pick), h('div', { class: 'field' }, h('label', { for: 'stf' }, 'Statement (CSV)'), file), h('div', { class: 'field' }, h('label', { for: 'sts' }, 'Which amounts are charges?'), sign), h('div', { class: 'field' }, h('label', { for: 'std' }, 'Date format'), order)) : emptyState('No open cards', 'Add a card first.'), err, out);
}

export { widget, payload, schema, row, LABELS, enumLabel, editor, prettify };
export async function viewOffers() {
  const tab = params().get('tab') || 'cards';
  const sc = await schema();
  const reload = () => render();
  const bar = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': k === tab ? 'true' : 'false', onclick: () => go(`/cards?tab=${k}`) }, l)));
  let body;
  if (tab === 'cards') body = await cardsTab(sc, reload);
  else if (tab === 'bank' || tab === 'invest') body = await acctTab(tab, sc, reload);
  else if (tab === 'recurring') body = await recurringTab(sc, reload);
  else if (tab === 'rules') body = await rulesTab(sc, reload);
  else if (tab === 'calendar') body = await calendarTab();
  else if (tab === 'reminders') body = await remindersTab(reload);
  else if (tab === 'statements') body = await statementsTab(reload);
  else if (tab === 'offers') body = await offersTab();
  else if (tab === 'holdings') body = await holdingsTab();
  else if (tab === 'compare') body = await compareTab();
  else if (tab === 'plans') body = await plansTab();
  else if (tab === 'ledger') body = await ledgerTab();
  else if (tab === 'psettings') body = await plannerSettingsTab();
  else body = importTab(reload);
  return shell('Cards and bonuses', [bar, body]);
}
