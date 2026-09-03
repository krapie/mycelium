import { createBacklog, listBacklog, buildBacklogSeed, markBacklogEntered } from '../backlog.js';
import { isBacklog } from '../schema.js';
import { findSession } from '../scanner.js';
import { reindexOne } from '../index-db.js';
import { AGENTS, which, newCommandLine } from '../agents.js';
import { dirsForFolder, injectAgentsMd } from '../reuse.js';
import { copyToClipboard } from '../tui/clipboard.js';
import { fail, parseFlags } from './util.js';

const USAGE =
  'Usage: mycelium backlog add "<title>" [--desc "..."] [--folder f] | list [--folder f] | open <id|prefix> [--agent a] [--dir D] [--copy]';

export function backlogCmd(args) {
  const [sub, ...rest] = args;
  if (!sub || sub === 'list') return listBacklogCmd(rest);
  if (sub === 'add') return addCmd(rest);
  if (sub === 'open') return openCmd(rest);
  return fail(USAGE);
}

function addCmd(args) {
  const { flags, positional } = parseFlags(args);
  const title = positional.join(' ').trim();
  if (!title) return fail(USAGE);
  const res = createBacklog({
    title,
    description: typeof flags.desc === 'string' ? flags.desc : '',
    folder: typeof flags.folder === 'string' ? flags.folder : null,
  });
  if (!res.ok) return fail(res.error);
  reindexOne(res.session);
  console.log(`백로그 추가: ${res.session.id.slice(0, 8)}  ${res.session.folder || '_inbox'}  ${title}`);
}

function listBacklogCmd(args) {
  const { flags } = parseFlags(args);
  const items = listBacklog({ folder: typeof flags.folder === 'string' ? flags.folder : undefined });
  if (!items.length) return console.log('백로그 없음');
  for (const n of items) {
    const mark = n.doneAt ? ' (시작함)' : '';
    console.log(`${n.id.slice(0, 8)}  ${n.folder || '_inbox'}  ${n.extracted.title}${mark}`);
    if (n.extracted.summary) console.log(`          ${n.extracted.summary.replace(/\s+/g, ' ').slice(0, 70)}`);
  }
}

/**
 * Print the `cd <dir> && <bin> <args>` line that starts this backlog item —
 * the CLI's equivalent of the TUI's "copy command" path, since there's no
 * picker here to choose an agent/directory interactively.
 *
 * The item stays listed, marked as started, until the session actually shows
 * up: scanner.js recognizes it by the marker this seed carries and replaces
 * the item with it on the next scan, whichever terminal it was run in.
 */
function openCmd(args) {
  const { flags, positional } = parseFlags(args);
  const idOrPrefix = positional[0];
  if (!idOrPrefix) return fail(USAGE);
  const found = findSession(idOrPrefix);
  if (!found.ok) return fail(found.error);
  const { session } = found;
  if (!isBacklog(session)) return fail(`${idOrPrefix}: 백로그 항목이 아닙니다 (mycelium resume 를 쓰세요)`);

  const agentKey = typeof flags.agent === 'string' ? flags.agent : Object.keys(AGENTS).find((k) => which(AGENTS[k].bin));
  if (!agentKey) return fail('설치된 에이전트 CLI가 없습니다');
  const dir = (typeof flags.dir === 'string' && flags.dir) || dirsForFolder(session.folder)[0] || process.cwd();

  const seed = buildBacklogSeed(session.id);
  if (!seed.ok) return fail(seed.error);
  // Same knowledge injection the TUI does before handing a directory to an
  // agent — the point of filing a backlog item in a folder is that the
  // session it starts inherits that folder's KNOWLEDGE.md.
  if (session.folder) {
    try {
      injectAgentsMd(dir, session.folder);
    } catch {
      /* no KNOWLEDGE yet — fine, agent just starts fresh */
    }
  }
  const cmd = newCommandLine({ agentKey, dir, seed: seed.prompt });
  if (!cmd.ok) return fail(cmd.error);

  const marked = markBacklogEntered(session.id);
  if (marked.ok) reindexOne(marked.session);

  console.error(`${session.id.slice(0, 8)}  [backlog]  ${session.folder || '_inbox'}`);
  console.error(`          ${session.extracted.title}`);
  console.log(cmd.line);
  if (flags.copy && !copyToClipboard(cmd.line)) console.error('copy failed (no clipboard tool found)');
}
