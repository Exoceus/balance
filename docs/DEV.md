# Balance — Dev & Install (Phase 0 + 1)

This is a **no-build** Manifest V3 extension — plain JS/ESM, no npm, no bundler. Load it
unpacked and iterate by editing files + hitting reload. Built for Chromium desktop.

## Install (unpacked)

1. Open `chrome://extensions` (or `brave://`, `edge://`).
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder (`balance/`).
4. Pin the ⚖ icon. Open a YouTube video — you should see the HUD bottom-left and the home
   feed replaced by "The feed is resting."

After editing code: go back to `chrome://extensions` and click the **reload** ↻ on the
Balance card. Content-script changes also need a YouTube tab refresh. For service-worker logs,
click **"service worker"** on the card to open its DevTools console.

## How the pieces talk

```
content.js  ──(classify / tick / reclassify / spendCredits / takePass)──►  service-worker.js
   ▲  │                                                                         │
   │  └──────────────── returns lane + budget state ◄─────────────────────────┘
   │
   └── chrome.storage.onChanged (config) ── re-applies surgery + re-classifies
popup.js  ──► service-worker (getState)  +  ──► content.js (getNowPlaying / reclassifyCurrent / endSession)
options.js ──► storage (config) ──(onChanged)──► content.js
```

- **Service worker** is the only place that mutates the ledger/cache and runs classification.
  It reads fresh from storage every message, so MV3 suspension is harmless.
- **Content script** is a classic script (no ES imports) — it inlines the handful of
  constants it needs. Everything else it asks the worker for.
- **Popup/Options** are ES-module pages and `import` from `src/shared/`.

## File map

| Path | Role |
|------|------|
| `manifest.json` | MV3 manifest |
| `src/shared/constants.js` | DEFAULT_CONFIG, lane/profile metadata, helpers (importable) |
| `src/shared/keywords.js` | default Tier-3 keyword rules |
| `src/shared/classify.js` | pure classification pipeline (lists → cache → keywords → default) |
| `src/shared/storage.js` | storage gateway, daily rollover, first-run init |
| `src/background/service-worker.js` | classification orchestration + accounting engine |
| `src/content/content.js` | nav detection, scraper, tick loop, HUD + interstitials |
| `src/content/surgery.css` | all the YouTube hide/dim selectors (class-gated) |
| `src/popup/*` | toolbar popup (status + quick actions) |
| `src/options/*` | full settings editor |
| `tools/make_icons.py` | regenerates `icons/` (pure stdlib) |

## Maintenance notes (read before debugging "it stopped hiding things")

- **YouTube DOM churn is the #1 fragility.** All layout selectors live in `surgery.css`;
  all *scraping* selectors live in `scrapeMeta()` in `content.js`. Those are the two places
  to fix when YouTube ships a redesign. Failure is safe by design — a stale hide-selector
  just shows a recommendation again; a stale scrape selector falls back to `document.title`.
- **Accounting honesty:** the tick counts `video.currentTime` deltas only while playing +
  tab-visible, and ignores deltas > ~7s (seeks). Don't replace it with a wall-clock timer.
- **Intent / drift depth is Phase 2** — not built yet. Today, interventions fire on lane
  (Drift) and budget (over-Recharge) only; there's no "5th autoplay" escalation yet.
- **AI classification is Phase 4** — the `default` branch in `classify.js` is where Claude
  Haiku will plug in. For now unknowns become budgeted Recharge.

## Quick logic check (no browser)

The classifier is pure, so you can sanity-check it with node:

```bash
node --check src/**/*.js   # syntax
# or import classifyVideo from src/shared/classify.js in a throwaway .mjs and assert lanes
```

## Manual test checklist

- [ ] Home feed hidden; search still works.
- [ ] Open an interview/tech video → HUD shows 🟢 Enrich, "banking".
- [ ] Open sports highlights → 🟡 Recharge, budget ticks down.
- [ ] Let Recharge run past the budget → over-budget interstitial with pass/credits/stop.
- [ ] Open something with "reaction"/"compilation" in the title → 🔴 Drift gut-check.
- [ ] Reclassify from the interstitial or popup → channel remembered next time.
- [ ] Pause 15 min from popup → HUD shows "paused", no surgery, no counting.
