import { readFileSync } from 'node:fs';
import { reindex } from '../index-db.js';
import { autoTagSession, tagAll } from '../learn.js';
import { generateDigest, extractKnowledge, foldersWithSessions } from '../insight.js';
import { fail, parseFlags } from './util.js';

function fmtTags(tags) {
  return tags && tags.length ? '#' + tags.join(' #') : '(no tags)';
}

export async function autotagCmd(args) {
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
}

export async function digestCmd(args) {
  const { flags, positional } = parseFlags(args);
  const period = positional[0] === 'week' ? 'week' : 'day';
  const res = await generateDigest({ period, date: flags.date });
  if (!res.ok) return fail(res.error);
  console.log(`${res.keyed} 다이제스트 생성 (${res.count} 세션) → ${res.path}`);
  console.log('');
  console.log(readFileSync(res.path, 'utf8'));
}

export async function knowledgeCmd(args) {
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
}
