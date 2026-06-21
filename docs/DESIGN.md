# Balance — System Design

This document covers the architecture, the components to build, the data model, and the
two engines that do the real work (classification orchestration and time accounting).

For *how a video gets a lane*, see [CLASSIFICATION.md](CLASSIFICATION.md).
For *what the user sees*, see [UX.md](UX.md).

---

## 1. Platform & constraints

- **Target:** Chromium (Chrome / Edge / Brave / Arc) on **Manifest V3** first; Firefox port
  later (MV3 differences are small but real — background service worker lifecycle).
- **No backend required for MVP.** Everything runs locally in the extension. The only thing
  that *can* need the network is optional AI classification (§4), and even that can be
  bring-your-own-key or swapped for a fully-local embedding model.
- **Privacy posture:** all watch history, budgets, and rules live in `chrome.storage` on the
  device. Nothing leaves the machine unless the user explicitly enables cloud AI
  classification, and even then only `{title, channel, description-snippet}` is sent — never
  full history.

## 2. Component overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│                            BROWSER EXTENSION                                  │
│                                                                              │
│  ┌─────────────────────────────┐        ┌──────────────────────────────┐    │
│  │  CONTENT SCRIPT (youtube.com)│◄──────►│  SERVICE WORKER (background)  │    │
│  │                              │ ports  │                              │    │
│  │  • Page Surgeon             │        │  • Classification Orchestrator│    │
│  │    (hide/dim recs, autoplay,│        │      rules → cache → AI       │    │
│  │     shorts, end-screen)     │        │  • Accounting Engine          │    │
│  │  • Metadata Scraper         │        │      (per-lane time + credits)│    │
│  │  • Navigation/Intent Hook   │        │  • Intervention Policy        │    │
│  │    (yt-navigate-finish)     │        │      (decides friction level) │    │
│  │  • Player State Reporter    │        │  • Storage gateway            │    │
│  │  • Intervention Renderer    │        └───────────────┬──────────────┘    │
│  │    (interstitial, HUD, dim) │                        │                    │
│  └─────────────────────────────┘                        │                    │
│                                                          ▼                    │
│  ┌──────────┐  ┌──────────────┐                ┌──────────────────┐          │
│  │  POPUP   │  │ OPTIONS PAGE │                │ chrome.storage    │          │
│  │ (status) │  │  (full config)│               │ local: ledger,    │          │
│  └──────────┘  └──────────────┘                │   cache, config   │          │
│  ┌──────────────────────────┐                  │ sync: config only │          │
│  │ DASHBOARD (weekly review)│                  └──────────────────┘          │
│  └──────────────────────────┘                                                │
│                                                          │ (optional)         │
└──────────────────────────────────────────────────────────┼───────────────────┘
                                                           ▼
                                          ┌────────────────────────────┐
                                          │ AI classifier (optional)   │
                                          │ • Claude Haiku via BYO key  │
                                          │   or thin serverless proxy  │
                                          │ • OR local embedding model  │
                                          └────────────────────────────┘
```

## 3. Components to build

### 3.1 Content script (`content/`)
Injected on `*.youtube.com`. YouTube is a single-page app, so the script must be resilient
to client-side navigation (no full page reloads).

- **Page Surgeon** — CSS + DOM mutation that hides or dims recommendation surfaces according
  to the active *surgery profile* (Gentle / Balanced / Strict). Targets: home feed grid,
  sidebar "Up next" / related, end-screen video cards, autoplay toggle (force off), Shorts
  shelf and `/shorts` route, optionally comments. Uses a `MutationObserver` because YouTube
  re-renders these nodes constantly.
- **Metadata Scraper** — reads the current video's `title`, `channelName`, `channelId`,
  `durationSeconds`, `isShort`, `isSubscribed`, and a description snippet from the DOM and
  `ytInitialPlayerResponse` when available.
- **Navigation / Intent Hook** — listens for YouTube's `yt-navigate-finish` event and the
  History API to detect each new video and, critically, **how the user got there** (search,
  subscriptions, channel page, direct link, home feed, sidebar rec, autoplay, end-screen,
  shorts feed). This feeds the drift model in [CLASSIFICATION.md](CLASSIFICATION.md#intent).
- **Player State Reporter** — reports `playing | paused | buffering`, current timestamp, and
  tab visibility/audibility to the worker so accounting only counts time actually watched.
- **Intervention Renderer** — draws the in-page UI: the budget HUD, dimming overlays, and
  full interstitials. Implemented in a Shadow DOM root so YouTube's CSS can't fight it.

### 3.2 Service worker (`background/`)
The brain. Stateless-ish (MV3 can suspend it), so all durable state lives in storage and is
re-hydrated on wake.

- **Classification Orchestrator** — given scraped metadata, returns a lane. Pipeline: deny/allow
  lists → keyword rules → cache → (optional) AI → default. Caches by `videoId` and
  `channelId`. Detailed in [CLASSIFICATION.md](CLASSIFICATION.md).
- **Accounting Engine** — see §5. Ticks watch time, attributes it to a lane, decrements
  budgets, accrues/spends credits.
- **Intervention Policy** — pure function: `(lane, budgetState, driftDepth, schedule) →
  interventionLevel`. Keeps the "how hard to push" logic in one testable place (§6).
- **Storage gateway** — read/write wrapper with migrations and a small in-memory cache.

### 3.3 UI surfaces (`ui/`)
- **Popup** — at-a-glance: current video's lane, today's Recharge budget remaining, credit
  balance, quick toggles (pause Balance 15 min, reclassify this video, end session).
- **Options page** — full config: lanes, budgets, earn ratio, channel lists, keyword rules,
  surgery profile, schedules, classifier mode + key.
- **Dashboard** — weekly review: time by lane, drift events, streaks, "biggest rabbit holes."
- **Onboarding** — first-run wizard that seeds the lanes from your subscriptions (§ UX).

### 3.4 Shared (`shared/`)
Types, the lane/intent enums, the storage schema + migrations, and the Intervention Policy
function (imported by both worker and tests).

## 4. Classifier deployment options

The orchestrator is provider-agnostic. Three modes the user can pick in Options — **the chosen
default for this build is `rules+ai` with Claude Haiku 4.5** (best accuracy; only
`{title, channel, snippet}` leaves the device, cached per-channel so calls are rare):

| Mode | Network? | Cost | Notes |
|------|----------|------|-------|
| `rules` | No | Free | Channel lists + keyword rules only. Fully deterministic, fully private. Good default to start. |
| `rules+embeddings` | No* | Free after model download | A small local sentence-embedding model classifies unknown videos by similarity to your seed examples. Private, no per-call cost. *Model downloaded once. |
| `rules+ai` | Yes | ~cents/day | Unknown videos sent to **Claude Haiku 4.5** (cheap, fast, good at this) as `{title, channel, snippet}`. Best accuracy. Use a thin serverless proxy to hold the API key, or BYO-key stored locally. |

Whatever the mode, results are cached aggressively (per channel especially — most of your
watching is from a stable set of channels), so the AI is called rarely.

## 5. Accounting engine

The engine answers: *"How much time, in which lane, and how many credits do I owe?"*

```
On each 5s tick, IF (active tab is a YouTube video AND player == playing
                     AND tab is visible/audible):
    lane        = classification of current video
    source      = intent of current video
    effectiveLane = applyIntent(lane, source, driftDepth)   // see CLASSIFICATION
    ledger.today.byLane[effectiveLane] += 5s
    IF effectiveLane == Enrich AND earn.enabled:
        credits += 5s / earn.ratio        // e.g. ratio 3 ⇒ 1 earned per 3 watched
        credits  = min(credits, earn.dailyCap)
    IF effectiveLane == Recharge:
        budget.recharge.remaining -= 5s   // may go negative ⇒ over budget
```

Rules that keep it honest:
- **Pause / blur / mute / background tab ⇒ no tick.** You don't pay for time you're not watching.
- **Seeking or replaying** the same video doesn't double-charge beyond wall-clock time.
- **Credits are earned live but spent explicitly** — going over the Recharge budget prompts
  the user to *choose* to spend credits (or take a timed pass), so there's a conscious moment.
- **Daily reset** at a user-set wake hour; weekly rollups for the dashboard.

## 6. Intervention levels

A single ordered scale the policy maps onto:

| Level | Trigger (typical) | What the user sees |
|-------|-------------------|--------------------|
| 0 — None | Enrich; or Recharge within budget at drift depth 0–1 | Nothing, maybe a quiet HUD |
| 1 — Inform | Recharge nearing budget; first Drift of a session | HUD turns amber; one-line note |
| 2 — Speed bump | Drift; or Recharge over budget | Interstitial naming *why*, with off-ramps |
| 3 — Cost | "Watch anyway" on Drift / over-budget | Proceed but at 2× budget burn, or spend credits |
| 4 — Cool-down | Drift depth ≥ threshold | 60s forced breather before continue |
| 5 — Hard stop | Daily Drift cap hit, or focus-hours schedule | Blocked until next session / schedule window |

The escalation is driven by **drift depth** (consecutive algorithm-sourced videos) far more
than by raw minutes — that's what makes it target rabbit holes specifically rather than
punishing a single long, intentional watch.

## 7. Data model

```ts
// All persisted in chrome.storage. config syncs across devices; ledger/cache stay local.

type Lane = 'enrich' | 'recharge' | 'drift' | 'unset';
type Intent = 'search' | 'subscriptions' | 'channel' | 'direct'      // intentional
            | 'home' | 'sidebar' | 'autoplay' | 'endscreen' | 'shorts'; // algorithmic

interface Config {
  lanes: {
    shortsAsDrift: boolean;
    defaultLaneForUnknown: Lane;          // default 'recharge' (benefit of the doubt, but budgeted)
  };
  budgets: { recharge: { dailyMinutes: number; weeklyMinutes?: number } };
  earn:   { enabled: boolean; ratio: number; dailyCapMinutes: number }; // ratio 3 ⇒ 3:1
  rules:  {
    channelLanes: Record<string /*channelId*/, Lane>;   // allow/deny by lane
    keywordRules: Array<{ pattern: string; flags?: string; lane: Lane; weight: number }>;
  };
  surgery: 'gentle' | 'balanced' | 'strict' | {
    hideHomeFeed: boolean; hideSidebar: boolean; forceAutoplayOff: boolean;
    hideShorts: boolean; hideEndScreen: boolean; hideComments: boolean;
  };
  classifier: { mode: 'rules' | 'rules+embeddings' | 'rules+ai'; provider?: string;
                byoKey?: string; confidenceThreshold: number };
  schedule: { wakeHour: number; focusHours?: Array<[number, number]>;
              weekendProfile?: Partial<Config> };
  driftThresholds: { coolDownAt: number; hardStopAt: number };
}

interface Ledger {
  today: { dateKey: string; byLane: Record<Lane, number /*seconds*/>;
           creditsEarned: number; creditsSpent: number; driftEvents: number };
  history: Array<Ledger['today']>;        // rolled up daily, trimmed to N weeks
  sessions: Array<{ start: number; end?: number; maxDriftDepth: number;
                    videos: Array<{ videoId: string; lane: Lane; intent: Intent;
                                    seconds: number }> }>;
}

interface ClassificationCache {
  byVideo:   Record<string, { lane: Lane; confidence: number; source: string; ts: number }>;
  byChannel: Record<string, { lane: Lane; confidence: number; source: string; ts: number }>;
}
```

## 8. Why this architecture holds up

- **The lever that matters most is free and offline:** neutralizing the recommendation
  surface (Page Surgeon) kills the majority of drift before classification even runs. Even in
  pure `rules` mode with no AI, Balance is effective on day one.
- **Cost scales to ~zero:** per-channel caching means the AI (if used) is queried a handful of
  times per day, not per video.
- **Failure is graceful:** if classification is uncertain or the worker is asleep, a video
  defaults to budgeted Recharge — never a hard block on a false positive. Balance errs toward
  *nudging*, not *locking you out*, which is what keeps people from uninstalling it.
