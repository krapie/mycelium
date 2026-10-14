import { createClip, listClips, findClip, deleteClip, clipFolder, clipText } from '../clip.js';
import { loadRaw } from '../scanner.js';
import { fail, parseFlags, resolveSessionId } from './util.js';

const USAGE =
  'Usage: mycelium clip add <session> [--turn N | --turn N-M] [--note "..."] | list [--folder f] [--session s] | show <clip> | rm <clip>';

export function clipCmd(args) {
  const [sub, ...rest] = args;
  if (!sub || sub === 'list') return listCmd(rest);
  if (sub === 'add') return addCmd(rest);
  if (sub === 'show') return showCmd(rest);
  if (sub === 'rm') return rmCmd(rest);
  return fail(USAGE);
}

/**
 * Without --turn, print the session's turns numbered instead of guessing —
 * the numbers are what --turn takes, and there's no picker here like the
 * TUI's `p` to choose one interactively.
 */
function addCmd(args) {
  const { flags, positional } = parseFlags(args);
  if (!positional[0]) return fail(USAGE);
  const sessionId = resolveSessionId(positional[0]);
  if (typeof flags.turn !== 'string') {
    const n = loadRaw(sessionId);
    n.turns.forEach((t, i) => console.log(`${String(i + 1).padStart(4)}  [${t.role}] ${t.text.replace(/\s+/g, ' ').slice(0, 80)}`));
    return console.log(`\n→ mycelium clip add ${sessionId.slice(0, 8)} --turn <N> (or N-M)`);
  }
  const m = flags.turn.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return fail(USAGE);
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  const res = createClip({ sessionId, from, to, note: typeof flags.note === 'string' ? flags.note : '' });
  if (!res.ok) return fail(res.error);
  const range = from === to ? `turn ${from}` : `turns ${from}-${to}`;
  console.log(`clipped ${res.clip.id.slice(0, 8)}  ${sessionId.slice(0, 8)} ${range}  ${res.clip.folder || '_inbox'}`);
}

function listCmd(args) {
  const { flags } = parseFlags(args);
  const clips = listClips({
    folder: typeof flags.folder === 'string' ? flags.folder : undefined,
    sessionId: typeof flags.session === 'string' ? resolveSessionId(flags.session) : undefined,
  });
  if (!clips.length) return console.log('no clips');
  for (const c of clips) {
    const range = c.from === c.to ? `#${c.from}` : `#${c.from}-${c.to}`;
    console.log(`${c.id.slice(0, 8)}  ${clipFolder(c) || '_inbox'}  ${c.sessionId.slice(0, 8)} ${range}${c.note ? `  ${c.note}` : ''}`);
    console.log(`          ${clipText(c).replace(/\s+/g, ' ').slice(0, 70)}`);
  }
}

function showCmd(args) {
  if (!args[0]) return fail(USAGE);
  const found = findClip(args[0]);
  if (!found.ok) return fail(found.error);
  const c = found.clip;
  if (c.note) console.log(`# ${c.note}\n`);
  console.log(`${c.source} · ${c.sessionTitle || c.sessionId.slice(0, 8)} · ${clipFolder(c) || '_inbox'}\n`);
  console.log(clipText(c));
}

function rmCmd(args) {
  if (!args[0]) return fail(USAGE);
  const found = findClip(args[0]);
  if (!found.ok) return fail(found.error);
  const res = deleteClip(found.clip.id);
  if (!res.ok) return fail(res.error);
  console.log(`removed clip ${found.clip.id.slice(0, 8)}`);
}
