import { loadRaw } from './scanner.js';
import { assembleContext } from './reuse.js';
import { firstUserTurn } from './schema.js';
import { contentLocale } from './config.js';

/**
 * Render a session into a handoff prompt a *different* agent can pick up with.
 * The code artifacts already live on disk (git etc.), so the prompt only needs
 * to carry intent across the model boundary: what was done, why, what's left,
 * plus the inherited folder knowledge. Structure follows authsec-bridge's
 * handoff shape (original task, work so far, last message, next steps).
 *
 * `locale` follows `config.js`'s `contentLocale()`, same as the LLM prompts
 * in learn.js/organize/classify.js/insight.js/split.js (AGENTS.md's
 * "Human-facing text" convention) — this isn't itself an LLM prompt, but the
 * same reasoning applies: it's human-facing text a user reads/pastes, so it
 * should match their chosen locale instead of always coming back Korean.
 * Korean text kept verbatim under the 'ko' branch; English added alongside.
 */
export function buildHandoff(sessionId, locale = contentLocale()) {
  const n = loadRaw(sessionId);
  if (!n) return { ok: false, error: `no session ${sessionId}` };

  const noRequest = locale === 'ko' ? '(원 요청 없음)' : '(no original request)';
  const firstUser = firstUserTurn(n)?.text?.trim() || noRequest;
  const lastAssistant = [...n.turns].reverse().find((t) => t.role === 'assistant')?.text?.trim() || '';
  const knowledge = assembleContext(n.folder);

  const lines =
    locale === 'ko'
      ? [
          `# 이어받는 작업 (원 세션: ${n.source} / ${n.id.slice(0, 8)})`,
          '',
          `이 작업은 다른 에이전트가 진행하던 것을 이어받는 것입니다. 처음부터 다시 시작하지 말고, 아래 맥락을 바탕으로 같은 작업 디렉토리에서 이어서 완료하세요. 실제 코드/문서 변경은 이미 디스크(및 git)에 있으니 파일을 직접 확인하세요.`,
          '',
          `**작업 디렉토리:** ${n.cwd || '(불명)'}`,
          '',
          `**원래 요청:**`,
          firstUser.slice(0, 800),
          '',
        ]
      : [
          `# Continuing work (original session: ${n.source} / ${n.id.slice(0, 8)})`,
          '',
          `This continues work another agent was doing. Don't start over — pick up from the context below in the same working directory. The actual code/doc changes already live on disk (and in git), so check the files directly.`,
          '',
          `**Working directory:** ${n.cwd || '(unknown)'}`,
          '',
          `**Original request:**`,
          firstUser.slice(0, 800),
          '',
        ];

  if (n.extracted.summary) {
    lines.push(locale === 'ko' ? '**지금까지 한 일 (요약):**' : '**Work so far (summary):**', n.extracted.summary, '');
  }
  if (n.artifacts.filesChanged.length) {
    lines.push(
      locale === 'ko' ? '**건드린 파일:**' : '**Files touched:**',
      n.artifacts.filesChanged.slice(0, 30).map((f) => `- ${f}`).join('\n'),
      '',
    );
  }
  if ((n.extracted.decisions || []).length) {
    lines.push(
      locale === 'ko' ? '**내려진 결정:**' : '**Decisions made:**',
      n.extracted.decisions.map((d) => `- ${d}`).join('\n'),
      '',
    );
  }
  if ((n.extracted.todos || []).length) {
    lines.push(
      locale === 'ko' ? '**남은 할 일:**' : '**Remaining todos:**',
      n.extracted.todos.map((t) => `- ${t}`).join('\n'),
      '',
    );
  }
  if (lastAssistant) {
    lines.push(
      locale === 'ko' ? '**직전 에이전트의 마지막 메시지:**' : "**Previous agent's last message:**",
      lastAssistant.slice(0, 600),
      '',
    );
  }
  if (knowledge) {
    lines.push(locale === 'ko' ? '**이 작업 공간의 프로젝트 지식:**' : '**Project knowledge for this workspace:**', knowledge, '');
  }

  lines.push(
    locale === 'ko' ? '위 맥락을 확인하고, 남은 작업을 이어서 완료하세요.' : 'Review the context above and continue the remaining work.',
  );
  return { ok: true, prompt: lines.join('\n'), session: n };
}
