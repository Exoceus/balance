# Balance — Classification & the Drift Model

This is the heart of Balance. Anyone can build a timer; the hard part is deciding **which
lane a video belongs in** and recognizing **when you've slipped into a rabbit hole**. This
doc covers both.

---

## 1. The two questions

For every video you open, Balance asks two independent questions:

1. **What *is* this?** → a *content lane* from the video itself (title, channel, description).
2. **How did you *get* here?** → an *intent signal* from your navigation.

The final, *effective* lane is a function of both. This is the key insight that lets Balance
tell World-Cup-highlights-you-searched-for (fine) apart from the-same-highlights-as-your-
sixth-autoplay (a rabbit hole).

```
contentLane  ──┐
               ├──►  applyIntent()  ──►  effectiveLane  ──►  intervention
intent + driftDepth ┘
```

## 2. Content lane — the classification pipeline

Cheapest, most certain checks first. Stop at the first confident answer. Cache everything.

```
                 ┌──────────────────────────────────────────────┐
  video metadata │ title, channelId, channelName, duration,      │
  ──────────────►│ isShort, isSubscribed, description snippet     │
                 └──────────────────────────────────────────────┘
                                    │
   ┌────────────────────────────────┼─────────────────────────────────────────┐
   ▼                                                                            │
 (0) Shorts?  ── /shorts route or isShort ──► Drift (if shortsAsDrift)          │
   │ no                                                                         │
   ▼                                                                            │
 (1) Channel list?  ── channelId in channelLanes ──► that lane  (confidence 1.0)│
   │ miss                                                                       │
   ▼                                                                            │
 (2) Channel cache? ── seen this channel before ──► cached lane  (conf ~0.9)    │
   │ miss                                                                       │
   ▼                                                                            │
 (3) Keyword rules? ── title/desc matches weighted rules ──► winning lane       │
   │ no strong match                                                            │
   ▼                                                                            │
 (4) Classifier mode?                                                           │
       rules            ──► defaultLaneForUnknown (Recharge)                    │
       rules+embeddings ──► nearest-seed-exemplar lane (local, private)         │
       rules+ai         ──► Claude Haiku classifies {title,channel,snippet}     │
   │                                                                            │
   ▼                                                                            │
 (5) Cache result by videoId AND channelId, then return  ◄──────────────────────┘
```

### Tier 1 — Channel lists (deterministic, free)
Your strongest signal. Most people watch from a stable set of a few dozen channels.
`channelLanes[channelId] = 'enrich' | 'recharge' | 'drift'`. Seeded during onboarding by
sorting your subscriptions; grows every time you correct a classification.

### Tier 2 — Channel cache
Once any tier assigns a channel a lane with decent confidence, remember it. The next video
from that channel skips straight to the answer. This is why the AI almost never runs after
the first week.

### Tier 3 — Keyword / regex rules (heuristic, free)
Weighted patterns over the title (and description). Ships with sensible defaults you can edit:

```jsonc
// Drift-leaning
{ "pattern": "\\b(reaction|reacts? to|tier list|drama|exposed|gone wrong|compilation|"
            + "memes?|cringe|ranking every)\\b", "lane": "drift",    "weight": 2 },
// Enrich-leaning
{ "pattern": "\\b(interview|fireside|how I built|deep dive|lecture|paper|architecture|"
            + "postmortem|case study|from scratch|explained|q&a with)\\b",
  "lane": "enrich",  "weight": 2 },
// Recharge-leaning
{ "pattern": "\\b(highlights|full match|recap|extended|official trailer)\\b",
  "lane": "recharge","weight": 1 }
```

Rules are signals, not verdicts: weights from all matches sum per lane; a lane wins only if it
clears `confidenceThreshold` and beats the runner-up by a margin. Otherwise → Tier 4.

### Tier 4 — The smart fallback (only for genuine unknowns)
Three interchangeable backends, chosen in Options:

- **`rules` (default):** no fallback — unknowns become budgeted **Recharge**. Errs toward
  "allowed but counted," never a hard block. Fully private, zero cost.
- **`rules+embeddings` (private, smart):** a small local sentence-embedding model embeds
  `title + channel`. You seeded 5–10 exemplars per lane during onboarding; classify by nearest
  cluster (cosine). No network, no per-call cost. Great privacy/accuracy trade-off.
- **`rules+ai` (most accurate):** send `{title, channel, descriptionSnippet, durationBucket}`
  to **Claude Haiku 4.5** with a tight rubric (below). Haiku is cheap and fast, and per-channel
  caching means a handful of calls a day. Key held in a thin serverless proxy *or* BYO-key
  stored locally.

**AI rubric (system prompt sketch):**
> You sort YouTube videos into one of three lanes for a focus tool.
> **enrich** — technical, educational, or genuinely inspiring: engineering/AI/science,
> long-form interviews with builders, talks, "how I built X," rigorous explainers.
> **recharge** — deliberate entertainment a thoughtful person might choose: sports
> highlights, a specific hobby, well-made documentaries-as-fun.
> **drift** — low-effort algorithmic bait: reaction videos, drama/gossip, generic memes,
> ragebait, clickbait compilations, anything optimized for autoplay stickiness.
> Return strict JSON: `{"lane": "...", "confidence": 0-1, "reason": "<8 words"}`.
> When torn between recharge and drift, weigh whether a deliberate viewer would *seek this
> out* (recharge) or only stumble into it (drift).

The `reason` is shown in the interstitial ("looks like a reaction video") so the nudge is
transparent, and it's the thing the user corrects to retrain the rules.

## 3. Intent — how you got here  {#intent}

The Navigation/Intent Hook tags every video with a `source`. Sources split into two classes:

| Intentional (you chose) | Algorithmic (it was pushed) |
|-------------------------|------------------------------|
| `search` — you typed a query | `home` — home-feed click |
| `subscriptions` — from your subs feed | `sidebar` — "Up next" / related |
| `channel` — from a channel page | `autoplay` — auto-advanced |
| `direct` — link/bookmark/external | `endscreen` — end-screen card |
|  | `shorts` — Shorts feed |

Detection: read the in-app referrer from the SPA navigation event and the originating DOM
container (YouTube tags recommendation clicks distinctly from search-result clicks), plus URL
params. Autoplay is detectable because no click preceded the `yt-navigate-finish`.

## 4. Drift depth — the rabbit-hole detector

A single integer per session, and arguably the most important number in the whole system.

```
on new video:
    if intent is intentional:   driftDepth = 0          // a deliberate choice resets the slide
    if intent is algorithmic:   driftDepth += 1         // another push deeper down the hole
```

- **Depth 0–1:** you're in control. No friction even on Recharge.
- **Depth 2–3:** the algorithm is steering. Recharge gets a speed bump; Drift gets an interstitial.
- **Depth ≥ `coolDownAt` (default 4):** forced 60s cool-down before continuing.
- **Depth ≥ `hardStopAt` (default 6):** session ends; suggest Enrich picks or a break.

This is why Balance doesn't punish a single long, chosen video (depth stays 0) but does catch
"I came for one highlight and it's 40 minutes later" (depth climbs with every autoplay).

## 5. `applyIntent()` — combining the two

```ts
function applyIntent(contentLane, intent, driftDepth) {
  // Searched/subscribed entertainment is legitimate Recharge.
  if (contentLane === 'recharge' && isIntentional(intent)) return 'recharge';

  // Entertainment the algorithm pushed, especially mid-slide, is Drift.
  if (contentLane === 'recharge' && isAlgorithmic(intent) && driftDepth >= 2) return 'drift';

  // Enrich is always welcome regardless of how you arrived...
  if (contentLane === 'enrich') return 'enrich';
  // ...but if "Enrich" was the algorithm's pick deep in a slide, trust it a little less:
  // keep the lane, but don't award earn-credits for algorithm-sourced views.

  return contentLane; // Drift stays Drift; unknown stays its default
}
```

The asymmetry is deliberate: **intent can demote entertainment to Drift, and it gates rewards,
but it never blocks Enrich.** Good content is always allowed in; only the *credit* for it is
withheld when you didn't choose it, so the algorithm can't game the earn system.

## 6. Learning loop

Every correction is gold. When the user reclassifies a video in the popup/interstitial:
1. Update `channelLanes[channelId]` (one correction fixes the whole channel going forward).
2. Optionally propose a keyword rule if a title token strongly predicts the new lane.
3. Add the example to the embedding exemplar set (if in that mode).

Over a week or two, Tiers 1–2 answer almost everything and the smart fallback goes quiet.

## 7. Honest limitations

- **Titles lie.** Clickbait deliberately mimics quality. Mitigation: channel-level lists
  dominate, and the AI rubric is tuned to be suspicious of bait phrasing.
- **Mixed channels.** A channel that posts both lectures and memes can't be a single lane;
  these fall through to per-video keyword/AI classification (still cached per video).
- **Intent detection is heuristic.** YouTube can change its DOM/events; the hook needs
  occasional maintenance. Failure mode is safe: unknown intent is treated as `direct`
  (intentional), so we under-block rather than over-block.
- **Cold start.** Day one leans on defaults + surgery. Onboarding (see [UX.md](UX.md)) seeds
  enough channel lists that the first session already feels personalized.
