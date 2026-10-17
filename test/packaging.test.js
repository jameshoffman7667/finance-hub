import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('default port is 8070 and PORT overrides it', () => {
  const base = { APP_SECRET_KEY: 'x'.repeat(40) };
  assert.equal(loadConfig(base).port, 8070);
  assert.equal(loadConfig({ ...base, PORT: '8123' }).port, 8123);
});

test('image and compose health checks follow PORT', () => {
  const d = read('Dockerfile');
  assert.match(d, /EXPOSE 8070/);
  assert.match(d, /HEALTHCHECK[\s\S]*127\.0\.0\.1:\$\{PORT\}\/healthz/);
  const c = read('deploy/compose.yaml');
  assert.match(c, /PORT=\$\{PORT_HOST:\?/);
  assert.match(c, /"\$\{PORT_HOST\}:\$\{PORT_HOST\}"/);
  assert.match(c, /127\.0\.0\.1:\$\$\{PORT\}\/healthz/);
  assert.doesNotMatch(c, /8080/);
});
