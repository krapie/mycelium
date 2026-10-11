'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { knownDirs, resolveCli, childEnv, loginShellPath } = require('../src/cli-path.js');

const have = (...paths) => (p) => paths.includes(p);
const MINIMAL = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };

test('an absolute path from the setting is trusted as given', () => {
  const r = resolveCli({ configured: '/opt/homebrew/bin/mycelium', env: MINIMAL, platform: 'darwin', exists: () => false });
  assert.deepEqual([r.command, r.dir, r.from], ['/opt/homebrew/bin/mycelium', '/opt/homebrew/bin', 'setting']);
});

test('found on PATH when PATH has it', () => {
  const r = resolveCli({ env: { PATH: '/usr/bin:/home/me/bin' }, platform: 'linux', home: '/home/me', exists: have('/home/me/bin/mycelium', '/usr/bin') });
  assert.deepEqual([r.command, r.from], ['/home/me/bin/mycelium', 'PATH']);
});

test('the Dock-launched case: PATH is minimal, Homebrew is not on it — found in the known location', () => {
  const r = resolveCli({ env: MINIMAL, platform: 'darwin', home: '/Users/me', exists: have('/opt/homebrew/bin', '/opt/homebrew/bin/mycelium', '/usr/bin') });
  assert.deepEqual([r.command, r.dir, r.from], ['/opt/homebrew/bin/mycelium', '/opt/homebrew/bin', 'known location']);
});

test('nvm: the newest node version is searched first', () => {
  const root = '/Users/me/.nvm/versions/node';
  const r = resolveCli({
    env: MINIMAL, platform: 'darwin', home: '/Users/me',
    readdir: (d) => (d === root ? ['v20.1.0', 'v22.5.0', 'v9.0.0', 'junk'] : (() => { throw new Error('no'); })()),
    exists: have(root + '/v22.5.0/bin', root + '/v20.1.0/bin', root + '/v22.5.0/bin/mycelium', root + '/v20.1.0/bin/mycelium'),
  });
  assert.equal(r.command, root + '/v22.5.0/bin/mycelium');
});

test('extra directories (from the login shell) are searched too', () => {
  const r = resolveCli({ env: MINIMAL, platform: 'linux', home: '/h', exists: have('/weird/place/mycelium'), extraDirs: ['/weird/place'] });
  assert.equal(r.command, '/weird/place/mycelium');
});

test('not found anywhere: the bare name comes back with what was searched', () => {
  const r = resolveCli({ env: MINIMAL, platform: 'darwin', home: '/Users/me', exists: have('/opt/homebrew/bin', '/usr/bin') });
  assert.deepEqual([r.command, r.dir, r.from], ['mycelium', null, null]);
  assert.ok(r.searched.includes('/opt/homebrew/bin') && r.searched.includes('/usr/bin'));
});

test('Windows: the npm .cmd shim under %APPDATA% is found, through a differently-cased `Path`', () => {
  const env = { Path: 'C:\\Windows\\System32', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' };
  const dir = 'C:\\Users\\me\\AppData\\Roaming\\npm';
  const r = resolveCli({ env, platform: 'win32', exists: have('C:\\Windows\\System32', dir, dir + '\\mycelium.cmd') });
  assert.deepEqual([r.command, r.dir], [dir + '\\mycelium.cmd', dir]);
});

test('childEnv puts the CLI directory first so `#!/usr/bin/env node` finds the node beside it', () => {
  const env = childEnv({ env: MINIMAL, platform: 'darwin', dir: '/opt/homebrew/bin', home: '/Users/me', exists: have('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin') });
  assert.equal(env.PATH, '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin');
});

test('childEnv skips locations that do not exist and keeps the original PATH', () => {
  const env = childEnv({ env: { PATH: '/a:/b' }, platform: 'linux', dir: null, home: '/h', exists: () => false });
  assert.equal(env.PATH, '/a:/b');
});

test('childEnv on Windows uses ";" and the key the environment already has', () => {
  const env = childEnv({ env: { Path: 'C:\\x' }, platform: 'win32', dir: 'C:\\n', home: 'C:\\h', exists: have('C:\\n') });
  assert.deepEqual(env, { Path: 'C:\\n;C:\\x' });
});

test('knownDirs only returns directories that exist', () => {
  assert.deepEqual(knownDirs({ platform: 'darwin', home: '/Users/me', exists: have('/opt/homebrew/bin') }), ['/opt/homebrew/bin']);
});

// --- login shell fallback
function fakeShell(onSpawn) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => child.emit('close');
    setImmediate(() => onSpawn(child));
    return child;
  };
}

test('loginShellPath returns the shell\'s PATH and ignores whatever the rc files print', async () => {
  const spawnFn = fakeShell((c) => {
    c.stdout.emit('data', 'Welcome back!\nnvm loaded\n__MYCELIUM_PATH__/opt/homebrew/bin:/usr/bin__MYCELIUM_PATH__');
    c.emit('close');
  });
  assert.equal(await loginShellPath({ platform: 'linux', shell: '/bin/zsh', spawnFn }), '/opt/homebrew/bin:/usr/bin');
});

test('loginShellPath gives up after its own timeout instead of hanging', async () => {
  const t0 = Date.now();
  assert.equal(await loginShellPath({ platform: 'linux', shell: '/bin/zsh', timeoutMs: 30, spawnFn: fakeShell(() => {}) }), null);
  assert.ok(Date.now() - t0 < 1000);
});

test('loginShellPath is null when the shell fails to start or prints nothing useful', async () => {
  assert.equal(await loginShellPath({ platform: 'linux', shell: '/bin/zsh', spawnFn: fakeShell((c) => c.emit('error', new Error('boom'))) }), null);
  assert.equal(await loginShellPath({ platform: 'linux', shell: '/bin/zsh', spawnFn: fakeShell((c) => { c.stdout.emit('data', 'no markers'); c.emit('close'); }) }), null);
  assert.equal(await loginShellPath({ platform: 'linux', shell: '', spawnFn: fakeShell(() => {}) }), null);
});

test('loginShellPath never starts a shell on Windows', async () => {
  let started = false;
  assert.equal(await loginShellPath({ platform: 'win32', shell: 'C:\\Windows\\System32\\cmd.exe', spawnFn: () => { started = true; return fakeShell(() => {})(); } }), null);
  assert.equal(started, false);
});
