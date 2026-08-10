import { randomUUID } from 'node:crypto';
import { emptyNeutral } from '../schema.js';
import { findPersona } from './personas.js';
import { getLocale } from './i18n.js';

// Realistic mock sessions for the first-run tutorial / `mycelium demo` — NOT
// real captures. Content lives in personas.js (one shared source for this
// file and tutorial-mock-llm.js, so folder names/keywords/knowledge can't
// drift out of sync between the two the way they used to). Dates are
// computed relative to "now" each time this is called, not hardcoded, so a
// demo run always looks fresh on the calendar. Every session is `demo: true`
// (tutorial.js's endTutorial() sweeps on that) and starts `folder: null` so
// the o step has real work to do.

function daysAgo(n, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}

// personas.js's title/summary/turns are `{en, ko}` (turns: `{role, en, ko}`)
// — resolved here against whichever locale is active at seed time (index.js
// picks language before calling seedMockSessions(), so getLocale() already
// reflects it by the time this runs). `locale` defaults to getLocale()
// rather than always reading it live, so a caller can pin a specific
// language explicitly (see the tests) without needing to call setLocale()
// first and risk leaking that change to whatever runs after it.
export function buildMockSessions(personaId = 'swe', locale = getLocale()) {
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
    return n;
  });
}
