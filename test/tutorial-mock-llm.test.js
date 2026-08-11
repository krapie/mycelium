import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.js';

// Production delay is 5s (see tutorial-mock-llm.js's MOCK_DELAY_MS) — fine
// for a human clicking through the demo, but this file makes many calls
// across its tests, so a static import would make the suite take way too
// long. Override it to something fast but still nonzero (proves the delay
// mechanism itself works) before dynamically importing the module — same
// env-before-dynamic-import pattern test/helpers.js's useTempHome() uses
// for MYCELIUM_HOME, since the module reads this once at load time too.
//
// useTempHome() itself matters more than usual here: createTutorialMockProvider()
// now defaults its `locale` param to i18n.js's getLocale(), which reads
// config.json — without isolating MYCELIUM_HOME first, that would read
// whatever locale happens to be set in the REAL ~/.mycelium/config.json on
// whatever machine runs this suite, not the 'en' default this file's
// English-content assertions assume.
useTempHome();
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

// Mirrors learn.js's buildPrompt()/sessionExcerpt() shape closely enough to
// exercise the dispatch (the "decisions" substring) and mockAutotag()'s own
// line-parsing — not a byte-for-byte copy of the real (Korean) prompt text.
function autotagPrompt(userText, assistantText) {
  return `아래 세션 기록을 읽고 JSON으로만 출력해라.

세션 기록:
"""
user: ${userText}
assistant: ${assistantText}
"""

출력 형식:
{"title": "", "tags": [], "summary": "", "decisions": [], "todos": []}`;
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

test('createTutorialMockProvider(personaId, "ko") classifies placement candidates against Korean summaries', async () => {
  const swe = createTutorialMockProvider('swe', 'ko');
  const sweReply = await swe(
    placementsPrompt([
      { id: 'a', summary: '주문 내역 페이지에 재주문 버튼을 구현했다.' },
      { id: 'b', summary: '장바구니 합계 반올림 버그를 수정했다.' },
      { id: 'c', summary: '알 수 없는 세션에 대한 요약.' },
    ]),
  );
  const sweById = Object.fromEntries(JSON.parse(sweReply).placements.map((p) => [p.id, p.folder]));
  assert.equal(sweById.a, 'retail-website/express-reorder');
  assert.equal(sweById.b, 'retail-website/cart-rounding-fix');
  assert.equal(sweById.c, null);

  const cse = createTutorialMockProvider('cse', 'ko');
  const cseReply = await cse(
    placementsPrompt([
      { id: 'a', summary: '온프레미스 링크의 BGP 세션을 점검했다.' },
      { id: 'b', summary: 'S3 계정 간 AccessDenied 문제를 조사했다.' },
    ]),
  );
  const cseById = Object.fromEntries(JSON.parse(cseReply).placements.map((p) => [p.id, p.folder]));
  assert.equal(cseById.a, 'cases/onprem-connectivity');
  assert.equal(cseById.b, 'cases/s3-cross-account');
});

test('createTutorialMockProvider(personaId, "ko") returns Korean canned knowledge text, per persona', async () => {
  const swe = createTutorialMockProvider('swe', 'ko');
  const sweReply = await swe(knowledgePrompt('retail-website/express-reorder'));
  assert.match(sweReply, /익스프레스 재주문/);
  assert.ok(/[가-힣]/.test(sweReply), 'ko knowledge output must actually contain Korean');

  const cse = createTutorialMockProvider('cse', 'ko');
  const cseReply = await cse(knowledgePrompt('cases/onprem-connectivity'));
  assert.match(cseReply, /온프레미스/);

  const sa = createTutorialMockProvider('sa', 'ko');
  const saReply = await sa(knowledgePrompt('customers/nimbustech'));
  assert.match(saReply, /NimbusTech/);
  assert.ok(/[가-힣]/.test(saReply), 'ko knowledge output must actually contain Korean even with an English proper noun in it');
});

test('mockSplit uses the active locale\'s splitLabels, still computed from the real turn count', async () => {
  // Same CSE 3-way-merge scenario (12 turns) as the English test above, but
  // in Korean — the turn-count math is locale-independent, only the labels
  // (and the "턴 N [role]:" prompt format itself, which is already Korean
  // regardless of UI locale — split.js's real prompt is hardcoded Korean by
  // design, see AGENTS.md) should differ.
  const cse = createTutorialMockProvider('cse', 'ko');
  const reply = JSON.parse(await cse(splitPrompt(12)));
  assert.deepEqual(reply.ranges, [
    { from: 1, to: 6, label: 'DX/VPC/ALB 전반 조사' },
    { from: 7, to: 12, label: 'MTU 근본 원인과 해결' },
  ]);
});

test('provider returns a valid autotag-shaped JSON reply, derived from the actual turn content', async () => {
  // Regression test: Shift+M/Shift+S's merge/split handlers (sessions.js)
  // now call autoTagSession() on their own result right after — without a
  // dispatch case for this prompt shape, the mock's knowledge-shaped
  // fallback isn't valid JSON, so autoTagSession() silently failed
  // (unparseable reply) and a demo merge/split kept showing an empty
  // summary, the exact "merge/split quality is too low" complaint this
  // whole feature exists to fix.
  const provider = createTutorialMockProvider('swe');
  const reply = await provider(autotagPrompt('How do I fix the flaky test?', 'Added a retry with backoff.'));
  const parsed = JSON.parse(reply);
  assert.ok(typeof parsed.title === 'string' && parsed.title.length > 0);
  assert.ok(typeof parsed.summary === 'string' && parsed.summary.length > 0);
  assert.ok(Array.isArray(parsed.tags));
  assert.ok(Array.isArray(parsed.decisions));
  assert.ok(Array.isArray(parsed.todos));
  assert.match(parsed.summary, /flaky test/, 'summary is derived from the actual turn content, not a fixed canned string');
});

test('provider\'s autotag mock varies per session instead of returning identical text every time', async () => {
  const provider = createTutorialMockProvider('swe');
  const a = JSON.parse(await provider(autotagPrompt('Question about caching.', 'Use an LRU cache.')));
  const b = JSON.parse(await provider(autotagPrompt('Question about retries.', 'Use exponential backoff.')));
  assert.notEqual(a.summary, b.summary);
  assert.notEqual(a.title, b.title);
});

test('provider\'s autotag mock respects locale', async () => {
  const provider = createTutorialMockProvider('swe', 'ko');
  const reply = await provider(autotagPrompt('캐싱 관련 질문', 'LRU 캐시를 사용하세요'));
  const parsed = JSON.parse(reply);
  assert.ok(/[가-힣]/.test(parsed.summary), 'ko locale summary must actually contain Korean');
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
