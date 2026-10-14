/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

// Fails if a tracked JS file lacks the license header; `--fix` inserts it.
// Usage: node scripts/check-license-headers.js [--fix]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const HEADER = `/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */
`;

const EXCLUDED = /^test\/fixtures\//;

const files = execFileSync('git', ['ls-files', '*.js', '*.mjs', '*.cjs'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !EXCLUDED.test(f));

// Only the first lines count, so a stray mention deep in a file can't pass.
const hasHeader = (src) => {
  const head = src.split('\n').slice(0, 12).join('\n');
  return head.includes('SPDX-License-Identifier: MIT') && head.includes('Copyright');
};

const fix = process.argv.includes('--fix');
const missing = [];

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  if (hasHeader(src)) continue;
  if (!fix) {
    missing.push(f);
    continue;
  }
  // A shebang must stay on line 1 or the OS won't exec the file.
  const m = src.match(/^#![^\n]*\n/);
  const shebang = m ? m[0] : '';
  writeFileSync(f, `${shebang}${HEADER}\n${src.slice(shebang.length)}`);
  console.log(`added header: ${f}`);
}

if (missing.length) {
  console.error(`Missing license header in ${missing.length} file(s):\n${missing.map((f) => `  ${f}`).join('\n')}`);
  console.error('Run `npm run lint:headers:fix` to add it.');
  process.exit(1);
}
