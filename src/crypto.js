import crypto from 'node:crypto';

// AES-256-GCM envelope for secrets stored in the database (TOTP seeds, later API keys).
const key = (secret) => crypto.createHash('sha256').update('finance-hub:enc:' + secret).digest();

export function encrypt(secret, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(secret), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}

export function decrypt(secret, blob) {
  const [iv, tag, ct] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(secret), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (n = 32) => crypto.randomBytes(n).toString('base64url');

// RFC 4226 / 6238 TOTP, SHA-1, 6 digits, 30 s steps.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function unbase32(s) {
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export const newTotpSecret = () => base32(crypto.randomBytes(20));
export function totpAt(secretB32, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', unbase32(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1_000_000).padStart(6, '0');
}
// Returns the matched step (so a code cannot be replayed) or null.
export function verifyTotp(secretB32, code, lastStep = 0, nowMs = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = Math.floor(nowMs / 30000);
  for (const d of [0, -1, 1]) {
    const step = cur + d;
    if (step > lastStep && crypto.timingSafeEqual(Buffer.from(totpAt(secretB32, step)), Buffer.from(c))) return step;
  }
  return null;
}
