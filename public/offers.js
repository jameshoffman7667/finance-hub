// Cards, bank and investment accounts, bonuses, recurring payments and re-application rules.
// Loaded by app.js. Everything is built with h(), so text from the database is never parsed as markup.
import { h, get, post, patch, del, money, fmtDate, shell, go, params, dialog, emptyState, today, render } from './app.js';

const TABS = [['cards', 'Credit cards'], ['bank', 'Bank accounts'], ['invest', 'Investment accounts'], ['recurring', 'Recurring payments'], ['rules', 'Re-apply rules'], ['import', 'Import workbook']];
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
  verified: 'Confirmed against the issuer\'s official terms?', network: 'Network', kind: 'Kind', notes: 'Notes', status: 'Status',
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
  const skip = new Set(['label', 'kind']);
  const un = rec.unconfirmed || [];
  dialog(`${isNew ? 'Add' : 'Edit'} ${entity === 'cards' ? 'credit card' : entity === 'accounts' ? (rec.kind === 'invest' ? 'investment account' : 'bank account') : entity === 'recurring' ? 'recurring payment' : 'rule'}`, (close) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const ws = spec.fields.filter((fd) => !skip.has(fd.key)).map((fd) => {
      const opts = { unconfirmed: un, prefix: 'e' };
      if (fd.key === 'status' && entity === 'cards') fd = { ...fd, enum: 'card_status' };
      if (fd.key === 'status' && entity === 'accounts') fd = { ...fd, type: 'enum', enum: 'acct_status' };
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
        for (const w of ws) if (w.type === 'int' && (body[w.key] === '' || body[w.key] == null)) body[w.key] = null; else if ((w.key === 'card_id' || w.key === 'acct_id') && body[w.key]) body[w.key] = Number(body[w.key]);
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
  else body = importTab(reload);
  return shell('Cards and bonuses', [bar, body]);
}
