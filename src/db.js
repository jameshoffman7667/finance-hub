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
