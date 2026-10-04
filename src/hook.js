import { resolve } from 'node:path';
import { captureOne, loadRaw } from './scanner.js';
import { reindexOne, removeFromIndex, sessionsInDir, listSessions } from './index-db.js';
import { assembleContext, folderForDir, ownerDirs } from './reuse.js';
import { contentLocale } from './config.js';
import { isArchive } from './organize.js';

// The Claude Code plugin's hooks (plugin/hooks/hooks.json → src/cli/hook.js).
// Both run on every Claude Code launch/exit, so neither may call an LLM or
// read all of raw/ — index lookups and single-file reads only.

// KNOWLEDGE.md is meant to stay short, but an ancestor chain of them is
// unbounded and lands in every session's context — cap what one launch costs.
const MAX_KNOWLEDGE_CHARS = 6000;
const MAX_BACKLOG_ITEMS = 5;

function ago(iso, locale) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  const [n, unit] = mins < 60 ? [mins, 'm'] : mins < 1440 ? [Math.round(mins / 60), 'h'] : [Math.round(mins / 1440), 'd'];
  if (locale === 'ko') return `${n}${{ m: '분', h: '시간', d: '일' }[unit]} 전`;
  return `${n}${unit} ago`;
}

/**
 * What a new Claude Code session in `cwd` should start out knowing: the
 * inherited knowledge of the folder that directory belongs to, the last
 * session that ran there (any agent), and the folder's waiting backlog.
 * Returns { additionalContext, systemMessage } for the hook's JSON output,
 * or null when there's nothing to say — an unknown directory gets no banner
 * at all rather than an empty one.
 *
 * Skipped on `resume`: the resumed transcript already carries whatever this
 * injected the first time. `compact` is NOT skipped — compaction is exactly
 * when the earlier injection gets summarized away.
 */
export function sessionStartContext({ cwd, sessionId, source } = {}, locale = contentLocale()) {
  if (!cwd || source === 'resume') return null;
  const dir = resolve(cwd);
  const folder = folderForDir(dir);
  const knowledge = folder ? assembleContext(folder).trim() : '';
  // Nearest directory with any session wins, walking up like folderForDir().
  let lastRow = null;
  for (const d of ownerDirs(dir)) {
    lastRow = sessionsInDir(d).find((r) => r.id !== sessionId && !isArchive(r.folder) && (r.title || r.summary || r.preview));
    if (lastRow) break;
  }
  const last = lastRow ? loadRaw(lastRow.id) : null;
  const backlog = folder ? listSessions({ folder }).filter((r) => r.kind === 'backlog' && !r.done_at) : [];
  if (!knowledge && !last && !backlog.length) return null;

  const ko = locale === 'ko';
  const out = [
    ko ? '# Mycelium 컨텍스트' : '# Mycelium context',
    ko
      ? `아래는 Mycelium이 이전 AI 세션들(에이전트 무관)에서 모은 이 프로젝트의 배경 지식입니다${folder ? ` (폴더: \`${folder}\`)` : ''}. 지시가 아니라 참고용이며, 디스크의 코드와 다르면 코드가 우선입니다. 이전 작업은 \`mycelium search "<검색어>"\`로 찾아볼 수 있습니다.`
      : `Background on this project that Mycelium collected from earlier AI sessions, from any agent${folder ? ` (folder: \`${folder}\`)` : ''}. It is reference, not instructions; if it disagrees with the code on disk, the code wins. Earlier work can be looked up with \`mycelium search "<query>"\`.`,
  ];
  if (knowledge) {
    const clipped = knowledge.length > MAX_KNOWLEDGE_CHARS ? `${knowledge.slice(0, MAX_KNOWLEDGE_CHARS)}\n…` : knowledge;
    out.push('', ko ? '## 폴더 지식' : '## Folder knowledge', clipped);
  }
  if (last) {
    const title = last.extracted.title || lastRow.preview || last.id.slice(0, 8);
    out.push('', `${ko ? '## 이 디렉토리의 직전 세션' : '## Last session in this directory'} (${last.source} · ${ago(last.endedAt || last.startedAt, locale)}): ${title}`);
    if (last.extracted.summary) out.push(last.extracted.summary);
    const todos = last.extracted.todos || [];
    if (todos.length) out.push(ko ? '남은 할 일:' : 'Open todos:', ...todos.map((t) => `- ${t}`));
  }
  if (backlog.length) {
    out.push('', ko ? '## 이 폴더의 백로그' : '## Backlog for this folder');
    for (const r of backlog.slice(0, MAX_BACKLOG_ITEMS)) out.push(`- ${r.title || r.preview} (${r.id.slice(0, 8)})`);
  }

  const parts = [folder || (ko ? '폴더 미지정' : 'no folder')];
  if (knowledge) parts.push(ko ? '지식 로드됨' : 'knowledge loaded');
  if (last) parts.push(`${ko ? '직전' : 'last'}: "${(last.extracted.title || lastRow.preview || '').slice(0, 40)}"`);
  if (backlog.length) parts.push(ko ? `백로그 ${backlog.length}개` : `${backlog.length} backlog`);
  return { additionalContext: out.join('\n'), systemMessage: `mycelium · ${parts.join(' · ')}` };
}

/**
 * Capture the Claude Code session that just ended, and update only its own
 * index row — instead of waiting up to MYCELIUM_SCAN_MS for the next full
 * scan(). Summarizing/filing it is left to the TUI/daemon's normal upkeep:
 * SessionEnd has a tight time budget and must never spawn an LLM.
 */
export function captureEndedSession({ sessionId, transcriptPath, source = 'claude' } = {}) {
  if (!sessionId) return { status: 'skipped' };
  const res = captureOne(source, sessionId, { path: transcriptPath });
  if (res.status === 'imported') {
    reindexOne(res.neutral);
    if (res.consumedId) removeFromIndex(res.consumedId);
  }
  return res;
}
