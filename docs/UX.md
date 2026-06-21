# Balance — User Experience & Mockups

How Balance feels to use, from first run to a typical evening, with ASCII wireframes for every
surface. Design rule throughout: **nudge, don't nag.** The best intervention is the one you
barely notice; the loudest ones come only when you're genuinely sliding.

---

## 1. The emotional arc we're designing for

| Moment | What we want you to feel |
|--------|--------------------------|
| Open YouTube | Calm. No wall of recommendations shouting for attention. |
| Watch Enrich | Rewarded. A credit bar fills; you're "banking" fun. |
| Watch chosen Recharge | Free, but aware. A quiet HUD shows the budget ticking. |
| Drift starts | Gently caught. A speed bump that names what's happening, with an easy out. |
| Deep in a hole | Firmly but kindly stopped, then handed something better. |
| End of week | Reflective, a little proud. The dashboard shows attention well spent. |

---

## 2. First run — onboarding (the lane sorter)

The single most important onboarding step is seeding channel lists from your subscriptions, so
classification is personal from minute one.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚖  Balance — let's sort your channels                    Step 2 of 4 │
├─────────────────────────────────────────────────────────────────────┤
│  Drag each channel into a lane. We've guessed — fix what's wrong.     │
│                                                                       │
│   🟢 ENRICH            🟡 RECHARGE           🔴 DRIFT                  │
│   grow / inspire       deliberate fun        rabbit holes             │
│  ┌────────────────┐  ┌────────────────┐   ┌────────────────┐          │
│  │ Lex Fridman    │  │ FIFA           │   │ Daily Dose of  │          │
│  │ Two Minute Pap…│  │ NBA            │   │   Internet     │          │
│  │ ThePrimeagen   │  │ Marques B.     │   │ (drag here…)   │          │
│  │ + 9 more       │  │ + 3 more       │   │                │          │
│  └────────────────┘  └────────────────┘   └────────────────┘          │
│                                                                       │
│  Unsorted (12):  [ MrBeast ] [ Veritasium ] [ ESPN ] [ Kurzgesagt ]…  │
│                                                                       │
│  ⚙ Default for anything unsorted:  ( • Recharge / budgeted )  ▼       │
│                                                          [ Back ][Next]│
└─────────────────────────────────────────────────────────────────────┘
```

Other onboarding steps: (1) welcome + the three principles, (3) set your **Recharge budget**
(default 30 min/day) and **earn ratio** (default 3:1), (4) pick a **surgery profile**:

```
┌─────────────────────────────────────────────────────────────────────┐
│  How aggressive should Balance be with YouTube's layout?  Step 4 of 4 │
├─────────────────────────────────────────────────────────────────────┤
│  ( ) Gentle    Dim recommendations, keep them clickable.              │
│  (•) Balanced  Hide home feed + sidebar + autoplay. Keep search/subs. │  ← recommended
│  ( ) Strict    Balanced + hide Shorts, end-screens, and comments.     │
│                                                                       │
│  Preview ▼   [ youtube.com home with feed hidden, search bar centered]│
│                                                       [ Back ][ Done ]│
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. The home page, after surgery (Balanced profile)

The feed is gone. What's left is a launchpad for *intentional* watching.

```
┌───────────────────────────────────────────────────────────────────────┐
│  ≡   ▶ YouTube      [  Search…                              🔍 ]    ⚖ ◉ │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│         The feed is resting. Search, or pick from your lanes.           │
│                                                                         │
│   🟢 From your Enrich subs (new)        🟡 Recharge — 30:00 left today   │
│   ┌──────────┐ ┌──────────┐             ┌──────────┐ ┌──────────┐        │
│   │ AI agents│ │ Building │             │ WC: ARG  │ │ Top 10   │        │
│   │ interview│ │ a compi… │             │ v FRA HL │ │ saves    │        │
│   └──────────┘ └──────────┘             └──────────┘ └──────────┘        │
│                                                                         │
│   Credits available: 🟡 +8 min  (earned from 24 min of Enrich today)    │
└───────────────────────────────────────────────────────────────────────┘
```

The rails here are **not** YouTube's recommendations — they're *your subscriptions*, filtered
by lane. Enrich is shown first and bigger. Drift channels are simply never surfaced.

---

## 4. The in-page HUD (always-on, ambient)

A small, draggable pill near the player. Colorless and quiet when all is well; it earns your
attention only when the budget or drift depth changes.

```
   While watching Enrich:                 While watching chosen Recharge:
   ┌─────────────────────────────┐        ┌─────────────────────────────┐
   │ ⚖ 🟢 Enrich · banking +1/3m │        │ ⚖ 🟡 Recharge · 21:30 left  │
   └─────────────────────────────┘        │   [▓▓▓▓▓▓▓░░░] credits +8min │
                                          └─────────────────────────────┘

   Budget getting low (amber):            Drift depth climbing (warning):
   ┌─────────────────────────────┐        ┌─────────────────────────────┐
   │ ⚖ 🟡 Recharge · 3:10 left ⚠ │        │ ⚖ 🔴 3rd autoplay in a row… │
   └─────────────────────────────┘        │   one more triggers a pause  │
                                          └─────────────────────────────┘
```

---

## 5. The interstitial (the speed bump)

The core intervention. Appears as a calm overlay (player auto-pauses) when you hit Drift or go
over budget. It always **names why**, always **offers a graceful path**, and never traps you.

### 5a. Drift caught
```
┌───────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                        ⚖   Quick gut-check                              │
│                                                                         │
│   This looks like a 🔴 rabbit-hole video.                               │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │  "Top 50 FUNNIEST World Cup Fails 😂😂"                           │  │
│   │  via autoplay · 4th in a row · reason: clickbait compilation      │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│   You came for highlights 18 minutes ago. Still want this?              │
│                                                                         │
│     [  Not really — show me Enrich ▸  ]   ← suggests 2 of your subs     │
│     [  I'm done for now            ]                                    │
│     [  Watch anyway  ·  costs 2× budget (≈ spends 5 min) ]              │
│                                                                         │
│   ▸ Wrong call? This is actually:  🟢 Enrich   🟡 Recharge   (retrains) │
└───────────────────────────────────────────────────────────────────────┘
```

### 5b. Over budget (but it's legit entertainment you chose)
```
┌───────────────────────────────────────────────────────────────────────┐
│                     ⚖   Recharge budget is spent                        │
│                                                                         │
│   You've used your 30 min of entertainment for today. This one's        │
│   🟡 Recharge and you searched for it — no judgment. How to proceed?    │
│                                                                         │
│     [  Spend 12 earned credits  ▸  ]   ← from today's Enrich watching   │
│     [  Take a 10-min pass       ]      (borrows against tomorrow)       │
│     [  Stop here — good call    ]                                       │
│                                                                         │
│   Streak: 4 days within budget 🔥  — keep it?                           │
└───────────────────────────────────────────────────────────────────────┘
```

### 5c. Cool-down (deep drift)
```
┌───────────────────────────────────────────────────────────────────────┐
│                          ⚖   Let's pause                                │
│                                                                         │
│   That's 5 autoplayed videos in a row. Take 60 seconds.                 │
│                                                                         │
│                        ◴   00:47 remaining                              │
│                                                                         │
│   When the timer ends:                                                  │
│     [  Back to something useful ▸ ]      [  End session, I'm good  ]     │
│                                                                         │
│   (Breathe. The video will still be there. It's rarely worth it.)       │
└───────────────────────────────────────────────────────────────────────┘
```

Tone matters: the copy is a friendly second-self, not a scold. "Good call," "no judgment,"
"it's rarely worth it" — these keep the tool on your side so you don't disable it in a huff.

---

## 6. The popup (toolbar click)

Quick status and controls without leaving the video.

```
┌──────────────────────────────────┐
│ ⚖  Balance                  ◉ on │
├──────────────────────────────────┤
│ Now watching                     │
│  🟢 Enrich · "AI agents in 2026" │
│  Andrej Karpathy · banking +1/3m │
│                                  │
│ Today                            │
│  🟢 Enrich      48 min           │
│  🟡 Recharge    22 / 30 min ▓▓▓░ │
│  🔴 Drift        6 min  (2 avoided)│
│  Credits        🟡 +12 min       │
│                                  │
│ Quick actions                    │
│  [ Reclassify this video ▾ ]     │
│  [ Pause Balance 15 min   ]      │
│  [ End session            ]      │
│  [ Open dashboard ·  ⚙ Settings ]│
└──────────────────────────────────┘
```

---

## 7. The weekly dashboard (reflection)

Opens on Sundays (or on demand). The goal is insight and a little pride — not guilt.

```
┌───────────────────────────────────────────────────────────────────────┐
│  ⚖  Your week on YouTube                         Jun 14 – Jun 20, 2026  │
├───────────────────────────────────────────────────────────────────────┤
│  Total watched: 6h 12m            vs last week: ▼ 41m   nice.           │
│                                                                         │
│  By lane                                                                │
│   🟢 Enrich    ███████████████████░░░░░░░  3h 40m   (59%)               │
│   🟡 Recharge  ██████████░░░░░░░░░░░░░░░░░  1h 58m   (32%)               │
│   🔴 Drift     ███░░░░░░░░░░░░░░░░░░░░░░░░    34m    ( 9%)  ▼ from 1h22m │
│                                                                         │
│  Rabbit holes caught: 11   ·   avg drift depth before stop: 3.2         │
│  Longest hole that slipped through: 14m (Sat night) — want to block     │
│  "Daily Dose of Internet" autoplay? [ Yes, → Drift ]                    │
│                                                                         │
│  Budget: within Recharge 6/7 days 🔥   ·   credits earned 84m / spent 31m│
│                                                                         │
│  Top Enrich you watched:  Karpathy interview · "Building a compiler"…   │
│  Suggestion: you keep searching "world cup" then drifting — want a      │
│  one-tap "World Cup highlights only" saved search?   [ Create it ]      │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 8. Options page (full control)

Tabbed; power users live here, everyone else rarely visits after onboarding.

```
┌───────────────────────────────────────────────────────────────────────┐
│ ⚖ Settings   [ Lanes ][ Budget ][ Layout ][ Classifier ][ Schedule ]   │
├───────────────────────────────────────────────────────────────────────┤
│  LANES & RULES                                                          │
│   Channels        🟢 14   🟡 7   🔴 5      [ + add ] [ import subs ]    │
│   Keyword rules   "reaction|tier list|drama" → 🔴   [ edit ] [ + add ]  │
│   Unknown video defaults to:  ( 🟡 Recharge ▼ )                         │
│                                                                         │
│  BUDGET & CREDITS                                                       │
│   Recharge/day    [ 30 ] min      Weekly cap [ off ]                    │
│   Earn ratio      [ 3 ] min Enrich → 1 min Recharge   Daily cap [ 20 ]  │
│                                                                         │
│  CLASSIFIER                                                             │
│   Mode  ( ) Rules only   (•) Rules + on-device AI   ( ) Rules + Claude  │
│   └ Claude Haiku key: [ •••••••••• ]  (stored locally)  [ test ]        │
│                                                                         │
│  SCHEDULE                                                               │
│   Focus hours (hard-stop Drift):  [ 09:00 ]–[ 17:00 ] on weekdays       │
│   Day resets at:  [ 04:00 ]    Weekend profile: ( looser ▼ )            │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 9. Walkthrough: a Saturday with the World Cup on

A concrete story that exercises the whole system.

1. You open YouTube. **No feed** — just search + your lanes. (Surgery)
2. You search *"Argentina France highlights"* and click the official FIFA clip.
   Source = `search`, content = Recharge, drift depth = 0 → **plays freely**, HUD shows
   `🟡 21:30 left`. (Intent keeps chosen fun frictionless)
3. It ends. Autoplay is off, so nothing hijacks you — but you click a sidebar "Up next"
   highlight anyway. Source = `sidebar`, depth = 1 → still fine, HUD ticks down.
4. Two more auto-suggested clips later (depth 3), one is *"World Cup Fails Compilation 😂."*
   Content = Drift, depth = 3 → **interstitial 5a**. You hit *"Show me Enrich"* and it offers
   the Karpathy interview you'd saved. (Rabbit hole intercepted, redirected up)
5. You watch 24 min of that interview → **credits accrue** (+8 min). Later that night you're
   over your 30-min Recharge budget but want one more match recap → **interstitial 5b** lets
   you *spend earned credits*. Conscious choice, not a sneaky slide. (Budget, not ban)
6. Sunday, the **dashboard** shows 59% Enrich, Drift down 48m from last week, a 6/7 budget
   streak. You feel fine about it — which is the whole point.
