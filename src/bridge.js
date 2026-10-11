import { VERSION } from './version.js';
import { scan, findSession, loadRaw, sourceSessionExists } from './scanner.js';
import { autoTagSession, tagAll } from './learn.js';
import { killInFlight } from './llm.js';
import { organizeLimit } from './config.js';
import { listTreeDirs } from './organize.js';
import {
  buildKnowledgeText,
  writeKnowledgeText,
  pendingKnowledgeReviews,
  promoteKnowledge,
  dismissPendingKnowledge,
} from './insight.js';
import { mkdir, move, tag, reviewablePlacements, applyPlacements, clearSuggestions } from './organize.js';
import { dirsForFolder, injectAgentsMd, assembleContext } from './reuse.js';
import { buildHandoff } from './handoff.js';
import { AGENTS, which, resumeCommandLine, newCommandLine } from './agents.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSafeFolderPath, HOME, TREE_DIR } from './paths.js';
import * as data from './tui/data.js';

/**
 * Method table behind `mycelium serve` (cli/serve.js) — the one seam an
 * editor integration (vscode/) talks to, so it never has to import this
 * package's modules (node:sqlite needs the user's own Node, not an editor's
 * embedded one) or duplicate any store-writing logic. Every entry only maps
 * onto a function the TUI/CLI already call; nothing here owns behavior.
 *
 * A handler returns plain JSON-able data, or throws BridgeError for a
 * failure the caller should see as a message (the `{ ok: false, error }`
 * shape the underlying modules already use).
 */
export const PROTOCOL = 1;

export class BridgeError extends Error {}

const ok = (res) => {
  if (res && res.ok === false) throw new BridgeError(res.error || 'failed');
  return res;
};

const need = (cond, msg) => {
  if (!cond) throw new BridgeError(msg);
};

const safeFolder = (folder) => {
  need(isSafeFolderPath(folder), `invalid folder path: ${folder}`);
  return folder;
};

// The detail view never shows raw turns; sending a long transcript over the
// pipe for every click would only slow the tree down.
const withoutTurns = (n) => {
  const { turns, toolActivity: _t, ...rest } = n;
  return { ...rest, turnCount: turns.length };
};

// Neighbours in the session's lineage as {id, title, source}, so the client
// can label a link without a request per id (tui/render.js's refLabel() does
// the same for the TUI). A neighbour that no longer exists is dropped.
const refs = (ids) =>
  (ids || [])
    .map((id) => loadRaw(id))
    .filter(Boolean)
    .map((r) => ({ id: r.id, title: r.extracted.title || null, source: r.source }));
const lineageOf = (n) => ({
  continuationOf: refs(n.continuationOf ? [n.continuationOf] : []),
  continuedTo: refs(n.continuedTo),
  mergedFrom: refs(n.mergedFrom),
  splitFrom: refs(n.splitFrom ? [n.splitFrom] : []),
  splitInto: refs(n.splitInto),
});

// Methods that call an LLM run for minutes; serve.js runs these outside its
// one-at-a-time queue so a refresh isn't stuck behind them. They report
// through ctx.notify, tagged with the caller's `token` so it can tell which
// request a progress line belongs to.
export const LONG = new Set(['autotag', 'organizeSuggest', 'knowledgeBuild']);

const reporter = (ctx, params) => (info) => ctx.notify('progress', { token: params.token, ...info });

const currentKnowledge = (folder) => {
  try {
    return readFileSync(join(TREE_DIR, ...folder.split('/'), 'KNOWLEDGE.md'), 'utf8');
  } catch {
    return '';
  }
};

export const METHODS = {
  hello: () => ({ version: VERSION, protocol: PROTOCOL, home: HOME }),

  folders: () => {
    const f = data.folders();
    // Which folders already carry a KNOWLEDGE.md, so a client can mark them.
    const knowledge = f.list.filter((p) => existsSync(join(TREE_DIR, ...p.split('/'), 'KNOWLEDGE.md')));
    return { list: f.list, counts: Object.fromEntries(f.counts), inbox: f.inbox, total: f.total, knowledge };
  },

  sessions: ({ folder, query, tags, date, dir, limit } = {}) => {
    const rows = data.sessions({ folder, query, tags, date, dir });
    return limit ? rows.slice(0, limit) : rows;
  },

  detail: ({ id, turns = false }) => {
    const n = ok(findSession(id)).session;
    return { ...(turns ? n : withoutTurns(n)), lineage: lineageOf(n) };
  },

  tags: () => data.tags(),

  scan: () => {
    const summary = scan();
    data.refresh();
    return summary;
  },

  mkdir: ({ folder }) => {
    mkdir(safeFolder(folder));
    return { ok: true };
  },

  move: ({ ids, folder }) => {
    need(Array.isArray(ids) && ids.length, 'no sessions given');
    if (folder) safeFolder(folder);
    for (const id of ids) ok(move(id, folder || null));
    data.refreshMany(ids);
    return { ok: true, moved: ids.length };
  },

  tag: ({ ids, add = [], remove = [] }) => {
    need(Array.isArray(ids) && ids.length, 'no sessions given');
    for (const id of ids) ok(tag(id, add, remove));
    data.refreshMany(ids);
    return { ok: true };
  },

  // Only the agents whose program is on PATH, unless `all`: then every agent,
  // each with `onPath`, so a client that has another way to run one (Claude
  // Code's own panel runs Claude without a CLI) can still offer it.
  agents: ({ all = false } = {}) =>
    Object.entries(AGENTS)
      .map(([key, a]) => ({ key, label: a.label, bin: a.bin, onPath: which(a.bin) }))
      .filter((a) => all || a.onPath),

  // Same refusals as `mycelium resume` (cli/reuse.js): a merge/split product
  // has no agent-native id to resume, and a pruned transcript would only make
  // the agent's own --resume fail once run. The caller offers handoff instead.
  resumeCommand: ({ id, force = false, allowMissingBin = false }) => {
    const { session } = ok(findSession(id));
    if (session.mergedFrom?.length || session.splitFrom) {
      throw new BridgeError('merged/split session — not resumable, use handoff');
    }
    if (!force && !sourceSessionExists(session.source, session.id)) {
      throw new BridgeError(`${AGENTS[session.source]?.label || session.source} no longer has this session on this machine — use handoff`);
    }
    return ok(resumeCommandLine(session, { requireBin: !allowMissingBin }));
  },

  newCommand: ({ agentKey, dir, seed, allowMissingBin = false }) => ok(newCommandLine({ agentKey, dir, seed }, { requireBin: !allowMissingBin })),

  handoff: ({ id }) => ok(buildHandoff(ok(findSession(id)).session.id)),

  dirsForFolder: ({ folder }) => dirsForFolder(folder),

  context: ({ folder }) => ({ context: assembleContext(folder) }),

  inject: ({ dir, folder }) => {
    need(dir && folder, 'dir and folder are required');
    return ok(injectAgentsMd(dir, folder));
  },

  // --- LLM steps (auto-summarize, smart organize, folder knowledge) ---

  // ids → summarize those; otherwise whatever lacks an up-to-date summary,
  // oldest first, bounded by `limit` (tagAll()'s own ordering and circuit
  // breaker apply either way).
  autotag: async (p, ctx) => {
    const report = reporter(ctx, p);
    let tagged = 0;
    let failed = 0;
    if (Array.isArray(p.ids) && p.ids.length) {
      for (const id of p.ids) {
        const res = await autoTagSession(id);
        if (res.ok) tagged++;
        else failed++;
        report({ done: tagged + failed, total: p.ids.length });
      }
      data.refreshMany(p.ids);
      return { tagged, failed };
    }
    const res = await tagAll({
      limit: p.limit,
      concurrency: 2,
      onProgress: (s, err) => {
        if (s) tagged++;
        else if (err) failed++;
        report({ done: tagged + failed, total: p.limit || undefined });
      },
    });
    data.refresh();
    return { tagged: res.tagged, skipped: res.skipped, failed: res.failed, stoppedEarly: !!res.stoppedEarly };
  },

  organizeSuggest: async (p, ctx) => {
    const report = reporter(ctx, p);
    const res = await reviewablePlacements({
      folder: p.folder || undefined,
      limit: p.limit || organizeLimit(),
      onEvent: (e) => {
        if (e.type === 'summarizing') report({ message: 'summarizing', total: e.count });
        else if (e.type === 'summarized') report({ message: 'summarized', id: e.id });
        else if (e.type === 'classifying') report({ message: 'classifying' });
        else if (e.type === 'batch') report({ message: 'classifying', done: e.done, total: e.total });
      },
    });
    ok(res);
    data.refresh(); // summaries were written along the way
    const existing = new Set(listTreeDirs());
    return res.placements
      .filter((x) => x.folder)
      .map((x) => {
        const n = loadRaw(x.id);
        return {
          id: x.id,
          title: n?.extracted.title || null,
          preview: n?.turns.find((t) => t.role === 'user')?.text?.slice(0, 120) || null,
          from: n?.folder || null,
          folder: x.folder,
          reason: x.reason || '',
          newFolder: !existing.has(x.folder),
        };
      });
  },

  // accept: [{id, folder}] get filed; reject: [id] just stop being suggested.
  organizeApply: ({ accept = [], reject = [] }) => {
    for (const a of accept) safeFolder(a.folder);
    const applied = applyPlacements(accept);
    clearSuggestions([...accept.map((a) => a.id), ...reject]);
    data.refreshMany([...accept.map((a) => a.id), ...reject]);
    return { applied };
  },

  knowledgeBuild: async ({ folder }) => {
    safeFolder(folder);
    const gen = ok(await buildKnowledgeText(folder));
    return { folder, text: gen.text, count: gen.count, current: currentKnowledge(folder) };
  },

  knowledgeSave: ({ folder, text }) => {
    safeFolder(folder);
    need(typeof text === 'string' && text.trim(), 'empty knowledge text');
    return writeKnowledgeText(folder, text);
  },

  // The daemon's overnight proposals waiting for a human to look at them.
  knowledgePending: () => pendingKnowledgeReviews().map((r) => ({ folder: r.folder, text: r.text, current: currentKnowledge(r.folder) })),

  knowledgePromote: ({ folder }) => ok(promoteKnowledge(safeFolder(folder))),

  knowledgeDismiss: ({ folder }) => dismissPendingKnowledge(safeFolder(folder)),

  // Best-effort: ends the in-flight claude/codex children; the caller's
  // consecutive-failure breaker then stops the rest of the batch.
  cancel: () => {
    killInFlight();
    return { ok: true };
  },

  // Cheap existence probe so a client can tell a deleted session from a
  // transient error without pulling the whole record.
  exists: ({ id }) => ({ exists: !!loadRaw(id) }),
};

/**
 * Run one JSON-RPC 2.0 request object, returning the response object (or
 * null for a notification, which has no id and gets no reply).
 */
export async function handle(req, ctx = { notify() {} }) {
  const id = req && req.id !== undefined ? req.id : null;
  const reply = (body) => (req && req.id === undefined ? null : { jsonrpc: '2.0', id, ...body });
  if (!req || typeof req.method !== 'string') {
    return { jsonrpc: '2.0', id, error: { code: -32600, message: 'invalid request' } };
  }
  const fn = Object.hasOwn(METHODS, req.method) ? METHODS[req.method] : null;
  if (!fn) return reply({ error: { code: -32601, message: `unknown method: ${req.method}` } });
  try {
    return reply({ result: await fn(req.params || {}, ctx) });
  } catch (err) {
    const known = err instanceof BridgeError;
    return reply({ error: { code: known ? -32000 : -32603, message: err.message } });
  }
}
