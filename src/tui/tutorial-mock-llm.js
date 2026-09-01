import { findPersona } from './personas.js';
import { getLocale } from './i18n.js';

// Deterministic, instant stand-ins for the tutorial's real o/w/Shift+S LLM
// calls, for speed and determinism a real subprocess can't offer. Dispatch
// is by a substring unique to each call site's JSON schema (`"placements"`,
// `"ranges"`, `"decisions"`, else the knowledge freeform fallback), parsing
// both en/ko label text. Storyline content lives in personas.js, shared
// with tutorial-data.js so the two can't drift.
export function resolveStorylines(storylines, locale) {
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

function mockPlacements(storylines, prompt, locale) {
  const placements = [];
  const re = locale === 'ko' ? /- id:(\S+) 현재폴더:\S+ 요약:(.+)/g : /- id:(\S+) current folder:\S+ summary:(.+)/g;
  let m;
  while ((m = re.exec(prompt))) {
    const [, id, summary] = m;
    const story = storylineForText(storylines, summary);
    placements.push({ id, folder: story ? story.folder : null, reason: story ? 'tutorial demo' : 'unclear' });
  }
  return JSON.stringify({ placements });
}

function mockKnowledge(storylines, prompt, locale) {
  const folderMatch = locale === 'ko' ? prompt.match(/"([^"]+)" 작업 공간/) : prompt.match(/"([^"]+)" workspace/);
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
// as `턴 N [role]: text` (ko) / `Turn N [role]: text` (en), 1-indexed, no
// gaps — so the actual turn count is read straight out of the prompt
// instead of assuming a fixed number. Needed once storyline session lengths
// stopped all being the same (the CSE persona's 3-way merge produces more
// total turns than a 2-way one), and a hardcoded {1,2}/{3,4} split silently
// dropped everything past turn 4.
function mockSplit(mergeStoryline, prompt, locale) {
  const re = locale === 'ko' ? /턴 (\d+) \[/g : /Turn (\d+) \[/g;
  const turnNumbers = [...prompt.matchAll(re)].map((m) => Number(m[1]));
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

// A genuinely instant (0ms) response is its own regression: the animated
// spinner never gets to animate, reading as "did that actually run?" 5s is
// well under a real call but long enough for the spinner to visibly cycle.
// Overridable so test/tutorial-mock-llm.test.js isn't stuck waiting per call.
const MOCK_DELAY_MS = Number(process.env.MYCELIUM_DEMO_MOCK_DELAY_MS) || 5000;

function delayed(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), MOCK_DELAY_MS));
}

// Low-level factory, independent of personas.js's persona/id lookup — takes
// already-resolved (plain-value) storylines, so any caller-built storyline
// bundle (not just personas.js's own) can drive the same dispatch/parsing
// logic instead of a second hand-rolled mock — see test/tutorial-mock-llm
// .test.js's own direct coverage of this.
export function createMockProvider(storylines, mergeStoryline, locale) {
  return function mockProvider(prompt) {
    if (prompt.includes('"placements"')) return delayed(mockPlacements(storylines, prompt, locale));
    if (prompt.includes('"ranges"')) return delayed(mockSplit(mergeStoryline, prompt, locale));
    if (prompt.includes('"decisions"')) return delayed(mockAutotag(prompt, locale));
    return delayed(mockKnowledge(storylines, prompt, locale));
  };
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
  return createMockProvider(storylines, mergeStoryline, locale);
}
