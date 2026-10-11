import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.js';

useTempHome();
const { saveRaw } = await import('../src/scanner.js');
const { emptyNeutral } = await import('../src/schema.js');
const { reindex, listSessions } = await import('../src/index-db.js');

function seed(id, projectDir) {
  saveRaw({ ...emptyNeutral(id, 'claude'), projectDir, startedAt: '2026-01-01T00:00:00Z', turns: [{ role: 'user', text: id }] });
}
seed('w-root', 'C:\\work\\app');
seed('w-sub', 'C:\\work\\app\\packages\\web');
seed('w-sibling', 'C:\\work\\application');
seed('w-other-drive', 'D:\\work\\app');
seed('p-root', '/work/app');
seed('p-sub', '/work/app/packages/web');
reindex();
const ids = (dir) => listSessions({ dir }).map((r) => r.id).sort();

test('a Windows workspace finds sessions in its subfolders, however either side spells the path', () => {
  assert.deepEqual(ids('C:\\work\\app'), ['w-root', 'w-sub']);
  assert.deepEqual(ids('c:/Work/App/'), ['w-root', 'w-sub'], 'forward slashes, other case, trailing slash');
  assert.deepEqual(ids('D:\\work\\app'), ['w-other-drive']);
});

test('POSIX directories are compared exactly as before', () => {
  assert.deepEqual(ids('/work/app'), ['p-root', 'p-sub']);
  assert.deepEqual(ids('/work/app/'), ['p-root', 'p-sub']);
  assert.deepEqual(ids('/work/App'), [], 'case matters on POSIX');
});
