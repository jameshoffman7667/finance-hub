import Database from 'better-sqlite3';
import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';

// Forward-only migrations. Each runs in a transaction; data-changing ones get a pre-migrate copy.
const MIGRATIONS = [
  {
    version: 1,
    destructive: false,
    sql: `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  totp_secret_enc TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_last_step INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  pending INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  stepup_until TEXT
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,            -- chequing, savings, investment, registered, credit_card, loan, mortgage, property, other
  kind TEXT NOT NULL CHECK (kind IN ('asset','liability')),
  owner TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'CAD',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE valuations (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  as_of TEXT NOT NULL,           -- YYYY-MM-DD
  value_cents INTEGER NOT NULL,  -- balance as a positive number; liabilities are subtracted in reports
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (account_id, as_of)
);
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('expense','income','transfer')),
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE rules (
  id INTEGER PRIMARY KEY,
  pattern TEXT NOT NULL,         -- case-insensitive substring of the description
  category_id INTEGER NOT NULL REFERENCES categories(id),
  priority INTEGER NOT NULL DEFAULT 100
);
CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  filename TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  skipped_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  batch_id INTEGER REFERENCES import_batches(id) ON DELETE CASCADE,
  posted_on TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, -- negative = money out
  category_id INTEGER REFERENCES categories(id),
  category_source TEXT NOT NULL DEFAULT 'none', -- none, rule, manual
  hash TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  UNIQUE (account_id, hash, seq)
);
CREATE INDEX idx_tx_date ON transactions(posted_on);
CREATE INDEX idx_tx_cat ON transactions(category_id);
INSERT INTO categories (name, kind) VALUES
 ('Groceries','expense'),('Dining','expense'),('Transport','expense'),('Housing','expense'),
 ('Utilities','expense'),('Subscriptions','expense'),('Health','expense'),('Shopping','expense'),
 ('Entertainment','expense'),('Travel','expense'),('Fees and interest','expense'),('Other','expense'),
 ('Salary','income'),('Other income','income'),('Transfer','transfer');
`,
  },
  {
    version: 2,
    destructive: false,
    sql: `
CREATE TABLE cards (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  owner TEXT, issuer TEXT NOT NULL, product TEXT NOT NULL, family TEXT, network TEXT, holder TEXT,
  last4 TEXT CHECK (last4 IS NULL OR (length(last4) = 4 AND last4 NOT GLOB '*[^0-9]*')),
  status TEXT NOT NULL CHECK (status IN ('open','frozen','closed','downgraded','pending','declined')),
  locked INTEGER, applied_on TEXT, approved_on TEXT, date_confidence TEXT,
  credit_limit_cents INTEGER, annual_fee_cents INTEGER, fee_waived_first_year INTEGER, hard_check INTEGER, referral_used INTEGER,
  rewards_program TEXT, cpp_cash REAL, cpp_best REAL, statement_day INTEGER, due_day INTEGER,
  downgraded_on TEXT, downgraded_to TEXT, closed_on TEXT, balance_settled_on TEXT, close_reason TEXT,
  credit_balance_cents INTEGER, spend_progress_cents INTEGER, spend_as_of TEXT, signup_cashback_cents INTEGER,
  bonus_consumed TEXT, consumed_on TEXT, clawback_months INTEGER, notes TEXT, rule_name TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE card_bonuses (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
  bonus_type TEXT, offer_text TEXT, amount INTEGER, spend_required_cents INTEGER, months_to_qualify INTEGER,
  outcome TEXT, received_on TEXT, offer_url TEXT, offer_start TEXT, offer_end TEXT, terms_text TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]',
  UNIQUE (card_id, slot)
);
CREATE TABLE inst_accounts (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('bank','invest')),
  owner TEXT, institution TEXT NOT NULL, account_type TEXT NOT NULL, name TEXT,
  last4 TEXT CHECK (last4 IS NULL OR (length(last4) = 4 AND last4 NOT GLOB '*[^0-9]*')),
  status TEXT NOT NULL, opened_on TEXT, date_confidence TEXT, closed_on TEXT, close_reason TEXT,
  monthly_fee_cents INTEGER, min_balance_cents INTEGER, currency TEXT, notes TEXT, rule_name TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE acct_bonuses (
  id INTEGER PRIMARY KEY,
  acct_id INTEGER NOT NULL REFERENCES inst_accounts(id) ON DELETE CASCADE,
  bonus_type TEXT, offer_text TEXT, offered_cents INTEGER, requirement TEXT, min_deposit_cents INTEGER, deposited_cents INTEGER,
  fee_reimbursed_cents INTEGER, months_to_qualify INTEGER, months_keep_funds INTEGER,
  outcome TEXT, received_on TEXT, received_cents INTEGER, referral_used INTEGER, notes TEXT,
  offer_url TEXT, offer_start TEXT, offer_end TEXT, terms_text TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE recurring (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, category TEXT, amount_cents INTEGER NOT NULL, currency TEXT,
  frequency TEXT NOT NULL, anchor_date TEXT NOT NULL,
  card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL, acct_id INTEGER REFERENCES inst_accounts(id) ON DELETE SET NULL,
  other_method TEXT, auto_pay INTEGER, status TEXT NOT NULL, end_date TEXT, remind_days INTEGER, notes TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE issuer_rules (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE, issuer TEXT NOT NULL, applies_to TEXT, scope TEXT NOT NULL,
  once_per_lifetime INTEGER, wait_months INTEGER, counted_from TEXT NOT NULL, blocked_while_held INTEGER, min_days_between INTEGER,
  source TEXT, last_checked TEXT, verified INTEGER NOT NULL DEFAULT 0,
  unconfirmed TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_card_bonus_card ON card_bonuses(card_id);
CREATE INDEX idx_acct_bonus_acct ON acct_bonuses(acct_id);
`,
  },
  {
    version: 3,
    destructive: false,
    sql: `
CREATE TABLE notify_prefs (
  kind TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, lead_days INTEGER NOT NULL, email INTEGER NOT NULL DEFAULT 0, push INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, event_date TEXT NOT NULL,
  created_at TEXT NOT NULL, read_at TEXT, emailed INTEGER NOT NULL DEFAULT 0, pushed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE push_subs (
  id INTEGER PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE statement_runs (
  id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  period_from TEXT NOT NULL, period_to TEXT NOT NULL, spend_cents INTEGER NOT NULL, lines INTEGER NOT NULL, applied_at TEXT NOT NULL
);
`,
  },
  {
    version: 4,
    destructive: false,
    sql: `
CREATE TABLE offer_terms (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL, issuer TEXT NOT NULL, product TEXT NOT NULL, status TEXT NOT NULL,
  window_start TEXT, window_end TEXT, source_url TEXT, seen_on TEXT, terms_text TEXT, qualifies TEXT,
  min_cents INTEGER, cap_cents INTEGER, rate_registered REAL, rate_nonreg REAL, fixed_cents INTEGER, points INTEGER, program TEXT, annual_fee_cents INTEGER, interest_pct REAL, spend_cents INTEGER,
  enrol_by TEXT, fund_by TEXT, hold_from TEXT, hold_until TEXT, payouts TEXT, paid_cents INTEGER,
  withdrawal_effect TEXT, withdrawal_scope TEXT, withdrawal_percent REAL, exemptions TEXT, combinable TEXT, fee_reimbursed_cents INTEGER, tax_note TEXT,
  verified INTEGER, unconfirmed TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE holdings (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, institution TEXT, account_type TEXT NOT NULL, value_cents INTEGER NOT NULL, invested INTEGER, interest_rate REAL,
  offer_id INTEGER REFERENCES offer_terms(id) ON DELETE SET NULL, counted_cents INTEGER, smith INTEGER, notes TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE debts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, kind TEXT, balance_cents INTEGER NOT NULL, rate REAL NOT NULL, smith INTEGER, notes TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE ledger_entries (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL, issuer TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
  expected_cents INTEGER, received_cents INTEGER, received_on TEXT, capital_cents INTEGER, locked_from TEXT, locked_to TEXT, capital_earning INTEGER,
  fees_cents INTEGER, interest_cents INTEGER, transfer_fee_cents INTEGER, fx_cents INTEGER, offer_id INTEGER REFERENCES offer_terms(id) ON DELETE SET NULL, notes TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE plans (id INTEGER PRIMARY KEY, name TEXT NOT NULL, offer_id INTEGER REFERENCES offer_terms(id) ON DELETE SET NULL, created_at TEXT NOT NULL);
CREATE TABLE plan_steps (
  id INTEGER PRIMARY KEY, plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  step_date TEXT, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, remind INTEGER NOT NULL DEFAULT 1, note TEXT
);
CREATE TABLE effort_logs (id INTEGER PRIMARY KEY, ref_type TEXT NOT NULL, ref_id INTEGER NOT NULL, hours REAL NOT NULL, logged_on TEXT NOT NULL, note TEXT);
CREATE INDEX idx_effort_ref ON effort_logs(ref_type, ref_id);
CREATE INDEX idx_steps_plan ON plan_steps(plan_id);
`,
  },
  {
    version: 5,
    destructive: false,
    sql: `
ALTER TABLE debts ADD COLUMN loan_type TEXT;
ALTER TABLE debts ADD COLUMN limit_cents INTEGER;
ALTER TABLE debts ADD COLUMN cap_day INTEGER;
ALTER TABLE debts ADD COLUMN opened_on TEXT;
ALTER TABLE holdings ADD COLUMN acb_cents INTEGER;
ALTER TABLE holdings ADD COLUMN foreign_prop INTEGER;
ALTER TABLE ledger_entries ADD COLUMN tax_flag TEXT;
CREATE TABLE loan_events (
  id INTEGER PRIMARY KEY, debt_id INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  event_date TEXT NOT NULL, kind TEXT NOT NULL, amount_cents INTEGER NOT NULL, holding_id INTEGER REFERENCES holdings(id) ON DELETE SET NULL, note TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE income_events (
  id INTEGER PRIMARY KEY, holding_id INTEGER NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  event_date TEXT NOT NULL, kind TEXT NOT NULL, amount_cents INTEGER NOT NULL, reinvested INTEGER, note TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE tax_years (
  id INTEGER PRIMARY KEY, year INTEGER NOT NULL, person TEXT, income_cents INTEGER, marginal_pct REAL, medical_threshold_cents INTEGER, note TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX idx_tax_year_person ON tax_years(year, COALESCE(person, ''));
CREATE TABLE tax_receipts (
  id INTEGER PRIMARY KEY, tax_year INTEGER NOT NULL, category TEXT NOT NULL, person TEXT, spent_on TEXT NOT NULL, payee TEXT, amount_cents INTEGER NOT NULL, reimbursed_cents INTEGER, claimed INTEGER, note TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE acb_trades (
  id INTEGER PRIMARY KEY, security TEXT NOT NULL, trade_date TEXT NOT NULL, kind TEXT NOT NULL, qty REAL, amount_cents INTEGER NOT NULL, fees_cents INTEGER, fx_rate REAL, holding_id INTEGER REFERENCES holdings(id) ON DELETE SET NULL, registered INTEGER, note TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE tax_slips (
  id INTEGER PRIMARY KEY, tax_year INTEGER NOT NULL, institution TEXT NOT NULL, kind TEXT NOT NULL, amount_cents INTEGER NOT NULL, note TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE registered_room (
  id INTEGER PRIMARY KEY, tax_year INTEGER NOT NULL, account TEXT NOT NULL, person TEXT, room_cents INTEGER NOT NULL, contributed_cents INTEGER, note TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE carryforwards (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, from_year INTEGER NOT NULL, amount_cents INTEGER NOT NULL, used_cents INTEGER, note TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE tax_checklist (tax_year INTEGER NOT NULL, item TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tax_year, item));
CREATE INDEX idx_loan_events ON loan_events(debt_id, event_date);
CREATE INDEX idx_trades ON acb_trades(security, trade_date);
`,
  },
  {
    version: 6,
    destructive: false,
    sql: `
ALTER TABLE categories ADD COLUMN flow_group TEXT;
CREATE TABLE plan_items (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, amount_cents INTEGER NOT NULL, kind TEXT NOT NULL, recurrence TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT,
  status TEXT NOT NULL, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL, note TEXT,
  unconfirmed TEXT NOT NULL DEFAULT '[]'
);
`,
  },
];

export const LATEST_SCHEMA = MIGRATIONS[MIGRATIONS.length - 1].version;

export function openDb(dataDir, log = console) {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'finance-hub.db');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  const current = row.v ?? 0;
  for (const m of MIGRATIONS.filter((x) => x.version > current)) {
    if (m.destructive && current > 0) {
      const dir = path.join(dataDir, 'backups');
      mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, `pre-migrate-${current}-to-${m.version}.db`);
      db.pragma('wal_checkpoint(TRUNCATE)');
      copyFileSync(file, dest);
      log.info(`pre-migrate backup written ${dest}`);
    }
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(m.version);
    })();
    log.info(`migrated database to schema ${m.version}`);
  }
  return db;
}

export const nowIso = () => new Date().toISOString();
