import { scan } from './scanner.js';
import { reindex } from './index-db.js';
import { autoOrganize } from './organize.js';
import { tagAll } from './learn.js';
import { generateDigest } from './insight.js';
import { startServer } from './server.js';

const SCAN_INTERVAL_MS = Number(process.env.MYCELIUM_SCAN_MS || 5 * 60 * 1000);
const HOST = process.env.MYCELIUM_HOST || '127.0.0.1';
const PORT = Number(process.env.MYCELIUM_PORT || 7420);

async function scanCycle() {
  try {
    const res = scan();
    if (res.imported > 0) {
      autoOrganize();
      reindex();
      console.log(`[scan] +${res.imported} (organized + reindexed)`);
      // Tag freshly imported sessions (skips those already summarized).
      const t = await tagAll();
      if (t.tagged > 0) {
        reindex();
        console.log(`[tag] +${t.tagged}`);
      }
    }
  } catch (err) {
    console.error(`[scan] ${err.message}`);
  }
}

let lastDigestDay = null;
async function digestCycle() {
  const today = new Date().toISOString().slice(0, 10);
  // Once per local day, generate yesterday's digest (the day is complete).
  if (lastDigestDay === today) return;
  lastDigestDay = today;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  try {
    const r = await generateDigest({ period: 'day', date: yesterday });
    if (r.ok) console.log(`[digest] ${r.keyed} (${r.count} sessions)`);
  } catch (err) {
    console.error(`[digest] ${err.message}`);
  }
}

export async function runDaemon() {
  console.log('Mycelium daemon starting.');
  console.log(`  scan interval: ${SCAN_INTERVAL_MS}ms`);
  startServer({ host: HOST, port: PORT });

  await scanCycle();
  await digestCycle();

  setInterval(scanCycle, SCAN_INTERVAL_MS);
  setInterval(digestCycle, 60 * 60 * 1000); // hourly check; fires once/day
}

if (import.meta.url === `file://${process.argv[1]}`) runDaemon();
