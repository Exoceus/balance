# Balance — Roadmap & Build Order

Phased so that **each phase is independently useful**. If you stop after Phase 1 you already
have a tool worth using; everything after is compounding refinement.

---

## Guiding cut-line principle

The biggest behavior change comes from the cheapest, most offline feature: **neutralizing the
recommendation surface.** Build that first, prove it helps, then layer intelligence on top.
Don't gate the MVP on AI classification — it's an enhancement, not a foundation.

---

## Phase 0 — Skeleton  ✅ DONE
*Goal: a loadable extension that knows when you're watching a video.*

- [x] MV3 scaffold: manifest, service worker, content script on `*.youtube.com`, popup.
- [x] Content script detects video changes via `yt-navigate-finish` + History API + URL poll.
- [x] Metadata Scraper: title, channelId/handle, channelName, duration, isShort, isSubscribed.
- [x] Player State Reporter (currentTime delta, visibility) → worker tick.
- [x] `chrome.storage` gateway + schema + first-run init + daily rollover.

## Phase 1 — MVP: Surgery + manual lanes + budget  ✅ DONE
*Goal: the core habit-changer, zero AI.*

- [x] **Page Surgeon** with Gentle/Balanced/Strict profiles (hide/dim home feed, sidebar,
      autoplay-off, shorts, end-screen, comments). Class-gated CSS in `surgery.css`.
- [x] Channel lists (`channelLanes`) + Options page to manage them.
- [x] Keyword/regex rule engine with shipped defaults (+ Options editor).
- [x] Classification orchestrator: shorts → lists → cache → keyword → default. (No Tier 4 yet.)
- [x] **Accounting Engine:** per-lane tick, 30-min Recharge budget, Enrich→credits, daily reset.
- [x] In-page **HUD** + **interstitial 5a/5b** (Drift gut-check + over-budget) with off-ramps.
- [x] Popup with today's totals, current-video lane, reclassify, pause, end session.

**Result:** loads unpacked; home feed is gone, highlights run on a 30-min budget, junk titles
trigger a speed bump. **Next: live on it for a week, then start Phase 2 (intent/drift depth).**

## Phase 2 — The drift model (½–1 week)
*Goal: target rabbit holes specifically, not just raw minutes.*

- [ ] Navigation/Intent Hook: tag each video's `source` (search/subs/channel/direct vs
      home/sidebar/autoplay/endscreen/shorts).
- [ ] Drift-depth counter + `applyIntent()` (intent demotes pushed entertainment to Drift).
- [ ] Intervention Policy as a pure, unit-tested function (levels 0–5).
- [ ] Cool-down (5c) and hard-stop interventions.

**Done when:** searching a highlight is frictionless but the 5th autoplay triggers a cool-down.

## Phase 3 — Earn & reflect (½–1 week)
*Goal: the positive-reinforcement loop and weekly insight.*

- [ ] Credit ledger: Enrich earns, over-budget Recharge can spend, daily cap, streaks.
- [ ] HUD "banking" indicator + credit-spend path in the over-budget interstitial.
- [ ] **Weekly dashboard** (time by lane, drift events caught, streaks, suggestions).
- [ ] Post-session/dashboard "block this autoplay channel?" one-tap learning prompts.

**Done when:** Enrich visibly funds Recharge, and Sunday shows a satisfying weekly review.

## Phase 4 — Smart classification (1 week)
*Goal: handle the long tail of unknown videos well.* **Chosen backend: Claude Haiku (cloud).**

- [ ] Pluggable Tier-4 backend interface.
- [ ] **`rules+ai` (default): Claude Haiku 4.5** classifier with the rubric in
      CLASSIFICATION.md; BYO-key in Options *and/or* a thin serverless proxy. Aggressive
      per-channel caching + rate limiting so it runs only a handful of times a day.
- [ ] Learning loop: corrections update channel lists, propose keyword rules.
- [ ] *(Later / optional)* `rules+embeddings` on-device mode for a fully-private alternative —
      not needed for the chosen setup, build only if cloud calls ever feel like too much.

**Done when:** brand-new channels get sensibly sorted without manual input, cheaply and rarely.

## Phase 5 — Polish & onboarding (½–1 week)
- [ ] Onboarding wizard incl. the **lane sorter** seeded from your subscriptions.
- [ ] Schedules (focus hours, weekend profile), config sync across devices.
- [ ] Copy pass on all interventions for the "friendly second-self" tone.
- [ ] Export/import config; accessibility pass on overlays. *(Firefox/mobile out of scope —
      see decisions below; Chromium desktop only.)*

---

## Tech stack (suggested)
- **Extension:** TypeScript, MV3. Build with Vite + `@crxjs/vite-plugin` (HMR for extensions).
- **In-page UI:** lightweight — Preact or vanilla + Shadow DOM (avoid heavy frameworks in a
  content script; they fight YouTube's perf and CSS).
- **Storage:** `chrome.storage.local` for ledger/cache, `chrome.storage.sync` for config.
- **AI (optional):** Claude Haiku 4.5 via the Anthropic SDK behind a tiny proxy, or BYO-key.
  On-device option: a small ONNX/transformers.js embedding model.
- **Tests:** Vitest for the pure logic (classifier, intervention policy, accounting). These are
  the parts worth testing hard; the DOM glue is best verified by hand against live YouTube.

## Biggest technical risks
1. **YouTube DOM churn.** Surgery selectors and intent detection will break when YouTube
   ships UI changes. Mitigation: centralize all selectors in one module, fail safe (a missed
   selector means a rec shows, not a crash), add a "report broken layout" affordance.
2. **MV3 service-worker suspension.** The worker sleeps; never hold state only in memory.
   Re-hydrate from storage on every wake; keep the accounting tick driven by content-script
   messages (the page is always alive while you watch) rather than a background timer alone.
3. **Accounting honesty** (don't count paused/background time) and **double-counting** on
   seeks/replays — get this right in Phase 1 or the budget loses trust.

## Decisions (locked 2026-06-20)
- **Classifier:** `rules+ai` with **Claude Haiku (cloud)** as the Tier-4 default. Only
  `{title, channel, snippet}` leaves the device; cached per-channel so calls are rare.
- **Budget:** **30 min/day** Recharge, **3:1** earn ratio (3 min Enrich → 1 min Recharge).
- **Shorts:** **treated as Drift** — hidden by default, counted against the rabbit-hole lane.
- **Platforms:** **Chromium desktop only** for now. Mobile is explicitly out of scope (would
  need a different mechanism — DNS/app-level — so don't over-invest in cross-device sync yet).

## Still open (lower-stakes, decide during build)
- **Scope of "surgery":** also hide comments under videos, or leave them? (Strict profile hides
  them; default is to keep.)
- **Focus-hours schedule:** do you want hard-stop Drift blocking during set work hours, or keep
  it budget-only?
