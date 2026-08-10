import test from 'node:test';
import assert from 'node:assert/strict';

// Production delay is 5s (see tutorial-mock-llm.js's MOCK_DELAY_MS) — fine
// for a human clicking through the demo, but this file makes ~9 calls
// across its tests, so a static import would make the suite take 45s+.
// Override it to something fast but still nonzero (proves the delay
// mechanism itself works) before dynamically importing the module — same
// env-before-dynamic-import pattern test/helpers.js's useTempHome() uses
// for MYCELIUM_HOME, since the module reads this once at load time too.
process.env.MYCELIUM_DEMO_MOCK_DELAY_MS = '30';
const { tutorialMockProvider } = await import('../src/tui/tutorial-mock-llm.js');

// Prompt fragments below mirror the REAL shapes organize/classify.js, split.js,
// and insight.js build (see those files), not just what this module itself
// assumes, so a drift in either side would actually break a test here.
// tutorialMockProvider() resolves after a deliberate short delay (see its
// own comment) so the demo's spinner has something to animate — every test
// here awaits it.

function placementsPrompt(candidates) {
  const folderBlock = '(아직 정리된 폴더 없음)';
  const sessionBlock = candidates
    .map((c) => `- id:${c.id} 현재폴더:(없음) 요약:${c.summary}`)
    .join('\n');
  return `아래는 이미 사람이 정리해 둔 폴더들과 그 안 세션 요약이다.

${folderBlock}

---
다음은 재분류가 필요한 세션들이다.
${sessionBlock}

출력 형식(JSON만, 다른 설명 없이):
{"placements":[{"id":"...", "folder":"..."|null, "reason":"짧은 이유"}]}`;
}

function splitPrompt() {
  return `아래는 하나의 AI 작업 세션의 전체 대화 기록이다.

턴 1 [user]: hi
턴 2 [assistant]: hi

출력 형식(JSON만, 다른 설명 없이):
{"ranges":[{"from":1,"to":8,"label":"짧은 주제 설명"}]}`;
}

function knowledgePrompt(folder) {
  return `아래는 "${folder}" 작업 공간에서 있었던 세션 요약과 결정들이다. 이 공간에서 새 작업을 시작하는 AI가 미리 알아야 할 "프로젝트 지식"을 정리해라.`;
}

test('tutorialMockProvider() classifies placement candidates by storyline keyword into English folders', async () => {
  const reply = await tutorialMockProvider(
    placementsPrompt([
      { id: 'a', summary: "Investigated pg-pool's max setting causing payment timeouts." },
      { id: 'b', summary: 'Fixed the login-card CSS overflow on iOS Safari.' },
      { id: 'c', summary: 'Designed a pandas + Airflow daily sales pipeline.' },
      { id: 'd', summary: 'Something entirely unrelated to any known storyline.' },
    ]),
  );
  const parsed = JSON.parse(reply);
  const byId = Object.fromEntries(parsed.placements.map((p) => [p.id, p.folder]));
  assert.equal(byId.a, 'backend/payments');
  assert.equal(byId.b, 'frontend/login-ui');
  assert.equal(byId.c, 'data/sales-pipeline');
  assert.equal(byId.d, null);
});

test('tutorialMockProvider() returns valid JSON matching every candidate id, in the placements schema', async () => {
  const reply = await tutorialMockProvider(
    placementsPrompt([{ id: 'demo-1', summary: 'connection-pool payment timeout investigation' }]),
  );
  const parsed = JSON.parse(reply);
  assert.equal(parsed.placements.length, 1);
  assert.equal(parsed.placements[0].id, 'demo-1');
  assert.equal(parsed.placements[0].folder, 'backend/payments');
  assert.ok(typeof parsed.placements[0].reason === 'string');
});

test('tutorialMockProvider() returns fixed 2-range split boundaries for a split prompt', async () => {
  const reply = await tutorialMockProvider(splitPrompt());
  const parsed = JSON.parse(reply);
  assert.deepEqual(parsed.ranges, [
    { from: 1, to: 2, label: 'Diagnosis' },
    { from: 3, to: 4, label: 'Resolution' },
  ]);
});

test('tutorialMockProvider() returns the matching canned English knowledge text for a known demo folder', async () => {
  const reply = await tutorialMockProvider(knowledgePrompt('backend/payments'));
  assert.match(reply, /Payments backend/);
  assert.doesNotMatch(reply, /[가-힣]/, 'demo knowledge output must be English, not Korean');
});

test('tutorialMockProvider() falls back gracefully for an unknown folder in a knowledge prompt', async () => {
  const reply = await tutorialMockProvider(knowledgePrompt('some/unexpected/folder'));
  assert.match(reply, /no tutorial notes/);
});

test('tutorialMockProvider() matches a knowledge request scoped one level above the storyline folder', async () => {
  // buildKnowledgeText() is subtree-scoped (isInSubtree()), so a human who
  // pressed `w` while on `backend` (not the leaf `backend/payments`) still
  // gets real material in the prompt — the mock's folder match needs the
  // same tolerance, not strict equality.
  const reply = await tutorialMockProvider(knowledgePrompt('backend'));
  assert.match(reply, /Payments backend/);
});

test('tutorialMockProvider() every canned knowledge text is English, not Korean', async () => {
  for (const folder of ['backend/payments', 'frontend/login-ui', 'data/sales-pipeline']) {
    const reply = await tutorialMockProvider(knowledgePrompt(folder));
    assert.doesNotMatch(reply, /[가-힣]/, `${folder}'s canned knowledge text must be English`);
  }
});

test('tutorialMockProvider() resolves after a deliberate delay, not instantly', async () => {
  const start = Date.now();
  await tutorialMockProvider(knowledgePrompt('backend/payments'));
  // Checks against this file's own MYCELIUM_DEMO_MOCK_DELAY_MS override
  // (30ms), not the real 5s production default — this only needs to prove
  // the delay mechanism fires at all, not what the demo actually feels like.
  assert.ok(Date.now() - start >= 20, 'mock output should not resolve near-instantly (spinner needs frames to animate)');
});
