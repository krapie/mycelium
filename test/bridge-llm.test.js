import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.js';

useTempHome();
const { saveRaw, loadRaw } = await import('../src/scanner.js');
const { emptyNeutral } = await import('../src/schema.js');
const { __setTestProvider, __clearTestProvider } = await import('../src/llm.js');
const { handle, LONG } = await import('../src/bridge.js');
const { reindex } = await import('../src/index-db.js');

test.afterEach(() => __clearTestProvider());

const sent = [];
const ctx = { notify: (method, params) => sent.push({ method, params }) };
const call = (method, params) => handle({ jsonrpc: '2.0', id: 1, method, params }, ctx);

function seed(id, over = {}) {
  const n = { ...emptyNeutral(id, 'claude'), startedAt: '2026-02-01T00:00:00Z', turns: [{ role: 'user', text: `work on ${id}` }, { role: 'assistant', text: 'ok' }], ...over };
  saveRaw(n);
  return n;
}

test('the LLM-backed methods are the ones serve.js runs outside its queue', () => {
  assert.deepEqual([...LONG].sort(), ['autotag', 'knowledgeBuild', 'organizeSuggest']);
});

test('autotag with ids summarizes those sessions and reports progress under the caller token', async () => {
  seed('at-1');
  seed('at-2');
  __setTestProvider(async () => JSON.stringify({ title: 'Fix it', tags: ['bug'], summary: 'fixed', decisions: [], todos: [] }));
  sent.length = 0;
  const { result } = await call('autotag', { ids: ['at-1', 'at-2'], token: 'tok-1' });
  assert.deepEqual(result, { tagged: 2, failed: 0 });
  assert.equal(loadRaw('at-1').extracted.title, 'Fix it');
  const progress = sent.filter((m) => m.method === 'progress');
  assert.equal(progress.length, 2);
  assert.deepEqual(progress.at(-1).params, { token: 'tok-1', done: 2, total: 2 });
});

test('organizeSuggest returns a reviewable list and organizeApply files only what was accepted', async () => {
  await call('mkdir', { folder: 'Work/api' }); // a folder that really exists, as move() would have made it
  seed('org-filed', { folder: 'Work/api', organizedBy: 'human', extracted: { ...emptyNeutral('x', 'claude').extracted, summary: 'REST api work' } });
  seed('org-a', { extracted: { ...emptyNeutral('x', 'claude').extracted, title: 'Add endpoint', summary: 'adds an endpoint' } });
  seed('org-b', { extracted: { ...emptyNeutral('x', 'claude').extracted, title: 'Tweak', summary: 'misc' } });
  reindex();
  __setTestProvider(async () =>
    JSON.stringify({
      placements: [
        { id: 'org-a', folder: 'Work/api', reason: 'api work' },
        { id: 'org-b', folder: 'Brand/new', reason: 'new topic' },
      ],
    }),
  );

  const { result: list } = await call('organizeSuggest', { limit: 10 });
  const a = list.find((x) => x.id === 'org-a');
  const b = list.find((x) => x.id === 'org-b');
  assert.equal(a.title, 'Add endpoint');
  assert.equal(a.newFolder, false);
  assert.equal(b.newFolder, true);

  const { result } = await call('organizeApply', { accept: [{ id: 'org-a', folder: 'Work/api' }], reject: ['org-b'] });
  assert.equal(result.applied, 1);
  assert.equal(loadRaw('org-a').folder, 'Work/api');
  assert.equal(loadRaw('org-a').organizedBy, 'human');
  assert.equal(loadRaw('org-b').folder, null);
  assert.equal(loadRaw('org-b').suggestedFolder, null, 'a rejected suggestion stops being offered');
});

test('organizeApply refuses an unsafe folder path', async () => {
  const { error } = await call('organizeApply', { accept: [{ id: 'org-a', folder: '../escape' }] });
  assert.equal(error.code, -32000);
});

test('knowledgeBuild proposes text next to the current file; knowledgeSave writes it', async () => {
  seed('kn-1', { folder: 'KB/area', extracted: { ...emptyNeutral('x', 'claude').extracted, summary: 'chose postgres', decisions: ['use postgres'] } });
  __setTestProvider(async () => '## Area\n\n- use postgres');
  const built = (await call('knowledgeBuild', { folder: 'KB/area' })).result;
  assert.match(built.text, /use postgres/);
  assert.equal(built.current, '');

  await call('knowledgeSave', { folder: 'KB/area', text: built.text });
  const again = (await call('knowledgeBuild', { folder: 'KB/area' })).result;
  assert.equal(again.current, built.text);
  assert.ok((await call('folders')).result.knowledge.includes('KB/area'));
  assert.equal((await call('knowledgeSave', { folder: 'KB/area', text: '  ' })).error.code, -32000);
});

test('pending knowledge can be listed, promoted and dismissed', async () => {
  const { writePendingKnowledgeText } = await import('../src/insight.js');
  writePendingKnowledgeText('KB/pending', 'proposed');
  const pending = (await call('knowledgePending')).result;
  assert.equal(pending.find((p) => p.folder === 'KB/pending').text, 'proposed');
  await call('knowledgePromote', { folder: 'KB/pending' });
  assert.equal((await call('knowledgePending')).result.some((p) => p.folder === 'KB/pending'), false);
  assert.equal((await call('knowledgePromote', { folder: 'KB/pending' })).error.code, -32000);
});
