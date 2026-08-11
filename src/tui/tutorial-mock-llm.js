import { findPersona } from './personas.js';
import { getLocale } from './i18n.js';

// Deterministic, instant stand-ins for the tutorial's real o/w/Shift+S LLM
// calls, wired up via llm.js's __setTestProvider() for the lifetime of the
// mock session store (see tutorial.js's seedMockSessions()/endTutorial()).
// Two problems this solves at once: (1) speed — a real claude/codex
// subprocess call takes anywhere from ~1 to 10+ seconds per call, several
// times over in one tutorial run; (2) determinism — organize/classify.js's
// prompt (and every other LLM prompt in this codebase) is hardcoded Korean
// by deliberate design (see AGENTS.md), so a freshly-proposed folder name
// with no existing folder to imitate comes back Korean even in an
// English-locale demo. Canned English folder names sidestep that without
// touching the real (intentionally Korean) production prompts at all.
//
// Dispatch is by a substring unique to each call site's own JSON response
// schema: classify.js's suggestPlacements() prompt asks for `{"placements":
// [...`, split.js's suggestSplitBoundaries() asks for `{"ranges":[...`,
// learn.js's autoTagSession() asks for `{"title": "", ..., "decisions": [],
// ...`; insight.js's buildKnowledgeText() has none of those (freeform
// prose), so it's the fallback case. Not fully exhaustive — mycelium demo's
// freeform explore step lets a curious user press `d` (digest) too, which
// also routes through complete() while this is still active; that one gets
// the knowledge-shaped fallback, a harmless mismatch (wrong-shaped text
// shown, nothing crashes or corrupts data), not worth a 5th detector for a
// path the tutorial doesn't script. `a` (autotag) DOES get its own case
// below — it's no longer just the manual explore-step key, since Shift+M/
// Shift+S's merge/split handlers now call autoTagSession() on their own
// result right after (see sessions.js) to avoid leaving a demo merge/split
// looking empty until a separate manual `a`.
//
// Storyline content (folder/keywords/knowledge/splitLabels) lives in
// personas.js, shared with tutorial-data.js, so the two can't drift out of
// sync the way separate hardcoded copies once did (see git history: merge/
// split regressions traced back to folder-name mismatches between this file
// and tutorial-data.js).
//
// personas.js's keywords/knowledge/splitLabels are `{en, ko}` — resolved
// once per createTutorialMockProvider() call against the active locale, so
// every function below keeps working against plain values exactly as
// before locale support existed.
function resolveStorylines(storylines, locale) {
  return storylines.map((s) => ({
    folder: s.folder,
    keywords: s.keywords[locale],
    knowledge: s.knowledge[locale],
    splitLabels: s.splitLabels?.[locale],
  }));
}

function storylineForText(storylines, text) {
  return storylines.find((s) => s.keywords.test(text)) || null;
}

function mockPlacements(storylines, prompt) {
  const placements = [];
  const re = /- id:(\S+) 현재폴더:\S+ 요약:(.+)/g;
  let m;
  while ((m = re.exec(prompt))) {
    const [, id, summary] = m;
    const story = storylineForText(storylines, summary);
    placements.push({ id, folder: story ? story.folder : null, reason: story ? 'tutorial demo' : 'unclear' });
  }
  return JSON.stringify({ placements });
}

function mockKnowledge(storylines, prompt) {
  const folderMatch = prompt.match(/"([^"]+)" 작업 공간/);
  const requested = folderMatch?.[1];
  // isInSubtree-equivalent match, not strict equality: buildKnowledgeText()
  // itself is scoped by subtree (organize/folders.js's isInSubtree()), so a
  // human who pressed `w` one folder level short of the leaf (e.g.
  // `retail-website` instead of `retail-website/express-reorder`) still
  // gets real session material in the prompt — this only needs to resolve
  // which storyline that material belongs to, same as the real
  // classification does.
  const story = requested && storylines.find((s) => s.folder === requested || s.folder.startsWith(`${requested}/`));
  return story ? story.knowledge : '## Notes\n\n(no tutorial notes for this folder)';
}

// learn.js's sessionExcerpt() embeds the transcript right above the JSON
// schema instruction as "role: text" lines — pulled out here for a crude
// but content-DERIVED (not identical regardless of which session this
// runs on) mock title/summary, so a merge/split result (or a manual `a`)
// doesn't show the exact same canned text for every session in the demo.
function mockAutotag(prompt, locale) {
  const lines = prompt
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const firstUser = lines.find((l) => l.startsWith('user:'))?.slice(5).trim() || '';
  const lastTurn = [...lines].reverse().find((l) => /^(user|assistant):/.test(l));
  const lastText = lastTurn?.replace(/^(user|assistant):\s*/, '') || '';
  const title = (firstUser || lastText || 'Session').slice(0, 40);
  const summary =
    locale === 'ko'
      ? `${firstUser.slice(0, 60) || '이 세션'}에 대해 다룸 — ${lastText.slice(0, 60) || '진행 중'}.`
      : `Covers ${firstUser.slice(0, 60) || 'this session'} — ${lastText.slice(0, 80) || 'in progress'}.`;
  return JSON.stringify({ title, tags: [], summary, decisions: [], todos: [] });
}

// The real prompt (split.js's suggestSplitBoundaries()) numbers every turn
// as `턴 N [role]: text`, 1-indexed, no gaps — so the actual turn count is
// read straight out of the prompt instead of assuming a fixed number.
// Needed once storyline session lengths stopped all being the same (the CSE
// persona's 3-way merge produces more total turns than a 2-way one), and a
// hardcoded {1,2}/{3,4} split silently dropped everything past turn 4.
function mockSplit(mergeStoryline, prompt) {
  const turnNumbers = [...prompt.matchAll(/턴 (\d+) \[/g)].map((m) => Number(m[1]));
  const total = turnNumbers.length ? Math.max(...turnNumbers) : 2;
  const mid = Math.max(1, Math.floor(total / 2));
  const [firstLabel, secondLabel] = mergeStoryline.splitLabels || ['Part 1', 'Part 2'];
  return JSON.stringify({
    ranges: [
      { from: 1, to: mid, label: firstLabel },
      { from: mid + 1, to: total, label: secondLabel },
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

// Factory rather than a single stateless function: which storyline set (and
// therefore which folder names/knowledge/split labels) applies depends on
// which persona AND language the user picked before the tutorial started —
// see tutorial.js's seedMockSessions(personaId). `locale` defaults to
// getLocale() rather than always reading it live, matching
// buildMockSessions()'s own reasoning (tutorial-data.js) — pin a specific
// language explicitly (tests) without needing setLocale() first.
export function createTutorialMockProvider(personaId = 'swe', locale = getLocale()) {
  const persona = findPersona(personaId);
  const storylines = resolveStorylines(persona.storylines, locale);
  const mergeStoryline = storylines[persona.mergeStorylineIndex];

  return function tutorialMockProvider(prompt) {
    if (prompt.includes('"placements"')) return delayed(mockPlacements(storylines, prompt));
    if (prompt.includes('"ranges"')) return delayed(mockSplit(mergeStoryline, prompt));
    if (prompt.includes('"decisions"')) return delayed(mockAutotag(prompt, locale));
    return delayed(mockKnowledge(storylines, prompt));
  };
}
