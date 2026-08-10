import { randomUUID } from 'node:crypto';
import { emptyNeutral } from '../schema.js';
import { findPersona } from './personas.js';

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

export function buildMockSessions(personaId = 'swe') {
  const persona = findPersona(personaId);
  const sessions = persona.storylines.flatMap((s) => s.sessions);
  return sessions.map((s) => {
    const n = emptyNeutral(randomUUID(), s.source);
    n.startedAt = daysAgo(s.daysAgo);
    n.endedAt = daysAgo(s.daysAgo, 11);
    n.turns = s.turns;
    n.extracted.title = s.title;
    n.extracted.summary = s.summary;
    n.extracted.tags = s.tags;
    n.summarizedTurnCount = s.turns.length;
    n.demo = true; // tutorial.js's endTutorial() sweeps on this flag
    return n;
  });
}
