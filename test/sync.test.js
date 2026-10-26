/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers.js';

useTempHome();
const { saveConfig, loadConfig } = await import('../src/config.js');
const { localDirFor, isFromOtherMachine } = await import('../src/agents.js');

const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const schemaUrl = new URL('../src/schema.js', import.meta.url).href;
const scannerUrl = new URL('../src/scanner.js', import.meta.url).href;
const organizeUrl = new URL('../src/organize.js', import.meta.url).href;
const configUrl = new URL('../src/config.js', import.meta.url).href;
const hasGit = !spawnSync('git', ['--version']).error;

test('localDirFor() maps another machine\'s path prefix and drops one that still doesn\'t exist here', () => {
  const here = mkdtempSync(join(tmpdir(), 'mycelium-map-'));
  mkdirSync(join(here, 'proj'));
  saveConfig({ ...loadConfig(), machineName: 'server', pathMap: { '/Users/me/code': here } });
  const fromLaptop = { host: 'laptop', projectDir: '/Users/me/code/proj', cwd: '/Users/me/code/proj' };
  assert.equal(isFromOtherMachine(fromLaptop), true);
  assert.equal(localDirFor(fromLaptop), join(here, 'proj'));
  assert.equal(localDirFor({ host: 'laptop', projectDir: '/Users/me/elsewhere' }), undefined);
  // This machine's own session keeps its dir even if it's gone (the launcher offers to recreate it).
  assert.equal(localDirFor({ host: 'server', projectDir: '/nope' }), '/nope');
});

// Two "machines" = two stores synced through one bare repo. Each runs as
// its own process because paths.js binds MYCELIUM_HOME once at import.
function machine(home) {
  const env = { ...process.env, MYCELIUM_HOME: home, MYCELIUM_DEMO_MODE: '' };
  return {
    home,
    cli: (...args) => execFileSync(process.execPath, [cliPath, ...args], { env, encoding: 'utf8' }),
    run: (code) =>
      execFileSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' }).trim(),
    raw: (id) => JSON.parse(readFileSync(join(home, 'raw', `${id}.json`), 'utf8')),
  };
}

function seedSession(m, id, name) {
  m.run(`
    const { emptyNeutral } = await import('${schemaUrl}');
    const { saveRaw } = await import('${scannerUrl}');
    const { saveConfig, loadConfig } = await import('${configUrl}');
    saveConfig({ ...loadConfig(), machineName: '${name}' });
    const n = emptyNeutral('${id}', 'claude');
    n.turns = [{ role: 'user', text: 'hello from ${name}' }];
    saveRaw(n);
  `);
}

test('two-way: two stores sync through a bare repo: merge on first sync, field-level edits, deletes and knowledge conflicts', { skip: !hasGit }, () => {
  const root = mkdtempSync(join(tmpdir(), 'mycelium-sync-'));
  const remote = join(root, 'remote.git');
  const a = machine(join(root, 'a'));
  const b = machine(join(root, 'b'));
  a.cli('sync', 'host', remote);
  seedSession(a, 'sess-a', 'laptop');
  seedSession(b, 'sess-b', 'server');

  // First sync merges the two existing stores.
  a.cli('sync', 'init', remote, '--two-way');
  b.cli('sync', 'init', remote, '--two-way', '--worker');
  a.cli('sync');
  for (const m of [a, b]) {
    assert.ok(existsSync(join(m.home, 'raw', 'sess-a.json')));
    assert.ok(existsSync(join(m.home, 'raw', 'sess-b.json')));
  }
  assert.equal(b.raw('sess-a').host, 'laptop');
  assert.match(b.cli('list'), /sess-a/, 'synced sessions are reindexed on the receiving machine');
  // The server can tell its own sessions from the laptop's.
  assert.match(b.cli('list'), /sess-a.*@laptop/);
  assert.match(b.cli('list'), /sess-b.*@server/);
  const fromLaptop = b.cli('list', '--host', 'laptop');
  assert.match(fromLaptop, /sess-a/);
  assert.doesNotMatch(fromLaptop, /sess-b/);

  // Concurrent edits to one session merge field by field.
  a.cli('mkdir', 'work');
  a.cli('mv', 'sess-a', 'work');
  b.cli('tag', 'sess-a', '+urgent');
  // Delete on one machine while the other edits the same session.
  b.run(`const { deleteSession } = await import('${organizeUrl}'); deleteSession('sess-b');`);
  a.cli('tag', 'sess-b', '+kept');
  // Both machines write the same folder's knowledge.
  for (const [m, text] of [[a, '# A\n'], [b, '# B\n']]) {
    mkdirSync(join(m.home, 'tree', 'work'), { recursive: true });
    writeFileSync(join(m.home, 'tree', 'work', 'KNOWLEDGE.md'), text);
  }
  a.cli('sync');
  b.cli('sync');
  a.cli('sync');

  for (const m of [a, b]) {
    const s = m.raw('sess-a');
    assert.equal(s.folder, 'work');
    assert.equal(s.organizedBy, 'human');
    assert.ok(s.extracted.tags.includes('urgent'));
    assert.equal(existsSync(join(m.home, 'raw', 'sess-b.json')), false, 'deletion wins over an edit');
    assert.match(readFileSync(join(m.home, 'excluded.txt'), 'utf8'), /sess-b/);
  }
  // One version stays as KNOWLEDGE.md and the other waits for `k` review — the same on both machines.
  const kn = (m, f) => readFileSync(join(m.home, 'tree', 'work', f), 'utf8');
  assert.equal(kn(a, 'KNOWLEDGE.md'), kn(b, 'KNOWLEDGE.md'));
  assert.equal(kn(a, 'KNOWLEDGE.pending.md'), kn(b, 'KNOWLEDGE.pending.md'));
  assert.notEqual(kn(a, 'KNOWLEDGE.md'), kn(a, 'KNOWLEDGE.pending.md'));

  // Machine-local files never leave the machine.
  const tracked = execFileSync('git', ['ls-files'], { cwd: a.home, encoding: 'utf8' });
  assert.doesNotMatch(tracked, /^(config\.json|db\/)/m);
  assert.match(b.cli('sync', 'worker'), /on/);
  assert.match(a.cli('sync', 'worker'), /off/);
});

test('a synced machine that is not the worker skips automatic LLM upkeep', async () => {
  const { __setTestProvider, __clearTestProvider } = await import('../src/llm.js');
  const { saveRaw } = await import('../src/scanner.js');
  const { emptyNeutral } = await import('../src/schema.js');
  const { smartOrganizeCycle, digestCycle, knowledgeReviewCycle } = await import('../src/daemon/cycles.js');
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  saveRaw({ ...emptyNeutral('nw-1', 'claude'), folder: 'f', startedAt: `${yesterday}T09:00:00.000Z`, turns: [{ role: 'user', text: 'x' }] });
  saveConfig({ ...loadConfig(), sync: { remote: '/nowhere.git', worker: false } });
  let calls = 0;
  __setTestProvider(async () => {
    calls++;
    return '{}';
  });
  const log = { log() {}, error() {} };
  try {
    await smartOrganizeCycle(log);
    await digestCycle(log);
    await knowledgeReviewCycle(log);
  } finally {
    __clearTestProvider();
  }
  assert.equal(calls, 0);
});

test('one-way: a machine only sends; the collecting machine gathers everything and keeps what a sender deletes', { skip: !hasGit }, () => {
  const root = mkdtempSync(join(tmpdir(), 'mycelium-push-'));
  const remote = join(root, 'remote.git');
  const laptop = machine(join(root, 'laptop'));
  const server = machine(join(root, 'server'));
  const guest = machine(join(root, 'guest'));
  laptop.cli('sync', 'host', remote);
  seedSession(laptop, 'lap-1', 'laptop');
  seedSession(laptop, 'lap-2', 'laptop');
  seedSession(server, 'srv-1', 'server');
  seedSession(guest, 'gst-1', 'guest');

  // One-way is the default for init.
  laptop.cli('sync', 'init', remote);
  assert.match(laptop.cli('sync', 'mode'), /^push/);
  server.cli('sync', 'init', remote, '--collect', '--worker');
  assert.match(laptop.cli('sync'), /sent/);
  server.cli('sync');

  // The server gathers the laptop's sessions; the laptop never receives the server's.
  assert.ok(existsSync(join(server.home, 'raw', 'lap-1.json')));
  assert.equal(server.raw('lap-1').host, 'laptop');
  laptop.cli('sync');
  assert.equal(existsSync(join(laptop.home, 'raw', 'srv-1.json')), false);
  assert.doesNotMatch(laptop.cli('list'), /srv-1/);

  // Later changes on the laptop reach the server.
  laptop.cli('tag', 'lap-1', '+urgent');
  laptop.cli('sync');
  server.cli('sync');
  assert.ok(server.raw('lap-1').extracted.tags.includes('urgent'));

  // Deleting on the sender does not delete on the server.
  laptop.run(`const { deleteSession } = await import('${organizeUrl}'); deleteSession('lap-2');`);
  laptop.cli('sync');
  server.cli('sync');
  assert.equal(existsSync(join(laptop.home, 'raw', 'lap-2.json')), false);
  assert.ok(existsSync(join(server.home, 'raw', 'lap-2.json')), 'the central copy is kept');
  server.cli('sync'); // and stays settled on the next pass
  assert.ok(existsSync(join(server.home, 'raw', 'lap-2.json')));

  // Opting in makes later deletions propagate.
  assert.match(server.cli('sync', 'deletes', 'propagate'), /propagate/);
  laptop.run(`const { deleteSession } = await import('${organizeUrl}'); deleteSession('lap-1');`);
  laptop.cli('sync');
  server.cli('sync');
  assert.equal(existsSync(join(server.home, 'raw', 'lap-1.json')), false);

  // A two-way machine gets everything the collecting machine holds, through main.
  guest.cli('sync', 'init', remote, '--two-way');
  server.cli('sync');
  guest.cli('sync');
  assert.ok(existsSync(join(guest.home, 'raw', 'srv-1.json')));
  assert.ok(existsSync(join(guest.home, 'raw', 'lap-2.json')));
  assert.match(server.cli('list'), /@laptop/);
});

test('a pushing machine runs LLM upkeep itself; modes and flags are validated', { skip: !hasGit }, () => {
  const root = mkdtempSync(join(tmpdir(), 'mycelium-mode-'));
  const remote = join(root, 'remote.git');
  const m = machine(join(root, 'm'));
  m.cli('sync', 'host', remote);
  seedSession(m, 'mode-1', 'laptop');
  assert.match(m.cli('sync', 'init', remote), /experimental/, 'setup says so');
  assert.match(m.cli('sync', 'worker'), /on/, 'nobody else summarizes a pushing machine\'s sessions');
  assert.throws(() => m.cli('sync', 'mode', 'sideways'), /mode must be one of/);
  assert.throws(() => m.cli('sync', 'init', remote, '--collect', '--two-way'), /pick one/);
  assert.match(m.cli('sync', 'mode', 'two-way'), /^two-way/);
  assert.match(m.cli('sync', 'worker'), /off/);
});

test('renameMachine() relabels only this machine\'s sessions, and refuses bad or taken names', async () => {
  const { renameMachine } = await import('../src/sync.js');
  const { saveRaw, loadRaw } = await import('../src/scanner.js');
  const { emptyNeutral } = await import('../src/schema.js');
  const { loadConfig, saveConfig, machineName } = await import('../src/config.js');
  saveConfig({ ...loadConfig(), machineName: 'old-name', sync: undefined });
  for (const [id, host] of [['rn-mine', 'old-name'], ['rn-theirs', 'homeserver'], ['rn-none', null]]) {
    saveRaw({ ...emptyNeutral(id, 'claude'), host });
  }

  const bad = await renameMachine('has space');
  assert.equal(bad.ok, false);
  assert.match((await renameMachine('homeserver')).error, /already carry/);
  assert.equal(machineName(), 'old-name', 'a refused rename changes nothing');

  const r = await renameMachine('macbook');
  assert.equal(r.ok, true);
  assert.equal(r.relabeled, 1);
  assert.equal(machineName(), 'macbook');
  assert.equal(loadRaw('rn-mine').host, 'macbook');
  assert.equal(loadRaw('rn-theirs').host, 'homeserver');
  assert.equal(loadRaw('rn-none').host, null);
  assert.equal((await renameMachine('macbook')).unchanged, true);
});

test('renaming a one-way machine moves its remote branch, and the collecting machine picks up the new name', { skip: !hasGit }, () => {
  const root = mkdtempSync(join(tmpdir(), 'mycelium-rename-'));
  const remote = join(root, 'remote.git');
  const laptop = machine(join(root, 'laptop'));
  const server = machine(join(root, 'server'));
  const guest = machine(join(root, 'guest'));
  laptop.cli('sync', 'host', remote);
  seedSession(laptop, 'rn-1', 'Kevins-Personal-Macbook');
  seedSession(server, 'rn-2', 'kevinprk');
  seedSession(guest, 'rn-3', 'guest');
  server.cli('sync', 'init', remote, '--collect', '--worker');
  laptop.cli('sync', 'init', remote);
  server.cli('sync');
  const branches = () => execFileSync('git', ['ls-remote', '--heads', remote], { encoding: 'utf8' });
  assert.match(branches(), /machines\/Kevins-Personal-Macbook/);
  assert.equal(server.raw('rn-1').host, 'Kevins-Personal-Macbook');

  // Rename the laptop: its records, its remote branch, and the server's view of them.
  assert.match(laptop.cli('sync', 'name', 'macbook'), /renamed Kevins-Personal-Macbook → macbook \(1 session/);
  assert.equal(laptop.cli('sync', 'name').trim(), 'macbook');
  assert.match(branches(), /machines\/macbook/);
  assert.doesNotMatch(branches(), /Kevins-Personal-Macbook/, 'the old branch is deleted once the new one is pushed');
  server.cli('sync');
  assert.equal(server.raw('rn-1').host, 'macbook');
  assert.equal(server.raw('rn-2').host, 'kevinprk', 'the server\'s own sessions are untouched');
  assert.match(server.cli('list', '--host', 'macbook'), /rn-1/);

  // Rename the collecting machine: a two-way client gets it through main.
  guest.cli('sync', 'init', remote, '--two-way');
  server.cli('sync');
  guest.cli('sync');
  assert.equal(guest.raw('rn-2').host, 'kevinprk');
  server.cli('sync', 'name', 'homeserver');
  guest.cli('sync');
  assert.equal(guest.raw('rn-2').host, 'homeserver');
  assert.equal(guest.raw('rn-1').host, 'macbook');

  // A name chosen at init is in place before the first push.
  const phone = machine(join(root, 'phone'));
  seedSession(phone, 'rn-4', 'phone-default');
  phone.cli('sync', 'init', remote, '--name', 'phone');
  assert.equal(phone.raw('rn-4').host, 'phone');
  assert.match(branches(), /machines\/phone/);
});

test('a delete-vs-edit conflict in a folder with spaces and Korean letters in its name still resolves', { skip: !hasGit }, () => {
  const root = mkdtempSync(join(tmpdir(), 'mycelium-quote-'));
  const remote = join(root, 'remote.git');
  const a = machine(join(root, 'a'));
  const b = machine(join(root, 'b'));
  a.cli('sync', 'host', remote);
  seedSession(a, 'q-a', 'a');
  seedSession(b, 'q-b', 'b');
  a.cli('sync', 'init', remote, '--two-way');
  b.cli('sync', 'init', remote, '--two-way');
  const folder = '프로젝트/내 폴더';
  const knowledge = (m) => join(m.home, 'tree', ...folder.split('/'), 'KNOWLEDGE.md');
  mkdirSync(join(a.home, 'tree', ...folder.split('/')), { recursive: true });
  writeFileSync(knowledge(a), '# v1\n');
  a.cli('sync');
  b.cli('sync');
  assert.ok(existsSync(knowledge(b)));

  // One machine deletes the file, the other edits it.
  rmSync(knowledge(a));
  a.cli('sync');
  writeFileSync(knowledge(b), '# v2, edited elsewhere\n');
  // git quotes a path like this in `status --porcelain`, so an unparsed one used to leave the merge stuck.
  b.cli('sync');
  assert.equal(existsSync(knowledge(b)), false, 'the deletion wins');
  a.cli('sync');
  assert.equal(existsSync(knowledge(a)), false);
});

test('a commit that cannot be made is reported, not silently skipped', { skip: !hasGit }, () => {
  const root = mkdtempSync(join(tmpdir(), 'mycelium-commit-'));
  const remote = join(root, 'remote.git');
  const m = machine(join(root, 'm'));
  m.cli('sync', 'host', remote);
  seedSession(m, 'c-1', 'laptop');
  m.cli('sync', 'init', remote);

  // A stuck index (a crashed git, a second process) makes `git add` fail.
  seedSession(m, 'c-2', 'laptop');
  writeFileSync(join(m.home, '.git', 'index.lock'), '');
  assert.throws(() => m.cli('sync'), (err) => /git add failed/.test(err.stderr) && !/sent/.test(err.stdout));
  rmSync(join(m.home, '.git', 'index.lock'));
  assert.match(m.cli('sync'), /sent/);
});

test('a user\'s commit signing and pre-commit hook cannot block the unattended commits', { skip: !hasGit || process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'mycelium-hooks-'));
  const remote = join(root, 'remote.git');
  const m = machine(join(root, 'm'));
  m.cli('sync', 'host', remote);
  seedSession(m, 'h-1', 'laptop');
  m.cli('sync', 'init', remote);

  // What a developer's global git config can do: sign every commit with a
  // signer that fails, and run a hook that rejects.
  writeFileSync(join(m.home, '.git', 'config'), readFileSync(join(m.home, '.git', 'config'), 'utf8') + '[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = false\n');
  const hook = join(m.home, '.git', 'hooks', 'pre-commit');
  mkdirSync(join(m.home, '.git', 'hooks'), { recursive: true });
  writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  chmodSync(hook, 0o755);

  seedSession(m, 'h-2', 'laptop');
  assert.match(m.cli('sync'), /sent/);
  execFileSync('git', ['--git-dir', remote, 'cat-file', '-e', 'machines/laptop:raw/h-2.json']);
});

test('git() runs without askpass helpers and gives a stalled network call a deadline', { skip: process.platform === 'win32' }, async () => {
  const { git } = await import('../src/sync.js');
  const saved = { ...process.env };
  try {
    // VS Code's terminal exports its own GIT_ASKPASS; it must not reach git.
    process.env.GIT_ASKPASS = '/bin/true';
    process.env.SSH_ASKPASS = '/bin/true';
    const env = await git(['-c', 'alias.probe=!printf "[%s][%s]" "$GIT_ASKPASS" "$SSH_ASKPASS"', 'probe']);
    assert.equal(env.stdout, '[][]');

    // git appends ssh's own arguments, so the stand-in has to ignore them.
    process.env.GIT_SSH_COMMAND = 'sh -c "sleep 30" ssh';
    const t0 = Date.now();
    const r = await git(['ls-remote', 'ssh://nobody@localhost/none'], { timeout: 400 });
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, true);
    assert.ok(Date.now() - t0 < 10000, 'returned near the deadline, not after the 30s hang');
  } finally {
    process.env = saved;
  }
});

// A machine that has never run the TUI or a scan has no store yet, and
// `sync init` checks for git before initRepo() creates one. git() runs in the
// store, where execFile answers ENOENT for the missing directory exactly as it
// would for a missing binary — so this reported "git is not installed" on a
// machine that had git, which is step 2 of docs/sync.md on a fresh laptop.
test('the git check survives a store that does not exist yet, and a missing cwd is not reported as a missing git', { skip: !hasGit }, async () => {
  const { git, hasGit: checkGit } = await import('../src/sync.js');
  const gone = join(mkdtempSync(join(tmpdir(), 'mycelium-nocwd-')), 'never-created');

  assert.equal(await checkGit(), true, 'git is found without depending on the store');

  const r = await git(['--version'], { cwd: gone });
  assert.equal(r.ok, false);
  assert.notEqual(r.missing, true, 'a missing cwd must not claim git is missing');
  assert.match(r.stderr, /no such directory/);

  // End to end: the real path a fresh machine takes.
  const root = mkdtempSync(join(tmpdir(), 'mycelium-fresh-'));
  const remote = join(root, 'remote.git');
  const fresh = machine(join(root, 'never-made'));
  fresh.cli('sync', 'host', remote);
  assert.match(fresh.cli('sync', 'init', remote, '--collect'), /sync set up/);
});
