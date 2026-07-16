#!/usr/bin/env node
import { scan, allRaw } from './scanner.js';
import { firstUserText } from './schema.js';

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
