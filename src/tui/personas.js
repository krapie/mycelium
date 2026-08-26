// Shared source of truth for the tutorial/`mycelium demo`'s mock content —
// one place per persona/storyline instead of two files independently
// hardcoding folder names. `mergeStorylineIndex` names the storyline the
// tutorial's Shift+M/S steps operate on. Most fields are `{en, ko}`;
// `folder`/`tags` stay single ASCII values, and `keywords` is genuinely
// language-specific, not just a translation (matched against whichever
// language the mock summary renders in).

function turn(role, en, ko) {
  return { role, en, ko };
}

export const PERSONAS = [
  {
    id: 'swe',
    label: { en: 'Software Engineer', ko: '소프트웨어 엔지니어' },
    description: {
      en: 'Building a new feature across the backend and frontend of a retail website',
      ko: '리테일 웹사이트의 백엔드와 프론트엔드에 걸쳐 새 기능을 개발하는 중',
    },
    storylines: [
      // Merge target: one feature, one backend session + one frontend
      // session — merged together "for review", the most literal reading
      // of "merge frontend/backend sessions for review".
      {
        folder: 'retail-website/express-reorder',
        keywords: {
          en: /reorder|order history|checkout/i,
          ko: /재주문|주문\s*내역|결제/i,
        },
        knowledge: {
          en: `## Express Reorder feature

- **API shape**: \`GET /api/orders/reorder-eligible\` returns past orders eligible for one-click reorder (in stock, not a discontinued SKU, shipped to a still-valid address) — eligibility is computed server-side, not left to the client to guess.
- **UI placement**: the Reorder button lives on the order history page, not the product page — customers look for it where they're already reviewing past purchases.
- **Stock check happens twice**: once when rendering eligibility, once again at the moment of reorder (inventory can change between the two) — the button disables with an explicit "no longer available" state rather than silently failing.`,
          ko: `## 익스프레스 재주문 기능

- **API 구조**: \`GET /api/orders/reorder-eligible\`는 원클릭 재주문이 가능한 과거 주문을 반환한다 (재고 보유, 단종 SKU 아님, 아직 유효한 배송 주소로 배송됨) — 재주문 가능 여부는 서버 측에서 계산하며, 클라이언트가 추측하도록 두지 않는다.
- **UI 위치**: 재주문 버튼은 상품 페이지가 아니라 주문 내역 페이지에 있다 — 고객이 이미 과거 구매를 살펴보고 있는 곳에 배치해야 자연스럽다.
- **재고 확인은 두 번**: 재주문 가능 여부를 렌더링할 때 한 번, 실제 재주문 시점에 다시 한 번 — 그 사이 재고가 바뀔 수 있기 때문이다. 버튼은 조용히 실패하는 대신 명시적인 "더 이상 구매 불가" 상태로 비활성화된다.`,
        },
        splitLabels: {
          en: ['Backend API', 'Frontend UI'],
          ko: ['백엔드 API', '프론트엔드 UI'],
        },
        sessions: [
          {
            source: 'claude',
            daysAgo: 2,
            title: {
              en: 'Build reorder-eligibility API for past purchases',
              ko: '과거 구매 재주문 가능 여부 API 구현',
            },
            summary: {
              en:
                'Designed and implemented GET /api/orders/reorder-eligible, returning past orders eligible for one-click ' +
                'reorder. Eligibility computed server-side: item still in stock, SKU not discontinued, shipping address ' +
                'still valid. Added a second eligibility check at reorder time since inventory can change in between.',
              ko:
                '과거 주문 중 원클릭 재주문이 가능한 항목을 반환하는 GET /api/orders/reorder-eligible API를 설계하고 구현. ' +
                '재주문 가능 여부는 서버 측에서 계산: 재고 보유 여부, 단종 SKU 여부, 배송 주소 유효성을 확인. 재고는 그 사이 ' +
                '변동될 수 있어 재주문 시점에 한 번 더 확인하는 로직을 추가함.',
            },
            tags: ['backend', 'checkout', 'api', 'nodejs'],
            turns: [
              turn(
                'user',
                "Product wants a 'reorder' button on order history so customers can rebuy past purchases in one click. What does the API need to check?",
                "상품팀에서 주문 내역 페이지에 '재주문' 버튼을 넣어서 고객이 과거 구매를 원클릭으로 다시 살 수 있게 하고 싶어해요. API에서는 뭘 확인해야 할까요?",
              ),
              turn(
                'assistant',
                "At minimum: item still in stock, SKU not discontinued, and the shipping address on the order is still valid. I'll add GET " +
                  "/api/orders/reorder-eligible that returns past orders with an eligible:true/false flag per line item, computed server-side " +
                  "so the frontend doesn't have to duplicate that logic.",
                '최소한 재고 보유 여부, SKU 단종 여부, 주문 당시 배송 주소가 아직 유효한지는 확인해야 해요. GET /api/orders/reorder-eligible를 ' +
                  '추가해서 과거 주문마다 라인 아이템 단위로 eligible:true/false 플래그를 서버 측에서 계산해 내려줄게요 — 프론트에서 같은 로직을 ' +
                  '중복 구현할 필요 없게요.',
              ),
              turn(
                'user',
                'What if stock changes between when they load the page and when they actually click reorder?',
                '페이지 로드 시점이랑 실제로 재주문 버튼을 누르는 시점 사이에 재고가 바뀌면 어떻게 하죠?',
              ),
              turn(
                'assistant',
                "Good catch — I'll re-check eligibility at the actual reorder-submit endpoint too, not just when rendering the list. If it's gone " +
                  'stale by then, the API returns a specific "no longer available" error the frontend can show instead of a generic failure.',
                '좋은 지적이에요 — 목록을 렌더링할 때뿐 아니라 실제 재주문 제출 엔드포인트에서도 한 번 더 재고 여부를 확인할게요. 그 사이 재고가 ' +
                  '없어졌다면 API가 구체적으로 "더 이상 구매 불가" 에러를 반환해서 프론트가 일반 에러 대신 명확하게 보여줄 수 있게 할게요.',
              ),
            ],
          },
          {
            source: 'codex',
            daysAgo: 1,
            title: {
              en: "Build 'Reorder' button UI on order history page",
              ko: "주문 내역 페이지에 '재주문' 버튼 UI 구현",
            },
            summary: {
              en:
                'Implemented the Reorder button on the order history page, wired to the new reorder-eligibility API. ' +
                'Button disables with an explicit "no longer available" state when the second, reorder-time eligibility ' +
                'check fails, instead of a generic error.',
              ko:
                '새로 만든 재주문 가능 여부 API와 연동해 주문 내역 페이지에 재주문 버튼을 구현. 제출 시점의 두 번째 재고 확인이 ' +
                '실패하면 일반 에러 대신 명시적인 "더 이상 구매 불가" 상태를 보여줌.',
            },
            tags: ['frontend', 'react', 'checkout'],
            turns: [
              turn(
                'user',
                "Backend's reorder-eligibility API is ready. Let's wire up the button on order history.",
                '백엔드 재주문 가능 여부 API가 준비됐어요. 주문 내역 페이지에 버튼을 붙여볼까요.',
              ),
              turn(
                'assistant',
                'Added a Reorder button next to each eligible past order, reading the eligible flag from the API response to decide whether to ' +
                  'render it enabled or hidden. Clicking it calls the reorder-submit endpoint and adds the items to the cart.',
                '재주문 가능한 과거 주문마다 옆에 재주문 버튼을 추가했고, API 응답의 eligible 플래그로 활성화/숨김을 결정해요. 버튼을 누르면 ' +
                  '재주문 제출 엔드포인트를 호출해서 장바구니에 담아요.',
              ),
              turn(
                'user',
                'What happens if it fails the second eligibility check at submit time?',
                '제출 시점 재고 확인이 실패하면 어떻게 되나요?',
              ),
              turn(
                'assistant',
                'The button shows a "no longer available" state inline instead of a generic error toast, and updates just that line item — the rest ' +
                  'of the order stays reorderable. Tested with a mid-flight stock change and it degrades cleanly.',
                '해당 라인 아이템만 인라인으로 "더 이상 구매 불가" 상태를 보여주고, 나머지 주문 항목은 그대로 재주문 가능하게 유지돼요. 도중에 ' +
                  '재고가 바뀌는 상황도 테스트해봤는데 자연스럽게 처리되더라고요.',
              ),
            ],
          },
        ],
      },
      {
        folder: 'retail-website/cart-rounding-fix',
        keywords: {
          en: /cart total|rounding|floating.?point|price/i,
          ko: /장바구니\s*합계|반올림|부동소수점|가격/i,
        },
        knowledge: {
          en: `## Cart pricing

- **Rounding rule**: round to the nearest cent AFTER summing line items in fixed-point cents (integers), never sum floating-point dollar values first — that's what caused the 1-cent-off cart totals.
- **Where it was wrong**: per-line-item rounding, then summing the rounded values, drifted from summing-then-rounding once by a cent on carts with 3+ items at certain price combinations.`,
          ko: `## 장바구니 가격 계산

- **반올림 규칙**: 라인 아이템을 정수 센트(고정소수점)로 먼저 합산한 뒤 마지막에 한 번만 반올림한다 — 부동소수점 달러 값을 먼저 더하면 안 된다. 이것이 1센트 오차의 원인이었다.
- **무엇이 잘못됐었나**: 라인 아이템마다 개별적으로 반올림한 뒤 합산하는 방식은, 항목이 3개 이상이고 특정 가격 조합일 때 정확한 값을 먼저 합산한 뒤 한 번만 반올림하는 방식과 최대 1센트까지 어긋났다.`,
        },
        sessions: [
          {
            source: 'claude',
            daysAgo: 5,
            title: {
              en: 'Investigate cart total off by one cent on some orders',
              ko: '일부 주문에서 장바구니 합계가 1센트 어긋나는 문제 조사',
            },
            summary: {
              en:
                'Investigated customer reports of cart totals being 1 cent off the sum of visible line items. Root cause: ' +
                'each line item was rounded to the nearest cent individually before summing, instead of summing exact ' +
                'values first and rounding once at the end — floating-point drift compounded across 3+ items.',
              ko:
                '고객들이 장바구니 합계가 화면에 보이는 라인 아이템 합과 1센트 차이난다고 제보한 문제를 조사. 원인: 라인 ' +
                '아이템을 각각 반올림한 뒤 합산했는데, 정확한 값을 먼저 합산하고 마지막에 한 번만 반올림해야 했음 — 항목이 ' +
                '3개 이상일 때 부동소수점 오차가 누적됨.',
            },
            tags: ['backend', 'pricing', 'bug'],
            turns: [
              turn(
                'user',
                "A few customers are reporting their cart total is 1 cent off from adding up the line items themselves. Can you dig in?",
                '고객 몇 명이 장바구니 라인 아이템을 직접 더한 값이랑 합계가 1센트 차이난다고 하는데, 한번 봐줄 수 있어요?',
              ),
              turn(
                'assistant',
                "Reproduced it on a 3-item cart. We're rounding each line item to the nearest cent individually before summing, but the actual " +
                  'prices are floating-point dollars — summing the rounded values can drift a cent from summing the exact values and rounding once at the end.',
                '3개 항목짜리 장바구니로 재현했어요. 라인 아이템마다 개별적으로 센트 단위로 반올림한 뒤 합산하고 있는데, 실제 가격은 ' +
                  '부동소수점 달러 값이라 반올림된 값들을 더한 결과가 정확한 값을 먼저 더하고 한 번만 반올림한 값과 1센트 어긋날 수 있어요.',
              ),
              turn(
                'user',
                'So the fix is round-once-at-the-end instead of round-per-item?',
                '그럼 매번 반올림하지 말고 마지막에 한 번만 반올림하는 게 해결책인가요?',
              ),
              turn(
                'assistant',
                "Right, and while I'm in there I'll switch the whole cart total calculation to fixed-point cents (integers) instead of floating-point " +
                  "dollars — floating point shouldn't be doing money math at all, this bug is a symptom of a bigger foot-gun.",
                '네, 맞아요. 겸사겸사 장바구니 합계 계산 전체를 부동소수점 달러 대신 정수 센트(고정소수점)로 바꿀게요 — 애초에 금액 ' +
                  '계산에 부동소수점을 쓰면 안 되고, 이 버그도 그 큰 문제의 한 증상이에요.',
              ),
            ],
          },
          {
            source: 'kiro',
            daysAgo: 4,
            title: {
              en: 'Fix cart total rounding by switching to fixed-point cents',
              ko: '고정소수점 센트 방식으로 전환해 장바구니 반올림 버그 수정',
            },
            summary: {
              en:
                'Fixed the cart total rounding bug by converting all cart price math to fixed-point cents (integers), ' +
                'summing first and converting to display dollars only at render time. Verified against the exact ' +
                'customer-reported cart combinations.',
              ko:
                '장바구니 가격 계산을 전부 정수 센트(고정소수점)로 바꾸고, 먼저 합산한 뒤 렌더링 시점에만 달러로 변환하도록 ' +
                '수정해 반올림 버그를 해결. 고객이 실제로 제보한 장바구니 조합으로 검증함.',
            },
            tags: ['backend', 'pricing', 'bug'],
            turns: [
              turn(
                'user',
                'Go ahead with the fixed-point cents fix we discussed.',
                '어제 얘기한 고정소수점 센트 방식으로 수정 진행해주세요.',
              ),
              turn(
                'assistant',
                'Converted line-item prices to integer cents at the point they enter cart math, sum in cents, and only convert back to a display ' +
                  'dollar string at render time. No rounding happens mid-calculation anymore, only once at the very end for display.',
                '라인 아이템 가격이 장바구니 계산에 들어오는 시점부터 정수 센트로 변환하고, 센트 단위로 합산한 뒤 렌더링 시점에만 화면용 ' +
                  '달러 문자열로 변환하도록 바꿨어요. 계산 도중에는 더 이상 반올림이 일어나지 않고, 맨 마지막 화면 표시 시점에 딱 한 번만 일어나요.',
              ),
              turn(
                'user',
                'Did you verify against the carts customers actually reported?',
                '고객이 실제로 제보한 장바구니로 검증해봤어요?',
              ),
              turn(
                'assistant',
                "Yes — reproduced both reported combinations with the old code, confirmed both are now exact with the fixed-point version.",
                '네 — 기존 코드로 두 가지 제보된 조합을 재현해봤고, 고정소수점 버전에서는 둘 다 정확히 맞는 걸 확인했어요.',
              ),
            ],
          },
        ],
      },
      {
        folder: 'retail-website/image-lazy-loading',
        keywords: {
          en: /lazy.?load|image|largest contentful paint|lcp|performance/i,
          ko: /지연\s*로딩|이미지|LCP|성능/i,
        },
        knowledge: {
          en: `## Product listing performance

- **Lazy-load below the fold only**: the first 2 rows of product images load eagerly (they're above the fold on most viewports) — lazy-loading those too regressed LCP by delaying the actual hero content.
- **Native \`loading="lazy"\`** was enough — no need for an IntersectionObserver-based library given browser support is already there for the target audience.`,
          ko: `## 상품 목록 페이지 성능

- **접힌 영역 아래만 지연 로딩**: 상품 이미지 처음 2줄은 대부분 뷰포트 기준 접힌 영역(fold) 위쪽이라 즉시 로딩한다 — 이 부분까지 지연 로딩하면 실제 히어로 콘텐츠 표시가 늦어져 LCP가 오히려 나빠진다.
- **네이티브 \`loading="lazy"\`로 충분**: 대상 사용자층의 브라우저 지원이 이미 충분해서, IntersectionObserver 기반 라이브러리를 따로 쓸 필요가 없었다.`,
        },
        sessions: [
          {
            source: 'codex',
            daysAgo: 7,
            title: {
              en: 'Investigate slow product listing page load',
              ko: '느린 상품 목록 페이지 로딩 조사',
            },
            summary: {
              en:
                'Investigated slow product listing page loads, tracing it to all product images (often 40+ per page) ' +
                'loading eagerly regardless of scroll position. Largest Contentful Paint was being delayed by images far ' +
                'below the fold competing for bandwidth with the actually-visible ones.',
              ko:
                '느린 상품 목록 페이지 로딩을 조사한 결과, 페이지당 종종 40개가 넘는 상품 이미지가 스크롤 위치와 무관하게 ' +
                '전부 즉시 로딩되는 것이 원인으로 드러남. 접힌 영역(fold) 한참 아래에 있는 이미지들이 실제로 보이는 이미지들과 ' +
                '대역폭을 두고 경쟁하면서 LCP가 지연되고 있었음.',
            },
            tags: ['frontend', 'performance', 'react'],
            turns: [
              turn(
                'user',
                'Product listing pages feel slow to load, especially on mobile. Can you profile it?',
                '상품 목록 페이지가 특히 모바일에서 느리게 로드되는 느낌이에요. 프로파일링 좀 해줄 수 있어요?',
              ),
              turn(
                'assistant',
                "Traced it to image loading — a page can have 40+ product images and they're all loading eagerly regardless of scroll position. " +
                  'Largest Contentful Paint is getting delayed because images way below the fold are competing for bandwidth with the ones actually visible.',
                '이미지 로딩이 원인으로 나왔어요 — 페이지 하나에 상품 이미지가 40개 넘게 있는 경우도 있는데, 전부 스크롤 위치와 상관없이 ' +
                  '즉시 로딩되고 있어요. 접힌 영역 한참 아래에 있는 이미지들이 실제로 보이는 이미지들과 대역폭을 두고 경쟁하면서 LCP가 ' +
                  '지연되고 있고요.',
              ),
              turn('user', 'Lazy-loading should fix that, right?', '지연 로딩(lazy loading)을 적용하면 해결되겠네요?'),
              turn(
                'assistant',
                'Yes, but I want to be careful about exactly where the fold cutoff is — lazy-loading images that ARE visible on load would make things worse, not better.',
                '네, 근데 접힌 영역 경계가 정확히 어디인지는 신경 써야 해요 — 로드 시점에 이미 화면에 보이는 이미지까지 지연 로딩하면 오히려 ' +
                  '더 나빠질 수 있어서요.',
              ),
            ],
          },
          {
            source: 'opencode',
            daysAgo: 6,
            title: {
              en: 'Add lazy-loading for below-the-fold product images',
              ko: '접힌 영역 아래 상품 이미지에 지연 로딩 적용',
            },
            summary: {
              en:
                'Added native loading="lazy" to product images below the first 2 rows (empirically above-the-fold on ' +
                'target viewports); first 2 rows stay eager. Verified LCP improvement and confirmed no regression from ' +
                'lazy-loading rows that were actually visible on load.',
              ko:
                '처음 2줄(대상 뷰포트 기준 경험적으로 접힌 영역 위쪽)을 제외한 상품 이미지에 네이티브 loading="lazy"를 ' +
                '적용; 처음 2줄은 즉시 로딩 유지. LCP 개선을 확인했고, 실제로 화면에 보이던 줄을 지연 로딩해서 생기는 ' +
                '회귀도 없음을 확인.',
            },
            tags: ['frontend', 'performance', 'react'],
            turns: [
              turn(
                'user',
                "Let's add the lazy-loading, keeping the first couple rows eager like we discussed.",
                '얘기했던 대로 처음 몇 줄은 즉시 로딩 유지하면서 지연 로딩을 추가해볼까요.',
              ),
              turn(
                'assistant',
                'Added native loading="lazy" to every product image starting from row 3 onward — rows 1-2 stay eager since they\'re above the fold ' +
                  'on our target viewport sizes. Used the native attribute rather than an IntersectionObserver library since browser support is already there.',
                '3번째 줄부터 모든 상품 이미지에 네이티브 loading="lazy"를 적용했어요 — 1~2번째 줄은 대상 뷰포트 크기에서 접힌 영역 ' +
                  '위쪽이라 즉시 로딩을 유지했고요. IntersectionObserver 라이브러리 대신 네이티브 속성을 썼는데, 브라우저 지원이 이미 ' +
                  '충분해서요.',
              ),
              turn('user', 'Did LCP actually improve?', 'LCP가 실제로 개선됐어요?'),
              turn(
                'assistant',
                'Yes, measured improvement on the listing page, and confirmed rows 1-2 still render immediately — no flash of missing images on load.',
                '네, 목록 페이지에서 개선을 측정했고, 1~2번째 줄은 여전히 즉시 렌더링되면서 로드 시 이미지가 잠깐 비어 보이는 현상도 없는 걸 확인했어요.',
              ),
            ],
          },
        ],
      },
    ],
    mergeStorylineIndex: 0,
  },
  {
    id: 'cse',
    label: { en: 'Cloud Support Engineer', ko: '클라우드 지원 엔지니어' },
    description: {
      en: 'Cross-service troubleshooting between an on-prem network and a VPC',
      ko: '온프레미스 네트워크와 VPC 사이의 교차 서비스 트러블슈팅',
    },
    storylines: [
      // Merge target: three separate investigation threads (DX, VPC, ALB)
      // that turn out to be one incident — merging all three (mergeSessions()
      // accepts 2+ ids already) into one record is what actually surfaces
      // the MTU root cause spanning all of them.
      {
        folder: 'cases/onprem-connectivity',
        keywords: {
          en: /direct connect|bgp|vpc route|security group|target health|mtu|onprem/i,
          ko: /direct connect|bgp|vpc|보안\s*그룹|target health|mtu|온프레미스/i,
        },
        knowledge: {
          en: `## On-prem ↔ VPC connectivity

- **Root cause pattern**: intermittent large-payload failures across an on-prem↔VPC path are an MTU mismatch until proven otherwise — check the Direct Connect virtual interface's jumbo frame setting against the VPC route/security-group path before assuming application-layer causes.
- **Where this one hid**: DX BGP session and VPC routing both looked healthy in isolation — only became visible once ALB target health (large POST bodies specifically failing) was correlated against the DX interface's MTU setting (1500 vs the on-prem side's 9001).
- **Fix**: aligned MTU to 1500 end-to-end on the DX virtual interface rather than raising the VPC side to jumbo — simpler blast radius, since jumbo frames aren't supported all the way through the on-prem path anyway.`,
          ko: `## 온프레미스 ↔ VPC 연결성

- **근본 원인 패턴**: 온프레미스↔VPC 구간에서 큰 페이로드만 간헐적으로 실패한다면, 애플리케이션 계층 문제로 넘겨짚기 전에 MTU 불일치부터 의심해야 한다 — Direct Connect 가상 인터페이스의 점보 프레임 설정을 VPC 라우팅/보안 그룹 경로와 대조해 확인한다.
- **이번 건이 숨어있던 방식**: DX BGP 세션과 VPC 라우팅은 각각 따로 보면 모두 정상이었다 — ALB target health(대용량 POST 바디만 실패)를 DX 인터페이스의 MTU 설정(1500, 온프레미스 쪽은 9001)과 교차 확인하고 나서야 드러났다.
- **해결**: VPC 쪽을 점보 프레임으로 올리는 대신 DX 가상 인터페이스를 종단 간 MTU 1500으로 맞췄다 — 어차피 점보 프레임이 온프레미스 경로 전체에서 지원되지 않으므로 영향 범위가 더 단순하다.`,
        },
        splitLabels: {
          en: ['Investigation across DX/VPC/ALB', 'MTU root cause & fix'],
          ko: ['DX/VPC/ALB 전반 조사', 'MTU 근본 원인과 해결'],
        },
        sessions: [
          {
            source: 'claude',
            daysAgo: 3,
            title: {
              en: 'Check Direct Connect BGP session for onprem-VPC link',
              ko: '온프레미스-VPC 링크의 Direct Connect BGP 세션 점검',
            },
            summary: {
              en:
                'Checked Direct Connect BGP session status for the on-prem-to-VPC link after reports of intermittent ' +
                'connectivity failures on large requests. BGP session itself is up and stable, route advertisements look ' +
                'correct — DX layer alone does not explain the failures.',
              ko:
                '대용량 요청에서 간헐적 연결 실패가 보고된 후, 온프레미스-VPC 링크의 Direct Connect BGP 세션 상태를 점검. ' +
                'BGP 세션 자체는 정상이고 안정적이며, 라우트 광고도 올바름 — DX 계층만으로는 실패 원인을 설명할 수 없음.',
            },
            tags: ['aws', 'direct-connect', 'bgp', 'networking'],
            turns: [
              turn(
                'user',
                "Customer's reporting intermittent failures on large requests between their on-prem network and our VPC. Can you check the DX side first?",
                '고객사에서 온프레미스 네트워크랑 우리 VPC 사이 대용량 요청에서 간헐적으로 실패한다고 하는데요. DX 쪽부터 먼저 확인해줄 수 있어요?',
              ),
              turn(
                'assistant',
                "BGP session on the Direct Connect virtual interface is up and stable — no flapping in the last 7 days. Route advertisements from " +
                  "on-prem look correct and the VPC route table has the expected propagated routes. DX layer alone doesn't explain intermittent large-request failures.",
                'Direct Connect 가상 인터페이스의 BGP 세션은 정상이고 안정적이에요 — 최근 7일간 플래핑도 없고요. 온프레미스에서 오는 라우트 ' +
                  '광고도 올바르고 VPC 라우트 테이블에도 예상대로 전파되어 있어요. DX 계층만으로는 간헐적인 대용량 요청 실패를 설명할 수 없네요.',
              ),
              turn(
                'user',
                'So it looks fine at the DX level — worth checking VPC routing/security groups next?',
                'DX 레벨은 문제없어 보이네요 — 다음으로 VPC 라우팅/보안 그룹을 확인해볼까요?',
              ),
              turn(
                'assistant',
                "Yes, that's the next layer to rule out. I'll check VPC route tables and security groups on the affected subnets.",
                '네, 그게 다음으로 배제해봐야 할 계층이에요. 영향받는 서브넷의 VPC 라우트 테이블과 보안 그룹을 확인해볼게요.',
              ),
            ],
          },
          {
            source: 'codex',
            daysAgo: 3,
            title: {
              en: 'Check VPC route tables and security groups for onprem traffic',
              ko: '온프레미스 트래픽에 대한 VPC 라우트 테이블과 보안 그룹 점검',
            },
            summary: {
              en:
                'Checked VPC route tables and security groups for the subnets handling on-prem traffic. Routes correctly ' +
                'point on-prem CIDR ranges at the DX virtual private gateway; security groups allow the required ports. ' +
                'No obvious VPC-layer misconfiguration explaining the intermittent large-request failures.',
              ko:
                '온프레미스 트래픽을 처리하는 서브넷의 VPC 라우트 테이블과 보안 그룹을 점검. 라우트는 온프레미스 CIDR 대역을 ' +
                'DX 가상 프라이빗 게이트웨이로 올바르게 지정하고 있고, 보안 그룹도 필요한 포트를 허용함. 간헐적 대용량 요청 ' +
                '실패를 설명할 만한 VPC 계층 설정 오류는 발견되지 않음.',
            },
            tags: ['aws', 'vpc', 'security-groups', 'networking'],
            turns: [
              turn(
                'user',
                'DX layer checks out. Can you look at VPC routing and security groups for the affected subnets?',
                'DX 계층은 문제없는 걸로 확인됐어요. 영향받는 서브넷의 VPC 라우팅이랑 보안 그룹 좀 봐줄 수 있어요?',
              ),
              turn(
                'assistant',
                "Route tables correctly point the on-prem CIDR ranges at the DX virtual private gateway, and security groups allow the ports the " +
                  "application actually uses. Nothing obviously wrong at the VPC layer either — this is starting to look like it's specific to request size, not routing.",
                '라우트 테이블은 온프레미스 CIDR 대역을 DX 가상 프라이빗 게이트웨이로 올바르게 지정하고 있고, 보안 그룹도 애플리케이션이 ' +
                  '실제로 쓰는 포트를 허용하고 있어요. VPC 계층에도 눈에 띄는 문제는 없네요 — 이건 라우팅보다 요청 크기 자체와 관련 있는 것 같아요.',
              ),
              turn(
                'user',
                "Specific to request size is a good lead. What's next?",
                '요청 크기랑 관련 있다는 게 좋은 단서네요. 다음은요?',
              ),
              turn(
                'assistant',
                "I want to check ALB target health during a failure window — if it's correlated with large POST bodies specifically, that points somewhere more specific than general connectivity.",
                '실패 구간 동안 ALB target health를 확인해보고 싶어요 — 만약 대용량 POST 바디랑 구체적으로 연관이 있다면 일반적인 연결성 ' +
                  '문제보다 더 구체적인 방향을 가리키는 거니까요.',
              ),
            ],
          },
          {
            source: 'kiro',
            daysAgo: 2,
            title: {
              en: 'Check ALB target health for onprem-originated requests',
              ko: '온프레미스發 요청에 대한 ALB target health 점검',
            },
            summary: {
              en:
                'Checked ALB target health during a reported failure window. Found failures correlated specifically with ' +
                'large POST request bodies from on-prem, not general connectivity. Suspected MTU mismatch — confirmed the ' +
                'DX virtual interface is set to standard 1500 MTU while the on-prem side sends up to 9001 (jumbo frames).',
              ko:
                '보고된 실패 구간 동안 ALB target health를 점검. 온프레미스에서 오는 대용량 POST 요청 바디와 구체적으로 ' +
                '연관된 실패를 발견 — 일반적인 연결성 문제가 아님. MTU 불일치를 의심 — DX 가상 인터페이스는 표준 MTU ' +
                '1500으로 설정되어 있는데 온프레미스 쪽은 최대 9001(점보 프레임)을 보내고 있음을 확인.',
            },
            tags: ['aws', 'elb', 'alb', 'networking', 'mtu'],
            turns: [
              turn(
                'user',
                'Any correlation between the failures and ALB target health during the failure window?',
                '실패 구간 동안 ALB target health랑 관련성이 있어요?',
              ),
              turn(
                'assistant',
                "Yes — target health checks pass consistently, but the actual failures correlate specifically with large POST request bodies from " +
                  "on-prem. Small requests never fail. That pattern points at fragmentation, not routing or health.",
                '네 — target health 체크는 계속 정상으로 나오는데, 실제 실패는 온프레미스에서 오는 대용량 POST 요청 바디와 구체적으로 ' +
                  '연관돼요. 작은 요청은 전혀 실패하지 않고요. 이 패턴은 라우팅이나 헬스보다는 단편화(fragmentation) 쪽을 가리켜요.',
              ),
              turn('user', 'Fragmentation — could this be an MTU mismatch?', '단편화라면 — MTU 불일치일 수도 있을까요?'),
              turn(
                'assistant',
                "Checking now — the Direct Connect virtual interface is set to standard 1500 MTU, but the on-prem network sends up to 9001 (jumbo " +
                  "frames) on that path. Packets over 1500 bytes get fragmented or dropped depending on the path, which lines up exactly with large-request-only failures.",
                '지금 확인해볼게요 — Direct Connect 가상 인터페이스는 표준 MTU 1500으로 설정돼 있는데, 온프레미스 네트워크는 그 경로로 최대 ' +
                  '9001(점보 프레임)까지 보내고 있어요. 1500바이트가 넘는 패킷은 경로에 따라 단편화되거나 드롭되는데, 이게 대용량 요청만 ' +
                  '실패하는 패턴이랑 정확히 맞아떨어져요.',
              ),
            ],
          },
        ],
      },
      {
        folder: 'cases/s3-cross-account',
        keywords: {
          en: /s3|cross-account|bucket policy|access denied/i,
          ko: /s3|cross-account|버킷\s*정책|access\s*denied/i,
        },
        knowledge: {
          en: `## S3 cross-account access

- **Both sides need a statement**: cross-account S3 access needs the bucket policy (resource side) to grant the account/role AND the requesting role's own IAM policy to allow the \`s3:GetObject\` action — missing either one produces the same generic AccessDenied, which makes it easy to fix only one side and still fail.
- **KMS adds a third side**: if the bucket uses a customer-managed KMS key, the key policy also needs to grant \`kms:Decrypt\` to the external account — this was the one actually missing here, not the bucket policy.`,
          ko: `## S3 계정 간 접근

- **양쪽 다 문 있어야 한다**: 계정 간 S3 접근은 버킷 정책(리소스 쪽)에서 해당 계정/역할을 허용하는 것과, 요청하는 역할 자신의 IAM 정책이 \`s3:GetObject\` 액션을 허용하는 것 둘 다 필요하다 — 둘 중 하나만 빠져도 똑같은 일반적인 AccessDenied가 나오기 때문에 한쪽만 고치고 여전히 실패하기 쉽다.
- **KMS가 세 번째 관문을 추가한다**: 버킷이 고객 관리형 KMS 키를 쓴다면, 키 정책도 외부 계정에 \`kms:Decrypt\`를 허용해야 한다 — 실제로 이번에 빠져 있던 건 버킷 정책이 아니라 바로 이 부분이었다.`,
        },
        sessions: [
          {
            source: 'opencode',
            daysAgo: 6,
            title: {
              en: 'Investigate S3 cross-account AccessDenied for partner account',
              ko: '파트너 계정의 S3 계정 간 AccessDenied 조사',
            },
            summary: {
              en:
                "Investigated AccessDenied errors from a partner account trying to read objects from a customer's S3 " +
                "bucket. Bucket policy already granted the partner account s3:GetObject. Root cause: the bucket uses a " +
                "customer-managed KMS key, and the key policy did not grant kms:Decrypt to the partner account.",
              ko:
                '고객사 S3 버킷 객체를 읽으려는 파트너 계정에서 발생한 AccessDenied 오류를 조사. 버킷 정책은 이미 파트너 ' +
                '계정에 s3:GetObject를 허용하고 있었음. 근본 원인: 버킷이 고객 관리형 KMS 키를 사용하는데, 키 정책이 ' +
                '파트너 계정에 kms:Decrypt를 허용하지 않고 있었음.',
            },
            tags: ['aws', 's3', 'kms', 'iam'],
            turns: [
              turn(
                'user',
                "Customer's partner account is getting AccessDenied reading objects from their S3 bucket, even though the bucket policy grants s3:GetObject to that account. Can you take a look?",
                '고객사 파트너 계정이 S3 버킷 객체를 읽으려는데 AccessDenied가 나온대요. 버킷 정책에는 그 계정에 s3:GetObject를 허용해뒀는데도요. 한번 봐줄 수 있어요?',
              ),
              turn(
                'assistant',
                "Confirmed the bucket policy grants the partner account s3:GetObject and the partner's own IAM role allows the action too — so it's not " +
                  "the usual both-sides-need-a-statement issue. Bucket also uses a customer-managed KMS key for encryption, which is a common third culprit.",
                '버킷 정책이 파트너 계정에 s3:GetObject를 허용하고 있고, 파트너 쪽 IAM 역할도 그 액션을 허용하고 있는 걸 확인했어요 — ' +
                  "그러니까 흔한 '양쪽 다 문이 있어야 한다'는 문제는 아니네요. 버킷이 암호화에 고객 관리형 KMS 키도 쓰고 있는데, 이게 흔한 세 번째 원인이에요.",
              ),
              turn(
                'user',
                'Is the KMS key policy the missing piece?',
                'KMS 키 정책이 빠진 부분일까요?',
              ),
              turn(
                'assistant',
                "Checking the key policy now — this is exactly the kind of thing that produces the same generic AccessDenied as a bucket policy issue, so worth ruling in or out explicitly.",
                '지금 키 정책을 확인해볼게요 — 이런 경우가 정확히 버킷 정책 문제랑 똑같은 일반적인 AccessDenied를 내는 유형이라, 명확하게 확인해볼 가치가 있어요.',
              ),
            ],
          },
          {
            source: 'codex',
            daysAgo: 5,
            title: {
              en: 'Resolve S3 cross-account access by fixing KMS key policy',
              ko: 'KMS 키 정책 수정으로 S3 계정 간 접근 문제 해결',
            },
            summary: {
              en:
                "Resolved the cross-account AccessDenied by adding kms:Decrypt for the partner account to the bucket's " +
                "KMS key policy. Verified the partner account can now read objects successfully.",
              ko:
                '버킷의 KMS 키 정책에 파트너 계정용 kms:Decrypt를 추가해 계정 간 AccessDenied를 해결. 파트너 계정이 이제 ' +
                '정상적으로 객체를 읽을 수 있음을 확인.',
            },
            tags: ['aws', 's3', 'kms', 'iam'],
            turns: [
              turn(
                'user',
                "Confirmed — key policy didn't have the partner account at all. Can you fix it?",
                '확인해보니 — 키 정책에 파트너 계정이 아예 없었어요. 고쳐줄 수 있어요?',
              ),
              turn(
                'assistant',
                "Added a statement granting kms:Decrypt on the key to the partner account's role ARN, alongside the existing bucket policy and IAM " +
                  "grants (which were already correct). All three pieces — bucket policy, partner IAM role, KMS key policy — now align.",
                '키에 파트너 계정 역할 ARN에 대한 kms:Decrypt 권한을 추가하는 문장을 넣었어요, 기존에 이미 맞게 되어 있던 버킷 정책이랑 ' +
                  'IAM 권한 옆에요. 이제 버킷 정책, 파트너 IAM 역할, KMS 키 정책 세 가지가 다 일치해요.',
              ),
              turn(
                'user',
                'Can you confirm with the partner that it works now?',
                '파트너 쪽에 이제 되는지 확인해달라고 할 수 있어요?',
              ),
              turn(
                'assistant',
                "Yes, had them re-run their read — succeeded. Documented all three required grants so this doesn't get half-fixed again if it recurs elsewhere.",
                '네, 다시 읽기 시도해달라고 했고 — 성공했어요. 나중에 또 이런 문제가 생겼을 때 절반만 고치고 끝나지 않도록 필요한 세 가지 권한을 전부 문서화해뒀어요.',
              ),
            ],
          },
        ],
      },
    ],
    mergeStorylineIndex: 0,
  },
  {
    id: 'sa',
    label: { en: 'Solutions Architect', ko: '솔루션즈 아키텍트' },
    description: {
      en: 'Architecting a new AI agent platform for a customer, across research and customer meetings',
      ko: '고객사를 위한 새 AI 에이전트 플랫폼 아키텍처 설계 — 리서치와 고객 미팅을 아우름',
    },
    storylines: [
      // Merge target: two research sessions (best practices + reference
      // architectures) merged into one consolidated body of research, the
      // literal basis for "propose new architecture and slide creation".
      {
        folder: 'customers/nimbustech',
        keywords: {
          en: /agent platform|multi-agent|orchestrat|best practices|reference architecture/i,
          ko: /에이전트\s*플랫폼|멀티\s*에이전트|오케스트레이션|모범\s*사례|레퍼런스\s*아키텍처/i,
        },
        knowledge: {
          en: `## NimbusTech AI agent platform

- **Orchestration pattern**: favor a single coordinator agent delegating to narrow specialist agents over one large general-purpose agent — matches what worked in the surveyed reference architectures and keeps individual agent prompts/tools reviewable.
- **State**: shared state belongs in an external store (not agent memory) so any agent can pick up a task mid-flight — the reference architectures that skipped this hit reliability walls once conversations got multi-step.
- **Slide structure for the proposal**: current-state pain points → proposed architecture (with the coordinator/specialist diagram) → phased migration plan. Leading with pain points anchored the architecture discussion in the customer's own language rather than abstract patterns.`,
          ko: `## NimbusTech AI 에이전트 플랫폼

- **오케스트레이션 패턴**: 하나의 거대한 범용 에이전트보다는, 좁은 역할의 전문 에이전트들에게 위임하는 단일 코디네이터 에이전트 구조를 선호한다 — 조사한 레퍼런스 아키텍처들에서 실제로 잘 작동했던 방식이고, 개별 에이전트의 프롬프트/도구를 검토 가능한 수준으로 유지할 수 있다.
- **상태 관리**: 공유 상태는 에이전트 메모리가 아니라 외부 저장소에 두어야 어떤 에이전트든 작업을 중간에 이어받을 수 있다 — 이걸 생략한 레퍼런스 아키텍처들은 대화가 여러 단계로 길어지면서 신뢰성 문제에 부딪혔다.
- **제안서 슬라이드 구성**: 현재 상태의 페인 포인트 → 제안 아키텍처(코디네이터/전문가 다이어그램 포함) → 단계별 마이그레이션 계획. 페인 포인트로 시작하니 아키텍처 논의가 추상적인 패턴이 아니라 고객 자신의 언어로 닻을 내렸다.`,
        },
        splitLabels: {
          en: ['Best practices findings', 'Reference architectures'],
          ko: ['모범 사례 조사 결과', '레퍼런스 아키텍처'],
        },
        sessions: [
          {
            source: 'claude',
            daysAgo: 4,
            title: {
              en: 'Research AI agent platform best practices for NimbusTech',
              ko: 'NimbusTech를 위한 AI 에이전트 플랫폼 모범 사례 조사',
            },
            summary: {
              en:
                'Researched best practices for building an AI agent platform ahead of proposing an architecture to ' +
                "NimbusTech. Key finding: a coordinator agent delegating to narrow specialist agents outperforms one " +
                "large general-purpose agent on reliability and reviewability. Shared state needs to live in an external " +
                "store, not agent memory, for multi-step tasks to survive handoffs.",
              ko:
                'NimbusTech에 아키텍처를 제안하기에 앞서 AI 에이전트 플랫폼 구축 모범 사례를 조사. 핵심 발견: 좁은 역할의 ' +
                '전문 에이전트에게 위임하는 코디네이터 에이전트가 하나의 거대한 범용 에이전트보다 신뢰성과 검토 용이성 면에서 ' +
                '우수함. 여러 단계에 걸친 작업이 핸드오프를 견디려면 공유 상태가 에이전트 메모리가 아니라 외부 저장소에 있어야 함.',
            },
            tags: ['ai-agents', 'architecture', 'research'],
            turns: [
              turn(
                'user',
                "Before we propose anything to NimbusTech, let's ground this in actual best practices for agent platform design. What's out there?",
                'NimbusTech에 뭐든 제안하기 전에, 에이전트 플랫폼 설계에 대한 실제 모범 사례부터 근거를 잡고 싶어요. 어떤 게 있을까요?',
              ),
              turn(
                'assistant',
                "The strongest recurring pattern is a coordinator agent that delegates to narrow specialist agents, rather than one large general-purpose " +
                  "agent trying to do everything — it's more reliable and each specialist's prompt/tools stay small enough to actually review.",
                '가장 강하게 반복되는 패턴은, 하나의 거대한 범용 에이전트가 모든 걸 다 하려는 것보다는, 좁은 역할의 전문 에이전트들에게 ' +
                  '위임하는 코디네이터 에이전트예요 — 더 안정적이고 각 전문 에이전트의 프롬프트/도구도 실제로 검토할 수 있을 만큼 작게 유지돼요.',
              ),
              turn(
                'user',
                'What about state across a multi-step task?',
                '여러 단계로 이어지는 작업에서 상태는 어떻게 관리하나요?',
              ),
              turn(
                'assistant',
                "Shared state needs to live in an external store, not just in whatever agent is currently handling the task — otherwise handing off " +
                  "mid-task loses context. I'll pull together a couple more sources on this before we move to reference architectures.",
                '공유 상태는 현재 그 작업을 처리 중인 에이전트가 아니라 외부 저장소에 있어야 해요 — 안 그러면 핸드오프할 때 맥락을 잃어버려요. ' +
                  '레퍼런스 아키텍처로 넘어가기 전에 이 부분 관련 자료를 몇 개 더 모아볼게요.',
              ),
            ],
          },
          {
            source: 'codex',
            daysAgo: 3,
            title: {
              en: 'Research reference architectures for multi-agent platforms',
              ko: '멀티 에이전트 플랫폼 레퍼런스 아키텍처 조사',
            },
            summary: {
              en:
                "Researched published reference architectures for multi-agent platforms, comparing coordinator/specialist " +
                "patterns across several. Confirmed the external-state-store pattern is what separates architectures that " +
                "held up under multi-step conversations from ones that hit reliability walls.",
              ko:
                '멀티 에이전트 플랫폼의 공개된 레퍼런스 아키텍처들을 조사하며, 여러 아키텍처의 코디네이터/전문가 패턴을 비교. ' +
                '외부 상태 저장소 패턴이야말로 여러 단계 대화에서도 버틴 아키텍처와 신뢰성 문제에 부딪힌 아키텍처를 가르는 ' +
                '지점임을 확인.',
            },
            tags: ['ai-agents', 'architecture', 'research'],
            turns: [
              turn(
                'user',
                "Let's look at how other teams have actually architected this, not just principles in the abstract.",
                '추상적인 원칙 말고, 다른 팀들이 실제로 이걸 어떻게 아키텍처링했는지 살펴볼까요.',
              ),
              turn(
                'assistant',
                "Compared a handful of published reference architectures — the coordinator/specialist split shows up consistently, but the ones that " +
                  "kept agent state purely in-memory per-conversation are the ones with documented reliability issues once tasks got multi-step.",
                '공개된 레퍼런스 아키텍처 여러 개를 비교해봤는데 — 코디네이터/전문가 구조는 꾸준히 등장하는데, 에이전트 상태를 대화별로 순수하게 ' +
                  '메모리에만 유지한 아키텍처들은 작업이 여러 단계로 길어지면서 신뢰성 문제가 문서화되어 있더라고요.',
              ),
              turn(
                'user',
                'So the external-state-store point from the best-practices research holds up against real examples too.',
                '그럼 모범 사례 조사에서 나온 외부 상태 저장소 이야기가 실제 사례로도 뒷받침되네요.',
              ),
              turn(
                'assistant',
                "Exactly — that's the one piece I'd flag as non-negotiable in the proposal, not just a nice-to-have. Ready to start drafting the architecture proposal and slides.",
                '맞아요 — 제안서에서 그냥 있으면 좋은 옵션이 아니라 타협 불가능한 항목으로 표시할 유일한 부분이 바로 이거예요. 이제 아키텍처 ' +
                  '제안서랑 슬라이드 초안 작업을 시작할 준비가 됐어요.',
              ),
            ],
          },
        ],
      },
      {
        folder: 'customers/globex',
        keywords: {
          en: /globex|discovery|current.?state|pain points/i,
          ko: /globex|디스커버리|현재\s*상태|페인\s*포인트/i,
        },
        knowledge: {
          en: `## Globex engagement

- **Current-state pain point**: their existing automation is a set of disconnected scripts with no shared context between runs — the discovery call surfaced this as the actual blocker, not a lack of AI capability.
- **Scope for the architecture review**: keep the first proposal narrow (one workflow, not a platform rebuild) — Globex's own team flagged rebuild fatigue from a previous initiative.`,
          ko: `## Globex 프로젝트

- **현재 상태 페인 포인트**: 기존 자동화는 실행 간 공유 컨텍스트가 없는, 서로 연결되지 않은 스크립트 모음이다 — 디스커버리 미팅에서 이것이 실제 병목이라는 게 드러났고, AI 역량 부족 문제가 아니었다.
- **아키텍처 리뷰 범위**: 첫 제안은 좁게 잡는다(플랫폼 전면 재구축이 아니라 워크플로 하나) — Globex 팀 스스로가 이전 이니셔티브에서 재구축 피로감을 겪었다고 언급했다.`,
        },
        sessions: [
          {
            source: 'kiro',
            daysAgo: 8,
            title: {
              en: 'Discovery meeting with Globex — current automation pain points',
              ko: 'Globex 디스커버리 미팅 — 현재 자동화의 페인 포인트',
            },
            summary: {
              en:
                "Ran a discovery meeting with Globex to understand their current automation setup ahead of proposing an " +
                "AI agent solution. Their existing automation is a set of disconnected scripts with no shared context " +
                "between runs — that's the actual blocker, not a lack of AI capability. Team flagged rebuild fatigue " +
                "from a previous initiative, so scope should stay narrow.",
              ko:
                'AI 에이전트 솔루션을 제안하기에 앞서 Globex의 현재 자동화 구성을 파악하기 위한 디스커버리 미팅 진행. ' +
                '기존 자동화는 실행 간 공유 컨텍스트가 없는, 서로 연결되지 않은 스크립트 모음임 — 그것이 실제 병목이지 ' +
                'AI 역량 부족이 아님. 팀은 이전 이니셔티브에서 재구축 피로감을 겪었다고 언급해서 범위를 좁게 잡아야 함.',
            },
            tags: ['customer', 'discovery', 'meeting'],
            turns: [
              turn(
                'user',
                "Notes from today's Globex discovery call — what's actually broken in their current setup?",
                '오늘 Globex 디스커버리 콜 메모인데 — 지금 구성에서 실제로 뭐가 문제인가요?',
              ),
              turn(
                'assistant',
                "Their automation today is a pile of disconnected scripts with no shared context between runs — someone has to manually stitch " +
                  "outputs together. That's the real blocker, not a lack of AI capability like they initially framed it.",
                '지금 자동화는 실행 간 공유 컨텍스트가 없이 서로 연결되지 않은 스크립트 더미예요 — 누군가 결과물을 수동으로 이어붙이고 있어요. ' +
                  '그게 처음에 그들이 프레이밍했던 AI 역량 부족이 아니라 진짜 병목이에요.',
              ),
              turn(
                'user',
                'Anything to be careful about scoping-wise?',
                '범위 잡을 때 조심해야 할 게 있을까요?',
              ),
              turn(
                'assistant',
                "Their team explicitly mentioned rebuild fatigue from a previous platform initiative that stalled. I'd keep the first proposal narrow — one workflow end-to-end, not a platform rebuild pitch.",
                '팀에서 이전에 무산된 플랫폼 이니셔티브 때문에 재구축 피로감이 있다고 명시적으로 언급했어요. 첫 제안은 좁게 잡는 게 좋겠어요 — ' +
                  '플랫폼 재구축 피치가 아니라 워크플로 하나를 처음부터 끝까지요.',
              ),
            ],
          },
          {
            source: 'claude',
            daysAgo: 7,
            title: {
              en: 'Architecture review meeting with Globex — proposed narrow-scope workflow',
              ko: 'Globex 아키텍처 리뷰 미팅 — 좁은 범위 워크플로 제안',
            },
            summary: {
              en:
                "Presented a narrow-scope architecture proposal to Globex addressing the shared-context gap identified in " +
                "discovery, framed as one workflow rather than a platform rebuild. Positively received — team appreciated " +
                "that it directly addressed their stated pain point instead of a broader pitch.",
              ko:
                '디스커버리에서 파악된 공유 컨텍스트 부재 문제를 다루는 좁은 범위의 아키텍처 제안을 Globex에 발표, 플랫폼 ' +
                '재구축이 아니라 워크플로 하나로 프레이밍함. 반응이 좋았음 — 팀은 넓은 범위의 피치 대신 자신들이 말한 ' +
                '페인 포인트를 직접 다뤘다는 점을 높이 평가함.',
            },
            tags: ['customer', 'architecture-review', 'meeting'],
            turns: [
              turn(
                'user',
                'How did the architecture review land with Globex?',
                'Globex에 아키텍처 리뷰가 어떻게 받아들여졌나요?',
              ),
              turn(
                'assistant',
                "Went well — presented it as a single workflow that gives their scripts shared context via a coordinator, not a platform rebuild. " +
                  "Because it mapped directly to the pain point from discovery instead of a bigger pitch, there wasn't the skepticism I was expecting given the rebuild fatigue.",
                '잘 됐어요 — 플랫폼 재구축이 아니라, 코디네이터를 통해 스크립트들에 공유 컨텍스트를 부여하는 단일 워크플로로 발표했어요. ' +
                  '디스커버리에서 나온 페인 포인트에 직접 대응했지 더 큰 피치가 아니어서, 재구축 피로감을 감안했을 때 예상했던 회의감이 없었어요.',
              ),
              turn(
                'user',
                'Any pushback or open questions?',
                '반발이나 열린 질문은 없었나요?',
              ),
              turn(
                'assistant',
                "Mainly timeline questions, nothing architectural. I'll follow up with a phased rollout plan next.",
                '주로 일정 관련 질문이었고, 아키텍처 관련은 없었어요. 다음으로 단계별 롤아웃 계획을 후속으로 보낼게요.',
              ),
            ],
          },
        ],
      },
      {
        folder: 'customers/initech',
        keywords: {
          en: /initech|kickoff|migration/i,
          ko: /initech|킥오프|마이그레이션/i,
        },
        knowledge: {
          en: `## Initech engagement

- **Migration framing matters**: Initech's stakeholders responded better to "migrate incrementally, keep the old system running in parallel" than any all-at-once framing — even though the technical plan barely changed, leading with the parallel-run detail changed the room.`,
          ko: `## Initech 프로젝트

- **마이그레이션 프레이밍이 중요하다**: Initech 이해관계자들은 어떤 일괄 전환(all-at-once) 프레이밍보다 "점진적으로 마이그레이션하고 기존 시스템은 병행 운영한다"는 쪽에 훨씬 좋게 반응했다 — 기술 계획 자체는 거의 바뀌지 않았는데도, 병행 운영 디테일을 먼저 제시한 것만으로 분위기가 달라졌다.`,
        },
        sessions: [
          {
            source: 'codex',
            daysAgo: 10,
            title: {
              en: 'Kickoff meeting with Initech — AI agent platform migration',
              ko: 'Initech 킥오프 미팅 — AI 에이전트 플랫폼 마이그레이션',
            },
            summary: {
              en:
                "Kickoff meeting with Initech to scope a migration from their legacy rules-engine automation to an AI " +
                "agent platform. Agreed on an incremental migration running the old system in parallel rather than a " +
                "cutover, based on stakeholder risk appetite discussed in the meeting.",
              ko:
                '기존 규칙 엔진 기반 자동화에서 AI 에이전트 플랫폼으로의 마이그레이션 범위를 잡기 위한 Initech 킥오프 ' +
                '미팅. 미팅에서 논의된 이해관계자들의 리스크 성향을 바탕으로, 일괄 전환이 아니라 기존 시스템을 병행 ' +
                '운영하는 점진적 마이그레이션으로 합의함.',
            },
            tags: ['customer', 'kickoff', 'meeting'],
            turns: [
              turn(
                'user',
                "Kickoff with Initech — what's the shape of this migration?",
                'Initech 킥오프 — 이번 마이그레이션은 어떤 모습이 될까요?',
              ),
              turn(
                'assistant',
                "They're moving off a legacy rules-engine automation system. Given how risk-averse the room was about a cutover, we agreed on an " +
                  "incremental migration — new agent platform runs in parallel with the old system until each workflow is proven out.",
                '기존 규칙 엔진 기반 자동화 시스템에서 벗어나려는 거예요. 회의실 분위기가 일괄 전환에 대해 꽤 리스크 회피적이어서, 새 ' +
                  '에이전트 플랫폼이 각 워크플로가 검증될 때까지 기존 시스템과 병행 운영되는 점진적 마이그레이션으로 합의했어요.',
              ),
              turn(
                'user',
                'Does that change the technical plan much?',
                '그러면 기술 계획이 많이 바뀌나요?',
              ),
              turn(
                'assistant',
                "Barely — the parallel-run framing is mostly about sequencing and stakeholder comfort, not a different architecture. I'll draft the migration architecture review for next week.",
                '거의 안 바뀌어요 — 병행 운영 프레이밍은 주로 순서와 이해관계자들의 심리적 편안함에 관한 거지, 아키텍처 자체가 달라지는 건 ' +
                  '아니에요. 다음 주까지 마이그레이션 아키텍처 리뷰 초안을 준비할게요.',
              ),
            ],
          },
          {
            source: 'opencode',
            daysAgo: 9,
            title: {
              en: 'Migration architecture review with Initech',
              ko: 'Initech 마이그레이션 아키텍처 리뷰',
            },
            summary: {
              en:
                "Presented the migration architecture to Initech: new agent platform running in parallel with the legacy " +
                "rules engine, workflows cut over one at a time once proven. Leading with the parallel-run detail (over " +
                "the technical architecture itself) is what actually landed with stakeholders.",
              ko:
                'Initech에 마이그레이션 아키텍처를 발표: 새 에이전트 플랫폼이 기존 규칙 엔진과 병행 운영되며, 워크플로는 ' +
                '검증되는 대로 하나씩 전환됨. 기술 아키텍처 자체보다 병행 운영 디테일을 먼저 제시한 것이 이해관계자들에게 ' +
                '실제로 통한 지점이었음.',
            },
            tags: ['customer', 'architecture-review', 'migration', 'meeting'],
            turns: [
              turn(
                'user',
                "How'd the migration architecture review go?",
                '마이그레이션 아키텍처 리뷰는 어떻게 됐어요?',
              ),
              turn(
                'assistant',
                "Landed well once I led with the parallel-run detail — old system keeps running, workflows cut over one at a time once each is proven. " +
                  "That's what actually changed the room's comfort level, even though the underlying technical architecture was the same plan we discussed at kickoff.",
                '병행 운영 디테일을 먼저 제시하니까 잘 받아들여졌어요 — 기존 시스템은 계속 돌아가고, 워크플로는 각각 검증되는 대로 하나씩 ' +
                  '전환된다는 부분이요. 킥오프 때 논의했던 것과 기술 아키텍처 자체는 똑같은데도, 그 부분이 실제로 회의실의 심리적 편안함을 바꿨어요.',
              ),
              turn(
                'user',
                'Worth remembering for future migrations, not just Initech.',
                'Initech뿐 아니라 앞으로 다른 마이그레이션에서도 기억해둘 만하네요.',
              ),
              turn(
                'assistant',
                "Agreed — I'll note it as a general pattern: for risk-averse stakeholders, lead migration proposals with the rollback/parallel-run story, not the target architecture.",
                '동의해요 — 일반 패턴으로 기록해둘게요: 리스크 회피적인 이해관계자들에게는, 목표 아키텍처가 아니라 롤백/병행 운영 스토리로 ' +
                  '마이그레이션 제안을 시작하라고요.',
              ),
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
