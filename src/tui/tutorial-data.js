import { randomUUID } from 'node:crypto';
import { emptyNeutral } from '../schema.js';

// Realistic mock sessions for the first-run tutorial / `mycelium demo` — NOT
// real captures. Three storylines (two sessions each) so the o-key step has
// something genuinely worth sorting: a backend timeout bug, a frontend CSS
// bug, and a data-pipeline build-out. Dates are computed relative to "now"
// each time this is called, not hardcoded, so a demo run always looks fresh
// on the calendar. Every session is `demo: true` (tutorial.js's endTutorial()
// sweeps on that) and starts `folder: null` so o has real work to do.

function daysAgo(n, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}

function turn(role, text) {
  return { role, text };
}

const SESSIONS = [
  {
    source: 'claude',
    daysAgo: 6,
    title: 'Investigate payment API timeouts',
    summary:
      'Investigated POST /api/payments intermittently taking 30+ seconds and timing out during peak ' +
      "hours. Logs and connection-pool metrics showed the DB pool (pg-pool)'s max was set too low at " +
      '10, so concurrent requests were queuing up waiting for a free connection.',
    tags: ['backend', 'payments', 'performance', 'PostgreSQL'],
    turns: [
      turn('user', "The payment API keeps timing out whenever traffic spikes and I can't find the cause. Can you look at the logs with me?"),
      turn(
        'assistant',
        'Looking at the logs, POST /api/payments requests are spending a long time waiting before the DB query even starts. ' +
          'The pg-pool config has max: 10, which is way too small for the 40-50 concurrent requests we see at peak (per monitoring). ' +
          "Connections are all in use, so the rest of the requests sit in a queue until they time out.",
      ),
      turn('user', 'So bumping max is the fix, or is there something else going on too?'),
      turn(
        'assistant',
        "Raising max is the right first move. We should also check the DB's own max_connections, so the DB side doesn't reject " +
          "connections once we grow the pool. Let's actually change the values and confirm with a load test next session.",
      ),
    ],
  },
  {
    source: 'codex',
    daysAgo: 5,
    title: 'Fix payment API connection-pool settings',
    summary:
      "Fixed yesterday's timeout issue by raising pg-pool's max from 10 to 30 and adding " +
      'idleTimeoutMillis so idle connections stop hogging the pool. Also raised the RDS parameter ' +
      "group's max_connections from 100 to 200. Load testing confirmed p99 latency improved to 4.2s.",
    tags: ['backend', 'payments', 'performance', 'PostgreSQL'],
    turns: [
      turn('user', "Let's fix the connection-pool issue we found yesterday. What should we set max to?"),
      turn(
        'assistant',
        'Peak concurrency was around 40-50, so I set max: 30 with some headroom, and added idleTimeoutMillis: 10000 so idle ' +
          "connections get released quickly. We'll also need to raise RDS's max_connections from 100 to 200 to accommodate the larger pool.",
      ),
      turn('user', 'Deployed it and ran the load test. How does it look?'),
      turn(
        'assistant',
        'p99 latency dropped from 30+ seconds (timeouts) to 4.2 seconds, and the error rate went from 12% to 0%. ' +
          "I'd recommend adding connection-pool metrics to the dashboard next so we catch this earlier if it happens again.",
      ),
    ],
  },
  {
    source: 'claude',
    daysAgo: 4,
    title: 'Reproduce broken mobile layout on the login page',
    summary:
      'Reproduced a bug on iOS Safari (390px width) where the login form\'s password field and ' +
      'submit button get pushed off-screen. Root cause: the parent container has a fixed width ' +
      '(480px), causing horizontal scroll on any viewport narrower than that.',
    tags: ['frontend', 'React', 'CSS', 'responsive'],
    turns: [
      turn('user', "A user sent a screenshot showing login is broken on their iPhone — the button is off-screen."),
      turn(
        'assistant',
        "Reproduced it at 390px width (iOS Safari). `.login-card` has a hardcoded `width: 480px`, so the card renders wider " +
          "than the viewport and causes horizontal scroll. There's no media query handling this at all.",
      ),
      turn('user', 'When did this start happening?'),
      turn(
        'assistant',
        "Looks like it came from a recent design-refresh commit that changed `max-width` to a plain `width`. I'll fix it next " +
          'session with `max-width` + `width: 100%` and adjust padding for small screens.',
      ),
    ],
  },
  {
    source: 'kiro',
    daysAgo: 3,
    title: 'Fix responsive CSS on the login form',
    summary:
      'Changed .login-card from width: 480px to max-width: 480px + width: 100%, and added a media ' +
      'query that reduces padding and font size below 360px. Verified on real devices (iPhone SE, ' +
      'iPhone 14) — renders correctly with no horizontal scroll.',
    tags: ['frontend', 'React', 'CSS', 'responsive'],
    turns: [
      turn('user', "Go ahead and fix the CSS based on what we found yesterday. Needs to cover down to the smallest screen (iPhone SE)."),
      turn(
        'assistant',
        'Changed `.login-card` to `max-width: 480px; width: 100%;`, and added a rule under `@media (max-width: 360px)` that drops ' +
          'padding from 24px to 12px and reduces the font size a step.',
      ),
      turn('user', 'Tested on both iPhone SE and iPhone 14 — looks clean now. Thanks!'),
      turn('assistant', "Glad it's clean now. To prevent this class of bug going forward, I'd suggest making max-width (not a fixed width) the team convention for card-style components."),
    ],
  },
  {
    source: 'codex',
    daysAgo: 2,
    title: 'Design the daily sales report pipeline',
    summary:
      "Designed a pipeline that aggregates yesterday's sales every morning and posts a summary to " +
      'Slack. Agreed on reading from the orders DB with pandas, aggregating by product/region, ' +
      'landing the result in S3 as parquet, then sending the summary via a Slack webhook.',
    tags: ['data', 'Python', 'pandas', 'pipeline'],
    turns: [
      turn('user', "I'd like a daily Slack summary of yesterday's sales every morning. What structure would you recommend?"),
      turn(
        'assistant',
        "I'd break it into 3 stages: (1) read yesterday's data from the orders DB with pandas and aggregate by product/region, " +
          '(2) land the aggregated result in S3 as parquet so it stays available for later re-analysis, (3) send a summary via a ' +
          "Slack webhook. We'll need to set up scheduling separately.",
      ),
      turn('user', "Sounds good — what should we use for scheduling? Is cron enough?"),
      turn('assistant', "Airflow is the better call once you factor in retries, monitoring, and dependency management. Let's wire up an Airflow DAG for the scheduling next session."),
    ],
  },
  {
    source: 'claude',
    daysAgo: 1,
    title: 'Schedule the sales report pipeline on Airflow',
    summary:
      "Wrapped yesterday's sales-aggregation script in an Airflow DAG scheduled for 07:00 KST daily. " +
      'Configured on_failure_callback to retry 3 times and post a failure alert to the Slack channel.',
    tags: ['data', 'Python', 'pandas', 'pipeline', 'Airflow'],
    turns: [
      turn('user', "Take the aggregation script we wrote yesterday and get it running every morning at 7am via an Airflow DAG."),
      turn(
        'assistant',
        'Created a `daily_sales_report` DAG with `schedule_interval` set to a cron expression for 07:00 KST. Set retries=3, ' +
          'retry_delay=5 minutes, and wired on_failure_callback to post a failure alert to the Slack channel.',
      ),
      turn('user', "Triggered a test run and the report showed up fine in Slack. Did you verify the failure alert too?"),
      turn('assistant', "Yes — I deliberately killed the DB connection during a test run and confirmed the Slack alert arrives correctly after the 3 retries are exhausted."),
    ],
  },
];

export function buildMockSessions() {
  return SESSIONS.map((s) => {
    const n = emptyNeutral(randomUUID(), s.source);
    n.startedAt = daysAgo(s.daysAgo);
    n.endedAt = daysAgo(s.daysAgo, 11);
    n.turns = s.turns;
    n.extracted.title = s.title;
    n.extracted.summary = s.summary;
    n.extracted.tags = s.tags;
    n.summarizedTurnCount = s.turns.length;
    n.demo = true; // tutorial.js's endTutorial() sweeps on this flag
    return n;
  });
}
