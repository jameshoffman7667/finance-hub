// Android build checks (spec v1.11 section 15 template, adapted to this app: ES modules, public/ web manifest).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startApp, client } from './helpers.js';

const require = createRequire(import.meta.url);
const { versionCode } = require('../scripts/android-version.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const twa = JSON.parse(fs.readFileSync(path.join(root, 'twa-manifest.json'), 'utf8'));

test('versionCode = MAJOR*100000000 + MINOR*10000 + PATCH, with the limits', () => {
  assert.equal(versionCode('2.11.0'), 200110000);
  assert.equal(versionCode('2.11.1'), 200110001);
  assert.equal(versionCode('0.1.0'), 10000);
  assert.equal(versionCode('0.9.0'), 90000);
  assert.equal(versionCode('20.9999.9999'), 2000000000 + 99990000 + 9999);
  assert.ok(versionCode('2.12.0') > versionCode('2.11.9999'));
  assert.throws(() => versionCode('2.10000.0'), /9999 or less/);
  assert.throws(() => versionCode('2.0.10000'), /9999 or less/);
  assert.throws(() => versionCode('21.0.0'), /20 or less/);
  assert.throws(() => versionCode('2.1'), /MAJOR\.MINOR\.PATCH/);
});

test('twa-manifest.json has the required fields', () => {
  assert.equal(twa.packageId, 'ca.hoffmanhouse.financehub');
  assert.match(twa.packageId, /^ca\.hoffmanhouse\.[a-z0-9]+$/, 'package id: lowercase letters and digits only, no hyphens');
  assert.equal(twa.host, 'finances.hoffmanhouse.ca');
  assert.equal(twa.display, 'standalone');
  assert.equal(twa.fallbackType, 'customtabs');
  assert.equal(twa.startUrl, '/');
  assert.equal(twa.signingKey.alias, 'financehub');
  assert.ok(twa.iconUrl.startsWith('https://' + twa.host + '/') && twa.maskableIconUrl.includes('maskable'));
  for (const u of [twa.iconUrl, twa.maskableIconUrl]) assert.ok(fs.existsSync(path.join(root, 'public', new URL(u).pathname)), u);
  assert.ok(!JSON.stringify(twa).match(/password/i), 'no passwords in twa-manifest.json');
  assert.ok(!JSON.stringify(twa).includes('<'), 'no <PLACEHOLDER> left in twa-manifest.json');
});

test("twa-manifest.json uses Bubblewrap's version fields (appVersion = name, appVersionCode = number)", () => {
  assert.equal(typeof twa.appVersion, 'string'); assert.equal(typeof twa.appVersionCode, 'number');
  assert.equal(twa.appVersionName, undefined);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(twa.appVersion, pkg.version, 'twa-manifest.json version follows package.json');
  assert.equal(twa.appVersionCode, versionCode(pkg.version));
});

test('minSdkVersion is at least 24 (androidbrowserhelper 2.7 needs it)', () => { assert.ok(twa.minSdkVersion >= 24); });

test('enableSiteSettingsShortcut stays true (the browser helper library toggles ManageDataLauncherActivity at start and crashes if it is missing)', () => {
  assert.equal(twa.enableSiteSettingsShortcut, true);
});

test('notifications are on because the app uses Web Push', () => {
  assert.equal(twa.enableNotifications, true);
  assert.match(fs.readFileSync(path.join(root, 'src/notify.js'), 'utf8'), /web-push/);
});

test('the manifest colours match the web manifest', () => {
  const web = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'));
  assert.equal(twa.themeColor.toLowerCase(), web.theme_color.toLowerCase());
  assert.equal(twa.backgroundColor.toLowerCase(), web.background_color.toLowerCase());
});

test('assetlinks.json is public (no login), JSON, not redirected and names the package', async () => {
  const app = await startApp(); const c = client(app.base);
  try {
    const r = await c.raw('GET', '/.well-known/assetlinks.json');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /application\/json/);
    const j = JSON.parse(r.text);
    assert.equal(j[0].target.package_name, twa.packageId);
    assert.ok(Array.isArray(j[0].target.sha256_cert_fingerprints));
    assert.ok(j[0].target.sha256_cert_fingerprints.every((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f)), 'real SHA-256 fingerprint, not the placeholder');
    assert.ok(j[0].relation.includes('delegate_permission/common.handle_all_urls'));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'public/.well-known/assetlinks.json'), 'utf8')), j, 'the served file is the file the workflow checks');
    // nothing else became public: the API still needs a sign-in
    assert.equal((await c.get('/api/accounts')).status, 401);
  } finally { await app.close(); }
});

test('release workflow: prepare, image, android in order; manual rebuild input; overwrite guard', () => {
  const w = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  assert.match(w, /\n  prepare:/); assert.match(w, /\n  image:\n(?:.*\n)*?    needs: prepare/); assert.match(w, /\n  android:\n    needs: \[prepare, image\]/);
  assert.match(w, /twa-manifest\.json/); assert.match(w, /gh release upload/);
  assert.match(w, /workflow_dispatch:/); assert.match(w, /overwrite/);
  assert.match(w, /github\.event_name != 'workflow_dispatch'/, 'prepare and image must be skipped on a manual run');
  assert.match(w, /paths: \[package\.json, VERSION\]/, 'the version path filter stays');
  assert.match(w, /ASSETLINKS_PATH: public\/\.well-known\/assetlinks\.json/);
  assert.ok(fs.existsSync(path.join(root, 'public/.well-known/assetlinks.json')));
});

test('Android Back: every dialog owns a history entry and Back closes it', () => {
  const js = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  assert.match(js, /history\.pushState\(\{ dlg: entry\.id \}/);
  assert.match(js, /popstate[\s\S]{0,200}openDialogs/);
  assert.ok(!/h\('dialog'|showModal/.test(fs.readdirSync(path.join(root, 'public')).filter((f) => f.endsWith('.js') && f !== 'app.js').map((f) => fs.readFileSync(path.join(root, 'public', f), 'utf8')).join('\n')), 'only app.js opens dialogs, so none bypasses the history entry');
});
