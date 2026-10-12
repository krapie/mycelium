// Regenerates media/icon.png — the extension's 256x256 listing icon (the Marketplace
// and the Extensions panel want a PNG; media/icon.svg is only the activity-bar glyph).
// The same mycelium network as that glyph, in the project's foxfire teal on its dark
// humus color, drawn with a small supersampling rasterizer so it needs no dependencies.
// Usage: node scripts/gen-icon.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
const SS = 4; // samples per pixel side
const BG = [0x14, 0x14, 0x0f];
const FOX = [0x7f, 0xe0, 0xc4];
const SPORE = [0xd4, 0xa2, 0x4e];

// geometry in the glyph's 24x24 space, scaled to the icon
const k = SIZE / 24;
const C = [12, 12];
const SATS = [[5, 6], [19, 7], [6, 19], [19, 18]];
const nodes = [{ at: C, r: 2.4, col: FOX }, ...SATS.map((at, i) => ({ at, r: i === 1 ? 1.5 : 1.8, col: i === 3 ? SPORE : FOX }))];
const branches = SATS.map((at) => ({ a: C, b: at, w: 0.7 }));
const dots = [[9.5, 3.4, 0.45], [21, 12.5, 0.4], [3.2, 12.8, 0.4], [14, 21.2, 0.45]];

const dist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// color at a point in glyph space, or null when transparent
function sample(x, y) {
  // rounded square tile
  const r = 56 / k, m = 0;
  const cx = Math.min(Math.max(x, r + m), 24 - r - m), cy = Math.min(Math.max(y, r + m), 24 - r - m);
  if (Math.hypot(x - cx, y - cy) > r) return null;
  let col = BG;
  for (const b of branches) if (dist(x, y, b.a[0], b.a[1], b.b[0], b.b[1]) <= b.w / 2) col = mix(col, FOX, 0.55);
  for (const [dx, dy, dr] of dots) if (Math.hypot(x - dx, y - dy) <= dr) col = mix(col, FOX, 0.5);
  for (const n of nodes) if (Math.hypot(x - n.at[0], y - n.at[1]) <= n.r) col = n.col;
  return col;
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));

const px = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample((x + (sx + 0.5) / SS) / k, (y + (sy + 0.5) / SS) / k);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
    }
    const o = (y * SIZE + x) * 4;
    if (a) { px[o] = Math.round(r / a); px[o + 1] = Math.round(g / a); px[o + 2] = Math.round(b / a); px[o + 3] = Math.round((255 * a) / (SS * SS)); }
  }
}

// --- PNG encoding
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const rows = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) { rows[y * (SIZE * 4 + 1)] = 0; px.copy(rows, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4); }
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
const out = join(dirname(fileURLToPath(import.meta.url)), '../media/icon.png');
writeFileSync(out, png);
console.log(`wrote ${out} (${SIZE}x${SIZE}, ${png.length} bytes)`);
