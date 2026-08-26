import { randomUUID } from 'node:crypto';
import { emptyNeutral } from '../schema.js';
import { findPersona } from './personas.js';
import { getLocale } from './i18n.js';

// Realistic mock sessions for the first-run tutorial / `mycelium demo` — not
// real captures. Content lives in personas.js, shared with tutorial-mock-llm.js
// so the two can't drift. Dates are relative to "now" so a demo always looks
// fresh; every session is `demo: true` and starts `folder: null`.

function daysAgo(n, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}

// personas.js's title/summary/turns are `{en, ko}` (turns: `{role, en, ko}`)
// — resolved here against whichever locale is active at seed time (index.js
// picks language before the tutorial ever calls injectDemoSessions(), so
// getLocale() already reflects it by the time this runs). `locale` defaults to getLocale()
// rather than always reading it live, so a caller can pin a specific
// language explicitly (see the tests) without needing to call setLocale()
// first and risk leaking that change to whatever runs after it.
//
// `projectDir` (optional) is a real, existing directory every mock session
// gets stamped with, so the tutorial's `n` step's directory picker
// (dirsForFolder(), reuse.js) has a real suggestion instead of falling
// through to a free-text prompt pre-filled with wherever the user happened
// to launch mycelium from. Stays a plain field stamp here — no fs access —
// tutorial.js's injectDemoSessions() is the one that actually creates it.
export function buildMockSessions(personaId = 'swe', locale = getLocale(), projectDir) {
  const persona = findPersona(personaId);
  const sessions = persona.storylines.flatMap((s) => s.sessions);
  return sessions.map((s) => {
    const n = emptyNeutral(randomUUID(), s.source);
    n.startedAt = daysAgo(s.daysAgo);
    n.endedAt = daysAgo(s.daysAgo, 11);
    n.turns = s.turns.map((t) => ({ role: t.role, text: t[locale] }));
    n.extracted.title = s.title[locale];
    n.extracted.summary = s.summary[locale];
    n.extracted.tags = s.tags;
    n.summarizedTurnCount = n.turns.length;
    n.demo = true; // tutorial.js's endTutorial() sweeps on this flag
    if (projectDir) n.projectDir = projectDir;
    return n;
  });
}
