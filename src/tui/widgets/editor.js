import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { foreground } from '../foreground.js';
import { loadRaw } from '../../scanner.js';
import { setContent } from '../../organize.js';
import { t } from '../i18n.js';

// blessed has no reliable multi-line text-input widget in this codebase (see
// the prompt()/textPrompt() single-line helpers), and building one would
// inherit the same class of bugs already hit elsewhere (shrink-height,
// duplicate-label, Setulc). Shelling out to the user's own $EDITOR — the
// pattern `git commit -e` uses — sidesteps all of that and gives real
// multi-line editing for free, reusing the suspend/resume dance already
// proven for launching agents.
function buildEditText(n) {
  return `${t('editor.titleMarker')} ${n.extracted.title || ''}\n---\n${n.extracted.summary || ''}\n`;
}

function parseEditText(text) {
  const marker = t('editor.titleMarker');
  const lines = text.split('\n');
  let title = '';
  let sepIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (sepIdx === -1 && lines[i].startsWith(marker)) title = lines[i].slice(lines[i].indexOf(':') + 1).trim();
    if (lines[i].trim() === '---') {
      sepIdx = i;
      break;
    }
  }
  const summary = sepIdx >= 0 ? lines.slice(sepIdx + 1).join('\n').trim() : '';
  return { title, summary };
}

/**
 * Open the session's title + summary in $EDITOR/$VISUAL (falls back to vi).
 * Mycelium-only: writes to Mycelium's own raw store via organize.setContent,
 * never to the original agent's session log.
 */
export function editSessionContent(app, sessionId, onDone) {
  const n = loadRaw(sessionId);
  if (!n) {
    app.notify(t('editor.notFound'), 3);
    return onDone && onDone();
  }

  const dir = mkdtempSync(join(tmpdir(), 'mycelium-edit-'));
  const file = join(dir, `${sessionId}.md`);
  const cleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  try {
    writeFileSync(file, buildEditText(n), 'utf8');
  } catch (err) {
    cleanup();
    app.notify(t('editor.prepFailed', err.message), 3);
    return onDone && onDone();
  }

  const editorCmd = process.env.VISUAL || process.env.EDITOR || 'vi';
  const [bin, ...baseArgs] = editorCmd.split(' ').filter(Boolean);

  foreground(app, bin, [...baseArgs, file], process.cwd(), () => {
    let parsed;
    try {
      parsed = parseEditText(readFileSync(file, 'utf8'));
    } catch (err) {
      cleanup();
      app.notify(t('editor.readFailed', err.message), 3);
      return onDone && onDone();
    }
    cleanup();

    const res = setContent(sessionId, parsed);
    app.notify(res.ok ? t('editor.saved') : t('editor.saveFailed', res.error), res.ok ? 2 : 3);
    if (onDone) onDone();
  });
}
