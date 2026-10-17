// Money is integer cents. Parse human text without floating point.
export function parseCents(input) {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-\s*$/.test(s)) { neg = true; s = s.replace(/-\s*$/, ''); }
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
  s = s.replace(/[$\s]|CAD|USD/gi, '').replace(/^\+/, '');
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
  // 1.234,56 (European) vs 1,234.56
  if (/,\d{1,2}$/.test(s) && s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const m = /^(\d*)(?:\.(\d{0,2})\d*)?$/.exec(s);
  if (!m || (m[1] === '' && !m[2])) return null;
  const cents = Number(m[1] || '0') * 100 + Number((m[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return neg ? -cents : cents;
}

export function parseDate(input, order = 'YMD') {
  const s = String(input ?? '').trim();
  let y, m, d, x;
  if ((x = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) [, y, m, d] = x;
  else if ((x = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s))) {
    if (order === 'DMY') [, d, m, y] = x; else [, m, d, y] = x;
  } else if ((x = /^(\d{8})$/.exec(s))) { y = s.slice(0, 4); m = s.slice(4, 6); d = s.slice(6, 8); }
  else return null;
  y = +y; m = +m; d = +d;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const fmtCents = (c) => (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
