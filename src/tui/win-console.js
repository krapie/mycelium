import { execFileSync } from 'node:child_process';
import pkg from 'neo-blessed';
const blessed = pkg.default || pkg;

// Workarounds for the classic Windows console host (conhost: cmd/PowerShell
// windows outside Windows Terminal). VS Code and Windows Terminal render
// through ConPTY and need none of this beyond defaultTerminal().

// Windows consoles don't set TERM, and blessed then falls back to its bundled
// `windows-ansi` terminfo: 8 colors, no alternate screen buffer, no cursor
// save/restore. The TUI ends up drawing into the scrollback buffer, so stale
// frames survive redraws at shifted rows and the palette collapses to
// blue/red. Windows Terminal and Win10+ conhost both speak xterm VT
// sequences, so use xterm-256color there. An explicit TERM (Git Bash, WSL,
// ssh) still wins.
export function defaultTerminal(platform = process.platform, env = process.env) {
  if (platform === 'win32' && !env.TERM) return 'xterm-256color';
  return undefined;
}

// Conhost wraps the cursor as soon as the last column is written (Node
// doesn't set DISABLE_NEWLINE_AUTO_RETURN), so writing the bottom-right cell
// scrolls the whole screen up one row. blessed doesn't know that happened, so
// every later diff-only redraw lands one row off from the first frame. Make
// blessed believe that cell is already up to date so draw() never writes it.
// The cell is always status-bar padding, so nothing visible is lost.
export function guardBottomRightCell(screen) {
  const draw = screen.draw;
  screen.draw = function (start, end) {
    const y = this.rows - 1;
    const x = this.cols - 1;
    const line = this.lines[y];
    const o = this.olines[y];
    if (line && o && line[x] && o[x]) {
      // A double-width char just before the last column would spill into it too.
      if (line[x - 1] && blessed.unicode.charWidth(line[x - 1][1]) === 2) line[x - 1][1] = ' ';
      line[x][0] = o[x][0];
      line[x][1] = o[x][1];
    }
    return draw.call(this, start, end);
  };
}

// Unicode East Asian Width "A" (ambiguous) ranges, BMP only. Box drawing
// (U+2500-257F) is left out: blessed lays borders out one cell per char, and
// conhost draws them through the DEC line-drawing charset anyway.
const AMBIGUOUS = [
  [0xa1, 0xa1], [0xa4, 0xa4], [0xa7, 0xa8], [0xaa, 0xaa], [0xad, 0xae], [0xb0, 0xb4],
  [0xb6, 0xba], [0xbc, 0xbf], [0xc6, 0xc6], [0xd0, 0xd0], [0xd7, 0xd8], [0xde, 0xe1],
  [0xe6, 0xe6], [0xe8, 0xea], [0xec, 0xed], [0xf0, 0xf0], [0xf2, 0xf3], [0xf7, 0xfa],
  [0xfc, 0xfc], [0xfe, 0xfe], [0x101, 0x101], [0x111, 0x111], [0x113, 0x113], [0x11b, 0x11b],
  [0x126, 0x127], [0x12b, 0x12b], [0x131, 0x133], [0x138, 0x138], [0x13f, 0x142], [0x144, 0x144],
  [0x148, 0x14b], [0x14d, 0x14d], [0x152, 0x153], [0x166, 0x167], [0x16b, 0x16b],
  [0x1ce, 0x1ce], [0x1d0, 0x1d0], [0x1d2, 0x1d2], [0x1d4, 0x1d4], [0x1d6, 0x1d6], [0x1d8, 0x1d8],
  [0x1da, 0x1da], [0x1dc, 0x1dc], [0x251, 0x251], [0x261, 0x261], [0x2c4, 0x2c4], [0x2c7, 0x2c7],
  [0x2c9, 0x2cb], [0x2cd, 0x2cd], [0x2d0, 0x2d0], [0x2d8, 0x2db], [0x2dd, 0x2dd], [0x2df, 0x2df],
  [0x391, 0x3a1], [0x3a3, 0x3a9], [0x3b1, 0x3c1], [0x3c3, 0x3c9], [0x401, 0x401], [0x410, 0x44f],
  [0x451, 0x451], [0x2010, 0x2010], [0x2013, 0x2016], [0x2018, 0x2019], [0x201c, 0x201d],
  [0x2020, 0x2022], [0x2024, 0x2027], [0x2030, 0x2030], [0x2032, 0x2033], [0x2035, 0x2035],
  [0x203b, 0x203b], [0x203e, 0x203e], [0x2074, 0x2074], [0x207f, 0x207f], [0x2081, 0x2084],
  [0x20ac, 0x20ac], [0x2103, 0x2103], [0x2105, 0x2105], [0x2109, 0x2109], [0x2113, 0x2113],
  [0x2116, 0x2116], [0x2121, 0x2122], [0x2126, 0x2126], [0x212b, 0x212b], [0x2153, 0x2154],
  [0x215b, 0x215e], [0x2160, 0x216b], [0x2170, 0x2179], [0x2189, 0x2189], [0x2190, 0x2199],
  [0x21b8, 0x21b9], [0x21d2, 0x21d2], [0x21d4, 0x21d4], [0x21e7, 0x21e7], [0x2200, 0x2200],
  [0x2202, 0x2203], [0x2207, 0x2208], [0x220b, 0x220b], [0x220f, 0x220f], [0x2211, 0x2211],
  [0x2215, 0x2215], [0x221a, 0x221a], [0x221d, 0x2220], [0x2223, 0x2223], [0x2225, 0x2225],
  [0x2227, 0x222c], [0x222e, 0x222e], [0x2234, 0x2237], [0x223c, 0x223d], [0x2248, 0x2248],
  [0x224c, 0x224c], [0x2252, 0x2252], [0x2260, 0x2261], [0x2264, 0x2267], [0x226a, 0x226b],
  [0x226e, 0x226f], [0x2282, 0x2283], [0x2286, 0x2287], [0x2295, 0x2295], [0x2299, 0x2299],
  [0x22a5, 0x22a5], [0x22bf, 0x22bf], [0x2312, 0x2312], [0x2460, 0x24e9], [0x24eb, 0x24ff],
  [0x2580, 0x258f], [0x2592, 0x2595], [0x25a0, 0x25a1], [0x25a3, 0x25a9], [0x25b2, 0x25b3],
  [0x25b6, 0x25b7], [0x25bc, 0x25bd], [0x25c0, 0x25c1], [0x25c6, 0x25c8], [0x25cb, 0x25cb],
  [0x25ce, 0x25d1], [0x25e2, 0x25e5], [0x25ef, 0x25ef], [0x2605, 0x2606], [0x2609, 0x2609],
  [0x260e, 0x260f], [0x261c, 0x261c], [0x261e, 0x261e], [0x2640, 0x2640], [0x2642, 0x2642],
  [0x2660, 0x2661], [0x2663, 0x2665], [0x2667, 0x266a], [0x266c, 0x266d], [0x266f, 0x266f],
  [0x273d, 0x273d], [0x2776, 0x277f], [0x3248, 0x324f], [0xfffd, 0xfffd],
];

const CJK_CODE_PAGES = new Set([932, 936, 949, 950]);

function activeCodePage() {
  try {
    const out = execFileSync(`${process.env.WINDIR || 'C:\\Windows'}\\system32\\chcp.com`, [], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'ascii',
      timeout: 1500,
    });
    const m = /\d+/.exec(out);
    return m ? Number(m[0]) : -1;
  } catch {
    return -1;
  }
}

// A conhost window on a CJK code page (Korean = 949) draws ambiguous-width
// characters (· … → — “ ” ① ...) two cells wide; blessed counts them as one.
// Every one of them shifts the rest of its row right, until the row overflows,
// wraps and scrolls the screen (stale, doubled panel labels). Windows Terminal
// and VS Code (WT_SESSION / TERM_PROGRAM) draw them one cell wide.
// MYCELIUM_AMBIGUOUS_WIDE=1/0 forces it either way.
export function ambiguousIsWide(platform = process.platform, env = process.env, codePage = activeCodePage) {
  if (env.MYCELIUM_AMBIGUOUS_WIDE === '1') return true;
  if (env.MYCELIUM_AMBIGUOUS_WIDE === '0') return false;
  if (platform !== 'win32' || env.WT_SESSION || env.TERM_PROGRAM) return false;
  return CJK_CODE_PAGES.has(codePage());
}

// Teach blessed that ambiguous-width chars take two cells, so its layout
// matches what conhost draws. Both of blessed's width checks are patched:
// `chars.all` (parseContent reserves a placeholder cell after each wide char)
// and `charWidth` (draw/strWidth). Chars blessed sends through the DEC
// line-drawing charset (· ± ° ≤ ≥ ...) are drawn one cell wide and are skipped.
export function widenAmbiguousChars(screen) {
  const unicode = blessed.unicode;
  // Patches blessed's module globals, so apply at most once per process.
  if (unicode.__myceliumWideAmbiguous) return;
  unicode.__myceliumWideAmbiguous = true;
  const acs = screen.tput.strings.enter_alt_charset_mode && !screen.tput.brokenACS ? screen.tput.acscr || {} : {};
  const wide = new Set();
  for (const [a, b] of AMBIGUOUS) for (let cp = a; cp <= b; cp++) if (!acs[String.fromCodePoint(cp)]) wide.add(cp);

  const charWidth = unicode.charWidth;
  unicode.charWidth = function (str, i) {
    const point = typeof str !== 'number' ? unicode.codePointAt(str, i || 0) : str;
    return wide.has(point) ? 2 : charWidth.call(this, str, i);
  };

  const hex = (cp) => '\\u' + cp.toString(16).padStart(4, '0');
  let cls = '';
  for (const cp of wide) cls += hex(cp);
  unicode.chars.all = new RegExp(
    '(' + unicode.chars.swide.source.slice(1, -1) + '|[' + unicode.chars.wide.source.slice(2, -2) + cls + '])',
    'g',
  );
}
