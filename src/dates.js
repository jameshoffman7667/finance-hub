// Date helpers on YYYY-MM-DD strings (UTC arithmetic, no time zones involved).
const parts = (s) => s.split('-').map(Number);
const fmt = (dt) => dt.toISOString().slice(0, 10);
export const toDate = (s) => { const [y, m, d] = parts(s); return new Date(Date.UTC(y, m - 1, d)); };
export function addDays(s, n) { const dt = toDate(s); dt.setUTCDate(dt.getUTCDate() + n); return fmt(dt); }
// Same behaviour as Excel EDATE: the day is clamped to the end of a shorter month.
export function addMonths(s, n) {
  const [y, m, d] = parts(s);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12), nm = t - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(ny, nm, Math.min(d, last))));
}
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
export const maxDate = (list) => list.filter(Boolean).reduce((a, b) => (a && a > b ? a : b), null);
