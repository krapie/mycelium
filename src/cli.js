#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { scan, allRaw, findSession } from './scanner.js';
import { firstUserText } from './schema.js';
import { reindex, search, listTags } from './index-db.js';
import {
  mkdir,
  move,
  tag,
  autoOrganize,
  addRule,
  suggestPlacements,
  applyPlacements,
  summarizeCandidates,
  pendingSuggestions,
  queueSuggestions,
  clearSuggestions,
  unmerge,
} from './organize.js';
import { unsplit } from './split.js';
import { autoTagSession, tagAll } from './learn.js';
import { generateDigest, extractKnowledge, foldersWithSessions } from './insight.js';
import { assembleContext, folderForCwd, injectAgentsMd, contextForSession } from './reuse.js';
import { buildHandoff } from './handoff.js';
import { resumeCommandLine } from './agents.js';
import { copyToClipboard } from './tui/clipboard.js';

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
      const { flags } = parseFlags(args);
      if (!flags.smart) {
        const res = autoOrganize();
        reindex();
        console.log(`auto-placed ${res.placed}, kept ${res.skippedHuman} human-organized sessions untouched`);
        break;
      }
      // Reuse whatever the daemon already queued (smartOrganizeCycle in
      // daemon.js) instead of recomputing — instant when the daemon's been
      // doing the work in the background.
      let placements = pendingSuggestions();
      if (!placements.length) {
        // Only summarizes the sessions actually being classified below
        // (still unorganized) — not the whole store's summary backlog,
        // which is `autotag`'s job. Bounded-concurrency (see organize.js),
        // but can still take a while with a real backlog, so report
        // progress rather than going silent.
        const pending = allRaw().filter((n) => !n.folder && n.organizedBy !== 'human' && !n.extracted.summary).length;
        if (pending) console.log(`summarizing ${pending} session(s) first…`);
        await summarizeCandidates({
          onProgress: (s, err) => {
            if (err) console.log(`  ! ${err.message}`);
            else console.log(`  + ${s.id.slice(0, 8)}`);
          },
        });
        reindex();
        console.log('classifying…');
        const res = await suggestPlacements({
          onProgress: (batch, total) => total > 1 && console.log(`  batch ${batch}/${total}`),
        });
        if (!res.ok) return fail(res.error);
        if (!res.placements.length) {
          console.log('no confident placements found');
          break;
        }
        placements = res.placements;
        queueSuggestions(placements); // persists even if this run doesn't --apply
      }
      for (const p of placements) {
        console.log(`${p.id.slice(0, 8)}  → ${p.folder || '(no match, stays in _inbox)'}${p.reason ? `  — ${p.reason}` : ''}`);
      }
      if (flags.apply) {
        const applied = applyPlacements(placements);
        clearSuggestions(placements.map((p) => p.id));
        reindex();
        console.log(`\napplied ${applied} placements`);
      } else {
        const matched = placements.filter((p) => p.folder).length;
        console.log(`\n${matched} suggested — re-run with --apply to file them`);
      }
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
    case 'resume': {
      const { flags, positional } = parseFlags(args);
      const idOrPrefix = positional[0];
      if (!idOrPrefix) return fail('Usage: mycelium resume <sessionId|prefix> [--copy] [--exec]');
      const found = findSession(idOrPrefix);
      if (!found.ok) return fail(found.error);
      const { session } = found;

      const cmd = resumeCommandLine(session);
      if (!cmd.ok) return fail(cmd.error);

      if (flags.exec) {
        const child = spawn(cmd.bin, cmd.args, { cwd: cmd.cwd, stdio: 'inherit' });
        child.on('exit', (code) => {
          try {
            scan();
            reindex();
          } catch {
            /* ignore */
          }
          process.exit(code ?? 0);
        });
        return; // async exit above — don't fall through to main()'s implicit end
      }

      const folder = session.folder || '_inbox';
      console.error(`${session.id.slice(0, 8)}  [${session.source}]  ${folder}`);
      console.error(`          ${firstUserText(session).slice(0, 70)}`);
      console.log(cmd.line);

      if (flags.copy) {
        if (!copyToClipboard(cmd.line)) console.error('copy failed (no clipboard tool found)');
      }
      break;
    }
    case 'unmerge': {
      const { positional } = parseFlags(args);
      const idOrPrefix = positional[0];
      if (!idOrPrefix) return fail('Usage: mycelium unmerge <sessionId|prefix>');
      const found = findSession(idOrPrefix);
      if (!found.ok) return fail(found.error);
      const res = unmerge(found.session.id);
      if (!res.ok) return fail(res.error);
      reindex();
      console.log(`unmerged — restored ${res.restored.length} original session(s)`);
      break;
    }
    case 'unsplit': {
      const { positional } = parseFlags(args);
      const idOrPrefix = positional[0];
      if (!idOrPrefix) return fail('Usage: mycelium unsplit <sessionId|prefix>');
      const found = findSession(idOrPrefix);
      if (!found.ok) return fail(found.error);
      const res = unsplit(found.session.id);
      if (!res.ok) return fail(res.error);
      reindex();
      console.log(`unsplit — removed ${res.removed.length} split piece(s)`);
      break;
    }
    case 'daemon': {
      const { flags } = parseFlags(args);
      if (flags.stop) {
        const { stopDetachedDaemon } = await import('./daemon.js');
        const res = stopDetachedDaemon();
        console.log(res.stopped ? `daemon stopped (pid ${res.pid})` : 'daemon is not running');
        break;
      }
      if (flags.detach) {
        const { spawnDetachedDaemon } = await import('./daemon.js');
        const res = spawnDetachedDaemon();
        console.log(res.started ? `daemon started (pid ${res.pid})` : `daemon already running (pid ${res.pid})`);
        break;
      }
      const { runDaemon } = await import('./daemon.js');
      await runDaemon();
      break;
    }
    case 'lang': {
      const { getLocale, setLocale } = await import('./tui/i18n.js');
      const [locale] = args;
      if (!locale) {
        console.log(`current: ${getLocale()}`);
        break;
      }
      if (locale !== 'en' && locale !== 'ko') return fail("Usage: mycelium lang <en|ko>");
      setLocale(locale);
      console.log(`language set to ${locale} (applies to the TUI on next launch)`);
      break;
    }
    default:
      console.log(`Mycelium — AI 협업 컨텍스트 라이프사이클

Capture   scan                          세션 저장소 스캔 → 중립 스키마
Organize  organize                      cwd 기반 자동 배치 (사람 결정은 보존)
          organize --smart [--apply]    내용 기반 폴더 제안 (요약 먼저 채움, --apply 전엔 미리보기만)
          mkdir <folder>                폴더 생성
          mv <session> <folder>         세션 수동 이동
          tag <session> +t -t           태그 수동 편집
          rule <cwd-prefix> <folder>    cwd→폴더 자동배치 규칙
          unmerge <session>              TUI Shift+M 병합 되돌리기 (원본 세션들 복원)
          unsplit <session>              TUI Shift+S 분할 되돌리기 (분할 조각 제거, 원본 복원)
Learn     autotag [<session>] [--force] 내용 기반 자동 태깅 (소급 일괄)
          digest [week] [--date D]      일일/주간 서사 다이제스트
          knowledge [<folder>]          폴더별 KNOWLEDGE.md 추출
Reuse     context <session>|--folder|--cwd   조상 경로 컨텍스트 출력
          inject [--dir D] [--folder F] AGENTS.md에 지식 주입
          handoff <session>            다른 에이전트용 인수인계 프롬프트
          resume <session|prefix> [--copy|--exec]  이어열기 명령어 출력(새 탭 붙여넣기용) / 클립보드 복사 / 즉시 실행
Find      search <q> [--tag t] [--folder f]
          list [--folder f] / tags     (_archive는 기본 숨김 — list --folder _archive)
Run       (인자 없음) 또는 tui          인터랙티브 TUI (콕핏) — 켜져 있는 동안 스캔·정리·다이제스트를 자체적으로 수행
          daemon                        (선택) TUI 없이 백그라운드 업킵만 필요할 때 (포그라운드로 실행)
          daemon --detach / --stop      (선택) TUI가 꺼져 있을 때도 계속 돌리고 싶으면 — 분리 실행 / 정지 (scripts/run.sh·stop.sh와 동일)
          lang [en|ko]                  TUI 표시 언어 설정/확인 (기본 en)
Clean     cleanup [tidy]                메타세션 제거 + 빈 폴더 정리 + 인덱스 재생성
          cleanup folders|archive|index 부분 정리
          cleanup reset --yes           전체 데이터(~/.mycelium) 초기화
`);
      process.exit(cmd ? 1 : 0);
  }
}

main();
