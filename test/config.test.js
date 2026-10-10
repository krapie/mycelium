import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { useTempHome } from './helpers.js';

useTempHome();
const { loadConfig, saveConfig, organizeLimit, parseLimit, DEFAULT_ORGANIZE_LIMIT, machineName, excludedIds, addExcludedId } = await import(
  '../src/config.js'
);
const { CONFIG_PATH, EXCLUDED_PATH } = await import('../src/paths.js');

test('loadConfig() returns pure defaults when no config.json exists yet', () => {
  assert.deepEqual(loadConfig(), {
    excludedSessionIds: [],
    locale: 'en',
    autoApproveSmartOrganize: false,
    onboarded: false,
    archiveOlderThanDays: 90,
    firstScanModalShown: false,
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
    archiveOlderThanDays: 90,
    firstScanModalShown: false,
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

test('parseLimit() accepts only positive integers (#167)', () => {
  assert.equal(parseLimit('25'), 25);
  assert.equal(parseLimit(5), 5);
  for (const bad of [true, false, '', null, undefined, '0', '-3', '2.5', 'abc']) assert.equal(parseLimit(bad), null, String(bad));
});

test('organizeLimit(): saved setting, then MYCELIUM_SUMMARIZE_BATCH_LIMIT, then the default (#167)', () => {
  const env = process.env.MYCELIUM_SUMMARIZE_BATCH_LIMIT;
  try {
    saveConfig({});
    delete process.env.MYCELIUM_SUMMARIZE_BATCH_LIMIT;
    assert.equal(organizeLimit(), DEFAULT_ORGANIZE_LIMIT);
    process.env.MYCELIUM_SUMMARIZE_BATCH_LIMIT = '12';
    assert.equal(organizeLimit(), 12);
    saveConfig({ organizeLimit: 7 });
    assert.equal(organizeLimit(), 7);
    saveConfig({ organizeLimit: 'nonsense' });
    assert.equal(organizeLimit(), 12);
  } finally {
    if (env === undefined) delete process.env.MYCELIUM_SUMMARIZE_BATCH_LIMIT;
    else process.env.MYCELIUM_SUMMARIZE_BATCH_LIMIT = env;
    saveConfig({});
  }
});

test('machineName() is derived once and then stays fixed', () => {
  saveConfig({});
  const first = machineName();
  assert.ok(first && !first.includes('.'));
  assert.equal(loadConfig().machineName, first);
  saveConfig({ ...loadConfig(), machineName: 'laptop' });
  assert.equal(machineName(), 'laptop');
});

test('excludedIds() moves an older config.json list into excluded.txt', () => {
  saveConfig({ excludedSessionIds: ['b', 'a'] });
  addExcludedId('c');
  assert.deepEqual([...excludedIds()].sort(), ['a', 'b', 'c']);
  assert.deepEqual(loadConfig().excludedSessionIds, []);
  assert.equal(readFileSync(EXCLUDED_PATH, 'utf8'), 'a\nb\nc\n');
});
