import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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
  m.cli('sync', 'init', remote);
  assert.match(m.cli('sync', 'worker'), /on/, 'nobody else summarizes a pushing machine\'s sessions');
  assert.throws(() => m.cli('sync', 'mode', 'sideways'), /mode must be one of/);
  assert.throws(() => m.cli('sync', 'init', remote, '--collect', '--two-way'), /pick one/);
  assert.match(m.cli('sync', 'mode', 'two-way'), /^two-way/);
  assert.match(m.cli('sync', 'worker'), /off/);
});
