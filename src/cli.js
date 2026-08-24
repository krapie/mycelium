#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { scan, allRaw, findSession, reevaluateArchive } from './scanner.js';
import { firstUserText } from './schema.js';
import { reindex, search, listTags } from './index-db.js';
import {
  mkdir,
  move,
  tag,
  suggestPlacements,
  applyPlacements,
  summarizeCandidates,
  pendingSuggestions,
  queueSuggestions,
  clearSuggestions,
  classificationCandidates,
  listTreeDirs,
  unmerge,
} from './organize.js';
import { unsplit } from './split.js';
import { autoTagSession, tagAll } from './learn.js';
import { generateDigest, extractKnowledge, foldersWithSessions } from './insight.js';
import { assembleContext, injectAgentsMd, contextForSession } from './reuse.js';
import { buildHandoff } from './handoff.js';
import { resumeCommandLine } from './agents.js';
import { copyToClipboard } from './tui/clipboard.js';
import { loadConfig, saveConfig } from './config.js';
import { VERSION } from './version.js';

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
  if (cmd === '--version' || cmd === '-v' || cmd === '-V') {
    console.log(`mycelium v${VERSION}`);
    process.exit(0);
  }
  // No command (or `tui`) → launch the interactive cockpit. `--tutorial`
  // is internal — only `demo` (below) passes it, to skip straight into
  // the tutorial instead of the normal first-run yes/no prompt.
  if (!cmd || cmd === 'tui') {
    const { runTui } = await import('./tui/index.js');
    return runTui({ forceTutorial: args.includes('--tutorial') });
  }
  switch (cmd) {
    case 'scan': {
      const wasEmpty = allRaw().length === 0;
      const res = scan({
        onImport: (n) => console.log(`  + ${n.id.slice(0, 8)}  ${firstUserText(n).slice(0, 60)}`),
      });
      console.log(
        `scanned ${res.scanned}, imported ${res.imported}, skipped ${res.skipped}, failed ${res.failed}`,
      );
      const n = reindex();
      console.log(`reindexed ${n} sessions`);
      // First scan ever: capture doesn't file anything into a folder, so
      // without this a new user's next step (mycelium organize / TUI's `o`)
      // is invisible unless they already know it exists.
      if (wasEmpty && res.imported > 0) {
        console.log(
          `\n${res.imported}개 세션을 가져왔습니다. 아직 폴더가 없습니다 — ` +
            `mycelium organize 로 정리하거나, mycelium 으로 TUI를 열어 o를 눌러보세요.`,
        );
      }
      break;
    }
    case 'reindex': {
      const n = reindex();
      console.log(`reindexed ${n} sessions`);
      break;
    }
    case 'archive': {
      const { flags, positional } = parseFlags(args);
      const sub = positional[0] || 'reeval';
      if (sub !== 'reeval') {
        return fail(`알 수 없는 대상: ${sub}\n사용: mycelium archive reeval [--days N]`);
      }
      // --days, if given, persists as the new threshold before re-evaluating
      // (so the config and the actual archive state stay consistent). Omit it
      // to just re-apply whatever archiveOlderThanDays is already configured.
      let days;
      if (flags.days !== undefined && flags.days !== true) {
        days = Number(flags.days);
        if (!Number.isFinite(days)) return fail('--days 는 숫자여야 합니다');
        saveConfig({ ...loadConfig(), archiveOlderThanDays: days });
      }
      const res = reevaluateArchive({ days });
      reindex();
      const used = days ?? (Number(loadConfig().archiveOlderThanDays) || 0);
      console.log(
        `재평가 완료 (임계값 ${used}일): New로 복구 ${res.unarchived}개, 새로 archive ${res.archived}개.`,
      );
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
      // Always content-based classification; `--smart` is still accepted
      // (harmlessly ignored) for anyone with it in a saved script.
      const { flags } = parseFlags(args);
      // Reuse whatever the daemon already queued (smartOrganizeCycle in
      // daemon.js) instead of recomputing — instant when the daemon's been
      // doing the work in the background.
      let placements = pendingSuggestions({ folder: flags.folder || undefined });
      if (!placements.length) {
        // cooldownMs: 0 bypasses the daemon's "don't re-ask too soon"
        // throttle, since a human explicitly asked for this right now. Same
        // review-before-move safety net either way — nothing moves until
        // --apply.
        const limit = flags.limit ? Number(flags.limit) : 200;
        // --folder scopes to that subtree (same as `list`/`search --folder`);
        // omitted means the whole store, matching this command's existing
        // default. There's no CLI equivalent of the TUI's "Root" yet — pass
        // a real folder to narrow.
        const folder = flags.folder || undefined;
        const pending = classificationCandidates({ cooldownMs: 0, folder }).filter((n) => !n.extracted.summary).length;
        if (pending) console.log(`summarizing ${pending} session(s) first…`);
        await summarizeCandidates({
          folder,
          onProgress: (s, err) => {
            if (err) console.log(`  ! ${err.message}`);
            else console.log(`  + ${s.id.slice(0, 8)}`);
          },
        });
        reindex();
        console.log('classifying…');
        const res = await suggestPlacements({
          cooldownMs: 0,
          folder,
          limit,
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
      const existingDirs = new Set(listTreeDirs());
      for (const p of placements) {
        const badge = p.folder && !existingDirs.has(p.folder) ? ' (new folder)' : '';
        console.log(`${p.id.slice(0, 8)}  → ${p.folder || '(no match, stays in _inbox)'}${badge}${p.reason ? `  — ${p.reason}` : ''}`);
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
      } else fail('Usage: mycelium context <sessionId> | --folder <path>');
      break;
    }
    case 'inject': {
      const { flags } = parseFlags(args);
      const targetDir = flags.dir || process.cwd();
      const folder = flags.folder;
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
      // A merge/split product's id isn't a real agent-native session id —
      // --resume <id> would fail once actually run. Point at handoff, the
      // only thing that can actually continue one (see the TUI's `r` on a
      // merge/split session, which does this same redirect automatically).
      if (session.mergedFrom?.length || session.splitFrom) {
        return fail(`${idOrPrefix}: merged/split session — not resumable. Use: mycelium handoff ${session.id}`);
      }

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
    case 'demo': {
      // Runs the tutorial against a completely separate store — never the
      // real ~/.mycelium — so it's safe to fire in the middle of a live
      // demo without exposing personal projects. Only child_process.spawn()
      // guarantees this: MYCELIUM_HOME is read once, at module load, by
      // paths.js, and this file's own imports (already evaluated by the
      // time this line runs) are far too late to change that for THIS
      // process — same reasoning as daemon.js's spawnDetachedDaemon().
      const { join } = await import('node:path');
      const { homedir } = await import('node:os');
      const { existsSync, rmSync } = await import('node:fs');
      const demoHome = join(homedir(), '.mycelium-demo');
      if (existsSync(demoHome)) rmSync(demoHome, { recursive: true, force: true });
      // Fired off now, awaited (if needed at all) only much later in the
      // handoff branch below — the tutorial itself takes at least tens of
      // seconds of real interaction, plenty of time for this to fully
      // resolve in the background. tui/index.js transitively pulls in
      // nearly the whole app (app.js/neo-blessed, sessions.js and
      // everything IT imports) — all cold, since only the CHILD process
      // below has loaded any of it so far. Without this, that whole load
      // happened serially, visibly, in the gap between the child exiting
      // and the real screen painting — see cli.js's own handoff comment
      // and i18n.js's demo.handoffTransition for the rest of that fix. A
      // presenter who never finishes the tutorial (no handoff) just never
      // awaits this — the resolved module sits unused, harmless.
      const tuiIndexPromise = import('./tui/index.js');
      const child = spawn(process.execPath, [process.argv[1], 'tui', '--tutorial'], {
        // MYCELIUM_DEMO_MODE: scanner.js's own guard against pulling real
        // session content into this throwaway store — see its comment.
        env: { ...process.env, MYCELIUM_HOME: demoHome, MYCELIUM_DEMO_MODE: '1' },
        stdio: 'inherit',
      });
      return new Promise((resolve) => {
        child.on('exit', async (code) => {
          const { DEMO_HANDOFF_EXIT_CODE } = await import('./tui/tutorial.js');
          if (code === DEMO_HANDOFF_EXIT_CODE) {
            // Actively discard stdin for the duration of this handoff.
            // Confirmed via a disposable VHS debug tape (not committed —
            // see this session's history) that an impatient repeat `q`
            // right after the first genuinely leaks through: the child's
            // screen.destroy() (app.js, called by its own quit()) restores
            // cooked mode before this exit handler runs, so a keystroke
            // typed in the gap sits in the terminal's normal input queue
            // until SOMETHING reads it — and once the real TUI's own
            // raw-mode reader starts below, that stale keystroke arrives
            // indistinguishable from a live press, landing on whatever's
            // focused (observed: it closed firstScanModal() AND armed
            // app.js's quit-confirm in the same event, both being
            // independent listeners on the same keypress — one more stray
            // `q` from there would have actually exited the just-launched
            // real session). Resuming then immediately dropping the
            // listener flips the stream back to blessed's expected paused
            // starting state (Node auto-pauses a readable once its last
            // 'data' listener is removed) — createApp() (inside runTui()
            // below) sets up its own raw-mode reading same as always.
            //
            // The short wait below is deliberate, not decorative: a first
            // attempt without it still let the stray keystroke through
            // (confirmed by re-running the same VHS tape) — resume() asks
            // Node to read the fd, but that read isn't synchronous with the
            // call, and the async work following used to finish (now that
            // it's pre-warmed) before the OS had actually delivered the
            // buffered byte into this listener. 120ms is well inside what a
            // human "impatient repeat press" already takes to physically
            // happen, and imperceptible against the handoff's overall
            // duration.
            const discardStdin = () => {};
            if (process.stdin.isTTY) {
              process.stdin.resume();
              process.stdin.on('data', discardStdin);
              await new Promise((r) => setTimeout(r, 120));
            }
            // The presenter went all the way through the tutorial (not an
            // early Esc bail) — hand off straight into a real TUI session.
            // This process's own env was never touched (only the CHILD's
            // env got the MYCELIUM_HOME override above), so paths.js
            // resolves the user's actual ~/.mycelium here, not the demo
            // store — no separate spawn needed, just run it in-process.
            //
            // Carry the language picked during the demo into the real tool
            // too, but ONLY here, on a full-completion handoff — continuing
            // straight into real data in the same terminal right after
            // finishing the demo should feel seamless, not switch back to
            // whatever language was set before. An early Esc bail (no
            // handoff, separate branch below) deliberately does NOT do
            // this: exploring a different language just to preview/present
            // the demo shouldn't silently change real settings unless you
            // actually continue into real data right after. Read straight
            // off the demo's own config.json (still on disk — only wiped at
            // the START of a future `mycelium demo` run, not on exit),
            // since loadConfig()/i18n.js's getLocale() in this process
            // resolve against THIS process's own real MYCELIUM_HOME, not
            // the child's isolated one.
            try {
              const demoConfigPath = join(demoHome, 'config.json');
              if (existsSync(demoConfigPath)) {
                const demoCfg = JSON.parse(readFileSync(demoConfigPath, 'utf8'));
                if (demoCfg.locale) {
                  const { setLocale } = await import('./tui/i18n.js');
                  setLocale(demoCfg.locale);
                }
              }
            } catch {
              // Best-effort — a missing/malformed demo config just means
              // the real tool keeps whatever language it already had, not
              // a hard failure blocking the handoff itself.
            }
            // Printed immediately, in whatever locale was just set above,
            // before any of the (usually fast now, thanks to the pre-warmed
            // import above, but not guaranteed on a slower machine) real-TUI
            // mount work below. screen.destroy() (app.js, called by the
            // child's own quit()) already restored the terminal to normal/
            // cooked mode before this process's exit handler even ran, so a
            // plain console.log() here is safe — nothing blessed-related is
            // mounted yet to corrupt. Without this, a silent gap here read
            // as "did that even do anything?" — enough that a user might
            // press q again, which (once the real screen DOES mount and
            // starts reading input) risks landing on the just-launched real
            // session's own quit-confirm instead of a no-op.
            const { t } = await import('./tui/i18n.js');
            console.log(t('demo.handoffTransition'));
            // A real bug found in production: on a real ~/.mycelium that's
            // ALSO never been onboarded yet (a brand new install, or one
            // where the user tried `mycelium demo` before ever running plain
            // `mycelium`), runTui() below would immediately show its OWN
            // first-run onboarding prompt — language picker, "want a tour?",
            // persona picker — right on top of the demo the human just
            // finished. Someone who just sat through the interactive
            // tutorial does not expect an equivalent second one a moment
            // later; it read as the demo breaking/restarting rather than
            // handing off. Mark the real store onboarded here, same as
            // finishing (or declining) the real tutorial already does —
            // this handoff only ever happens after a FULL completion
            // (DEMO_HANDOFF_EXIT_CODE, not an early Esc bail), so treating
            // it as equivalent real onboarding is exactly right, not a
            // shortcut around it.
            saveConfig({ ...loadConfig(), onboarded: true });
            // Awaits the SAME promise kicked off right after spawning the
            // child above — already resolved (or resolving) by now, so this
            // is near-instant instead of paying the full cold-import cost
            // here in the visible gap.
            const { runTui } = await tuiIndexPromise;
            if (process.stdin.isTTY) {
              process.stdin.removeListener('data', discardStdin);
              process.stdin.pause();
            }
            await runTui();
          } else {
            process.exitCode = code ?? 0;
          }
          resolve();
        });
      });
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

Capture   scan                          세션 저장소 스캔 → 중립 스키마 (오래된 세션은 첫 캡처 시 _archive로, 나머지는 미분류로 시작)
          archive reeval [--days N]     현재/지정 임계값으로 auto-archive 재평가 (New↔_archive 복구/이동). --days는 기본값도 갱신
Organize  organize [--apply] [--limit N] [--folder <경로>]   내용 기반 폴더 제안(요약 먼저 채움) — --folder로 특정 폴더(하위 포함)만 좁히기, --apply 전엔 미리보기만
          mkdir <folder>                폴더 생성
          mv <session> <folder>         세션 수동 이동
          tag <session> +t -t           태그 수동 편집
          unmerge <session>              TUI Shift+M 병합 되돌리기 (원본 세션들 복원)
          unsplit <session>              TUI Shift+S 분할 되돌리기 (분할 조각 제거, 원본 복원)
Learn     autotag [<session>] [--force] 내용 기반 자동 태깅 (소급 일괄)
          digest [week] [--date D]      일일/주간 서사 다이제스트
          knowledge [<folder>]          폴더별 KNOWLEDGE.md 추출
Reuse     context <session>|--folder    조상 경로 컨텍스트 출력
          inject [--dir D] --folder F   AGENTS.md에 지식 주입
          handoff <session>            다른 에이전트용 인수인계 프롬프트
          resume <session|prefix> [--copy|--exec]  이어열기 명령어 출력(새 탭 붙여넣기용) / 클립보드 복사 / 즉시 실행
Find      search <q> [--tag t] [--folder f]
          list [--folder f] / tags     (_archive는 기본 숨김 — list --folder _archive)
Run       (인자 없음) 또는 tui          인터랙티브 TUI (콕핏) — 켜져 있는 동안 스캔·정리·다이제스트를 자체적으로 수행
          daemon                        (선택) TUI 없이 백그라운드 업킵만 필요할 때 (포그라운드로 실행)
          daemon --detach / --stop      (선택) TUI가 꺼져 있을 때도 계속 돌리고 싶으면 — 분리 실행 / 정지 (scripts/run.sh·stop.sh와 동일)
          demo                          가짜 세션으로 인터랙티브 튜토리얼 실행(별도 스토어, 실제 데이터 안 건드림) — 3분 데모용
          lang [en|ko]                  TUI 표시 언어 설정/확인 (기본 en)
Clean     cleanup [tidy]                메타세션 제거 + 빈 폴더 정리 + 인덱스 재생성
          cleanup folders|archive|index 부분 정리
          cleanup reset --yes           전체 데이터(~/.mycelium) 초기화
Other     --version / -v / -V           설치된 버전 출력
`);
      process.exit(cmd ? 1 : 0);
  }
}

main();
