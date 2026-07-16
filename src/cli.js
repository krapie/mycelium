#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { scan, allRaw } from './scanner.js';
import { firstUserText } from './schema.js';
import { reindex, search, listTags } from './index-db.js';
import { mkdir, move, tag, autoOrganize, addRule } from './organize.js';
import { autoTagSession, tagAll } from './learn.js';
import { generateDigest, extractKnowledge, foldersWithSessions } from './insight.js';
import { assembleContext, folderForCwd, injectAgentsMd, contextForSession } from './reuse.js';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function fmtTags(tags) {
  return tags && tags.length ? '#' + tags.join(' #') : '(no tags)';
}

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
    case 'organize': {
      const res = autoOrganize();
      reindex();
      console.log(`auto-placed ${res.placed}, kept ${res.skippedHuman} human-organized sessions untouched`);
      break;
    }
    case 'mkdir': {
      const [folder] = args;
      if (!folder) return fail('Usage: mycelium mkdir <folder-path>');
      console.log(`created ${mkdir(folder)}`);
      break;
    }
    case 'mv': {
      const [sessionId, folder] = args;
      if (!sessionId) return fail('Usage: mycelium mv <sessionId> <folder-path>');
      const res = move(sessionId, folder || null);
      if (!res.ok) return fail(res.error);
      reindex();
      console.log(`moved ${sessionId.slice(0, 8)} → ${res.session.folder || '_inbox'} (human)`);
      break;
    }
    case 'tag': {
      const [sessionId, ...rest] = args;
      if (!sessionId) return fail('Usage: mycelium tag <sessionId> +tag -tag');
      const add = rest.filter((t) => t.startsWith('+')).map((t) => t.slice(1));
      const remove = rest.filter((t) => t.startsWith('-')).map((t) => t.slice(1));
      const res = tag(sessionId, add, remove);
      if (!res.ok) return fail(res.error);
      reindex();
      console.log(`${sessionId.slice(0, 8)} tags: ${res.session.extracted.tags.join(', ') || '(none)'} (human)`);
      break;
    }
    case 'rule': {
      const [prefix, folder] = args;
      if (!prefix || !folder) return fail('Usage: mycelium rule <cwd-prefix> <folder-path>');
      addRule(prefix, folder);
      console.log(`rule added: ${prefix} → ${folder}`);
      break;
    }
    case 'autotag': {
      const { flags, positional } = parseFlags(args);
      if (positional[0]) {
        const res = await autoTagSession(positional[0]);
        if (!res.ok) return fail(res.error);
        console.log(`${positional[0].slice(0, 8)}  ${fmtTags(res.session.extracted.tags)}`);
        console.log(`  ${res.session.extracted.summary || ''}`);
      } else {
        const res = await tagAll({
          force: !!flags.force,
          onProgress: (s, err) => {
            if (err) console.log(`  ! ${err.message}`);
            else console.log(`  + ${s.id.slice(0, 8)}  ${fmtTags(s.extracted.tags)}`);
          },
        });
        console.log(`tagged ${res.tagged}, skipped ${res.skipped}, failed ${res.failed}`);
      }
      reindex();
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
    case 'digest': {
      const { flags, positional } = parseFlags(args);
      const period = positional[0] === 'week' ? 'week' : 'day';
      const res = await generateDigest({ period, date: flags.date });
      if (!res.ok) return fail(res.error);
      console.log(`${res.keyed} 다이제스트 생성 (${res.count} 세션) → ${res.path}`);
      console.log('');
      console.log(readFileSync(res.path, 'utf8'));
      break;
    }
    case 'knowledge': {
      const [folder] = args;
      if (folder) {
        const res = await extractKnowledge(folder);
        if (!res.ok) return fail(res.error);
        console.log(`${res.folder} KNOWLEDGE.md 생성 (${res.count} 세션) → ${res.path}`);
      } else {
        for (const f of foldersWithSessions()) {
          const res = await extractKnowledge(f);
          console.log(res.ok ? `  + ${f} (${res.count})` : `  ! ${f}: ${res.error}`);
        }
      }
      break;
    }
    case 'context': {
      const { flags, positional } = parseFlags(args);
      if (positional[0]) {
        const res = contextForSession(positional[0]);
        if (!res.ok) return fail(res.error);
        console.log(res.context || '(상속할 컨텍스트 없음)');
      } else if (flags.folder) {
        console.log(assembleContext(flags.folder) || '(상속할 컨텍스트 없음)');
      } else if (flags.cwd) {
        console.log(assembleContext(folderForCwd(flags.cwd)) || '(상속할 컨텍스트 없음)');
      } else fail('Usage: mycelium context <sessionId> | --folder <path> | --cwd <dir>');
      break;
    }
    case 'inject': {
      const { flags } = parseFlags(args);
      const targetDir = flags.dir || process.cwd();
      const folder = flags.folder || folderForCwd(targetDir);
      if (!folder) return fail('대상 폴더를 결정할 수 없습니다 (--folder 로 지정하세요)');
      const res = injectAgentsMd(targetDir, folder);
      if (!res.ok) return fail(res.error);
      console.log(`AGENTS.md 갱신: ${res.path} (${res.folder} 지식 주입)`);
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
