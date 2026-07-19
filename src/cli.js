#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { scan, allRaw } from './scanner.js';
import { firstUserText } from './schema.js';
import { reindex, search, listTags } from './index-db.js';
import { mkdir, move, tag, autoOrganize, addRule } from './organize.js';
import { autoTagSession, tagAll } from './learn.js';
import { generateDigest, extractKnowledge, foldersWithSessions } from './insight.js';
import { assembleContext, folderForCwd, injectAgentsMd, contextForSession } from './reuse.js';
import { buildHandoff } from './handoff.js';

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
  // No command (or `tui`) → launch the interactive cockpit.
  if (!cmd || cmd === 'tui') {
    const { runTui } = await import('./tui/index.js');
    return runTui();
  }
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
    case 'cleanup': {
      const { flags, positional } = parseFlags(args);
      const { tidy, pruneEmptyFolders, clearArchive, rebuildIndex, resetStore } = await import('./cleanup.js');
      const target = positional[0] || 'tidy';
      switch (target) {
        case 'tidy': {
          const r = tidy();
          console.log(`정리 완료: 메타세션 ${r.meta}개 제거, 빈 폴더 ${r.folders}개 제거, 인덱스 ${r.indexed}개 재생성`);
          break;
        }
        case 'folders':
          console.log(`빈 폴더 ${pruneEmptyFolders()}개 제거`);
          rebuildIndex();
          break;
        case 'archive':
          console.log(`_archive 세션 ${clearArchive()}개 삭제`);
          rebuildIndex();
          break;
        case 'index':
          console.log(`인덱스 ${rebuildIndex()}개 재생성`);
          break;
        case 'reset':
          if (!flags.yes) {
            return fail('전체 데이터(~/.mycelium)를 삭제합니다. 확실하면: mycelium cleanup reset --yes');
          }
          console.log(`전체 초기화 완료: ${resetStore()} (다시 mycelium scan 하세요)`);
          break;
        default:
          return fail(`알 수 없는 대상: ${target}\n사용: mycelium cleanup [tidy|folders|archive|index|reset --yes]`);
      }
      break;
    }
    case 'handoff': {
      const [sessionId] = args;
      if (!sessionId) return fail('Usage: mycelium handoff <sessionId>');
      const res = buildHandoff(sessionId);
      if (!res.ok) return fail(res.error);
      console.log(res.prompt);
      break;
    }
    case 'daemon': {
      const { runDaemon } = await import('./daemon.js');
      await runDaemon();
      break;
    }
    default:
      console.log(`Mycelium — AI 협업 컨텍스트 라이프사이클

Capture   scan                          세션 저장소 스캔 → 중립 스키마
Organize  organize                      cwd 기반 자동 배치 (사람 결정은 보존)
          mkdir <folder>                폴더 생성
          mv <session> <folder>         세션 수동 이동
          tag <session> +t -t           태그 수동 편집
          rule <cwd-prefix> <folder>    cwd→폴더 자동배치 규칙
Learn     autotag [<session>] [--force] 내용 기반 자동 태깅 (소급 일괄)
          digest [week] [--date D]      일일/주간 서사 다이제스트
          knowledge [<folder>]          폴더별 KNOWLEDGE.md 추출
Reuse     context <session>|--folder|--cwd   조상 경로 컨텍스트 출력
          inject [--dir D] [--folder F] AGENTS.md에 지식 주입
          handoff <session>            다른 에이전트용 인수인계 프롬프트
Find      search <q> [--tag t] [--folder f]
          list [--folder f] / tags     (_archive는 기본 숨김 — list --folder _archive)
Run       (인자 없음) 또는 tui          인터랙티브 TUI (콕핏)
          daemon                        백그라운드 스캔 폴링 + 다이제스트
Clean     cleanup [tidy]                메타세션 제거 + 빈 폴더 정리 + 인덱스 재생성
          cleanup folders|archive|index 부분 정리
          cleanup reset --yes           전체 데이터(~/.mycelium) 초기화
`);
      process.exit(cmd ? 1 : 0);
  }
}

main();
