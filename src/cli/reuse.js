import { spawn } from 'node:child_process';
import { scan, findSession } from '../scanner.js';
import { firstUserText } from '../schema.js';
import { reindex } from '../index-db.js';
import { assembleContext, injectAgentsMd, contextForSession } from '../reuse.js';
import { buildHandoff } from '../handoff.js';
import { resumeCommandLine } from '../agents.js';
import { copyToClipboard } from '../tui/clipboard.js';
import { fail, parseFlags } from './util.js';

export function contextCmd(args) {
  const { flags, positional } = parseFlags(args);
  if (positional[0]) {
    const res = contextForSession(positional[0]);
    if (!res.ok) return fail(res.error);
    console.log(res.context || '(상속할 컨텍스트 없음)');
  } else if (flags.folder) {
    console.log(assembleContext(flags.folder) || '(상속할 컨텍스트 없음)');
  } else fail('Usage: mycelium context <sessionId> | --folder <path>');
}

export function injectCmd(args) {
  const { flags } = parseFlags(args);
  const targetDir = flags.dir || process.cwd();
  const folder = flags.folder;
  if (!folder) return fail('대상 폴더를 결정할 수 없습니다 (--folder 로 지정하세요)');
  const res = injectAgentsMd(targetDir, folder);
  if (!res.ok) return fail(res.error);
  console.log(`AGENTS.md 갱신: ${res.path} (${res.folder} 지식 주입)`);
}

export function handoffCmd(args) {
  const [sessionId] = args;
  if (!sessionId) return fail('Usage: mycelium handoff <sessionId>');
  const res = buildHandoff(sessionId);
  if (!res.ok) return fail(res.error);
  console.log(res.prompt);
}

export function resumeCmd(args) {
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
}
