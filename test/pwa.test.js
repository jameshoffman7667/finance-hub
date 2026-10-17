import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { VERSION } from '../src/config.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('service worker cache name tracks the package version', () => {
  assert.match(read('public/sw.js'), new RegExp(`const VERSION = '${VERSION.replaceAll('.', '\\.')}'`));
});

test('manifest has required installability fields and files exist', () => {
  const m = JSON.parse(read('public/manifest.webmanifest'));
  for (const k of ['name', 'short_name', 'id', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'description']) assert.ok(m[k], k);
  assert.equal(m.display, 'standalone');
  const sizes = m.icons.map((i) => `${i.sizes}:${i.purpose}`);
  assert.ok(sizes.includes('192x192:any') && sizes.includes('512x512:any') && sizes.includes('512x512:maskable'));
  for (const f of [...m.icons, ...m.screenshots]) assert.ok(existsSync(new URL('../public' + f.src, import.meta.url)), f.src);
  assert.ok(m.screenshots.some((s) => s.form_factor === 'wide') && m.screenshots.some((s) => s.form_factor === 'narrow'));
  assert.ok(existsSync(new URL('../public/icons/apple-touch-icon.png', import.meta.url)));
});

test('service worker never touches API or auth traffic', () => {
  const sw = read('public/sw.js');
  assert.match(sw, /startsWith\('\/api\/'\)[^\n]*return/);
});

test('changelog entry for the current version meets length limits', () => {
  const log = read('CHANGELOG.md');
  const i = log.indexOf(`## v${VERSION} `);
  assert.ok(i >= 0);
  const block = log.slice(i);
  const short = /\*\*Short:\*\* (.*)/.exec(block)[1];
  const long = /\*\*Long:\*\* (.*)/.exec(block)[1];
  assert.ok(short.length > 0 && short.length <= 50, `short ${short.length}`);
  assert.ok(long.length > 0 && long.length <= 250, `long ${long.length}`);
});
