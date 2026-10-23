/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

// Regenerates media/walkthrough/*.svg — the Capture → Organize → Learn →
// Reuse loop with one stage lit, in a dark and a light variant (a walkthrough
// image can't inherit the theme's colors, so each theme gets its own file).
// Usage: node scripts/gen-walkthrough.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '../media/walkthrough');
mkdirSync(out, { recursive: true });

const STAGES = [
  ['capture', 'Capture', 'scan sessions'],
  ['organize', 'Organize', 'folders & tags'],
  ['learn', 'Learn', 'summaries & knowledge'],
  ['reuse', 'Reuse', 'resume & hand off'],
];
const THEMES = {
  dark: { text: '#e9e4d6', sub: '#a39d8a', dim: '#6f6a5a', on: '#7fe0c4', onText: '#14140f' },
  light: { text: '#2b2a24', sub: '#6b6657', dim: '#a9a392', on: '#1f8f74', onText: '#ffffff' },
};

// An unescaped & made these files invalid XML, and an invalid SVG is not drawn at all.
const xml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function svg(lit, c) {
  const w = 128, h = 74, gap = 44, x0 = 28, y = 56;
  const nodes = STAGES.map(([key, name, sub], i) => {
    const x = x0 + i * (w + gap);
    const on = key === lit;
    return `<g>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${on ? c.on : 'none'}" stroke="${on ? c.on : c.dim}" stroke-width="${on ? 0 : 1.5}"/>
  <text x="${x + w / 2}" y="${y + 33}" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="18" font-weight="600" fill="${on ? c.onText : c.text}">${xml(name)}</text>
  <text x="${x + w / 2}" y="${y + 54}" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="11.5" fill="${on ? c.onText : c.sub}">${xml(sub)}</text>
</g>`;
  });
  const arrows = [0, 1, 2].map((i) => {
    const x = x0 + (i + 1) * w + i * gap + 8;
    return `<path d="M${x} ${y + h / 2} h${gap - 16} m-6 -5 l6 5 l-6 5" fill="none" stroke="${c.dim}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  const last = x0 + 3 * (w + gap) + w / 2;
  const first = x0 + w / 2;
  const back = `<path d="M${last} ${y + h + 10} v22 h${-(last - first)} v-22 m-5 6 l5 -6 l5 6" fill="none" stroke="${c.dim}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 5"/>`;
  const width = x0 * 2 + 4 * w + 3 * gap;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 190" width="${width}" height="190" role="img" aria-label="Capture, Organize, Learn, Reuse">
${nodes.join('\n')}
${arrows.join('\n')}
${back}
<text x="${width / 2}" y="30" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="12" fill="${c.sub}" letter-spacing="1.5">${lit === 'loop' ? 'THE LOOP' : 'YOU ARE HERE'}</text>
</svg>
`;
}

for (const lit of ['loop', ...STAGES.map((s) => s[0])]) {
  for (const [theme, c] of Object.entries(THEMES)) writeFileSync(join(out, `${lit}-${theme}.svg`), svg(lit, c));
}
console.log('wrote', 5 * 2, 'files to', out);
