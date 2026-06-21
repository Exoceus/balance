# Balance

**A balanced diet for your YouTube attention.**

Balance is a browser extension that re-weights YouTube around *your* values instead of
the recommendation engine's. It makes high-value content frictionless, gives entertainment
a real-but-bounded place, and adds friction to the algorithmic rabbit holes that eat hours
without you noticing.

---

## The problem

Screen-time tools fail on YouTube for two reasons:

1. **They're time-blind to content value.** A blocker that cuts you off after 30 minutes
   treats a 30-minute interview with an AI researcher the same as 30 minutes of autoplayed
   meme compilations. But those are not the same — one you want *more* of, one you want
   *less* of.
2. **They're binary.** Block-all is unsustainable; you disable it the moment you genuinely
   want to watch the World Cup highlights. Allow-all is the status quo that got you here.

The real enemy isn't "YouTube" — it's **drift**: the slow slide from the one video you came
for into the algorithm's endless "Up next." Balance is built to kill drift while protecting
the two things you actually value: **enrichment** and **deliberate fun**.

## The idea in one sentence

> Treat your attention like a budget across three lanes — **Enrich**, **Recharge**, and
> **Drift** — make the good lane effortless, cap the fun lane, and tax the junk lane.

## The three lanes

| Lane | Color | What's in it | Policy |
|------|-------|--------------|--------|
| **Enrich** | 🟢 | Technical / inspiring content: AI interviews, "how I built X", deep dives, talks, lectures | Frictionless. Earns credits. |
| **Recharge** | 🟡 | *Deliberate* entertainment you value: World Cup highlights, a creator you love | Allowed within a daily budget |
| **Drift** | 🔴 | Algorithmic rabbit-hole bait: reactions, drama, generic memes, low-effort compilations, most autoplay | Heavy friction or blocked |
| **Shorts** | ⚫ | The infinite-scroll feed | Treated as Drift by default (toggleable) |

The crucial nuance: **a video's lane depends partly on how you arrived at it.** World Cup
highlights you *searched for* are Recharge. The same channel auto-playing as your sixth
consecutive video is Drift. Intent is a first-class signal — see
[CLASSIFICATION.md](docs/CLASSIFICATION.md).

## Three design principles

1. **Classify, don't just clock.** *What* you spend time on matters more than how much.
2. **Intent over impulse.** Reward content you sought out; tax content the algorithm pushed.
3. **Budget, don't ban.** Entertainment is allowed — within a deliberate budget — so the
   tool stays sustainable and you don't rebel against it.

## What it actually does, day to day

- **Neutralizes the recommendation surface** — the home feed, sidebar "Up next", end-screen
  cards, autoplay, and the Shorts shelf are hidden or dimmed by default. You navigate by
  *search* and *subscriptions*, which is inherently intentional.
- **Classifies every video** you open into a lane (rules first, optional AI for the unknowns).
- **Meters watch time per lane** and spends it against your budgets in real time.
- **Lets enrichment buy entertainment** — watch 30 min of Enrich, earn 10 min of Recharge
  (ratio configurable). The good stuff literally funds the fun stuff.
- **Escalates friction with drift depth** — the deeper you slide down the algorithmic hole,
  the harder Balance pushes back, then offers a graceful off-ramp.
- **Reflects weekly** — a dashboard shows where your attention actually went.

## Install (30 seconds)

No build step. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
pick this folder. Open a YouTube video and you'll see the ⚖ HUD. Full instructions and the
test checklist are in [docs/DEV.md](docs/DEV.md).

## Repo map

| File | What's in it |
|------|--------------|
| [docs/DESIGN.md](docs/DESIGN.md) | System architecture, components, data model, accounting engine |
| [docs/CLASSIFICATION.md](docs/CLASSIFICATION.md) | The crux: how a video gets a lane (rules → intent → AI), and the drift model |
| [docs/UX.md](docs/UX.md) | End-to-end user experience + ASCII mockups (interstitials, HUD, popup, dashboard, onboarding) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased build plan, MVP cut line, decisions |
| [docs/DEV.md](docs/DEV.md) | **Install, file map, maintenance notes, test checklist** |
| `manifest.json`, `src/` | The actual extension (Phase 0 + 1, see below) |

## Status

**Phase 0 + 1 built and working** — a loadable MV3 extension. Implemented:

- ✅ Page Surgeon (hide home feed / sidebar / autoplay / shorts / end-screen, 3 profiles)
- ✅ Manual channel lanes + keyword rules + classification pipeline (no AI yet)
- ✅ Accounting engine: per-lane watch time, 30-min Recharge budget, Enrich→credits, daily reset
- ✅ Ambient HUD + Drift gut-check + over-budget interstitials (spend credits / pass / stop)
- ✅ Popup (status, reclassify, pause, end session) + full Options page

**Not yet** (see [ROADMAP](docs/ROADMAP.md)): intent/drift-depth escalation (Phase 2),
earn streaks + weekly dashboard (Phase 3), Claude Haiku classification (Phase 4),
onboarding lane-sorter (Phase 5).
