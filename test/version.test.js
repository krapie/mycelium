import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.js';

test('VERSION matches package.json\'s own version field', () => {
  const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  assert.equal(VERSION, pkg.version);
});

test('VERSION looks like a semver string', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});
