import { allRaw } from '../scanner.js';
import { firstUserText, isBacklog } from '../schema.js';
import { search, listTags } from '../index-db.js';
import { parseFlags } from './util.js';

export function searchCmd(args) {
  const { flags, positional } = parseFlags(args);
  const query = positional.join(' ');
  const tags = flags.tag ? String(flags.tag).split(',') : [];
  const results = search({ query, tags, folder: flags.folder });
  for (const s of results) {
    const folder = s.folder || '_inbox';
    console.log(`${s.id.slice(0, 8)}  [${s.kind === 'backlog' ? 'backlog' : s.source}]  ${folder}`);
    console.log(`          ${(s.title || s.preview || '').slice(0, 70)}`);
  }
  console.log(`\n${results.length} results`);
}

export function listCmd(args) {
  const { flags } = parseFlags(args);
  let raws = allRaw().sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  // _archive is hidden from the TUI by default (see tui/data.js) — this
  // is the "specific command" that still shows it: mycelium list --folder _archive
  if (flags.folder) {
    raws = raws.filter((n) => n.folder === flags.folder || (n.folder && n.folder.startsWith(flags.folder + '/')));
  } else {
    raws = raws.filter((n) => n.folder !== '_archive' && !(n.folder && n.folder.startsWith('_archive/')));
  }
  for (const n of raws) {
    const folder = n.folder || '_inbox';
    const tags = n.extracted.tags.length ? ` #${n.extracted.tags.join(' #')}` : '';
    console.log(`${n.id.slice(0, 8)}  [${isBacklog(n) ? 'backlog' : n.source}]  ${folder}${tags}`);
    // A backlog item has no turns to preview — its title IS the line.
    console.log(`          ${(isBacklog(n) ? n.extracted.title || '' : firstUserText(n)).slice(0, 70)}`);
  }
  console.log(`\n${raws.length} sessions`);
}

export function tagsCmd() {
  for (const t of listTags()) console.log(`${String(t.n).padStart(4)}  ${t.name}`);
}
