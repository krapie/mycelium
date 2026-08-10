// Shared source of truth for the tutorial/`mycelium demo`'s mock content —
// one place per persona holding everything about each of its storylines
// (mock session content, the folder it should classify into, the keywords
// tutorial-mock-llm.js matches on, and the canned KNOWLEDGE.md/split-label
// text) instead of two separate files independently hardcoding folder
// names/keywords that have to stay in sync by hand. tutorial-data.js
// (session building) and tutorial-mock-llm.js (classification/knowledge/
// split mocking) both read from this file rather than each other.
//
// Each persona's `mergeStorylineIndex` names which of its storylines is the
// one the tutorial's Shift+M/Shift+S steps operate on — that storyline's
// sessions all classify into the SAME folder (so mergeSessions()'s real
// "keep the shared folder" behavior has something to preserve) and carries
// `splitLabels` for the two pieces Shift+S produces after merging.

function turn(role, text) {
  return { role, text };
}

export const PERSONAS = [
  {
    id: 'swe',
    label: 'Software Engineer',
    description: 'Building a new feature across the backend and frontend of a retail website',
    storylines: [
      // Merge target: one feature, one backend session + one frontend
      // session — merged together "for review", the most literal reading
      // of "merge frontend/backend sessions for review".
      {
        folder: 'retail-website/express-reorder',
        keywords: /reorder|order history|checkout/i,
        knowledge: `## Express Reorder feature

- **API shape**: \`GET /api/orders/reorder-eligible\` returns past orders eligible for one-click reorder (in stock, not a discontinued SKU, shipped to a still-valid address) — eligibility is computed server-side, not left to the client to guess.
- **UI placement**: the Reorder button lives on the order history page, not the product page — customers look for it where they're already reviewing past purchases.
- **Stock check happens twice**: once when rendering eligibility, once again at the moment of reorder (inventory can change between the two) — the button disables with an explicit "no longer available" state rather than silently failing.`,
        splitLabels: ['Backend API', 'Frontend UI'],
        sessions: [
          {
            source: 'claude',
            daysAgo: 2,
            title: 'Build reorder-eligibility API for past purchases',
            summary:
              'Designed and implemented GET /api/orders/reorder-eligible, returning past orders eligible for one-click ' +
              'reorder. Eligibility computed server-side: item still in stock, SKU not discontinued, shipping address ' +
              'still valid. Added a second eligibility check at reorder time since inventory can change in between.',
            tags: ['backend', 'checkout', 'api', 'nodejs'],
            turns: [
              turn('user', "Product wants a 'reorder' button on order history so customers can rebuy past purchases in one click. What does the API need to check?"),
              turn(
                'assistant',
                "At minimum: item still in stock, SKU not discontinued, and the shipping address on the order is still valid. I'll add GET " +
                  "/api/orders/reorder-eligible that returns past orders with an eligible:true/false flag per line item, computed server-side " +
                  "so the frontend doesn't have to duplicate that logic.",
              ),
              turn('user', "What if stock changes between when they load the page and when they actually click reorder?"),
              turn(
                'assistant',
                "Good catch — I'll re-check eligibility at the actual reorder-submit endpoint too, not just when rendering the list. If it's gone " +
                  'stale by then, the API returns a specific "no longer available" error the frontend can show instead of a generic failure.',
              ),
            ],
          },
          {
            source: 'codex',
            daysAgo: 1,
            title: "Build 'Reorder' button UI on order history page",
            summary:
              'Implemented the Reorder button on the order history page, wired to the new reorder-eligibility API. ' +
              'Button disables with an explicit "no longer available" state when the second, reorder-time eligibility ' +
              'check fails, instead of a generic error.',
            tags: ['frontend', 'react', 'checkout'],
            turns: [
              turn('user', "Backend's reorder-eligibility API is ready. Let's wire up the button on order history."),
              turn(
                'assistant',
                'Added a Reorder button next to each eligible past order, reading the eligible flag from the API response to decide whether to ' +
                  "render it enabled or hidden. Clicking it calls the reorder-submit endpoint and adds the items to the cart.",
              ),
              turn('user', 'What happens if it fails the second eligibility check at submit time?'),
              turn(
                'assistant',
                'The button shows a "no longer available" state inline instead of a generic error toast, and updates just that line item — the rest ' +
                  "of the order stays reorderable. Tested with a mid-flight stock change and it degrades cleanly.",
              ),
            ],
          },
        ],
      },
      {
        folder: 'retail-website/cart-rounding-fix',
        keywords: /cart total|rounding|floating.?point|price/i,
        knowledge: `## Cart pricing

- **Rounding rule**: round to the nearest cent AFTER summing line items in fixed-point cents (integers), never sum floating-point dollar values first — that's what caused the 1-cent-off cart totals.
- **Where it was wrong**: per-line-item rounding, then summing the rounded values, drifted from summing-then-rounding once by a cent on carts with 3+ items at certain price combinations.`,
        sessions: [
          {
            source: 'claude',
            daysAgo: 5,
            title: 'Investigate cart total off by one cent on some orders',
            summary:
              'Investigated customer reports of cart totals being 1 cent off the sum of visible line items. Root cause: ' +
              'each line item was rounded to the nearest cent individually before summing, instead of summing exact ' +
              'values first and rounding once at the end — floating-point drift compounded across 3+ items.',
            tags: ['backend', 'pricing', 'bug'],
            turns: [
              turn('user', "A few customers are reporting their cart total is 1 cent off from adding up the line items themselves. Can you dig in?"),
              turn(
                'assistant',
                "Reproduced it on a 3-item cart. We're rounding each line item to the nearest cent individually before summing, but the actual " +
                  'prices are floating-point dollars — summing the rounded values can drift a cent from summing the exact values and rounding once at the end.',
              ),
              turn('user', 'So the fix is round-once-at-the-end instead of round-per-item?'),
              turn(
                'assistant',
                "Right, and while I'm in there I'll switch the whole cart total calculation to fixed-point cents (integers) instead of floating-point " +
                  "dollars — floating point shouldn't be doing money math at all, this bug is a symptom of a bigger foot-gun.",
              ),
            ],
          },
          {
            source: 'kiro',
            daysAgo: 4,
            title: 'Fix cart total rounding by switching to fixed-point cents',
            summary:
              "Fixed the cart total rounding bug by converting all cart price math to fixed-point cents (integers), " +
              "summing first and converting to display dollars only at render time. Verified against the exact " +
              "customer-reported cart combinations.",
            tags: ['backend', 'pricing', 'bug'],
            turns: [
              turn('user', "Go ahead with the fixed-point cents fix we discussed."),
              turn(
                'assistant',
                'Converted line-item prices to integer cents at the point they enter cart math, sum in cents, and only convert back to a display ' +
                  "dollar string at render time. No rounding happens mid-calculation anymore, only once at the very end for display.",
              ),
              turn('user', 'Did you verify against the carts customers actually reported?'),
              turn('assistant', "Yes — reproduced both reported combinations with the old code, confirmed both are now exact with the fixed-point version."),
            ],
          },
        ],
      },
      {
        folder: 'retail-website/image-lazy-loading',
        keywords: /lazy.?load|image|largest contentful paint|lcp|performance/i,
        knowledge: `## Product listing performance

- **Lazy-load below the fold only**: the first 2 rows of product images load eagerly (they're above the fold on most viewports) — lazy-loading those too regressed LCP by delaying the actual hero content.
- **Native \`loading="lazy"\`** was enough — no need for an IntersectionObserver-based library given browser support is already there for the target audience.`,
        sessions: [
          {
            source: 'codex',
            daysAgo: 7,
            title: 'Investigate slow product listing page load',
            summary:
              'Investigated slow product listing page loads, tracing it to all product images (often 40+ per page) ' +
              'loading eagerly regardless of scroll position. Largest Contentful Paint was being delayed by images far ' +
              'below the fold competing for bandwidth with the actually-visible ones.',
            tags: ['frontend', 'performance', 'react'],
            turns: [
              turn('user', "Product listing pages feel slow to load, especially on mobile. Can you profile it?"),
              turn(
                'assistant',
                "Traced it to image loading — a page can have 40+ product images and they're all loading eagerly regardless of scroll position. " +
                  "Largest Contentful Paint is getting delayed because images way below the fold are competing for bandwidth with the ones actually visible.",
              ),
              turn('user', 'Lazy-loading should fix that, right?'),
              turn('assistant', "Yes, but I want to be careful about exactly where the fold cutoff is — lazy-loading images that ARE visible on load would make things worse, not better."),
            ],
          },
          {
            source: 'claude',
            daysAgo: 6,
            title: 'Add lazy-loading for below-the-fold product images',
            summary:
              'Added native loading="lazy" to product images below the first 2 rows (empirically above-the-fold on ' +
              'target viewports); first 2 rows stay eager. Verified LCP improvement and confirmed no regression from ' +
              'lazy-loading rows that were actually visible on load.',
            tags: ['frontend', 'performance', 'react'],
            turns: [
              turn('user', "Let's add the lazy-loading, keeping the first couple rows eager like we discussed."),
              turn(
                'assistant',
                'Added native loading="lazy" to every product image starting from row 3 onward — rows 1-2 stay eager since they\'re above the fold ' +
                  'on our target viewport sizes. Used the native attribute rather than an IntersectionObserver library since browser support is already there.',
              ),
              turn('user', 'Did LCP actually improve?'),
              turn('assistant', "Yes, measured improvement on the listing page, and confirmed rows 1-2 still render immediately — no flash of missing images on load."),
            ],
          },
        ],
      },
    ],
    mergeStorylineIndex: 0,
  },
  {
    id: 'cse',
    label: 'Cloud Support Engineer',
    description: 'Cross-service troubleshooting between an on-prem network and a VPC',
    storylines: [
      // Merge target: three separate investigation threads (DX, VPC, ALB)
      // that turn out to be one incident — merging all three (mergeSessions()
      // accepts 2+ ids already) into one record is what actually surfaces
      // the MTU root cause spanning all of them.
      {
        folder: 'cases/onprem-connectivity',
        keywords: /direct connect|bgp|vpc route|security group|target health|mtu|onprem/i,
        knowledge: `## On-prem ↔ VPC connectivity

- **Root cause pattern**: intermittent large-payload failures across an on-prem↔VPC path are an MTU mismatch until proven otherwise — check the Direct Connect virtual interface's jumbo frame setting against the VPC route/security-group path before assuming application-layer causes.
- **Where this one hid**: DX BGP session and VPC routing both looked healthy in isolation — only became visible once ALB target health (large POST bodies specifically failing) was correlated against the DX interface's MTU setting (1500 vs the on-prem side's 9001).
- **Fix**: aligned MTU to 1500 end-to-end on the DX virtual interface rather than raising the VPC side to jumbo — simpler blast radius, since jumbo frames aren't supported all the way through the on-prem path anyway.`,
        splitLabels: ['Investigation across DX/VPC/ALB', 'MTU root cause & fix'],
        sessions: [
          {
            source: 'claude',
            daysAgo: 3,
            title: 'Check Direct Connect BGP session for onprem-VPC link',
            summary:
              'Checked Direct Connect BGP session status for the on-prem-to-VPC link after reports of intermittent ' +
              'connectivity failures on large requests. BGP session itself is up and stable, route advertisements look ' +
              'correct — DX layer alone does not explain the failures.',
            tags: ['aws', 'direct-connect', 'bgp', 'networking'],
            turns: [
              turn('user', "Customer's reporting intermittent failures on large requests between their on-prem network and our VPC. Can you check the DX side first?"),
              turn(
                'assistant',
                "BGP session on the Direct Connect virtual interface is up and stable — no flapping in the last 7 days. Route advertisements from " +
                  "on-prem look correct and the VPC route table has the expected propagated routes. DX layer alone doesn't explain intermittent large-request failures.",
              ),
              turn('user', 'So it looks fine at the DX level — worth checking VPC routing/security groups next?'),
              turn('assistant', "Yes, that's the next layer to rule out. I'll check VPC route tables and security groups on the affected subnets."),
            ],
          },
          {
            source: 'codex',
            daysAgo: 3,
            title: 'Check VPC route tables and security groups for onprem traffic',
            summary:
              'Checked VPC route tables and security groups for the subnets handling on-prem traffic. Routes correctly ' +
              'point on-prem CIDR ranges at the DX virtual private gateway; security groups allow the required ports. ' +
              'No obvious VPC-layer misconfiguration explaining the intermittent large-request failures.',
            tags: ['aws', 'vpc', 'security-groups', 'networking'],
            turns: [
              turn('user', "DX layer checks out. Can you look at VPC routing and security groups for the affected subnets?"),
              turn(
                'assistant',
                "Route tables correctly point the on-prem CIDR ranges at the DX virtual private gateway, and security groups allow the ports the " +
                  "application actually uses. Nothing obviously wrong at the VPC layer either — this is starting to look like it's specific to request size, not routing.",
              ),
              turn('user', "Specific to request size is a good lead. What's next?"),
              turn('assistant', "I want to check ALB target health during a failure window — if it's correlated with large POST bodies specifically, that points somewhere more specific than general connectivity."),
            ],
          },
          {
            source: 'kiro',
            daysAgo: 2,
            title: 'Check ALB target health for onprem-originated requests',
            summary:
              'Checked ALB target health during a reported failure window. Found failures correlated specifically with ' +
              'large POST request bodies from on-prem, not general connectivity. Suspected MTU mismatch — confirmed the ' +
              'DX virtual interface is set to standard 1500 MTU while the on-prem side sends up to 9001 (jumbo frames).',
            tags: ['aws', 'elb', 'alb', 'networking', 'mtu'],
            turns: [
              turn('user', "Any correlation between the failures and ALB target health during the failure window?"),
              turn(
                'assistant',
                "Yes — target health checks pass consistently, but the actual failures correlate specifically with large POST request bodies from " +
                  "on-prem. Small requests never fail. That pattern points at fragmentation, not routing or health.",
              ),
              turn('user', 'Fragmentation — could this be an MTU mismatch?'),
              turn(
                'assistant',
                "Checking now — the Direct Connect virtual interface is set to standard 1500 MTU, but the on-prem network sends up to 9001 (jumbo " +
                  "frames) on that path. Packets over 1500 bytes get fragmented or dropped depending on the path, which lines up exactly with large-request-only failures.",
              ),
            ],
          },
        ],
      },
      {
        folder: 'cases/s3-cross-account',
        keywords: /s3|cross-account|bucket policy|access denied/i,
        knowledge: `## S3 cross-account access

- **Both sides need a statement**: cross-account S3 access needs the bucket policy (resource side) to grant the account/role AND the requesting role's own IAM policy to allow the \`s3:GetObject\` action — missing either one produces the same generic AccessDenied, which makes it easy to fix only one side and still fail.
- **KMS adds a third side**: if the bucket uses a customer-managed KMS key, the key policy also needs to grant \`kms:Decrypt\` to the external account — this was the one actually missing here, not the bucket policy.`,
        sessions: [
          {
            source: 'claude',
            daysAgo: 6,
            title: 'Investigate S3 cross-account AccessDenied for partner account',
            summary:
              "Investigated AccessDenied errors from a partner account trying to read objects from a customer's S3 " +
              "bucket. Bucket policy already granted the partner account s3:GetObject. Root cause: the bucket uses a " +
              "customer-managed KMS key, and the key policy did not grant kms:Decrypt to the partner account.",
            tags: ['aws', 's3', 'kms', 'iam'],
            turns: [
              turn('user', "Customer's partner account is getting AccessDenied reading objects from their S3 bucket, even though the bucket policy grants s3:GetObject to that account. Can you take a look?"),
              turn(
                'assistant',
                "Confirmed the bucket policy grants the partner account s3:GetObject and the partner's own IAM role allows the action too — so it's not " +
                  "the usual both-sides-need-a-statement issue. Bucket also uses a customer-managed KMS key for encryption, which is a common third culprit.",
              ),
              turn('user', 'Is the KMS key policy the missing piece?'),
              turn('assistant', "Checking the key policy now — this is exactly the kind of thing that produces the same generic AccessDenied as a bucket policy issue, so worth ruling in or out explicitly."),
            ],
          },
          {
            source: 'codex',
            daysAgo: 5,
            title: 'Resolve S3 cross-account access by fixing KMS key policy',
            summary:
              "Resolved the cross-account AccessDenied by adding kms:Decrypt for the partner account to the bucket's " +
              "KMS key policy. Verified the partner account can now read objects successfully.",
            tags: ['aws', 's3', 'kms', 'iam'],
            turns: [
              turn('user', "Confirmed — key policy didn't have the partner account at all. Can you fix it?"),
              turn(
                'assistant',
                "Added a statement granting kms:Decrypt on the key to the partner account's role ARN, alongside the existing bucket policy and IAM " +
                  "grants (which were already correct). All three pieces — bucket policy, partner IAM role, KMS key policy — now align.",
              ),
              turn('user', 'Can you confirm with the partner that it works now?'),
              turn('assistant', "Yes, had them re-run their read — succeeded. Documented all three required grants so this doesn't get half-fixed again if it recurs elsewhere."),
            ],
          },
        ],
      },
    ],
    mergeStorylineIndex: 0,
  },
  {
    id: 'sa',
    label: 'Solutions Architect',
    description: 'Architecting a new AI agent platform for a customer, across research and customer meetings',
    storylines: [
      // Merge target: two research sessions (best practices + reference
      // architectures) merged into one consolidated body of research, the
      // literal basis for "propose new architecture and slide creation".
      {
        folder: 'customers/nimbustech',
        keywords: /agent platform|multi-agent|orchestrat|best practices|reference architecture/i,
        knowledge: `## NimbusTech AI agent platform

- **Orchestration pattern**: favor a single coordinator agent delegating to narrow specialist agents over one large general-purpose agent — matches what worked in the surveyed reference architectures and keeps individual agent prompts/tools reviewable.
- **State**: shared state belongs in an external store (not agent memory) so any agent can pick up a task mid-flight — the reference architectures that skipped this hit reliability walls once conversations got multi-step.
- **Slide structure for the proposal**: current-state pain points → proposed architecture (with the coordinator/specialist diagram) → phased migration plan. Leading with pain points anchored the architecture discussion in the customer's own language rather than abstract patterns.`,
        splitLabels: ['Best practices findings', 'Reference architectures'],
        sessions: [
          {
            source: 'claude',
            daysAgo: 4,
            title: "Research AI agent platform best practices for NimbusTech",
            summary:
              'Researched best practices for building an AI agent platform ahead of proposing an architecture to ' +
              "NimbusTech. Key finding: a coordinator agent delegating to narrow specialist agents outperforms one " +
              "large general-purpose agent on reliability and reviewability. Shared state needs to live in an external " +
              "store, not agent memory, for multi-step tasks to survive handoffs.",
            tags: ['ai-agents', 'architecture', 'research'],
            turns: [
              turn('user', "Before we propose anything to NimbusTech, let's ground this in actual best practices for agent platform design. What's out there?"),
              turn(
                'assistant',
                "The strongest recurring pattern is a coordinator agent that delegates to narrow specialist agents, rather than one large general-purpose " +
                  "agent trying to do everything — it's more reliable and each specialist's prompt/tools stay small enough to actually review.",
              ),
              turn('user', 'What about state across a multi-step task?'),
              turn(
                'assistant',
                "Shared state needs to live in an external store, not just in whatever agent is currently handling the task — otherwise handing off " +
                  "mid-task loses context. I'll pull together a couple more sources on this before we move to reference architectures.",
              ),
            ],
          },
          {
            source: 'codex',
            daysAgo: 3,
            title: 'Research reference architectures for multi-agent platforms',
            summary:
              "Researched published reference architectures for multi-agent platforms, comparing coordinator/specialist " +
              "patterns across several. Confirmed the external-state-store pattern is what separates architectures that " +
              "held up under multi-step conversations from ones that hit reliability walls.",
            tags: ['ai-agents', 'architecture', 'research'],
            turns: [
              turn('user', "Let's look at how other teams have actually architected this, not just principles in the abstract."),
              turn(
                'assistant',
                "Compared a handful of published reference architectures — the coordinator/specialist split shows up consistently, but the ones that " +
                  "kept agent state purely in-memory per-conversation are the ones with documented reliability issues once tasks got multi-step.",
              ),
              turn('user', 'So the external-state-store point from the best-practices research holds up against real examples too.'),
              turn('assistant', "Exactly — that's the one piece I'd flag as non-negotiable in the proposal, not just a nice-to-have. Ready to start drafting the architecture proposal and slides."),
            ],
          },
        ],
      },
      {
        folder: 'customers/globex',
        keywords: /globex|discovery|current.?state|pain points/i,
        knowledge: `## Globex engagement

- **Current-state pain point**: their existing automation is a set of disconnected scripts with no shared context between runs — the discovery call surfaced this as the actual blocker, not a lack of AI capability.
- **Scope for the architecture review**: keep the first proposal narrow (one workflow, not a platform rebuild) — Globex's own team flagged rebuild fatigue from a previous initiative.`,
        sessions: [
          {
            source: 'kiro',
            daysAgo: 8,
            title: 'Discovery meeting with Globex — current automation pain points',
            summary:
              "Ran a discovery meeting with Globex to understand their current automation setup ahead of proposing an " +
              "AI agent solution. Their existing automation is a set of disconnected scripts with no shared context " +
              "between runs — that's the actual blocker, not a lack of AI capability. Team flagged rebuild fatigue " +
              "from a previous initiative, so scope should stay narrow.",
            tags: ['customer', 'discovery', 'meeting'],
            turns: [
              turn('user', "Notes from today's Globex discovery call — what's actually broken in their current setup?"),
              turn(
                'assistant',
                "Their automation today is a pile of disconnected scripts with no shared context between runs — someone has to manually stitch " +
                  "outputs together. That's the real blocker, not a lack of AI capability like they initially framed it.",
              ),
              turn('user', 'Anything to be careful about scoping-wise?'),
              turn('assistant', "Their team explicitly mentioned rebuild fatigue from a previous platform initiative that stalled. I'd keep the first proposal narrow — one workflow end-to-end, not a platform rebuild pitch."),
            ],
          },
          {
            source: 'claude',
            daysAgo: 7,
            title: 'Architecture review meeting with Globex — proposed narrow-scope workflow',
            summary:
              "Presented a narrow-scope architecture proposal to Globex addressing the shared-context gap identified in " +
              "discovery, framed as one workflow rather than a platform rebuild. Positively received — team appreciated " +
              "that it directly addressed their stated pain point instead of a broader pitch.",
            tags: ['customer', 'architecture-review', 'meeting'],
            turns: [
              turn('user', "How did the architecture review land with Globex?"),
              turn(
                'assistant',
                "Went well — presented it as a single workflow that gives their scripts shared context via a coordinator, not a platform rebuild. " +
                  "Because it mapped directly to the pain point from discovery instead of a bigger pitch, there wasn't the skepticism I was expecting given the rebuild fatigue.",
              ),
              turn('user', 'Any pushback or open questions?'),
              turn('assistant', "Mainly timeline questions, nothing architectural. I'll follow up with a phased rollout plan next."),
            ],
          },
        ],
      },
      {
        folder: 'customers/initech',
        keywords: /initech|kickoff|migration/i,
        knowledge: `## Initech engagement

- **Migration framing matters**: Initech's stakeholders responded better to "migrate incrementally, keep the old system running in parallel" than any all-at-once framing — even though the technical plan barely changed, leading with the parallel-run detail changed the room.`,
        sessions: [
          {
            source: 'codex',
            daysAgo: 10,
            title: 'Kickoff meeting with Initech — AI agent platform migration',
            summary:
              "Kickoff meeting with Initech to scope a migration from their legacy rules-engine automation to an AI " +
              "agent platform. Agreed on an incremental migration running the old system in parallel rather than a " +
              "cutover, based on stakeholder risk appetite discussed in the meeting.",
            tags: ['customer', 'kickoff', 'meeting'],
            turns: [
              turn('user', "Kickoff with Initech — what's the shape of this migration?"),
              turn(
                'assistant',
                "They're moving off a legacy rules-engine automation system. Given how risk-averse the room was about a cutover, we agreed on an " +
                  "incremental migration — new agent platform runs in parallel with the old system until each workflow is proven out.",
              ),
              turn('user', 'Does that change the technical plan much?'),
              turn('assistant', "Barely — the parallel-run framing is mostly about sequencing and stakeholder comfort, not a different architecture. I'll draft the migration architecture review for next week."),
            ],
          },
          {
            source: 'kiro',
            daysAgo: 9,
            title: 'Migration architecture review with Initech',
            summary:
              "Presented the migration architecture to Initech: new agent platform running in parallel with the legacy " +
              "rules engine, workflows cut over one at a time once proven. Leading with the parallel-run detail (over " +
              "the technical architecture itself) is what actually landed with stakeholders.",
            tags: ['customer', 'architecture-review', 'migration', 'meeting'],
            turns: [
              turn('user', "How'd the migration architecture review go?"),
              turn(
                'assistant',
                "Landed well once I led with the parallel-run detail — old system keeps running, workflows cut over one at a time once each is proven. " +
                  "That's what actually changed the room's comfort level, even though the underlying technical architecture was the same plan we discussed at kickoff.",
              ),
              turn('user', 'Worth remembering for future migrations, not just Initech.'),
              turn('assistant', "Agreed — I'll note it as a general pattern: for risk-averse stakeholders, lead migration proposals with the rollback/parallel-run story, not the target architecture."),
            ],
          },
        ],
      },
    ],
    mergeStorylineIndex: 0,
  },
];

export function findPersona(personaId) {
  return PERSONAS.find((p) => p.id === personaId) || PERSONAS[0];
}
