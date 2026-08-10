import test from 'node:test';
import assert from 'node:assert/strict';

// Production delay is 5s (see tutorial-mock-llm.js's MOCK_DELAY_MS) — fine
// for a human clicking through the demo, but this file makes many calls
// across its tests, so a static import would make the suite take way too
// long. Override it to something fast but still nonzero (proves the delay
// mechanism itself works) before dynamically importing the module — same
// env-before-dynamic-import pattern test/helpers.js's useTempHome() uses
// for MYCELIUM_HOME, since the module reads this once at load time too.
process.env.MYCELIUM_DEMO_MOCK_DELAY_MS = '30';
const { createTutorialMockProvider } = await import('../src/tui/tutorial-mock-llm.js');

// Prompt fragments below mirror the REAL shapes organize/classify.js, split.js,
// and insight.js build (see those files), not just what this module itself
// assumes, so a drift in either side would actually break a test here.
// The provider resolves after a deliberate short delay (see its own
// comment) so the demo's spinner has something to animate — every test
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

// totalTurns lets each test build a prompt with exactly as many numbered
// turns as the persona/storyline under test actually has, so the dynamic
// turn-count parsing in mockSplit() gets genuinely exercised rather than
// only ever seeing the same fixed count.
function splitPrompt(totalTurns) {
  const turns = Array.from({ length: totalTurns }, (_, i) => `턴 ${i + 1} [${i % 2 === 0 ? 'user' : 'assistant'}]: turn ${i + 1}`).join('\n');
  return `아래는 하나의 AI 작업 세션의 전체 대화 기록이다.

${turns}

출력 형식(JSON만, 다른 설명 없이):
{"ranges":[{"from":1,"to":8,"label":"짧은 주제 설명"}]}`;
}

function knowledgePrompt(folder) {
  return `아래는 "${folder}" 작업 공간에서 있었던 세션 요약과 결정들이다. 이 공간에서 새 작업을 시작하는 AI가 미리 알아야 할 "프로젝트 지식"을 정리해라.`;
}

test('createTutorialMockProvider("swe") classifies placement candidates by storyline keyword into English folders', async () => {
  const provider = createTutorialMockProvider('swe');
  const reply = await provider(
    placementsPrompt([
      { id: 'a', summary: 'Built the reorder-eligibility API for the order history page.' },
      { id: 'b', summary: 'Fixed a cart total rounding bug caused by floating-point drift.' },
      { id: 'c', summary: 'Added lazy-loading to product listing images to improve LCP.' },
      { id: 'd', summary: 'Something entirely unrelated to any known storyline.' },
    ]),
  );
  const parsed = JSON.parse(reply);
  const byId = Object.fromEntries(parsed.placements.map((p) => [p.id, p.folder]));
  assert.equal(byId.a, 'retail-website/express-reorder');
  assert.equal(byId.b, 'retail-website/cart-rounding-fix');
  assert.equal(byId.c, 'retail-website/image-lazy-loading');
  assert.equal(byId.d, null);
});

test('createTutorialMockProvider("cse") classifies placement candidates into its own folders', async () => {
  const provider = createTutorialMockProvider('cse');
  const reply = await provider(
    placementsPrompt([
      { id: 'a', summary: 'Checked the Direct Connect BGP session for an onprem link.' },
      { id: 'b', summary: 'Investigated an S3 cross-account access denied error.' },
      { id: 'c', summary: 'Unrelated summary matching nothing.' },
    ]),
  );
  const parsed = JSON.parse(reply);
  const byId = Object.fromEntries(parsed.placements.map((p) => [p.id, p.folder]));
  assert.equal(byId.a, 'cases/onprem-connectivity');
  assert.equal(byId.b, 'cases/s3-cross-account');
  assert.equal(byId.c, null);
});

test('createTutorialMockProvider("sa") classifies placement candidates into its own folders', async () => {
  const provider = createTutorialMockProvider('sa');
  const reply = await provider(
    placementsPrompt([
      { id: 'a', summary: 'Researched AI agent platform best practices for a customer.' },
      { id: 'b', summary: 'Ran a Globex discovery meeting about current-state pain points.' },
      { id: 'c', summary: 'Initech kickoff meeting about a migration.' },
    ]),
  );
  const parsed = JSON.parse(reply);
  const byId = Object.fromEntries(parsed.placements.map((p) => [p.id, p.folder]));
  assert.equal(byId.a, 'customers/nimbustech');
  assert.equal(byId.b, 'customers/globex');
  assert.equal(byId.c, 'customers/initech');
});

test('provider returns valid JSON matching every candidate id, in the placements schema', async () => {
  const provider = createTutorialMockProvider('swe');
  const reply = await provider(placementsPrompt([{ id: 'demo-1', summary: 'reorder button on order history' }]));
  const parsed = JSON.parse(reply);
  assert.equal(parsed.placements.length, 1);
  assert.equal(parsed.placements[0].id, 'demo-1');
  assert.equal(parsed.placements[0].folder, 'retail-website/express-reorder');
  assert.ok(typeof parsed.placements[0].reason === 'string');
});

test('mockSplit computes a roughly-even 2-way split from the actual turn count, not a hardcoded one', async () => {
  // SWE's merge storyline (express-reorder) is 2 sessions x 4 turns = 8.
  const swe = createTutorialMockProvider('swe');
  const sweReply = JSON.parse(await swe(splitPrompt(8)));
  assert.deepEqual(sweReply.ranges, [
    { from: 1, to: 4, label: 'Backend API' },
    { from: 5, to: 8, label: 'Frontend UI' },
  ]);

  // CSE's merge storyline (onprem-connectivity) is a 3-way merge — 3
  // sessions x 4 turns = 12. This is the exact case a hardcoded {1,2}/{3,4}
  // split used to silently drop everything past turn 4 for.
  const cse = createTutorialMockProvider('cse');
  const cseReply = JSON.parse(await cse(splitPrompt(12)));
  assert.deepEqual(cseReply.ranges, [
    { from: 1, to: 6, label: 'Investigation across DX/VPC/ALB' },
    { from: 7, to: 12, label: 'MTU root cause & fix' },
  ]);
  assert.equal(cseReply.ranges[1].to, 12, 'every turn must be covered, none silently dropped');
});

test('provider returns the matching canned English knowledge text for a known demo folder, per persona', async () => {
  const swe = createTutorialMockProvider('swe');
  const sweReply = await swe(knowledgePrompt('retail-website/express-reorder'));
  assert.match(sweReply, /Express Reorder/);
  assert.doesNotMatch(sweReply, /[가-힣]/, 'demo knowledge output must be English, not Korean');

  const cse = createTutorialMockProvider('cse');
  const cseReply = await cse(knowledgePrompt('cases/onprem-connectivity'));
  assert.match(cseReply, /On-prem/);

  const sa = createTutorialMockProvider('sa');
  const saReply = await sa(knowledgePrompt('customers/nimbustech'));
  assert.match(saReply, /NimbusTech/);
});

test('provider falls back gracefully for an unknown folder in a knowledge prompt', async () => {
  const provider = createTutorialMockProvider('swe');
  const reply = await provider(knowledgePrompt('some/unexpected/folder'));
  assert.match(reply, /no tutorial notes/);
});

test('provider matches a knowledge request scoped one level above the storyline folder', async () => {
  // buildKnowledgeText() is subtree-scoped (isInSubtree()), so a human who
  // pressed `w` while on `retail-website` (not the leaf
  // `retail-website/express-reorder`) still gets real material in the
  // prompt — the mock's folder match needs the same tolerance, not strict
  // equality.
  const provider = createTutorialMockProvider('swe');
  const reply = await provider(knowledgePrompt('retail-website'));
  assert.match(reply, /Express Reorder/);
});

test('every persona\'s canned knowledge text is English, not Korean', async () => {
  for (const [personaId, folders] of [
    ['swe', ['retail-website/express-reorder', 'retail-website/cart-rounding-fix', 'retail-website/image-lazy-loading']],
    ['cse', ['cases/onprem-connectivity', 'cases/s3-cross-account']],
    ['sa', ['customers/nimbustech', 'customers/globex', 'customers/initech']],
  ]) {
    const provider = createTutorialMockProvider(personaId);
    for (const folder of folders) {
      const reply = await provider(knowledgePrompt(folder));
      assert.doesNotMatch(reply, /[가-힣]/, `${personaId}'s ${folder} knowledge text must be English`);
    }
  }
});

test('provider resolves after a deliberate delay, not instantly', async () => {
  const provider = createTutorialMockProvider('swe');
  const start = Date.now();
  await provider(knowledgePrompt('retail-website/express-reorder'));
  // Checks against this file's own MYCELIUM_DEMO_MOCK_DELAY_MS override
  // (30ms), not the real 5s production default — this only needs to prove
  // the delay mechanism fires at all, not what the demo actually feels like.
  assert.ok(Date.now() - start >= 20, 'mock output should not resolve near-instantly (spinner needs frames to animate)');
});
