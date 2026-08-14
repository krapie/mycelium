#!/usr/bin/env node
// Burns demo/captions.js's cues onto an already-rendered pitch-en.mp4/
// pitch-ko.mp4, in place. Not part of the VHS tape itself — a post-
// processing pass, run after `npm run record:pitch` (or `vhs` directly).
//
// Why this exists instead of ffmpeg's usual text filters: VHS has no
// caption feature of its own, and this machine's `ffmpeg` (Homebrew's
// default `ffmpeg` formula) was built WITHOUT libass/freetype — confirmed
// via `ffmpeg -filters` (no `subtitles`, no `drawtext`). Rather than
// install a different ffmpeg build as a side effect of adding captions,
// this uses `rsvg-convert` (confirmed installed, confirmed it renders
// Korean text correctly) to turn each cue into a PNG, composited onto the
// video via ffmpeg's `overlay` filter — a core filter, no extra libs
// needed. Captions go in a strip PADDED below the recorded 1600x900 frame
// (never overlaid on top of the app's own real status bar — that's real
// product UI, covering it to show a caption is the wrong tradeoff).
//
// Usage: node demo/burn-captions.js <en|ko>
// Reads/writes demo/out/pitch-<locale>.mp4 in place (via a temp file —
// ffmpeg can't read and write the same path in one pass).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CAPTIONS } from './captions.js';

const locale = process.argv[2];
if (locale !== 'en' && locale !== 'ko') {
  console.error('Usage: node demo/burn-captions.js <en|ko>');
  process.exit(1);
}

const VIDEO_W = 1600;
const VIDEO_H = 900;
const STRIP_H = 70; // added below the recorded frame, never over it
const PADDED_H = VIDEO_H + STRIP_H;

const videoPath = `demo/out/pitch-${locale}.mp4`;
if (!existsSync(videoPath)) {
  console.error(`${videoPath} not found — render it first (npm run record:pitch).`);
  process.exit(1);
}

const cues = CAPTIONS[locale];
const workDir = mkdtempSync(join(tmpdir(), 'mycelium-captions-'));

// Escape text for safe embedding inside an XML attribute/text node — cue
// text is our own authored strings (captions.js), not external input, but
// `&`/`<`/`>` would still break the SVG if left raw.
function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const pngPaths = cues.map((cue, i) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${VIDEO_W}" height="${STRIP_H}">
  <rect width="${VIDEO_W}" height="${STRIP_H}" fill="#1a1b26"/>
  <text x="${VIDEO_W / 2}" y="${STRIP_H / 2 + 8}" font-family="Apple SD Gothic Neo, Menlo, monospace" font-size="24" fill="#e8e8f0" text-anchor="middle">${escapeXml(cue.text)}</text>
</svg>`;
  const svgPath = join(workDir, `cue-${i}.svg`);
  const pngPath = join(workDir, `cue-${i}.png`);
  writeFileSync(svgPath, svg);
  execFileSync('rsvg-convert', ['-o', pngPath, svgPath]);
  return pngPath;
});

// One ffmpeg pass: pad the video with a strip at the bottom (input [0:v]),
// then chain one overlay per cue, each active only during its own
// start..start+hold window — inactive cues contribute nothing (no manual
// gaps to manage between them).
const inputs = ['-i', videoPath, ...pngPaths.flatMap((p) => ['-i', p])];
const filterParts = [`[0:v]pad=${VIDEO_W}:${PADDED_H}:0:0:color=black[base]`];
let last = 'base';
cues.forEach((cue, i) => {
  const out = i === cues.length - 1 ? 'outv' : `v${i}`;
  const end = cue.start + cue.holdSeconds;
  filterParts.push(
    `[${last}][${i + 1}:v]overlay=0:${VIDEO_H}:enable='between(t,${cue.start},${end})'[${out}]`,
  );
  last = out;
});
const filterComplex = filterParts.join(';');

const outPath = join(workDir, `pitch-${locale}-captioned.mp4`);
execFileSync('ffmpeg', [
  '-y',
  ...inputs,
  '-filter_complex', filterComplex,
  '-map', '[outv]',
  '-map', '0:a?',
  '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p',
  outPath,
], { stdio: 'inherit' });

renameSync(outPath, videoPath);
rmSync(workDir, { recursive: true });
console.log(`captioned ${videoPath} (${cues.length} cues)`);
