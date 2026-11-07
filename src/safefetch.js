// Fetch a public web page on request: https only, no private addresses (checked at connect time), limited redirects, size and time caps, robots.txt respected.
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns';
import net from 'node:net';

const privateV4 = (ip) => { const [a, b] = ip.split('.').map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; };
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return privateV4(ip);
  const x = ip.toLowerCase();
  if (x === '::1' || x === '::' || x.startsWith('fe80') || x.startsWith('fc') || x.startsWith('fd')) return true;
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x); return m ? privateV4(m[1]) : false;
}

export const USER_AGENT = (v) => `FinanceHub-personal/${v} (single-user, fetched only when the owner asks)`;

export function fetchPage(url, { allowPrivate = false, maxBytes = 1.5e6, timeoutMs = 10000, redirects = 3, version = '0', accept = 'text/html,application/xhtml+xml,application/xml,text/plain,application/rss+xml' } = {}) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(new Error('That is not a valid web address')); }
    if (u.protocol !== 'https:' && !(allowPrivate && u.protocol === 'http:')) return reject(new Error('Only https addresses can be fetched'));
    if (u.username || u.password) return reject(new Error('Addresses with a user name are not allowed'));
    if (net.isIP(u.hostname) && isPrivateAddress(u.hostname) && !allowPrivate) return reject(new Error('That address is on a private network'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', timeout: timeoutMs, headers: { 'User-Agent': USER_AGENT(version), Accept: accept, 'Accept-Encoding': 'identity' },
      lookup: (host, opts, cb) => dns.lookup(host, opts, (err, addr, fam) => {
        if (err) return cb(err);
        const list = Array.isArray(addr) ? addr : [{ address: addr, family: fam }];
        if (!allowPrivate && list.some((a) => isPrivateAddress(a.address))) return cb(new Error('That address is on a private network'));
        return opts && opts.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
      }) }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume(); if (redirects <= 0) return reject(new Error('Too many redirects'));
        return fetchPage(new URL(res.headers.location, u).toString(), { allowPrivate, maxBytes, timeoutMs, redirects: redirects - 1, version, accept }).then(resolve, reject);
      }
      const type = String(res.headers['content-type'] || '');
      if (status === 200 && type && !/^(text\/|application\/(xhtml\+xml|xml|rss\+xml|atom\+xml|json))/i.test(type)) { res.resume(); return reject(new Error('That page is not text')); }
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > maxBytes) { req.destroy(new Error('That page is too large')); return; } chunks.push(c); });
      res.on('end', () => resolve({ status, url: u.toString(), type, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('The site took too long to answer')));
    req.on('error', reject); req.end();
  });
}

// robots.txt: rules for "*" and for FinanceHub. Allow when the file is missing (404); stay away when it cannot be read.
export function robotsAllows(txt, path) {
  const groups = []; let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) { continue; }
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
    else if ((k === 'allow' || k === 'disallow') && cur) cur.rules.push({ allow: k === 'allow', path: v });
  }
  const mine = groups.filter((g) => g.agents.some((a) => a === 'financehub' || a === 'financehub-personal'));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  let best = null;
  const re = (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  for (const g of use) for (const r of g.rules) { if (!r.path) continue; if (re(r.path).test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r; }
  return best ? best.allow : true;
}
export async function robotsCheck(url, opts) {
  const u = new URL(url);
  try {
    const r = await fetchPage(`${u.origin}/robots.txt`, { ...opts, accept: 'text/plain', maxBytes: 5e5 });
    if (r.status === 404 || r.status === 410) return true;
    if (r.status !== 200) return false;
    return robotsAllows(r.body, u.pathname + u.search);
  } catch { return false; }
}

// Plain text from HTML, and the facts worth reviewing.
export function pageText(html) {
  return html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x?[0-9a-f]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}
export function candidates(text) {
  const out = []; const seen = new Set();
  const push = (kind, value, ctx) => { const key = kind + value; if (seen.has(key) || out.length >= 40) return; seen.add(key); out.push({ kind, value, context: ctx }); };
  const ctx = (m) => text.slice(Math.max(0, m.index - 50), Math.min(text.length, m.index + m[0].length + 50)).trim();
  for (const m of text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/g)) push('amount', `$${m[1]}${m[2] ? '.' + m[2] : ''}`, ctx(m));
  for (const m of text.matchAll(/(\d{1,3}(?:,\d{3})+|\d{3,})\s*(?:bonus\s*)?(points|miles|Aeroplan points|Scene\+ points|Avion points)/gi)) push('points', `${m[1]} ${m[2]}`, ctx(m));
  for (const m of text.matchAll(/(?:until|expires?|ends?|by|before)\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/gi)) push('date', m[1], ctx(m));
  for (const m of text.matchAll(/annual fee[^.$]{0,40}\$\s?(\d+)/gi)) push('fee', `$${m[1]}`, ctx(m));
  return out;
}
export function rssItems(xml) {
  const out = [];
  for (const m of xml.matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)) {
    const b = m[0]; const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(b)?.[1] || ''; const l = /<link[^>]*>([^<]+)<\/link>/i.exec(b)?.[1] || /<link[^>]*href="([^"]+)"/i.exec(b)?.[1] || '';
    const d = /<(?:pubDate|updated|published)[^>]*>([\s\S]*?)<\/(?:pubDate|updated|published)>/i.exec(b)?.[1] || '';
    const clean = (x) => x.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;|&gt;/g, '').trim();
    out.push({ title: clean(t).slice(0, 200), link: clean(l).slice(0, 500), date: clean(d).slice(0, 40) });
  }
  return out.slice(0, 100);
}
