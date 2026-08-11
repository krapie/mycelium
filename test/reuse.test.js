import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers.js';

useTempHome();

const { emptyNeutral } = await import('../src/schema.js');
const { saveRaw } = await import('../src/scanner.js');
const { mkdir } = await import('../src/organize.js');
const { TREE_DIR } = await import('../src/paths.js');
const { assembleContext, injectAgentsMd, contextForSession } = await import('../src/reuse.js');

function writeKnowledge(folderPath, text) {
  mkdir(folderPath);
  writeFileSync(join(TREE_DIR, ...folderPath.split('/'), 'KNOWLEDGE.md'), text);
}

test('assembleContext() returns empty string for a falsy/root folder path', () => {
  assert.equal(assembleContext(''), '');
  assert.equal(assembleContext(null), '');
});

test('assembleContext() joins every ancestor KNOWLEDGE.md from root to leaf, in order', () => {
  writeKnowledge('work', 'Work-level knowledge.');
  writeKnowledge('work/proj', 'Proj-level knowledge.');
  const context = assembleContext('work/proj');
  const workIdx = context.indexOf('Work-level knowledge.');
  const projIdx = context.indexOf('Proj-level knowledge.');
  assert.ok(workIdx >= 0 && projIdx >= 0);
  assert.ok(workIdx < projIdx);
});

test('assembleContext() skips ancestor levels that have no KNOWLEDGE.md', () => {
  mkdir('nowledge/mid/leaf');
  writeKnowledge('nowledge/mid/leaf', 'Only the leaf has knowledge.');
  const context = assembleContext('nowledge/mid/leaf');
  assert.equal(context, 'Only the leaf has knowledge.');
});

test('injectAgentsMd() fails with no context when no ancestor has a KNOWLEDGE.md', () => {
  mkdir('empty-of-knowledge');
  const targetDir = mkdtempSync(join(tmpdir(), 'mycelium-agents-'));
  const res = injectAgentsMd(targetDir, 'empty-of-knowledge');
  assert.equal(res.ok, false);
});

test('injectAgentsMd() creates a fresh AGENTS.md with a marker block when none exists', () => {
  writeKnowledge('fresh-target', 'Knowledge for fresh target.');
  const targetDir = mkdtempSync(join(tmpdir(), 'mycelium-agents-'));
  const res = injectAgentsMd(targetDir, 'fresh-target');
  assert.equal(res.ok, true);
  const content = readFileSync(res.path, 'utf8');
  assert.match(content, /<!-- mycelium:begin -->/);
  assert.match(content, /<!-- mycelium:end -->/);
  assert.match(content, /Knowledge for fresh target\./);
});

test('injectAgentsMd() appends the marker block after existing user content, never touching it', () => {
  writeKnowledge('append-target', 'Append-target knowledge.');
  const targetDir = mkdtempSync(join(tmpdir(), 'mycelium-agents-'));
  const agentsPath = join(targetDir, 'AGENTS.md');
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(agentsPath, '# My own project notes\n\nDo not touch this.\n');

  const res = injectAgentsMd(targetDir, 'append-target');
  assert.equal(res.ok, true);
  const content = readFileSync(agentsPath, 'utf8');
  assert.match(content, /My own project notes/);
  assert.match(content, /Do not touch this\./);
  assert.match(content, /Append-target knowledge\./);
});

test('injectAgentsMd() replaces only the marker block on repeated calls — no duplication, user content preserved', () => {
  writeKnowledge('repeat-target', 'Version one.');
  const targetDir = mkdtempSync(join(tmpdir(), 'mycelium-agents-'));
  writeFileSync(join(targetDir, 'AGENTS.md'), '# User notes\n');

  injectAgentsMd(targetDir, 'repeat-target');
  writeKnowledge('repeat-target', 'Version two.');
  injectAgentsMd(targetDir, 'repeat-target');

  const content = readFileSync(join(targetDir, 'AGENTS.md'), 'utf8');
  assert.match(content, /User notes/);
  assert.match(content, /Version two\./);
  assert.doesNotMatch(content, /Version one\./);
  const beginCount = (content.match(/<!-- mycelium:begin -->/g) || []).length;
  assert.equal(beginCount, 1);
});

test('injectAgentsMd() also creates a CLAUDE.md bridging to AGENTS.md, since Claude Code does not read AGENTS.md on its own', () => {
  writeKnowledge('claude-bridge-fresh', 'Bridge knowledge.');
  const targetDir = mkdtempSync(join(tmpdir(), 'mycelium-agents-'));
  injectAgentsMd(targetDir, 'claude-bridge-fresh');
  const claudeMd = readFileSync(join(targetDir, 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /@AGENTS\.md/);
});

test('injectAgentsMd() prepends the bridge to an existing CLAUDE.md without touching its own content', () => {
  writeKnowledge('claude-bridge-existing', 'More bridge knowledge.');
  const targetDir = mkdtempSync(join(tmpdir(), 'mycelium-agents-'));
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, 'CLAUDE.md'), '# My own Claude instructions\n\nDo not touch this.\n');

  injectAgentsMd(targetDir, 'claude-bridge-existing');
  const claudeMd = readFileSync(join(targetDir, 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /@AGENTS\.md/);
  assert.match(claudeMd, /My own Claude instructions/);
  assert.match(claudeMd, /Do not touch this\./);
});

test('injectAgentsMd() never duplicates the CLAUDE.md bridge line on repeated calls', () => {
  writeKnowledge('claude-bridge-repeat', 'v1');
  const targetDir = mkdtempSync(join(tmpdir(), 'mycelium-agents-'));

  injectAgentsMd(targetDir, 'claude-bridge-repeat');
  writeKnowledge('claude-bridge-repeat', 'v2');
  injectAgentsMd(targetDir, 'claude-bridge-repeat');

  const claudeMd = readFileSync(join(targetDir, 'CLAUDE.md'), 'utf8');
  const bridgeCount = (claudeMd.match(/@AGENTS\.md/g) || []).length;
  assert.equal(bridgeCount, 1);
});

test('contextForSession() resolves a session\'s folder context, and fails cleanly for a missing session', () => {
  writeKnowledge('ctx-folder', 'Context-for-session knowledge.');
  const n = emptyNeutral('ctx-sess-1', 'claude');
  n.folder = 'ctx-folder';
  saveRaw(n);

  const res = contextForSession('ctx-sess-1');
  assert.equal(res.ok, true);
  assert.equal(res.folder, 'ctx-folder');
  assert.match(res.context, /Context-for-session knowledge\./);

  const missing = contextForSession('does-not-exist');
  assert.equal(missing.ok, false);
});
