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
