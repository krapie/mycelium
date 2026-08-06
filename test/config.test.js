import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { useTempHome } from './helpers.js';

useTempHome();
const { loadConfig, saveConfig } = await import('../src/config.js');
const { CONFIG_PATH } = await import('../src/paths.js');

test('loadConfig() returns pure defaults when no config.json exists yet', () => {
  assert.deepEqual(loadConfig(), {
    excludedSessionIds: [],
    locale: 'en',
    autoApproveSmartOrganize: false,
    onboarded: false,
  });
});

test('loadConfig() merges saved values over defaults, keeping unset keys at their default', () => {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify({ locale: 'ko', onboarded: true }));
  const cfg = loadConfig();
  assert.equal(cfg.locale, 'ko');
  assert.equal(cfg.onboarded, true);
  // Untouched keys still fall back to DEFAULTS:
  assert.deepEqual(cfg.excludedSessionIds, []);
  assert.equal(cfg.autoApproveSmartOrganize, false);
});

test('loadConfig() falls back to pure defaults when config.json is corrupt', () => {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, '{ not valid json ]');
  assert.deepEqual(loadConfig(), {
    excludedSessionIds: [],
    locale: 'en',
    autoApproveSmartOrganize: false,
    onboarded: false,
  });
});

test('saveConfig() writes exactly what it is given, then loadConfig() merges it back with defaults', () => {
  saveConfig({ locale: 'ko', excludedSessionIds: ['a', 'b'] });
  const cfg = loadConfig();
  assert.equal(cfg.locale, 'ko');
  assert.deepEqual(cfg.excludedSessionIds, ['a', 'b']);
  assert.equal(cfg.onboarded, false); // not in the saved object, so DEFAULTS fills it in
});

test('saveConfig() creates ~/.mycelium (and config.json) even before any other init', () => {
  saveConfig({ onboarded: true });
  assert.equal(loadConfig().onboarded, true);
});
