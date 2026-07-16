import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allRaw, loadRaw } from './scanner.js';
import { reindex, search, listTags } from './index-db.js';
import { move, tag, mkdir } from './organize.js';
import { DIGEST_DIR } from './paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, '..', 'web', 'index.html');

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function summarize(n) {
  return {
    id: n.id,
    source: n.source,
    folder: n.folder,
    startedAt: n.startedAt,
    tags: n.extracted.tags,
    summary: n.extracted.summary,
    organizedBy: n.organizedBy,
    preview: (n.turns.find((t) => t.role === 'user')?.text || '').slice(0, 160),
  };
}

// Localhost-only by default — sessions include private work (HR etc.), so the
// POC never exposes them on the network.
export function startServer({ host = '127.0.0.1', port = 7420 } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (p === '/' || p === '/index.html') {
        if (!existsSync(WEB)) return (res.writeHead(404), res.end('web/index.html missing'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(readFileSync(WEB, 'utf8'));
      }
      if (p === '/api/sessions' && req.method === 'GET') {
        const q = url.searchParams.get('q') || '';
        const tags = (url.searchParams.get('tags') || '').split(',').filter(Boolean);
        const folder = url.searchParams.get('folder') || undefined;
        if (q || tags.length || folder) {
          return sendJson(res, 200, { sessions: search({ query: q, tags, folder }) });
        }
        const sessions = allRaw()
          .map(summarize)
          .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
        return sendJson(res, 200, { sessions });
      }
      if (p === '/api/tags' && req.method === 'GET') {
        return sendJson(res, 200, { tags: listTags() });
      }
      if (p === '/api/folders' && req.method === 'GET') {
        const set = new Set();
        for (const n of allRaw()) if (n.folder) set.add(n.folder);
        return sendJson(res, 200, { folders: [...set].sort() });
      }
      const detail = p.match(/^\/api\/sessions\/([^/]+)$/);
      if (detail && req.method === 'GET') {
        const n = loadRaw(decodeURIComponent(detail[1]));
        if (!n) return sendJson(res, 404, { error: 'not found' });
        return sendJson(res, 200, { session: n });
      }
      const mv = p.match(/^\/api\/sessions\/([^/]+)\/move$/);
      if (mv && req.method === 'POST') {
        const body = await readBody(req);
        if (body.folder) mkdir(body.folder);
        const r = move(decodeURIComponent(mv[1]), body.folder || null);
        if (!r.ok) return sendJson(res, 400, { error: r.error });
        reindex();
        return sendJson(res, 200, { session: summarize(r.session) });
      }
      const tg = p.match(/^\/api\/sessions\/([^/]+)\/tag$/);
      if (tg && req.method === 'POST') {
        const body = await readBody(req);
        const r = tag(decodeURIComponent(tg[1]), body.add || [], body.remove || []);
        if (!r.ok) return sendJson(res, 400, { error: r.error });
        reindex();
        return sendJson(res, 200, { session: summarize(r.session) });
      }
      if (p === '/api/digests' && req.method === 'GET') {
        const { readdirSync } = await import('node:fs');
        let files = [];
        try {
          files = readdirSync(DIGEST_DIR).filter((f) => f.endsWith('.md')).sort().reverse();
        } catch {
          /* none yet */
        }
        return sendJson(res, 200, { digests: files });
      }
      const dg = p.match(/^\/api\/digests\/(.+)$/);
      if (dg && req.method === 'GET') {
        const f = join(DIGEST_DIR, decodeURIComponent(dg[1]).replace(/[^\w.-]/g, ''));
        if (!existsSync(f)) return sendJson(res, 404, { error: 'not found' });
        return sendJson(res, 200, { markdown: readFileSync(f, 'utf8') });
      }
      res.writeHead(404);
      res.end('not found');
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });
  server.listen(port, host, () => console.log(`Mycelium UI: http://${host}:${port}`));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer({ host: process.env.MYCELIUM_HOST || '127.0.0.1', port: Number(process.env.MYCELIUM_PORT || 7420) });
}
