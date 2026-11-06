// Reads the card / bank / investment history workbook (.xlsx) and loads it into the database.
// Cells with red text were filled in by Claude and are kept as "unconfirmed" until you accept them.
import ExcelJS from 'exceljs';
import { parseDate } from './money.js';
import { SPECS, clean, cleanLenient, FieldError } from './entities.js';

const RED = new Set(['FFFF0000', 'FFC00000', 'FFFF0001']);
const norm = (s) => String(s ?? '').trim().toLowerCase();

function plain(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return plain(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((x) => x.text).join('');
    if ('text' in v) return v.text;
    if ('error' in v) return null;
  }
  return v;
}
const text = (v) => { v = plain(v); if (v == null) return null; const s = (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim(); return s || null; };
const dateOf = (v) => { v = plain(v); if (v == null || v === '') return null; if (v instanceof Date) return v.toISOString().slice(0, 10); return parseDate(String(v)); };
const dollars = (v) => { v = plain(v); if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : null; };
const num = (v) => { v = plain(v); if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const yes = (v) => { const s = norm(text(v)); return s === 'yes' ? 1 : s === 'no' ? 0 : null; };

const MAPS = {
  card_status: { open: 'open', 'frozen (zero balance, locked)': 'frozen', frozen: 'frozen', closed: 'closed', 'downgraded / product-changed': 'downgraded', downgraded: 'downgraded', pending: 'pending', declined: 'declined' },
  acct_status: { open: 'open', 'closed by me': 'closed_me', 'closed by institution': 'closed_inst', 'converted to another product': 'converted', 'transferred out': 'transferred_out', dormant: 'dormant' },
  confidence: { 'exact date': 'exact', 'month only': 'month', estimate: 'estimate' },
  network: { visa: 'visa', mastercard: 'mastercard', amex: 'amex', other: 'other' },
  holder: { personal: 'personal', business: 'business' },
  close_reason: { 'not closed': 'not_closed', 'bonus complete': 'bonus_complete', 'avoided annual fee': 'avoid_fee', 'issuer closed it': 'issuer_closed', inactive: 'inactive', 'moved to better card': 'moved_better', other: 'other' },
  consumed: { no: 'no', partly: 'partly', yes: 'yes' },
  outcome: { 'in progress': 'in_progress', earned: 'earned', missed: 'missed', forfeited: 'forfeited' },
  card_bonus_type: { 'welcome / spend': 'welcome', anniversary: 'anniversary', 'second year': 'second_year', 'category / other': 'category', referral: 'referral', 'retention offer': 'retention' },
  scope: { 'same card': 'same_card', 'same card family': 'same_family', 'any card from the issuer': 'any_card', 'any account from the institution': 'any_account' },
  counted_from: { 'application date': 'application', 'approval date': 'approval', 'bonus received date': 'bonus_received', 'closed date': 'closed', 'downgrade date': 'downgrade' },
  frequency: { weekly: 'weekly', 'every 2 weeks': 'biweekly', monthly: 'monthly', 'every 2 months': 'bimonthly', quarterly: 'quarterly', 'every 6 months': 'semiannual', yearly: 'yearly' },
  rec_status: { active: 'active', paused: 'paused', cancelled: 'cancelled' },
};
const en = (map, v, warn) => { const s = norm(text(v)); if (!s) return null; if (MAPS[map][s]) return MAPS[map][s]; warn(`Unrecognised value "${text(v)}"`); return null; };

// Find the header row (first row whose first cell starts with a known heading) and map first-line heading -> column.
function headers(ws) {
  for (let r = 1; r <= 8; r++) {
    const row = ws.getRow(r); const first = norm(text(row.getCell(1).value));
    if (/^(id|account id|name|rule name)/.test(first)) {
      const cols = Array(row.cellCount + 1).fill(''), full = Array(row.cellCount + 1).fill('');
      row.eachCell({ includeEmpty: false }, (c, n) => { const t = String(text(c.value) ?? ''); cols[n] = norm(t.split('\n')[0]).replace(/\s*\*$/, ''); full[n] = norm(t.replace(/\s*\n\s*/g, ' ')); });
      return { row: r, cols, full };
    }
  }
  return null;
}
const find = (h, ...names) => { for (const n of names) { const i = h.cols.findIndex((c) => c === n); if (i > 0) return i; } return 0; };
const findAll = (h, name) => h.cols.map((c, i) => (c === name ? i : 0)).filter(Boolean);

function sheetRows(wb, name, warnings) {
  const ws = wb.getWorksheet(name);
  if (!ws) { warnings.push(`Sheet "${name}" not found: skipped`); return null; }
  const h = headers(ws);
  if (!h) { warnings.push(`Sheet "${name}": header row not found: skipped`); return null; }
  const rows = [];
  for (let r = h.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const first = text(row.getCell(1).value);
    if (!first) continue;
    if (/^example/i.test(first)) continue;
    rows.push({ r, cell: (i) => (i > 0 ? row.getCell(i) : { value: null, font: null }), red: (i) => { if (!(i > 0)) return false; const c = row.getCell(i); const argb = c.font?.color?.argb; return !!argb && RED.has(String(argb).toUpperCase()) && plain(c.value) != null; } });
  }
  return { ws, h, rows };
}

export async function previewWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const warnings = [];
  const out = { cards: [], accounts: [], recurring: [], rules: [], warnings };
  const lbl = (sheet, r) => `${sheet} row ${r}`;
  const guard = (where, fn) => { try { return fn(); } catch (e) { warnings.push(`${where}: ${e instanceof FieldError ? e.message : `could not read this row (${e.message})`}`); return null; } };

  // ---- Issuer rules
  const rules = sheetRows(wb, 'Issuer rules', warnings);
  if (rules) for (const { r, cell, red } of rules.rows) guard(lbl('Issuer rules', r), () => {
    const h = rules.h; const g = (...n) => cell(find(h, ...n)).value;
    const w = (m) => warnings.push(`${lbl('Issuer rules', r)}: ${m}`);
    const rowObj = {
      name: text(g('rule name')), issuer: text(g('issuer / institution')), applies_to: text(g('applies to (product or family)')) ,
      scope: en('scope', g('scope'), w) || 'same_card', once_per_lifetime: yes(g('bonus only once per lifetime?', 'bonus only once per lifetime')),
      wait_months: num(g('wait before a new bonus (months)')), counted_from: en('counted_from', g('months counted from'), w) || 'approval',
      blocked_while_held: yes(g('blocked while you still hold a matching card?')), min_days_between: num(g('min days between new applications to this issuer')),
      source: text(g('source / how sure are you?', 'source / how sure are you')), last_checked: dateOf(g('rule last checked')),
    };
    if (!rowObj.name || !rowObj.issuer) return;
    const reds = Object.entries({ name: find(h, 'rule name'), source: find(h, 'source / how sure are you?', 'source / how sure are you'), wait_months: find(h, 'wait before a new bonus (months)'), once_per_lifetime: find(h, 'bonus only once per lifetime?', 'bonus only once per lifetime') }).filter(([, i]) => i && red(i)).map(([k]) => k);
    out.rules.push({ row: cleanLenient(SPECS.rules.fields, rowObj, w), unconfirmed: reds, verified: reds.length ? 0 : 1 });
  });

  // ---- Cards
  const cs = sheetRows(wb, 'Cards', warnings);
  if (cs) {
    const h = cs.h;
    const slotCols = [];
    for (let k = 1; k <= 4; k++) {
      const pre = `bonus ${k}`;
      const idx = (suffix) => h.full.findIndex((c) => c.startsWith(pre + ' ') && c.includes(suffix));
      slotCols.push({ type: idx('type'), offer: idx('what the offer'), amount: idx('points or cash'), spend: idx('spend required'), months: idx('months from'), outcome: idx('outcome'), received: idx('date received') });
    }
    const mapCols = {
      owner: ['owner'], issuer: ['issuer'], product: ['card product'], family: ['card family'], network: ['network'], holder: ['personal or business'], last4: ['last 4 digits'],
      status: ['status'], locked: ['card locked?'], applied_on: ['application date'], approved_on: ['approval date'], date_confidence: ['date confidence'],
      credit_limit_cents: ['credit limit ($)'], annual_fee_cents: ['annual fee ($)'], fee_waived_first_year: ['first-year fee waived?'], hard_check: ['hard credit check?'], referral_used: ['referral used?'],
      rewards_program: ['rewards program'], cpp_cash: ['point value: cash'], cpp_best: ['point value: best use'], statement_day: ['statement closes'], due_day: ['payment due'],
      downgraded_on: ['downgrade / product-change date'], downgraded_to: ['downgraded to (card)'], closed_on: ['closed date'], balance_settled_on: ['final balance settled date'], close_reason: ['why closed'],
      credit_balance_cents: ['credit (negative) balance to spend'], spend_progress_cents: ['minimum spend progress ($)'], spend_as_of: ['spend as of (date)'], signup_cashback_cents: ['sign-up cashback received ($)'],
      bonus_consumed: ['bonus consumed?'], consumed_on: ['bonus consumed on'], clawback_months: ['bonus clawback period'], notes: ['notes'], rule_name: ['issuer rule'],
    };
    const colOf = {};
    for (const [k, names] of Object.entries(mapCols)) colOf[k] = h.cols.findIndex((c) => names.some((n) => c === n || c.startsWith(n)));
    for (const { r, cell, red } of cs.rows) guard(lbl('Cards', r), () => {
      const w = (m) => warnings.push(`${lbl('Cards', r)}: ${m}`);
      const v = (k) => cell(colOf[k]).value;
      const rowObj = {
        label: text(cell(1).value), owner: text(v('owner')), issuer: text(v('issuer')), product: text(v('product')), family: text(v('family')),
        network: en('network', v('network'), w), holder: en('holder', v('holder'), w), last4: text(v('last4')),
        status: en('card_status', v('status'), w), locked: yes(v('locked')), applied_on: dateOf(v('applied_on')), approved_on: dateOf(v('approved_on')), date_confidence: en('confidence', v('date_confidence'), w),
        credit_limit_cents: dollars(v('credit_limit_cents')), annual_fee_cents: dollars(v('annual_fee_cents')), fee_waived_first_year: yes(v('fee_waived_first_year')), hard_check: yes(v('hard_check')), referral_used: yes(v('referral_used')),
        rewards_program: text(v('rewards_program')), cpp_cash: num(v('cpp_cash')), cpp_best: num(v('cpp_best')), statement_day: num(v('statement_day')), due_day: num(v('due_day')),
        downgraded_on: dateOf(v('downgraded_on')), downgraded_to: text(v('downgraded_to')), closed_on: dateOf(v('closed_on')), balance_settled_on: dateOf(v('balance_settled_on')), close_reason: en('close_reason', v('close_reason'), w),
        credit_balance_cents: dollars(v('credit_balance_cents')), spend_progress_cents: dollars(v('spend_progress_cents')), spend_as_of: dateOf(v('spend_as_of')), signup_cashback_cents: dollars(v('signup_cashback_cents')),
        bonus_consumed: en('consumed', v('bonus_consumed'), w), consumed_on: dateOf(v('consumed_on')), clawback_months: num(v('clawback_months')), notes: text(v('notes')), rule_name: text(v('rule_name')),
      };
      if (!rowObj.issuer && !rowObj.product) return;
      const unconfirmed = Object.keys(colOf).filter((k) => colOf[k] > 0 && red(colOf[k]));
      const bonuses = [];
      slotCols.forEach((sc, i) => {
        const g = (k) => (sc[k] > 0 ? cell(sc[k]).value : null);
        const b = { bonus_type: en('card_bonus_type', g('type'), w), offer_text: text(g('offer')), amount: num(g('amount')), spend_required_cents: dollars(g('spend')), months_to_qualify: num(g('months')), outcome: en('outcome', g('outcome'), w), received_on: dateOf(g('received')) };
        if (Object.values(b).every((x) => x == null)) return;
        const bu = Object.keys(sc).filter((k) => sc[k] > 0 && red(sc[k])).map((k) => ({ type: 'bonus_type', offer: 'offer_text', amount: 'amount', spend: 'spend_required_cents', months: 'months_to_qualify', outcome: 'outcome', received: 'received_on' }[k]));
        bonuses.push({ ...b, slot: i + 1, unconfirmed: bu });
      });
      out.cards.push({ row: cleanLenient(SPECS.cards.fields, rowObj, w), bonuses, unconfirmed });
    });
  }

  // ---- Bank and investment accounts (+ their bonuses)
  const accountSheet = (name, kind, bonusSheet) => {
    const sh = sheetRows(wb, name, warnings); if (!sh) return;
    const h = sh.h;
    const c = { owner: find(h, 'owner'), institution: find(h, 'bank / institution', 'brokerage / institution'), account_type: find(h, 'account type'), name: find(h, 'account name'), last4: find(h, 'last 4 digits'), status: find(h, 'status'),
      opened_on: find(h, 'opened date'), date_confidence: find(h, 'date confidence'), closed_on: find(h, 'closed date', 'closed / transferred-out date'), close_reason: find(h, 'why closed'),
      monthly_fee_cents: find(h, 'monthly fee ($)'), min_balance_cents: find(h, 'minimum balance to avoid fee ($)', 'minimum balance to avoid the fee ($)'), currency: find(h, 'currency'), notes: find(h, 'notes') };
    const byLabel = new Map();
    for (const { r, cell, red } of sh.rows) guard(lbl(name, r), () => {
      const w = (m) => warnings.push(`${lbl(name, r)}: ${m}`);
      const v = (k) => (c[k] ? cell(c[k]).value : null);
      const rowObj = {
        label: text(cell(1).value), kind, owner: text(v('owner')), institution: text(v('institution')), account_type: text(v('account_type')), name: text(v('name')), last4: text(v('last4')),
        status: en('acct_status', v('status'), w) || 'open', opened_on: dateOf(v('opened_on')), date_confidence: en('confidence', v('date_confidence'), w), closed_on: dateOf(v('closed_on')), close_reason: text(v('close_reason')),
        monthly_fee_cents: dollars(v('monthly_fee_cents')), min_balance_cents: dollars(v('min_balance_cents')), currency: text(v('currency')), notes: text(v('notes')),
      };
      if (!rowObj.institution) return;
      if (!rowObj.account_type) rowObj.account_type = kind === 'bank' ? 'Account' : 'Investment account';
      const item = { row: cleanLenient(SPECS.accounts.fields, rowObj, w), bonuses: [], unconfirmed: Object.keys(c).filter((k) => c[k] && red(c[k])) };
      byLabel.set(rowObj.label, item); out.accounts.push(item);
    });
    const bs = sheetRows(wb, bonusSheet, warnings);
    if (bs) {
      const bh = bs.h;
      const bc = { type: find(bh, 'bonus type'), offer: find(bh, 'what the offer said'), offered: find(bh, 'bonus offered ($)'), req: find(bh, 'what you had to do'), mindep: find(bh, 'minimum deposit / transfer required ($)', 'minimum deposit / transfer required'),
        dep: find(bh, 'amount you actually deposited / transferred ($)'), fee: find(bh, 'transfer fee reimbursed ($)'), months: find(bh, 'months from opening to qualify'), keep: find(bh, 'months funds must stay'),
        outcome: find(bh, 'outcome'), recv: find(bh, 'date received'), amt: find(bh, 'bonus received ($)'), ref: find(bh, 'referral used?'), rule: find(bh, 'issuer rule'), notes: find(bh, 'notes') };
      for (const { r, cell, red } of bs.rows) guard(lbl(bonusSheet, r), () => {
        const w = (m) => warnings.push(`${lbl(bonusSheet, r)}: ${m}`);
        const parent = byLabel.get(text(cell(1).value));
        if (!parent) { warnings.push(`${lbl(bonusSheet, r)}: account "${text(cell(1).value)}" is not on the accounts sheet: skipped`); return; }
        const v = (k) => (bc[k] ? cell(bc[k]).value : null);
        const outcome = en('outcome', v('outcome'), w);
        const b = { bonus_type: text(v('type')), offer_text: text(v('offer')), offered_cents: dollars(v('offered')), requirement: text(v('req')), min_deposit_cents: dollars(v('mindep')), deposited_cents: dollars(v('dep')), fee_reimbursed_cents: dollars(v('fee')),
          months_to_qualify: num(v('months')), months_keep_funds: num(v('keep')), outcome, received_on: dateOf(v('recv')), received_cents: dollars(v('amt')), referral_used: yes(v('ref')), notes: text(v('notes')) };
        const keyOf = { type: 'bonus_type', offer: 'offer_text', offered: 'offered_cents', req: 'requirement', mindep: 'min_deposit_cents', dep: 'deposited_cents', fee: 'fee_reimbursed_cents', months: 'months_to_qualify', keep: 'months_keep_funds', outcome: 'outcome', recv: 'received_on', amt: 'received_cents', ref: 'referral_used', notes: 'notes' };
        if (!parent.row.rule_name && text(v('rule'))) parent.row.rule_name = text(v('rule'));
        parent.bonuses.push({ ...cleanLenient(SPECS.accounts.children.bonuses.fields, b, w), unconfirmed: Object.keys(bc).filter((k) => k !== 'rule' && bc[k] && red(bc[k])).map((k) => keyOf[k]) });
      });
    }
  };
  accountSheet('Bank accounts', 'bank', 'Bank account bonuses');
  accountSheet('Investment accounts', 'invest', 'Investment bonuses');

  // ---- Recurring payments
  const rs = sheetRows(wb, 'Recurring payments', warnings);
  if (rs) {
    const h = rs.h;
    const c = { category: find(h, 'category'), amount: find(h, 'price'), currency: find(h, 'currency'), frequency: find(h, 'frequency'), anchor: find(h, 'date'), card: find(h, 'paid by card'), bank: find(h, 'paid from bank account'), other: find(h, 'other payment method'), auto: find(h, 'auto-pay?'), status: find(h, 'status'), end: find(h, 'end date'), remind: find(h, 'remind me (days before)'), notes: find(h, 'notes') };
    for (const { r, cell, red } of rs.rows) guard(lbl('Recurring payments', r), () => {
      const w = (m) => warnings.push(`${lbl('Recurring payments', r)}: ${m}`);
      const v = (k) => (c[k] ? cell(c[k]).value : null);
      const rowObj = { name: text(cell(1).value), category: text(v('category')), amount_cents: dollars(v('amount')), currency: text(v('currency')), frequency: en('frequency', v('frequency'), w), anchor_date: dateOf(v('anchor')),
        auto_pay: yes(v('auto')), status: en('rec_status', v('status'), w) || 'active', end_date: dateOf(v('end')), remind_days: num(v('remind')), notes: text(v('notes')), other_method: text(v('other')) };
      const unconfirmed = Object.keys(c).filter((k) => c[k] && red(c[k]));
      out.recurring.push({ row: cleanLenient(SPECS.recurring.fields, rowObj, w), cardLabel: text(v('card')), acctLabel: text(v('bank')), unconfirmed });
    });
  }

  out.counts = { cards: out.cards.length, bonuses: out.cards.reduce((s, x) => s + x.bonuses.length, 0), accounts: out.accounts.length, account_bonuses: out.accounts.reduce((s, x) => s + x.bonuses.length, 0), recurring: out.recurring.length, rules: out.rules.length };
  out.existingCounts = (db) => ({
    cards: out.cards.filter((x) => db.prepare('SELECT 1 FROM cards WHERE label = ?').get(x.row.label)).length,
    accounts: out.accounts.filter((x) => db.prepare('SELECT 1 FROM inst_accounts WHERE label = ?').get(x.row.label)).length,
    recurring: out.recurring.filter((x) => db.prepare('SELECT 1 FROM recurring WHERE lower(name) = lower(?)').get(x.row.name)).length,
    rules: out.rules.filter((x) => db.prepare('SELECT 1 FROM issuer_rules WHERE name = ?').get(x.row.name)).length,
  });
  return out;
}

const insert = (db, table, obj) => {
  const keys = Object.keys(obj);
  return db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => obj[k])).lastInsertRowid;
};
const update = (db, table, id, obj) => {
  const keys = Object.keys(obj);
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => obj[k]), id);
};

// mode add_only: records whose ID/name already exists are left alone (in-app edits are safe).
// mode overwrite: they are replaced by the workbook's version.
export function applyWorkbook(db, p, mode, now) {
  const added = { cards: 0, accounts: 0, recurring: 0, rules: 0 }, replaced = { cards: 0, accounts: 0, recurring: 0, rules: 0 }, skipped = { cards: 0, accounts: 0, recurring: 0, rules: 0 };
  db.transaction(() => {
    for (const x of p.rules) {
      const cur = db.prepare('SELECT id FROM issuer_rules WHERE name = ?').get(x.row.name);
      const row = { ...x.row, verified: x.verified, unconfirmed: JSON.stringify(x.unconfirmed) };
      if (!cur) { insert(db, 'issuer_rules', row); added.rules++; } else if (mode === 'overwrite') { update(db, 'issuer_rules', cur.id, row); replaced.rules++; } else skipped.rules++;
    }
    for (const x of p.cards) {
      const cur = db.prepare('SELECT id FROM cards WHERE label = ?').get(x.row.label);
      if (cur && mode !== 'overwrite') { skipped.cards++; continue; }
      const row = { ...x.row, unconfirmed: JSON.stringify(x.unconfirmed) };
      let id;
      if (cur) { id = cur.id; update(db, 'cards', id, row); db.prepare('DELETE FROM card_bonuses WHERE card_id = ?').run(id); replaced.cards++; } else { id = insert(db, 'cards', { ...row, created_at: now }); added.cards++; }
      for (const b of x.bonuses) { const { unconfirmed, ...rest } = b; insert(db, 'card_bonuses', { ...rest, card_id: id, unconfirmed: JSON.stringify(unconfirmed) }); }
    }
    for (const x of p.accounts) {
      const cur = db.prepare('SELECT id FROM inst_accounts WHERE label = ?').get(x.row.label);
      if (cur && mode !== 'overwrite') { skipped.accounts++; continue; }
      const row = { ...x.row, unconfirmed: JSON.stringify(x.unconfirmed) };
      let id;
      if (cur) { id = cur.id; update(db, 'inst_accounts', id, row); db.prepare('DELETE FROM acct_bonuses WHERE acct_id = ?').run(id); replaced.accounts++; } else { id = insert(db, 'inst_accounts', { ...row, created_at: now }); added.accounts++; }
      for (const b of x.bonuses) { const { unconfirmed, ...rest } = b; insert(db, 'acct_bonuses', { ...rest, acct_id: id, unconfirmed: JSON.stringify(unconfirmed) }); }
    }
    for (const x of p.recurring) {
      const cur = db.prepare('SELECT id FROM recurring WHERE lower(name) = lower(?)').get(x.row.name);
      if (cur && mode !== 'overwrite') { skipped.recurring++; continue; }
      const card = x.cardLabel ? db.prepare('SELECT id FROM cards WHERE label = ? OR lower(product) = lower(?)').get(x.cardLabel.split(' ')[0], x.cardLabel) : null;
      const acct = x.acctLabel ? db.prepare('SELECT id FROM inst_accounts WHERE label = ?').get(x.acctLabel.split(' ')[0]) : null;
      const row = { ...x.row, card_id: card?.id ?? null, acct_id: acct?.id ?? null, unconfirmed: JSON.stringify(x.unconfirmed) };
      if (!card && x.cardLabel && !row.other_method) row.other_method = x.cardLabel;
      if (!acct && x.acctLabel && !row.other_method) row.other_method = x.acctLabel;
      if (cur) { update(db, 'recurring', cur.id, row); replaced.recurring++; } else { insert(db, 'recurring', row); added.recurring++; }
    }
  })();
  return { added, replaced, skipped, warnings: p.warnings.slice(0, 100) };
}
