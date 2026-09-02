#!/usr/bin/env node
// Manual, opt-in eval harness for the prompts in learn.js/organize/classify.js/
// insight/knowledge.js/insight/digest.js/split.js (issue #70). Answers that
// issue's own stated gap: test/*.test.js covers the plumbing around these
// calls (locale routing, JSON parsing, concurrency) via llm.js's mock-provider
// seam, but nothing evaluates actual output QUALITY against a real model.
//
// Deliberately lives here, not under test/ — node --test (what `npm test`
// runs) auto-discovers **/test/**/*.js, so a script there would spawn real,
// billed `claude`/`codex` subprocesses on every CI run. scripts/ is also
// outside package.json's "files" allowlist, so it never ships to npm users.
// This script makes REAL LLM calls, costs real usage, and is non-
// deterministic — it is never invoked by npm test/CI, only by hand
// (`npm run eval:prompts`).
//
// What it checks beyond "print for a human to read": every real output is
// run through the SAME parser the production code uses (parseJsonReply(),
// the module's own range/path validation) plus structural checks (field
// presence/type, length bands, banned-generic detection, forbidden-meta
// detection) — none of that judges semantic quality, but it's the majority
// of what actually goes wrong on a small model, and unlike a single
// printout, a pass-rate across --runs repeats actually shows whether a
// wording change helped.
//
// Usage:
//   node scripts/eval-prompts.js --yes
//   node scripts/eval-prompts.js --call learn,split --locale ko --runs 5 --yes
//   node scripts/eval-prompts.js --call knowledge --model sonnet --runs 3 --yes
//
// Flags:
//   --call <list>    comma-separated: learn,placement,knowledge,digest,split (default: all)
//   --locale <l>     en | ko | both (default: both)
//   --runs <n>       repeats per fixture x locale (default: 1)
//   --model <name>   overrides MYCELIUM_CLAUDE_MODEL / MYCELIUM_CODEX_MODEL for this run
//   --yes            required before any real call is made — without it, prints
//                    the estimated call count and exits
//   --strict         exit 1 if any structural check failed (off by default —
//                    this script is a diagnostic tool, not a CI gate)

import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'eval-fixtures');

function parseArgs(argv) {
  const args = { call: null, locale: 'both', runs: 1, model: null, yes: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--call') args.call = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--locale') args.locale = argv[++i];
    else if (a === '--runs') args.runs = Number(argv[++i]);
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--yes') args.yes = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        readFileSync(fileURLToPath(import.meta.url), 'utf8')
          .split('\n')
          .slice(24, 38)
          .map((l) => l.replace(/^\/\/ ?/, ''))
          .join('\n'),
      );
      process.exit(0);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const locales = args.locale === 'both' ? ['en', 'ko'] : [args.locale];
const calls = args.call || ['learn', 'placement', 'knowledge', 'digest', 'split'];

// MYCELIUM_HOME must be set before any src/paths.js-dependent module is
// imported (it reads the env var once, at module-load time) — same
// discipline as test/helpers.js's useTempHome(), hand-rolled here since
// this isn't a node:test file.
const home = mkdtempSync(join(tmpdir(), 'mycelium-eval-'));
process.env.MYCELIUM_HOME = home;
if (args.model) {
  process.env.MYCELIUM_CLAUDE_MODEL = args.model;
  process.env.MYCELIUM_CODEX_MODEL = args.model;
}

const { emptyNeutral } = await import('../src/schema.js');
const { saveRaw } = await import('../src/scanner.js');
const { parseJsonReply } = await import('../src/llm.js');
const { autoTagSession } = await import('../src/learn.js');
const { suggestPlacements } = await import('../src/organize.js');
const { buildKnowledgeText, writeKnowledgeText } = await import('../src/insight.js');
const { generateDigest } = await import('../src/insight.js');
const { suggestSplitBoundaries } = await import('../src/split.js');
const { loadConfig, saveConfig } = await import('../src/config.js');

function seed(session) {
  const n = { ...emptyNeutral(session.id, 'claude'), ...session, extracted: { ...emptyNeutral(session.id, 'claude').extracted, ...(session.extracted || {}) } };
  saveRaw(n);
  return n;
}

function setLocale(locale) {
  saveConfig({ ...loadConfig(), locale });
}

function loadFixtures(call) {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'));
  const fixtures = [];
  for (const f of files) {
    const data = JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8'));
    if (data.call === call) fixtures.push({ file: f, ...data });
  }
  return fixtures;
}

// ---- structural checks (real parser, no semantic judgment) ----

const BANNED_GENERIC_TITLES = /^(debugging session|code review|development work|session|working on it|misc|untitled)$/i;
const BANNED_TAGS = new Set(['claude', 'codex', 'cursor', 'kiro', 'debugging', 'refactoring', 'discussion']);
const FORBIDDEN_META = /(no code changes|just provided information|user asked and assistant answered|here is the (digest|summary)|in summary|this report covers|organized and saved|done\.?$)/i;

function isSafeFolderPath(p) {
  return typeof p === 'string' && p.trim() && p.split('/').every((seg) => seg && seg !== '.' && seg !== '..');
}

function checkLearnOutput(reply) {
  const checks = {};
  const parsed = parseJsonReply(reply);
  checks['json parses'] = !!parsed;
  if (!parsed) return checks;
  checks['title present, 1-40 chars'] = typeof parsed.title === 'string' && parsed.title.length > 0 && parsed.title.length <= 40;
  checks['title not a banned generic'] = !BANNED_GENERIC_TITLES.test((parsed.title || '').trim());
  checks['title has no trailing period'] = !(parsed.title || '').trim().endsWith('.');
  checks['tags is an array of 2-4'] = Array.isArray(parsed.tags) && parsed.tags.length >= 1 && parsed.tags.length <= 4;
  checks['no banned/tool-name tags'] = Array.isArray(parsed.tags) && parsed.tags.every((t) => !BANNED_TAGS.has(String(t).toLowerCase()));
  checks['summary present'] = typeof parsed.summary === 'string' && parsed.summary.length > 0;
  checks['summary has no forbidden meta phrase'] = !FORBIDDEN_META.test(parsed.summary || '');
  checks['decisions/todos are arrays'] = Array.isArray(parsed.decisions) && Array.isArray(parsed.todos);
  return checks;
}

function checkPlacementOutput(reply, candidateIds) {
  const checks = {};
  const parsed = parseJsonReply(reply);
  checks['json parses'] = !!parsed && Array.isArray(parsed.placements);
  if (!checks['json parses']) return checks;
  const returnedIds = new Set(parsed.placements.map((p) => p.id));
  checks['one entry per submitted id'] = candidateIds.every((id) => returnedIds.has(id));
  checks['every folder is null or a safe path'] = parsed.placements.every((p) => p.folder === null || isSafeFolderPath(p.folder));
  checks['reason under 15 words'] = parsed.placements.every((p) => !p.reason || p.reason.trim().split(/\s+/).length <= 15);
  return checks;
}

function checkKnowledgeOutput(text) {
  const checks = {};
  checks['no top-level # heading'] = !/^#\s/m.test(text.trim()) || /^##\s/.test(text.trim());
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  checks['under ~450 words (400 cap + buffer)'] = words <= 450;
  const headings = [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  const allowed = /^(conventions|decisions|terminology|watch out for|컨벤션|결정|용어|주의할 점)$/i;
  checks['only allowed headings used'] = headings.every((h) => allowed.test(h));
  return checks;
}

function checkDigestOutput(text) {
  const checks = {};
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  checks['roughly 3-6 sentences (20-200 words)'] = words >= 20 && words <= 200;
  checks['no forbidden meta phrase'] = !FORBIDDEN_META.test(text) && !/^(다이제스트입니다|요약하면|이 리포트는)/.test(text.trim());
  return checks;
}

function checkSplitOutput(reply, turnCount) {
  const checks = {};
  const parsed = parseJsonReply(reply);
  checks['json parses'] = !!parsed && Array.isArray(parsed.ranges) && parsed.ranges.length > 0;
  if (!checks['json parses']) return checks;
  const sorted = [...parsed.ranges].sort((a, b) => a.from - b.from);
  let coversAll = sorted[0]?.from === 1;
  let noGapsOverlaps = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from !== sorted[i - 1].to + 1) noGapsOverlaps = false;
  }
  if (sorted.length && sorted[sorted.length - 1].to !== turnCount) coversAll = false;
  checks['covers turn 1..N with no gaps/overlaps'] = coversAll && noGapsOverlaps;
  checks['no range shorter than 2 turns'] = parsed.ranges.every((r) => r.to - r.from + 1 >= 2 || turnCount < 2);
  checks['4 or fewer ranges (not over-split)'] = parsed.ranges.length <= 4;
  return checks;
}

// ---- run ----

async function estimateCallCount() {
  let n = 0;
  for (const call of calls) n += loadFixtures(call).length * locales.length * args.runs;
  return n;
}

const estimate = await estimateCallCount();
if (!args.yes) {
  console.log(`This would make ${estimate} real LLM call(s) (calls: ${calls.join(', ')}; locales: ${locales.join(', ')}; runs: ${args.runs}).`);
  console.log('Re-run with --yes to actually spend. Nothing was called.');
  process.exit(0);
}
console.log(`Running ${estimate} real LLM call(s)...\n`);

const results = []; // { call, fixture, locale, run, checks, output }

for (const call of calls) {
  const fixtures = loadFixtures(call);
  for (const fixture of fixtures) {
    for (const locale of locales) {
      for (let run = 1; run <= args.runs; run++) {
        setLocale(locale);
        // Re-seed fresh every run — several call sites (autoTagSession,
        // suggestPlacements) write back to the session/candidate records
        // themselves (lastClassifiedAt, extracted.*), which would change
        // what the NEXT run sees if not reset.
        for (const s of fixture.anchorSessions || []) seed(s);
        for (const [folder, text] of Object.entries(fixture.knowledgeFiles || {})) writeKnowledgeText(folder, text);
        // A fixture's own top-level `folder` (e.g. knowledge-folder.json)
        // is a default for every session that doesn't set its own —
        // keeps fixture files from repeating the same folder on every entry.
        for (const s of fixture.sessions) seed(fixture.folder && !s.folder ? { ...s, folder: fixture.folder } : s);

        try {
          if (call === 'learn') {
            const s = fixture.sessions[0];
            // autoTagSession() doesn't return the raw LLM reply, only the
            // parsed/applied result — reconstruct an equivalent JSON string
            // from what actually got written to the session for the
            // structural checks below (same fields, same shape).
            const res = await autoTagSession(s.id, {});
            const raw = res.ok
              ? JSON.stringify({ title: res.session.extracted.title, tags: res.session.extracted.tags, summary: res.session.extracted.summary, decisions: res.session.extracted.decisions, todos: res.session.extracted.todos })
              : null;
            results.push({ call, fixture: fixture.file, locale, run, checks: raw ? checkLearnOutput(raw) : { 'LLM call succeeded': false }, output: raw || res.error });
          } else if (call === 'placement') {
            const ids = fixture.sessions.map((s) => s.id);
            const res = await suggestPlacements({ folder: null, cooldownMs: 0 });
            const raw = JSON.stringify({ placements: res.placements });
            results.push({ call, fixture: fixture.file, locale, run, checks: res.ok ? checkPlacementOutput(raw, ids) : { 'LLM call succeeded': false }, output: raw });
          } else if (call === 'knowledge') {
            const res = await buildKnowledgeText(fixture.folder);
            // buildKnowledgeText() wraps the model's own reply as
            // `# <folder> — Project Knowledge\n\n<reply>` — that first
            // line is OUR heading, not the model's; strip it before
            // checking whether the MODEL emitted its own top-level "#".
            const body = res.ok ? res.text.replace(/^#[^\n]*\n\n/, '') : '';
            results.push({ call, fixture: fixture.file, locale, run, checks: res.ok ? checkKnowledgeOutput(body) : { 'LLM call succeeded': false }, output: res.ok ? res.text : res.error });
          } else if (call === 'digest') {
            const res = await generateDigest({ period: 'day', date: fixture.date });
            const { readFileSync: rf } = await import('node:fs');
            const written = res.ok ? rf(res.path, 'utf8') : '';
            const narrative = written.split('\n\n---\n\n')[0].replace(/^#[^\n]*\n\n/, '');
            results.push({ call, fixture: fixture.file, locale, run, checks: res.ok ? checkDigestOutput(narrative) : { 'LLM call succeeded': false }, output: res.ok ? narrative : res.error });
          } else if (call === 'split') {
            const s = fixture.sessions[0];
            const res = await suggestSplitBoundaries(s.id);
            const raw = res.ok ? JSON.stringify({ ranges: res.ranges }) : null;
            results.push({ call, fixture: fixture.file, locale, run, checks: raw ? checkSplitOutput(raw, s.turns.length) : { 'LLM call succeeded': false }, output: raw || res.error });
          }
        } catch (err) {
          results.push({ call, fixture: fixture.file, locale, run, checks: { 'LLM call succeeded': false }, output: `threw: ${err.message}` });
        }
      }
    }
  }
}

// ---- report ----

console.log('\n=== Pass-rate table ===\n');
const byCallFixtureLocale = new Map();
for (const r of results) {
  const key = `${r.call} / ${r.fixture} / ${r.locale}`;
  if (!byCallFixtureLocale.has(key)) byCallFixtureLocale.set(key, []);
  byCallFixtureLocale.get(key).push(r);
}
let anyFailed = false;
for (const [key, group] of byCallFixtureLocale) {
  console.log(key);
  const criteria = new Set();
  for (const r of group) for (const c of Object.keys(r.checks)) criteria.add(c);
  for (const c of criteria) {
    const passed = group.filter((r) => r.checks[c] === true).length;
    const rate = `${passed}/${group.length}`;
    if (passed < group.length) anyFailed = true;
    console.log(`  ${passed === group.length ? '✓' : '✗'} ${c}: ${rate}`);
  }
  console.log('');
}

console.log('=== Raw output (read this — pass rate alone doesn\'t judge semantic quality) ===\n');
for (const r of results) {
  console.log(`--- ${r.call} / ${r.fixture} / ${r.locale} / run ${r.run} ---`);
  console.log(r.output);
  console.log('');
}

if (args.strict && anyFailed) process.exit(1);
