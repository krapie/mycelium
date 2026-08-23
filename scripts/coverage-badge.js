// Reads an lcov file (produced by `npm run test:coverage`'s built-in Node
// `lcov` test reporter — see package.json) and prints GITHUB_OUTPUT-format
// `message=`/`color=` lines summarizing the aggregate line coverage, for
// .github/workflows/coverage.yml to feed straight into
// schneegans/dynamic-badges-action (which builds the shields.io badge from
// separate label/message/color inputs, not a pre-built JSON blob). No
// dependencies — lcov's LF/LH fields are plain text.

import { readFileSync } from 'node:fs';

const lcovPath = process.argv[2] ?? 'coverage/lcov.info';
const lcov = readFileSync(lcovPath, 'utf8');

let linesFound = 0;
let linesHit = 0;
for (const line of lcov.split('\n')) {
  if (line.startsWith('LF:')) linesFound += Number(line.slice(3));
  else if (line.startsWith('LH:')) linesHit += Number(line.slice(3));
}

if (linesFound === 0) {
  throw new Error(`No LF/LH records found in ${lcovPath} — is the file empty or malformed?`);
}

const pct = (linesHit / linesFound) * 100;
const message = `${pct.toFixed(1)}%`;

// Matches shields.io's own convention for coverage badges.
const color =
  pct >= 90 ? 'brightgreen' :
  pct >= 80 ? 'green' :
  pct >= 60 ? 'yellow' :
  pct >= 40 ? 'orange' :
  'red';

process.stdout.write(`message=${message}\ncolor=${color}\n`);
