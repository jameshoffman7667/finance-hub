// Field specs for the offer-tracking records. One definition drives validation, SQL and the screens.
import { parseCents, parseDate } from './money.js';

const E = (...v) => v;
export const ENUMS = {
  card_status: E('open', 'frozen', 'closed', 'downgraded', 'pending', 'declined'),
  acct_status: E('open', 'closed_me', 'closed_inst', 'converted', 'transferred_out', 'dormant'),
  confidence: E('exact', 'month', 'estimate'),
  network: E('visa', 'mastercard', 'amex', 'other'),
  holder: E('personal', 'business'),
  close_reason: E('not_closed', 'bonus_complete', 'avoid_fee', 'issuer_closed', 'inactive', 'moved_better', 'other'),
  consumed: E('no', 'partly', 'yes'),
  outcome: E('in_progress', 'earned', 'missed', 'forfeited'),
  card_bonus_type: E('welcome', 'anniversary', 'second_year', 'category', 'referral', 'retention'),
  bank_bonus_type: E('signup', 'funding', 'referral', 'direct_deposit', 'retention', 'other'),
  inv_bonus_type: E('transfer_in', 'cash_deposit', 'referral', 'trading_credit', 'cash_back_assets', 'other'),
  scope: E('same_card', 'same_family', 'any_card', 'any_account'),
  counted_from: E('application', 'approval', 'bonus_received', 'closed', 'downgrade'),
  frequency: E('weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly'),
  rec_status: E('active', 'paused', 'cancelled'),
  acct_kind: E('bank', 'invest'),
};

// [key, type, extra]   types: text, longtext, date, money, int, real, bool, enum
const f = (key, type, extra = {}) => ({ key, type, ...extra });
export const SPECS = {
  cards: {
    table: 'cards', order: "CASE status WHEN 'open' THEN 0 WHEN 'frozen' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END, label",
    fields: [
      f('label', 'text', { max: 20 }), f('owner', 'text', { optional: true }), f('issuer', 'text'), f('product', 'text'), f('family', 'text', { optional: true }),
      f('network', 'enum', { enum: 'network', optional: true }), f('holder', 'enum', { enum: 'holder', optional: true }), f('last4', 'text', { optional: true, pattern: /^\d{4}$/, hint: 'Last 4 digits only' }),
      f('status', 'enum', { enum: 'card_status' }), f('locked', 'bool', { optional: true }),
      f('applied_on', 'date', { optional: true }), f('approved_on', 'date', { optional: true }), f('date_confidence', 'enum', { enum: 'confidence', optional: true }),
      f('credit_limit_cents', 'money', { optional: true }), f('annual_fee_cents', 'money', { optional: true }), f('fee_waived_first_year', 'bool', { optional: true }),
      f('hard_check', 'bool', { optional: true }), f('referral_used', 'bool', { optional: true }),
      f('rewards_program', 'text', { optional: true }), f('cpp_cash', 'real', { optional: true }), f('cpp_best', 'real', { optional: true }),
      f('statement_day', 'int', { optional: true, min: 1, max: 31 }), f('due_day', 'int', { optional: true, min: 1, max: 31 }),
      f('downgraded_on', 'date', { optional: true }), f('downgraded_to', 'text', { optional: true }),
      f('closed_on', 'date', { optional: true }), f('balance_settled_on', 'date', { optional: true }), f('close_reason', 'enum', { enum: 'close_reason', optional: true }),
      f('credit_balance_cents', 'money', { optional: true, allowNegative: true }),
      f('spend_progress_cents', 'money', { optional: true }), f('spend_as_of', 'date', { optional: true }), f('signup_cashback_cents', 'money', { optional: true }),
      f('bonus_consumed', 'enum', { enum: 'consumed', optional: true }), f('consumed_on', 'date', { optional: true }), f('clawback_months', 'int', { optional: true, min: 0, max: 60 }),
      f('rule_name', 'text', { optional: true }), f('notes', 'longtext', { optional: true }),
    ],
    children: {
      bonuses: {
        table: 'card_bonuses', fk: 'card_id', max: 4,
        fields: [
          f('slot', 'int', { min: 1, max: 4 }), f('bonus_type', 'enum', { enum: 'card_bonus_type', optional: true }), f('offer_text', 'longtext', { optional: true }),
          f('amount', 'int', { optional: true, min: 0 }), f('spend_required_cents', 'money', { optional: true }), f('months_to_qualify', 'int', { optional: true, min: 0, max: 60 }),
          f('outcome', 'enum', { enum: 'outcome', optional: true }), f('received_on', 'date', { optional: true }),
          f('offer_url', 'text', { optional: true, max: 500 }), f('offer_start', 'date', { optional: true }), f('offer_end', 'date', { optional: true }), f('terms_text', 'longtext', { optional: true }),
        ],
      },
    },
  },
  accounts: {
    table: 'inst_accounts', order: "kind, CASE status WHEN 'open' THEN 0 ELSE 1 END, label",
    fields: [
      f('label', 'text', { max: 20 }), f('kind', 'enum', { enum: 'acct_kind' }), f('owner', 'text', { optional: true }), f('institution', 'text'), f('account_type', 'text'),
      f('name', 'text', { optional: true }), f('last4', 'text', { optional: true, pattern: /^\d{4}$/, hint: 'Last 4 digits only' }),
      f('status', 'enum', { enum: 'acct_status' }), f('opened_on', 'date', { optional: true }), f('date_confidence', 'enum', { enum: 'confidence', optional: true }),
      f('closed_on', 'date', { optional: true }), f('close_reason', 'text', { optional: true }),
      f('monthly_fee_cents', 'money', { optional: true }), f('min_balance_cents', 'money', { optional: true }), f('currency', 'text', { optional: true, max: 3 }),
      f('rule_name', 'text', { optional: true }), f('notes', 'longtext', { optional: true }),
    ],
    children: {
      bonuses: {
        table: 'acct_bonuses', fk: 'acct_id', max: 50,
        fields: [
          f('bonus_type', 'text', { optional: true }), f('offer_text', 'longtext', { optional: true }), f('offered_cents', 'money', { optional: true }),
          f('requirement', 'longtext', { optional: true }), f('min_deposit_cents', 'money', { optional: true }), f('deposited_cents', 'money', { optional: true }),
          f('fee_reimbursed_cents', 'money', { optional: true }), f('months_to_qualify', 'int', { optional: true, min: 0, max: 60 }), f('months_keep_funds', 'int', { optional: true, min: 0, max: 60 }),
          f('outcome', 'enum', { enum: 'outcome', optional: true }), f('received_on', 'date', { optional: true }), f('received_cents', 'money', { optional: true }),
          f('referral_used', 'bool', { optional: true }), f('notes', 'longtext', { optional: true }),
          f('offer_url', 'text', { optional: true, max: 500 }), f('offer_start', 'date', { optional: true }), f('offer_end', 'date', { optional: true }), f('terms_text', 'longtext', { optional: true }),
        ],
      },
    },
  },
  recurring: {
    table: 'recurring', order: "CASE status WHEN 'active' THEN 0 ELSE 1 END, name",
    fields: [
      f('name', 'text'), f('category', 'text', { optional: true }), f('amount_cents', 'money'), f('currency', 'text', { optional: true, max: 3 }),
      f('frequency', 'enum', { enum: 'frequency' }), f('anchor_date', 'date'), f('card_id', 'int', { optional: true, ref: 'cards' }), f('acct_id', 'int', { optional: true, ref: 'inst_accounts' }),
      f('other_method', 'text', { optional: true }), f('auto_pay', 'bool', { optional: true }), f('status', 'enum', { enum: 'rec_status' }),
      f('end_date', 'date', { optional: true }), f('remind_days', 'int', { optional: true, min: 0, max: 60 }), f('notes', 'longtext', { optional: true }),
    ],
  },
  rules: {
    table: 'issuer_rules', order: 'issuer, name',
    fields: [
      f('name', 'text'), f('issuer', 'text'), f('applies_to', 'text', { optional: true, max: 300 }), f('scope', 'enum', { enum: 'scope' }),
      f('once_per_lifetime', 'bool', { optional: true }), f('wait_months', 'int', { optional: true, min: 0, max: 240 }), f('counted_from', 'enum', { enum: 'counted_from' }),
      f('blocked_while_held', 'bool', { optional: true }), f('min_days_between', 'int', { optional: true, min: 0, max: 3650 }),
      f('source', 'longtext', { optional: true }), f('last_checked', 'date', { optional: true }), f('verified', 'bool', { optional: true }),
    ],
  },
};

export class FieldError extends Error {}

// Coerce one value. Empty means "not set" (null) for optional fields.
export function coerce(field, v) {
  const empty = v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  if (empty) {
    if (field.optional) return null;
    throw new FieldError(`${field.key}: required`);
  }
  switch (field.type) {
    case 'text': case 'longtext': {
      if (typeof v !== 'string') throw new FieldError(`${field.key}: expected text`);
      const s = v.trim(); const max = field.max || (field.type === 'longtext' ? 4000 : 200);
      if (s.length > max) throw new FieldError(`${field.key}: at most ${max} characters`);
      if (field.pattern && !field.pattern.test(s)) throw new FieldError(`${field.key}: ${field.hint || 'invalid'}`);
      return s;
    }
    case 'date': { const d = parseDate(v); if (!d || typeof v !== 'string') throw new FieldError(`${field.key}: use YYYY-MM-DD`); return d; }
    case 'money': {
      const c = typeof v === 'number' ? Math.round(v) : parseCents(v);
      if (c === null || !Number.isSafeInteger(c)) throw new FieldError(`${field.key}: not an amount`);
      if (c < 0 && !field.allowNegative) throw new FieldError(`${field.key}: cannot be negative`);
      return c;
    }
    case 'int': {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isInteger(n) || n < (field.min ?? 0) || n > (field.max ?? 1e9)) throw new FieldError(`${field.key}: whole number ${field.min ?? 0}-${field.max ?? ''}`);
      return n;
    }
    case 'real': { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1000) throw new FieldError(`${field.key}: not a valid number`); return n; }
    case 'bool': return v === true || v === 1 || v === 'yes' || v === 'Yes' ? 1 : v === false || v === 0 || v === 'no' || v === 'No' ? 0 : (() => { throw new FieldError(`${field.key}: yes or no`); })();
    case 'enum': if (!ENUMS[field.enum].includes(v)) throw new FieldError(`${field.key}: not one of ${ENUMS[field.enum].join(', ')}`); return v;
    default: throw new FieldError(`${field.key}: unsupported`);
  }
}

// Returns the cleaned columns. With partial=true only supplied keys are returned.
export function clean(fields, body, partial) {
  const out = {};
  for (const fd of fields) {
    if (partial && !(fd.key in body)) continue;
    out[fd.key] = coerce(fd, body[fd.key]);
  }
  return out;
}

// Import-friendly version: an invalid optional value is dropped with a warning instead of rejecting the row.
export function cleanLenient(fields, obj, warn) {
  const out = {};
  for (const fd of fields) {
    try { out[fd.key] = coerce(fd, obj[fd.key]); } catch (e) {
      if (!(e instanceof FieldError) || !fd.optional) throw e;
      warn(`${e.message} (left blank)`); out[fd.key] = null;
    }
  }
  return out;
}
