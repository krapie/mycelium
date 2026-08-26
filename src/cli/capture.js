import { scan, allRaw, reevaluateArchive } from '../scanner.js';
import { firstUserText } from '../schema.js';
import { reindex } from '../index-db.js';
import { loadConfig, saveConfig } from '../config.js';
import { fail, parseFlags } from './util.js';

export function scanCmd() {
  const wasEmpty = allRaw().length === 0;
  const res = scan({
    onImport: (n) => console.log(`  + ${n.id.slice(0, 8)}  ${firstUserText(n).slice(0, 60)}`),
  });
  console.log(`scanned ${res.scanned}, imported ${res.imported}, skipped ${res.skipped}, failed ${res.failed}`);
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
}

export function reindexCmd() {
  const n = reindex();
  console.log(`reindexed ${n} sessions`);
}

export function archiveCmd(args) {
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
  console.log(`재평가 완료 (임계값 ${used}일): New로 복구 ${res.unarchived}개, 새로 archive ${res.archived}개.`);
}
