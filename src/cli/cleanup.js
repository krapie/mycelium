import { fail, parseFlags } from './util.js';

export async function cleanupCmd(args) {
  const { flags, positional } = parseFlags(args);
  const { tidy, pruneEmptyFolders, clearArchive, rebuildIndex, resetStore } = await import('../cleanup.js');
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
}
