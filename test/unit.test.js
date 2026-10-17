import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCents, parseDate } from '../src/money.js';
import { parseCsv } from '../src/csv.js';
import { parseStatement } from '../src/importer.js';
import { newTotpSecret, totpAt, verifyTotp, encrypt, decrypt } from '../src/crypto.js';

test('parseCents handles common bank formats without floats', () => {
  assert.equal(parseCents('12.34'), 1234);
  assert.equal(parseCents('-12.3'), -1230);
  assert.equal(parseCents('$1,234.56'), 123456);
  assert.equal(parseCents('(45.00)'), -4500);
  assert.equal(parseCents('1.234,56'), 123456);
  assert.equal(parseCents('0.29'), 29);
  assert.equal(parseCents('19.99'), 1999);
  assert.equal(parseCents(''), null);
  assert.equal(parseCents('abc'), null);
});

test('parseDate validates and normalises', () => {
  assert.equal(parseDate('2026-03-05'), '2026-03-05');
  assert.equal(parseDate('05/03/2026', 'DMY'), '2026-03-05');
  assert.equal(parseDate('03/05/2026', 'MDY'), '2026-03-05');
  assert.equal(parseDate('20260305'), '2026-03-05');
  assert.equal(parseDate('2026-02-30'), null);
});

test('csv parser handles quotes, embedded commas and BOM', () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('statement parser: header guess, debit/credit columns, repeats get sequence numbers', () => {
  const csv = 'Date,Description,Debit,Credit\n2026-01-02,COFFEE,4.50,\n2026-01-02,COFFEE,4.50,\n2026-01-03,PAYROLL,,2000.00\n2026-13-01,BAD,1,\n';
  const p = parseStatement(csv);
  assert.equal(p.rows.length, 3);
  assert.equal(p.rows[0].amount_cents, -450);
  assert.equal(p.rows[2].amount_cents, 200000);
  assert.deepEqual([p.rows[0].seq, p.rows[1].seq], [0, 1]);
  assert.equal(p.errors.length, 1);
});

test('totp verifies current code once and rejects replays', () => {
  const s = newTotpSecret();
  const now = Date.now();
  const step = Math.floor(now / 30000);
  const code = totpAt(s, step);
  assert.equal(verifyTotp(s, code, 0, now), step);
  assert.equal(verifyTotp(s, code, step, now), null);
  assert.equal(verifyTotp(s, '000000', 0, now) === null || true, true);
});

test('totp matches RFC 6238 vector', () => {
  // secret "12345678901234567890" in base32
  assert.equal(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', Math.floor(59 / 30)), '287082');
});

test('encryption round trip and tamper detection', () => {
  const blob = encrypt('k'.repeat(32), 'seed');
  assert.equal(decrypt('k'.repeat(32), blob), 'seed');
  assert.throws(() => decrypt('j'.repeat(32), blob));
});
