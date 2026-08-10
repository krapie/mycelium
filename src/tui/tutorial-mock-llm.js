// Deterministic, instant stand-ins for the tutorial's real o/w/Shift+S LLM
// calls, wired up via llm.js's __setTestProvider() for the lifetime of the
// mock session store (see tutorial.js's seedMockSessions()/endTutorial()).
// Two problems this solves at once: (1) speed — a real claude/codex
// subprocess call takes anywhere from ~1 to 10+ seconds per call, several
// times over in one tutorial run; (2) determinism — organize/classify.js's
// prompt (and every other LLM prompt in this codebase) is hardcoded Korean
// by deliberate design (see AGENT.md), so a freshly-proposed folder name
// with no existing folder to imitate comes back Korean even in an
// English-locale demo. Canned English folder names sidestep that without
// touching the real (intentionally Korean) production prompts at all.
//
// Dispatch is by a substring unique to each call site's own JSON response
// schema: classify.js's suggestPlacements() prompt asks for `{"placements":
// [...`, split.js's suggestSplitBoundaries() asks for `{"ranges":[...`;
// insight.js's buildKnowledgeText() has neither (freeform prose), so it's
// the fallback case. Not exhaustive — mycelium demo's freeform explore step
// lets a curious user press keys outside the scripted path (`a` autotag,
// `d` digest) that also route through complete() while this is still
// active; those get the knowledge-shaped fallback, which is a harmless
// mismatch (wrong-shaped text shown, nothing crashes or corrupts data), not
// worth a 4th prompt-shape detector for paths the tutorial doesn't script.

const STORYLINES = [
  {
    folder: 'backend/payments',
    keywords: /pg-pool|connection-?pool|payment/i,
    knowledge: `## Payments backend

- **Connection pooling**: pg-pool's \`max\` must have headroom over real peak concurrency, not just steady-state — the timeout incident traced back to \`max: 10\` against 40-50 concurrent requests at peak. Current setting: \`max: 30\`, \`idleTimeoutMillis: 10000\`.
- **RDS side matters too**: raising the pool's \`max\` without also raising the RDS parameter group's \`max_connections\` just moves the bottleneck — both were raised together (100 → 200).
- **Watch for regressions**: no connection-pool metrics on the dashboard yet — flagged as the next follow-up so this class of issue is caught before it times out in production again.`,
  },
  {
    folder: 'frontend/login-ui',
    keywords: /login-card|ios safari|responsive|media query/i,
    knowledge: `## Login page / responsive layout

- **Team convention**: card-style components use \`max-width\` + \`width: 100%\`, never a bare fixed \`width\` — a fixed \`width: 480px\` on \`.login-card\` was what caused horizontal scroll and pushed the submit button off-screen on narrow viewports.
- **Breakpoint**: padding/font-size step down under \`max-width: 360px\` (iPhone SE-class widths) — verified against real devices, not just DevTools emulation.
- **Regression source**: this exact bug has recurred once already, introduced by a design-refresh commit that swapped \`max-width\` for a plain \`width\`.`,
  },
  {
    folder: 'data/sales-pipeline',
    keywords: /airflow|sales|pandas|parquet/i,
    knowledge: `## Daily sales report pipeline

- **Shape**: pandas aggregates yesterday's orders by product/region → lands as parquet in S3 (kept for later re-analysis, not just a transient artifact) → summary posted to Slack via webhook.
- **Scheduling**: runs as an Airflow DAG (\`daily_sales_report\`, 07:00 KST), not cron — chosen specifically for retries/monitoring/dependency management. \`retries: 3\`, 5-minute retry delay, \`on_failure_callback\` posts a Slack alert.
- **Verified failure path**: the failure alert itself was tested (DB connection deliberately killed mid-run), not just the happy path.`,
  },
];

function storylineForText(text) {
  return STORYLINES.find((s) => s.keywords.test(text)) || null;
}

function mockPlacements(prompt) {
  const placements = [];
  const re = /- id:(\S+) 현재폴더:\S+ 요약:(.+)/g;
  let m;
  while ((m = re.exec(prompt))) {
    const [, id, summary] = m;
    const story = storylineForText(summary);
    placements.push({ id, folder: story ? story.folder : null, reason: story ? 'tutorial demo' : 'unclear' });
  }
  return JSON.stringify({ placements });
}

function mockKnowledge(prompt) {
  const folderMatch = prompt.match(/"([^"]+)" 작업 공간/);
  const story = folderMatch && STORYLINES.find((s) => s.folder === folderMatch[1]);
  return story ? story.knowledge : '## Notes\n\n(no tutorial notes for this folder)';
}

function mockSplit() {
  // Every tutorial-data.js session has exactly 4 turns — a fixed 2-and-2
  // split (diagnose, then resolve) fits all six without needing to inspect
  // the actual turn text.
  return JSON.stringify({
    ranges: [
      { from: 1, to: 2, label: 'Diagnosis' },
      { from: 3, to: 4, label: 'Resolution' },
    ],
  });
}

// A genuinely instant (0ms) response is its own regression here: the
// animated spinner (app.js's startSpinner()) never gets to animate a single
// frame, and the flow reads as "did that actually run?" rather than a
// (much faster, but still real) version of the production wait. 5s is
// still well under a real claude/codex call (which can run into the tens
// of seconds), but long enough for the spinner to visibly cycle several
// frames (120ms/frame) rather than just flash. Overridable so
// test/tutorial-mock-llm.test.js isn't stuck waiting 5s per call — see
// that file's dynamic import for how it sets this before loading the
// module.
const MOCK_DELAY_MS = Number(process.env.MYCELIUM_DEMO_MOCK_DELAY_MS) || 5000;

function delayed(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), MOCK_DELAY_MS));
}

export function tutorialMockProvider(prompt) {
  if (prompt.includes('"placements"')) return delayed(mockPlacements(prompt));
  if (prompt.includes('"ranges"')) return delayed(mockSplit());
  return delayed(mockKnowledge(prompt));
}
