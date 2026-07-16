#!/usr/bin/env node
import { scan, allRaw } from './scanner.js';
import { firstUserText } from './schema.js';
import { reindex, search, listTags } from './index-db.js';

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  switch (cmd) {
    case 'scan': {
      const res = scan({
        onImport: (n) => console.log(`  + ${n.id.slice(0, 8)}  ${firstUserText(n).slice(0, 60)}`),
      });
      console.log(
        `scanned ${res.scanned}, imported ${res.imported}, skipped ${res.skipped}, failed ${res.failed}`,
      );
      const n = reindex();
      console.log(`reindexed ${n} sessions`);
      break;
    }
    case 'reindex': {
      const n = reindex();
      console.log(`reindexed ${n} sessions`);
      break;
    }
    case 'search': {
      const { flags, positional } = parseFlags(args);
      const query = positional.join(' ');
      const tags = flags.tag ? String(flags.tag).split(',') : [];
      const results = search({ query, tags, folder: flags.folder });
      for (const s of results) {
        const folder = s.folder || '_inbox';
        console.log(`${s.id.slice(0, 8)}  [${s.source}]  ${folder}`);
        console.log(`          ${(s.preview || '').slice(0, 70)}`);
      }
      console.log(`\n${results.length} results`);
      break;
    }
    case 'tags': {
      for (const t of listTags()) console.log(`${String(t.n).padStart(4)}  ${t.name}`);
      break;
    }
    case 'list': {
      const raws = allRaw().sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
      for (const n of raws) {
        const folder = n.folder || '_inbox';
        const tags = n.extracted.tags.length ? ` #${n.extracted.tags.join(' #')}` : '';
        console.log(`${n.id.slice(0, 8)}  [${n.source}]  ${folder}${tags}`);
        console.log(`          ${firstUserText(n).slice(0, 70)}`);
      }
      console.log(`\n${raws.length} sessions`);
      break;
    }
    default:
      console.log(`Mycelium — AI 협업 컨텍스트 라이프사이클

Usage:
  mycelium scan     세션 저장소를 스캔해 중립 스키마로 가져오기
  mycelium list     가져온 세션 목록
`);
      process.exit(cmd ? 1 : 0);
  }
}

main();
