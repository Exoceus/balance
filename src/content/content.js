// src/content/content.js — runs on youtube.com. Classic content script (no imports).
// Responsibilities: surgery (toggle CSS classes), detect video navigation, scrape metadata,
// meter watch time, render the HUD + interstitials (Shadow DOM). The service worker owns
// classification + accounting; this script asks it and reacts.
(() => {
  'use strict';

  // --- inlined constants (kept in sync with src/shared/constants.js by hand) ---
  const LANE_META = {
    enrich:   { emoji: '🟢', label: 'Enrich',   color: '#3fb950' },
    recharge: { emoji: '🟡', label: 'Recharge', color: '#d2a000' },
    drift:    { emoji: '🔴', label: 'Drift',    color: '#e5534b' },
    unset:    { emoji: '⚪', label: 'Unsorted', color: '#8b949e' },
  };
  const SURGERY_PROFILES = {
    gentle:   { dimHome: true,  dimSidebar: true },
    balanced: { hideHome: true, hideSidebar: true, autoplayOff: true },
    strict:   { hideHome: true, hideSidebar: true, autoplayOff: true,
                hideShorts: true, hideEndscreen: true, hideComments: true },
  };
  const TICK_MS = 1000;   // 1s metering → precise counters that update every second

  // --- state ---
  let config = null;
  let current = null;          // { videoId, meta, lane, classification }
  let override = null;         // { videoId, countLane, burn } — set by "watch anyway"/spend/pass
  let overBudgetHandled = false;
  let lastCurrentTime = 0;
  let lastTickWall = 0;        // wall-clock timestamp of the previous metering tick
  let lastState = null;
  let feedHost = null;         // shadow host for the curated home feed
  let curated = null;          // { enrich: [video...], recharge: [video...] }
  let feedCards = null;        // raw scraped cards, kept so we can re-group after a retag
  let feedToken = 0;           // invalidates in-flight feed scans on re-navigation
  let driftOpen = false;       // is the Drift review disclosure expanded (persist across re-renders)
  let lastAlertBoundary = -1;  // last 15-min total-watch boundary we alerted on (fullscreen nudges)
  const ALERT_EVERY_MIN = 15;

  // --- helpers ---
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);
  const dur = (s) => {                         // compact, e.g. "0s" / "42s" / "12m" / "1h 5m"
    s = Math.max(0, Math.round(s));
    if (s < 60) return s + 's';
    const m = Math.round(s / 60);
    return m < 60 ? m + 'm' : `${Math.floor(m / 60)}h ${m % 60}m`;
  };
  const clock = (s) => {                        // precise, e.g. "0:09" / "12:34" / "1:02:05"
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const ss = String(sec).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };
  const active = () => config && config.enabled && !(config.pausedUntil > Date.now());

  // Optimistic surgery before config loads (default = enabled + balanced) to avoid a feed flash.
  document.documentElement.classList.add('balance-on', 'balance-hide-home', 'balance-hide-sidebar');

  // ====================== surgery ======================
  function resolveFlags() {
    if (!active()) return {};
    const s = config.surgery;
    return (s && typeof s === 'object') ? s : (SURGERY_PROFILES[s] || SURGERY_PROFILES.balanced);
  }
  function applySurgery() {
    const html = document.documentElement;
    html.classList.toggle('balance-on', !!active());
    const f = resolveFlags();
    const map = {
      'balance-hide-home': f.hideHome, 'balance-hide-sidebar': f.hideSidebar,
      'balance-hide-shorts': f.hideShorts, 'balance-hide-endscreen': f.hideEndscreen,
      'balance-hide-comments': f.hideComments,
      'balance-dim-home': f.dimHome, 'balance-dim-sidebar': f.dimSidebar,
    };
    for (const [cls, on] of Object.entries(map)) html.classList.toggle(cls, !!on);
    if (active() && f.autoplayOff) turnOffAutoplay();
  }
  function turnOffAutoplay() {
    const btn = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
    if (btn) btn.click();
  }

  // ====================== metadata ======================
  function currentVideoId() {
    const u = new URL(location.href);
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
    return u.searchParams.get('v');
  }
  const isWatchPage = () => !!currentVideoId();

  function scrapeMeta() {
    const videoId = currentVideoId();
    if (!videoId) return null;
    const isShort = location.pathname.startsWith('/shorts/');
    const title = (
      document.querySelector('ytd-watch-metadata h1 yt-formatted-string, h1.ytd-watch-metadata, #title h1')?.textContent ||
      document.title.replace(/ - YouTube$/, '')
    ).trim();
    const ownerA = document.querySelector('ytd-video-owner-renderer a, #owner #channel-name a, ytd-channel-name#channel-name a, ytd-channel-name a');
    const channelName = ownerA?.textContent?.trim() || '';
    const href = ownerA?.getAttribute('href') || '';
    const channelId = (href.match(/\/channel\/([\w-]+)/) || [])[1] || '';
    const channelHandle = (href.match(/\/@([\w.-]+)/) || [])[1] || '';
    const subBtn = document.querySelector('#subscribe-button button, ytd-subscribe-button-renderer button');
    const isSubscribed = subBtn ? (subBtn.getAttribute('aria-pressed') === 'true' || /subscribed/i.test(subBtn.textContent || '')) : false;
    const v = document.querySelector('video');
    const durationSeconds = v && isFinite(v.duration) ? Math.round(v.duration) : 0;
    return { videoId, isShort, title, channelName, channelId, channelHandle, isSubscribed, durationSeconds };
  }

  // ====================== navigation ======================
  // Pull today's per-lane totals from the service worker so the panel is accurate
  // on every page — including home/search/subscriptions where no tick runs.
  async function refreshState() {
    const st = await send({ type: 'getState' });
    if (st && !st.error) { lastState = st; renderHud(); }
  }

  async function onNavigate() {
    applySurgery();
    refreshState();
    buildCuratedFeed();
    if (!isWatchPage()) { current = null; renderHud(); hideInterstitial(); removeWatchTagger(); return; }

    const videoId = currentVideoId();
    if (current && current.videoId === videoId) return;

    // reset per-video state
    override = null; overBudgetHandled = false; lastCurrentTime = 0; lastTickWall = 0;
    hideInterstitial(); hideEndOverlay();

    const meta = scrapeMeta();
    current = { videoId, meta, lane: 'unset', classification: null };
    await classifyCurrent(meta);
    retryEnrich(videoId, 0); // channel/title load async; re-scrape & re-classify a few times
  }

  function retryEnrich(videoId, n) {
    if (n > 8 || !current || current.videoId !== videoId) return;
    setTimeout(async () => {
      if (!current || current.videoId !== videoId) return;
      const meta = scrapeMeta();
      const before = current.meta || {};
      const changed = meta && (meta.channelName !== before.channelName || meta.title !== before.title ||
                               (!before.channelId && meta.channelId));
      if (changed) { current.meta = meta; await classifyCurrent(meta); }
      renderWatchTagger();                              // title area loads late — keep trying to mount
      if (active() && resolveFlags().autoplayOff) turnOffAutoplay(); // button loads late
      retryEnrich(videoId, n + 1);
    }, 500);
  }

  async function classifyCurrent(meta) {
    if (!meta) return;
    const res = await send({ type: 'classify', meta });
    if (!res || res.error) return;
    current.classification = res;
    current.lane = res.lane;
    renderHud();
    renderWatchTagger();
    // Show the Drift gut-check at most once per video (re-classification can fire repeatedly).
    if (active() && res.lane === 'drift' && !override && !current.driftShown) {
      current.driftShown = true;
      showDriftInterstitial();
    } else if (res.lane !== 'drift') {
      hideInterstitial();
    }
  }

  async function doReclassify(lane, { resume = false } = {}) {
    if (!current) return;
    await send({ type: 'reclassify', payload: {
      videoId: current.videoId,
      channelKey: current.classification?.channelKey || null,
      channelName: current.meta?.channelName || '',
      lane,
    }});
    current.lane = lane;
    current.classification = { ...(current.classification || {}), lane, source: 'user' };
    override = null; overBudgetHandled = false;
    hideInterstitial(); renderHud(); renderWatchTagger();
    if (resume) resumeVideo();   // only when dismissing an interstitial — not a plain retag
  }

  // ====================== curated home feed ======================
  // Rather than fully blanking the home feed, classify the cards YouTube already
  // rendered and re-surface only the good lanes: an "Get inspired" (Enrich) section,
  // then a Recharge section that appears only while there's budget left.
  const isHomePage = () => location.pathname === '/';

  // Pull one card's data out of a feed tile. Works across YouTube layouts (classic
  // id-based `ytd-rich-grid-media` and the newer class-based `yt-lockup-view-model`)
  // by trying several selectors and falling back to "any /watch link in the tile".
  // In-feed ads carry a /watch link and a generic "Watch" CTA, so they'd otherwise be
  // scraped and dumped into the default lane. Drop anything that looks sponsored.
  const AD_RENDERERS = 'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer, ' +
                       'ytd-promoted-video-renderer, ytd-promoted-sparkles-web-renderer';
  const AD_TITLES = /^(watch|watch on youtube|visit (site|store)|learn more|shop now|install|sign up|download|subscribe|play( now)?)$/i;
  function isAdTile(it) {
    if (it.matches?.(AD_RENDERERS) || it.closest?.(AD_RENDERERS)) return true;
    if (it.querySelector?.(AD_RENDERERS + ', [aria-label="Sponsored" i]')) return true;
    const badge = it.querySelector?.('ytd-badge-supported-renderer, badge-shape, .badge-shape-wiz__text, .badge');
    return !!badge && /\b(sponsored|ad)\b/i.test(badge.textContent || '');
  }

  function extractCard(it) {
    if (isAdTile(it)) return null;
    let vid = '';
    for (const a of it.querySelectorAll('a[href*="watch?v="]')) {
      const m = (a.getAttribute('href') || '').match(/[?&]v=([\w-]+)/);
      if (m) { vid = m[1]; break; }
    }
    if (!vid) return null;

    const titleEl = it.querySelector(
      '#video-title, a#video-title-link, .yt-lockup-metadata-view-model__title, h3 a, h3 span'
    );
    let title = (titleEl?.getAttribute?.('title') || titleEl?.textContent || '').trim();
    if (!title) {
      const la = it.querySelector('a[href*="watch?v="][title], a[href*="watch?v="][aria-label]');
      title = (la?.getAttribute('title') || la?.getAttribute('aria-label') || '').trim();
    }
    if (!title || AD_TITLES.test(title)) return null;

    const chA = it.querySelector(
      'ytd-channel-name a, #channel-name a, .yt-content-metadata-view-model a, a[href^="/@"], a[href*="/channel/"]'
    );
    const chHref = chA?.getAttribute('href') || '';
    const channelName = (
      it.querySelector('ytd-channel-name #text, ytd-channel-name a, #channel-name #text')?.textContent ||
      chA?.textContent || ''
    ).trim();
    const channelId = (chHref.match(/\/channel\/([\w-]+)/) || [])[1] || '';
    const channelHandle = (chHref.match(/\/@([\w.-]+)/) || [])[1] || '';
    // Same precedence as channelKeyOf() in classify.js, so retagging a card writes the
    // rule under the exact key classifyMany() will look it up by.
    const channelKey = channelId || (channelHandle ? 'h:' + channelHandle.toLowerCase()
                                   : channelName ? 'n:' + channelName.toLowerCase() : '');
    return { videoId: vid, title, channelName, channelId, channelHandle, channelKey, isShort: false };
  }

  function scrapeFeedCards() {
    const root = document.querySelector('ytd-browse[page-subtype="home"]') || document;
    let tiles = root.querySelectorAll('ytd-rich-item-renderer, yt-lockup-view-model, ytd-video-renderer');
    if (!tiles.length) tiles = document.querySelectorAll('ytd-rich-item-renderer, yt-lockup-view-model, ytd-video-renderer');
    const out = [], seen = new Set();
    for (const it of tiles) {
      const c = extractCard(it);
      if (c && !seen.has(c.videoId)) { seen.add(c.videoId); out.push(c); }
    }
    // Last-ditch: scrape raw /watch links anywhere on the page.
    if (!out.length) {
      for (const a of document.querySelectorAll('a[href*="/watch?v="]')) {
        if (isAdTile(a)) continue;
        const vid = ((a.getAttribute('href') || '').match(/[?&]v=([\w-]+)/) || [])[1];
        const title = (a.getAttribute('title') || a.getAttribute('aria-label') || a.textContent || '').trim();
        if (vid && title && !AD_TITLES.test(title) && !seen.has(vid)) {
          seen.add(vid);
          out.push({ videoId: vid, title, channelName: '', channelId: '', channelHandle: '', isShort: false });
        }
      }
    }
    return out;
  }

  function feedDiag() {
    return {
      home: isHomePage(),
      browse: !!document.querySelector('ytd-browse[page-subtype="home"]'),
      richItem: document.querySelectorAll('ytd-rich-item-renderer').length,
      lockup: document.querySelectorAll('yt-lockup-view-model').length,
      videoRenderer: document.querySelectorAll('ytd-video-renderer').length,
      watchLinks: document.querySelectorAll('a[href*="/watch?v="]').length,
    };
  }

  async function buildCuratedFeed(token = ++feedToken, tries = 0) {
    if (token !== feedToken) return;                  // a newer navigation superseded us
    if (!(isHomePage() && active() && resolveFlags().hideHome)) { removeCuratedFeed(); return; }

    // Force the (otherwise display:none) feed to render off-screen so it has tiles to scrape.
    document.documentElement.classList.add('balance-scanning');

    const cards = scrapeFeedCards();
    // Wait for the feed to stream in (want a healthy batch), but don't wait forever —
    // proceed with whatever we have once the retries are spent.
    if (cards.length < 6 && tries < 12) {
      setTimeout(() => buildCuratedFeed(token, tries + 1), 500);
      return;
    }

    document.documentElement.classList.remove('balance-scanning');
    if (!cards.length) { console.warn('[balance] feed: nothing scraped', feedDiag()); return; }

    const primary = document.querySelector('ytd-browse[page-subtype="home"] #primary')
                 || document.querySelector('ytd-browse[page-subtype="home"]');
    if (!primary) return;

    feedCards = cards;
    if (!lastState) await refreshState();
    if (token !== feedToken) return;
    ensureFeedHost(primary);
    document.documentElement.classList.add('balance-curated');
    await regroupAndRender();
  }

  // (Re)classify the scraped cards and split them into lanes, then paint. Called on first
  // build and again after a retag — since channel rules are read fresh, retagging one
  // card's channel re-sorts every card from that channel.
  async function regroupAndRender() {
    if (!feedCards) return;
    const res = await send({ type: 'classifyMany', metas: feedCards });
    const lane = {};
    (res?.results || []).forEach((r) => { lane[r.videoId] = r.lane; });
    curated = { enrich: [], recharge: [], drift: [] };
    for (const v of feedCards) {
      if (lane[v.videoId] === 'enrich') curated.enrich.push(v);
      else if (lane[v.videoId] === 'recharge') curated.recharge.push(v);
      else curated.drift.push(v);              // drift (and anything else) — captured for review
    }
    console.log(`[balance] feed: ${curated.enrich.length} enrich + ${curated.recharge.length} recharge + ${curated.drift.length} drift of ${feedCards.length}`);
    renderCuratedFeed();
  }

  // A lane was chosen from a card's dot — store it at the channel level (so the whole
  // channel re-sorts), cache the video too, then re-group the feed in place.
  async function onDotPick(videoId, channelKey, channelName, lane) {
    await send({ type: 'reclassify', payload: {
      videoId, channelKey: channelKey || null, channelName: channelName || '', lane,
    }});
    await regroupAndRender();
  }

  function onFeedClick(e) {
    const btn = e.target.closest('button[data-lane]');
    if (btn) {                                 // a lane button on a card dot or a drift row
      const host = e.target.closest('[data-vid]');
      e.preventDefault(); e.stopPropagation();
      if (host) onDotPick(host.dataset.vid, host.dataset.ck, host.dataset.cn, btn.dataset.lane);
      return;
    }
    if (e.target.closest('summary')) { driftOpen = !driftOpen; return; } // keep state across re-renders
    if (e.target.closest('.dot')) { e.preventDefault(); e.stopPropagation(); } // dot click ≠ navigate
  }

  function ensureFeedHost(primary) {
    if (feedHost && feedHost.isConnected) return;
    if (feedHost) feedHost.remove();
    feedHost = document.createElement('div');
    feedHost.id = 'balance-feed';
    feedHost.style.display = 'block';
    const sh = feedHost.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>${FEED_CSS}</style><div class="host-content"></div>`;
    sh.querySelector('.host-content').addEventListener('click', onFeedClick);
    primary.insertBefore(feedHost, primary.firstChild);
  }

  function removeCuratedFeed() {
    document.documentElement.classList.remove('balance-curated', 'balance-scanning');
    if (feedHost) { feedHost.remove(); feedHost = null; }
    curated = null;
    feedCards = null;
    driftOpen = false;
  }

  function renderCuratedFeed() {
    if (!feedHost || !curated) return;
    const slot = feedHost.shadowRoot.querySelector('.host-content');
    const enrich = curated.enrich, recharge = curated.recharge, drift = curated.drift || [];
    const remaining = lastState && lastState.remaining ? lastState.remaining.recharge : null;
    const showRecharge = recharge.length > 0 && (remaining == null || remaining > 0);

    const lanes3 = ['enrich', 'recharge', 'drift'];
    const card = (v, lane) => {
      const picks = lanes3.map((k) =>
        `<button data-lane="${k}" class="${k === lane ? 'cur' : ''}" title="${LANE_META[k].label}">${LANE_META[k].emoji}</button>`
      ).join('');
      return `
      <a class="card" href="/watch?v=${v.videoId}">
        <div class="thumb"><img loading="lazy" src="https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg" alt=""></div>
        <span class="dot" style="background:${LANE_META[lane].color}" title="Change lane"
              data-vid="${esc(v.videoId)}" data-ck="${esc(v.channelKey || '')}" data-cn="${esc(v.channelName || '')}">
          <span class="picker">${picks}</span></span>
        <div class="t">${esc(v.title)}</div>
        <div class="c">${esc(v.channelName)}</div>
      </a>`;
    };
    const section = (h2, sub, items, lane) => `
      <div class="section"><div class="shead"><h2>${h2}</h2><span class="sub">${sub}</span></div>
        <div class="grid">${items.map((v) => card(v, lane)).join('')}</div></div>`;

    let html = '<div class="wrap">';
    if (enrich.length) html += section('✨ Get inspired', `${enrich.length} enriching pick${enrich.length > 1 ? 's' : ''} from your feed`, enrich, 'enrich');
    if (showRecharge) {
      const sub = remaining != null ? `${dur(remaining)} of today's budget left` : 'within today’s budget';
      html += section('🟡 Recharge', sub, recharge, 'recharge');
    }
    if (drift.length) {
      const row = (v) => `
        <div class="drow" data-vid="${esc(v.videoId)}" data-ck="${esc(v.channelKey || '')}" data-cn="${esc(v.channelName || '')}">
          <span class="dtitle" title="${esc(v.title)}">${esc(v.title)}${v.channelName ? ` <span class="dmeta">· ${esc(v.channelName)}</span>` : ''}</span>
          <span class="dpick">
            <button data-lane="enrich" title="Move to Enrich">🟢</button>
            <button data-lane="recharge" title="Move to Recharge">🟡</button>
          </span>
        </div>`;
      html += `<details class="drift"${driftOpen ? ' open' : ''}>
        <summary><span class="chev">▸</span> 🔴 Drift · ${drift.length} hidden — review &amp; reclassify</summary>
        <div class="dlist">${drift.map(row).join('')}</div>
      </details>`;
    }
    html += (!enrich.length && !showRecharge && !drift.length)
      ? '<div class="resting">The feed is resting. Search, or open a subscription.</div>'
      : '<div class="resting">The feed is resting — these are hand-picked.<br>Search, or open a subscription for more.</div>';
    slot.innerHTML = html + '</div>';
  }

  // ====================== accounting tick ======================
  setInterval(tick, TICK_MS);
  async function tick() {
    if (!config || !current || !isWatchPage()) return;
    if (!active()) { renderHud(); return; }

    const v = document.querySelector('video');
    if (!v) return;
    const visible = document.visibilityState === 'visible' && !document.hidden;
    const now = Date.now();
    const ct = v.currentTime;

    // Count real (wall-clock) seconds spent actively watching, which naturally captures
    // playback speed — 2× for 10 real minutes costs 10 minutes of budget, same as 1×.
    // Gate on the video actually progressing (ct advanced) so buffering, seeks, and
    // background/hidden tabs don't inflate the count.
    let delta = 0;
    if (!v.paused && !v.ended && visible && ct > lastCurrentTime) {
      delta = (now - lastTickWall) / 1000;
      if (!(delta > 0 && delta <= TICK_MS / 1000 + 2)) delta = 0; // drop throttled/hidden gaps
    }
    lastCurrentTime = ct;
    lastTickWall = now;
    if (delta <= 0) { renderHud(); return; }

    const lane = override ? override.countLane : current.lane;
    const burn = override ? override.burn : 1;
    const st = await send({ type: 'tick', payload: {
      videoId: current.videoId, lane, seconds: delta, burnMultiplier: burn,
    }});
    if (st && !st.error) {
      lastState = st;
      renderHud(st);
      maybeFullscreenAlert(st);
      const rem = st.remaining ? st.remaining[current.lane] : undefined;
      if (current.lane !== 'enrich' && !override && !overBudgetHandled && rem != null && rem <= 0) {
        showOverBudgetInterstitial(st, current.lane);
      }
    }
  }

  function pauseVideo() { const v = document.querySelector('video'); if (v && !v.paused) v.pause(); }
  function resumeVideo() { const v = document.querySelector('video'); if (v && v.paused) v.play().catch(() => {}); }

  // ====================== UI (Shadow DOM) ======================
  // Two hosts: a full-screen overlay host (scrim + end card, fixed) and a compact host
  // injected into YouTube's top header bar (the per-lane stats, replacing the old box).
  let shadow = null, scrimEl = null, cardEl = null, endEl = null;
  let headerHost = null, headerSlot = null, headerRetry = false;
  let tagHost = null, tagSlot = null;

  function ensureUi() {
    if (shadow) return;
    const host = document.createElement('div');
    host.id = 'balance-root';
    host.style.cssText = 'all:initial; position:fixed; inset:0 auto auto 0; z-index:2147483646; pointer-events:none;';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${UI_CSS}</style>
      <div class="scrim" id="scrim" hidden><div class="card" id="card"></div></div>
      <div class="endwrap" id="end" hidden>
        <div class="endcard">
          <div class="endtitle">⚖ Session paused</div>
          <p>The video will still be there later. It's rarely worth it.</p>
          <button class="ghost" id="end-back">I changed my mind</button>
        </div>
      </div>`;
    scrimEl = shadow.getElementById('scrim');
    cardEl = shadow.getElementById('card');
    endEl = shadow.getElementById('end');
    shadow.getElementById('end-back').onclick = () => { hideEndOverlay(); resumeVideo(); };
  }

  // Insert (or re-insert) our stats host into the masthead's right-hand button cluster.
  function ensureHeaderUi() {
    if (headerHost && headerHost.isConnected) return true;
    headerHost = null;
    const end = document.querySelector('ytd-masthead #end, #masthead #end, ytd-masthead #buttons');
    if (!end) return false;
    headerHost = document.createElement('div');
    headerHost.id = 'balance-headbar';
    headerHost.style.cssText = 'display:flex; align-items:center; margin-right:8px;';
    const sh = headerHost.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>${HEAD_CSS}</style><div class="bar" id="bar"></div>`;
    headerSlot = sh.getElementById('bar');
    end.insertBefore(headerHost, end.firstChild);
    return true;
  }

  // Compact per-lane stats, rendered into the top header bar (hidden in fullscreen — the
  // 15-min nudges cover that case). Watched time for each lane; the active lane also shows
  // its remaining cap.
  function renderHud(st) {
    if (!ensureHeaderUi()) {                    // masthead not ready yet — retry once
      if (!headerRetry) { headerRetry = true; setTimeout(() => { headerRetry = false; renderHud(); }, 600); }
      return;
    }
    st = st || lastState;
    if (!config) { headerSlot.innerHTML = ''; return; }

    const status = !config.enabled ? 'off' : (config.pausedUntil > Date.now() ? 'paused' : '');
    const byLane = (st && st.byLane) || {};
    const remaining = (st && st.remaining) || {};
    const activeLane = (current && active()) ? current.lane : null;

    const items = ['enrich', 'recharge', 'drift'].map((k) => {
      const m = LANE_META[k];
      let cls = 'b-item lane-' + k + (k === activeLane ? ' active' : '');
      let extra = '';
      const r = remaining[k];                    // defined only for capped lanes
      if (r != null) {
        cls += r < 0 ? ' over' : (r < 300 ? ' warn' : '');
        if (k === activeLane) extra = `<span class="r">${r >= 0 ? clock(r) + ' left' : 'over ' + clock(-r)}</span>`;
      }
      return `<span class="${cls}" title="${m.label}">${m.emoji}<span class="t">${clock(byLane[k] || 0)}</span>${extra}</span>`;
    }).join('');

    const tag = status ? `<span class="b-tag">${status}</span>` : '';
    headerSlot.className = 'bar' + (status ? ' dim' : '');
    headerSlot.innerHTML = `<span class="b-logo">⚖</span>${items}${tag}`;
  }

  // ====================== fullscreen 15-min nudges ======================
  const isFullscreen = () => !!document.fullscreenElement;

  // Called each metering tick: when total watch time crosses a 15-min boundary while in
  // fullscreen (where the header bar is hidden), pop a transient nudge over the video.
  function maybeFullscreenAlert(st) {
    const total = Object.values(st.byLane || {}).reduce((a, b) => a + (b || 0), 0);
    const boundary = Math.floor(total / (ALERT_EVERY_MIN * 60));
    if (lastAlertBoundary < 0 || boundary < lastAlertBoundary) { lastAlertBoundary = boundary; return; }
    if (boundary > lastAlertBoundary) {
      lastAlertBoundary = boundary;                // consume the boundary even if not fullscreen
      if (isFullscreen()) showWatchAlert(boundary * ALERT_EVERY_MIN);
    }
  }

  let alertHost = null, alertTimer = 0;
  function showWatchAlert(totalMin) {
    removeWatchAlert();
    const mount = document.fullscreenElement || document.body;  // must live inside the FS element
    alertHost = document.createElement('div');
    alertHost.id = 'balance-alert';
    const sh = alertHost.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>${ALERT_CSS}</style>
      <div class="toast"><span class="i">⚖</span><span><b>${totalMin} min</b> of YouTube today — still intentional?</span></div>`;
    mount.appendChild(alertHost);
    sh.querySelector('.toast').addEventListener('click', removeWatchAlert);
    requestAnimationFrame(() => alertHost && alertHost.shadowRoot.querySelector('.toast').classList.add('show'));
    alertTimer = setTimeout(removeWatchAlert, 6000);
  }
  function removeWatchAlert() {
    clearTimeout(alertTimer);
    if (alertHost) { alertHost.remove(); alertHost = null; }
  }

  // ====================== watch-page lane tagger ======================
  // A small lane picker injected just under the video title, so a video (and its channel)
  // can be reclassified without opening the popup.
  function ensureWatchTagger() {
    if (tagHost && tagHost.isConnected) return true;
    tagHost = null;
    const h1 = document.querySelector('ytd-watch-metadata #title h1, ytd-watch-metadata h1, h1.ytd-watch-metadata');
    const container = h1 && (h1.closest('#title') || h1.parentElement);
    if (!container) return false;
    tagHost = document.createElement('div');
    tagHost.id = 'balance-tagger';
    tagHost.style.cssText = 'display:block; margin:8px 0 2px;';
    const sh = tagHost.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>${TAG_CSS}</style><div class="tagger" id="t"></div>`;
    tagSlot = sh.getElementById('t');
    tagSlot.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-lane]');
      if (b) doReclassify(b.dataset.lane);
    });
    container.appendChild(tagHost);
    return true;
  }

  function renderWatchTagger() {
    if (!isWatchPage() || !current) { removeWatchTagger(); return; }
    if (!ensureWatchTagger()) return;                 // title not in the DOM yet — retry loop covers it
    const lane = current.lane;
    tagSlot.innerHTML = `<span class="lbl">⚖ Lane</span>` + ['enrich', 'recharge', 'drift'].map((k) => {
      const m = LANE_META[k];
      return `<button data-lane="${k}" class="${k === lane ? 'cur lane-' + k : ''}">${m.emoji} ${m.label}</button>`;
    }).join('');
  }

  function removeWatchTagger() { if (tagHost) { tagHost.remove(); tagHost = null; } }

  function showScrim(html) {
    ensureUi();
    cardEl.innerHTML = html;
    scrimEl.hidden = false;
    pauseVideo();
  }
  function hideInterstitial() { if (scrimEl) scrimEl.hidden = true; }
  function showEndOverlay() { ensureUi(); endEl.hidden = false; pauseVideo(); }
  function hideEndOverlay() { if (endEl) endEl.hidden = true; }

  function showDriftInterstitial() {
    send({ type: 'driftEvent' });
    const m = current.meta || {};
    const reason = current.classification?.source || 'looks like a rabbit hole';
    showScrim(`
      <div class="kicker">⚖ Quick gut-check</div>
      <div class="lead">This looks like a <b style="color:#e5534b">🔴 rabbit-hole</b> video.</div>
      <div class="quote"><div class="qtitle">${esc(m.title || 'this video')}</div>
        <div class="qmeta">${esc(m.channelName || '')} · ${esc(reason)}</div></div>
      <p class="ask">Did you actually come here for this?</p>
      <div class="btns">
        <button class="primary" id="b-better">Find something better ▸</button>
        <button class="ghost" id="b-done">I'm done for now</button>
        <button class="danger" id="b-anyway">Watch anyway · 2× budget</button>
      </div>
      <div class="retag">Wrong call? This is actually
        <button data-lane="enrich" class="tag">🟢 Enrich</button>
        <button data-lane="recharge" class="tag">🟡 Recharge</button>
      </div>`);
    cardEl.querySelector('#b-better').onclick = () => { location.href = '/'; };
    cardEl.querySelector('#b-done').onclick = () => { hideInterstitial(); showEndOverlay(); };
    cardEl.querySelector('#b-anyway').onclick = () => {
      override = { videoId: current.videoId, countLane: 'recharge', burn: 2 };
      lastCurrentTime = document.querySelector('video')?.currentTime || 0;
      hideInterstitial(); resumeVideo();
    };
    cardEl.querySelectorAll('.tag').forEach((b) => { b.onclick = () => doReclassify(b.dataset.lane, { resume: true }); });
  }

  function showOverBudgetInterstitial(st, lane) {
    const m = LANE_META[lane] || LANE_META.recharge;
    showScrim(`
      <div class="kicker">⚖ ${m.label} budget is spent</div>
      <div class="lead">You've used today's ${m.emoji} ${m.label} time.</div>
      <p class="ask">You chose this one — no judgment. How to proceed?</p>
      <div class="btns">
        <button class="ghost" id="b-pass">Take a 10-min pass</button>
        <button class="ghost" id="b-stop">Stop here — good call</button>
        <button class="danger" id="b-anyway">Watch anyway · 2× burn</button>
      </div>`);
    const resumeFresh = () => { lastCurrentTime = document.querySelector('video')?.currentTime || 0; };
    cardEl.querySelector('#b-pass').onclick = async () => {
      lastState = await send({ type: 'takePass', payload: { lane, seconds: 600 } });
      overBudgetHandled = true; resumeFresh(); hideInterstitial(); resumeVideo(); renderHud(lastState);
    };
    cardEl.querySelector('#b-stop').onclick = () => { hideInterstitial(); showEndOverlay(); };
    cardEl.querySelector('#b-anyway').onclick = () => {
      override = { videoId: current.videoId, countLane: lane, burn: 2 };
      overBudgetHandled = true; resumeFresh(); hideInterstitial(); resumeVideo();
    };
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ====================== popup messaging ======================
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === 'getNowPlaying') {
      sendResponse(current ? {
        videoId: current.videoId, meta: current.meta, lane: current.lane,
        classification: current.classification,
      } : null);
      return;
    }
    if (msg.type === 'reclassifyCurrent') { doReclassify(msg.lane).then(() => sendResponse({ ok: true })); return true; }
    if (msg.type === 'endSession') { hideInterstitial(); showEndOverlay(); sendResponse({ ok: true }); return; }
    if (msg.type === 'refresh') { applySurgery(); if (current) classifyCurrent(current.meta); sendResponse({ ok: true }); return; }
  });

  // ====================== boot ======================
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.config) {
      config = changes.config.newValue;
      applySurgery();
      if (current) classifyCurrent(current.meta);
      if (isHomePage()) buildCuratedFeed();            // profile/enabled may have changed
    }
    // Ledger changes (this tab's ticks, another tab's watching, or daily rollover)
    // carry fresh per-lane totals — re-render the panel from them.
    if (changes.ledger) {
      lastState = { ...(lastState || {}), ...stateFromLedger(changes.ledger.newValue) };
      renderCuratedFeed();                             // recharge section is budget-gated
    }
    renderHud();
  });

  // Derive the panel's numbers straight from a ledger value (avoids a round-trip to the SW).
  function stateFromLedger(ledger) {
    const t = (ledger && ledger.today) || {};
    const byLane = t.byLane || {};
    const remaining = {};
    for (const lane of ['enrich', 'recharge', 'drift']) {
      const cap = (config?.budgets?.[lane]?.dailyMinutes || 0) * 60;
      if (cap > 0) remaining[lane] = cap + ((t.bonusSec?.[lane]) || 0) - (byLane[lane] || 0);
    }
    return { byLane, remaining };
  }

  ['yt-navigate-finish', 'yt-page-data-updated'].forEach((ev) => {
    window.addEventListener(ev, onNavigate, true);
    document.addEventListener(ev, onNavigate, true);
  });
  window.addEventListener('popstate', onNavigate);
  let lastHref = location.href;
  setInterval(() => { if (location.href !== lastHref) { lastHref = location.href; onNavigate(); } }, 1000);

  async function boot() {
    const { config: c } = await chrome.storage.local.get('config');
    config = c || { enabled: true, pausedUntil: 0, surgery: 'balanced',
      budgets: { enrich: { dailyMinutes: 0 }, recharge: { dailyMinutes: 30 }, drift: { dailyMinutes: 15 } } };
    applySurgery();
    onNavigate();
  }
  boot();

  // ====================== styles ======================
  const UI_CSS = `
    :host { all: initial; }
    .scrim, .endwrap { font-family: Roboto, "Segoe UI", system-ui, sans-serif; }
    .scrim, .endwrap {
      position: fixed; inset: 0; pointer-events: auto;
      align-items: center; justify-content: center;
    }
    /* Only flex when shown; otherwise let the UA [hidden] rule apply display:none.
       (An author 'display:flex' would override [hidden], leaving the overlay stuck.) */
    .scrim:not([hidden]), .endwrap:not([hidden]) { display: flex; }
    .scrim { background: rgba(8,10,15,.78); backdrop-filter: blur(3px); }
    .endwrap { background: #0a0c10; }
    .card, .endcard {
      width: min(560px, 92vw); background: #11141c; color: #e6edf3;
      border: 1px solid #2b3140; border-radius: 16px; padding: 26px 28px;
      box-shadow: 0 20px 60px rgba(0,0,0,.6);
    }
    .kicker { font-size: 13px; letter-spacing: .04em; text-transform: uppercase; color: #8b949e; margin-bottom: 10px; }
    .lead { font-size: 19px; font-weight: 700; margin-bottom: 6px; }
    .ask { color: #b9c2cf; margin: 10px 0 16px; }
    .quote { background: #0c0f16; border: 1px solid #2b3140; border-radius: 10px; padding: 12px 14px; margin: 8px 0 4px; }
    .qtitle { font-weight: 600; }
    .qmeta { color: #8b949e; font-size: 12px; margin-top: 4px; }
    .btns { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    button { font: inherit; font-weight: 600; border-radius: 9px; padding: 11px 14px; cursor: pointer; border: 1px solid transparent; text-align: center; }
    .primary { background: #3fb950; color: #06210d; }
    .ghost { background: transparent; color: #e6edf3; border-color: #2b3140; }
    .danger { background: transparent; color: #e5534b; border-color: #5a2a28; }
    .primary:hover { filter: brightness(1.08); }
    .ghost:hover { background: #1a1f2b; }
    .danger:hover { background: #2a1413; }
    .retag { margin-top: 16px; color: #8b949e; font-size: 13px; }
    .tag { display: inline-block; background: #1a1f2b; color: #e6edf3; border: 1px solid #2b3140; padding: 5px 9px; border-radius: 7px; margin-left: 6px; }
    .tag:hover { background: #222838; }
    .endtitle { font-size: 22px; font-weight: 800; margin-bottom: 8px; }
    .endcard p { color: #b9c2cf; margin: 0 0 18px; }
    .endcard { text-align: center; }
  `;

  // Inline (light-DOM-adjacent) shadow host for the curated home feed.
  const FEED_CSS = `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; }
    .wrap { font-family: Roboto, "Segoe UI", system-ui, sans-serif; color: #e6edf3; padding: 56px 0 48px; }
    .section { margin: 0 0 36px; }
    .shead { display: flex; align-items: baseline; gap: 10px; margin: 0 0 16px; flex-wrap: wrap; }
    .shead h2 { margin: 0; font-size: 20px; font-weight: 700; color: #f0f6fc; letter-spacing: -.01em; }
    .shead .sub { font-size: 13px; color: #8b949e; }
    .grid { display: flex; gap: 14px; overflow-x: auto; overflow-y: hidden;
            scroll-snap-type: x proximity; padding-bottom: 10px; scrollbar-width: thin;
            scrollbar-color: #2b3140 transparent; overscroll-behavior-x: contain; }
    .grid::-webkit-scrollbar { height: 8px; }
    .grid::-webkit-scrollbar-thumb { background: #2b3140; border-radius: 4px; }
    .grid::-webkit-scrollbar-thumb:hover { background: #3a4252; }
    .card { flex: 0 0 230px; width: 230px; scroll-snap-align: start;
            display: block; position: relative; text-decoration: none; color: inherit; }
    .card:hover { z-index: 5; }
    .thumb { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 12px;
             overflow: hidden; background: #1a1f2b; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .dot { position: absolute; top: 8px; left: 8px; width: 14px; height: 14px; border-radius: 50%;
           box-shadow: 0 0 0 2px rgba(0,0,0,.5); cursor: pointer; z-index: 4; }
    .dot:hover { box-shadow: 0 0 0 2px rgba(0,0,0,.5), 0 0 0 4px rgba(255,255,255,.28); }
    .picker { position: absolute; top: -5px; left: -5px; display: none; align-items: center; gap: 2px;
              padding: 4px; background: #11141c; border: 1px solid #2b3140; border-radius: 999px;
              box-shadow: 0 10px 28px rgba(0,0,0,.6); }
    .dot:hover .picker, .picker:hover { display: flex; }
    .picker button { width: 27px; height: 27px; padding: 0; border: none; border-radius: 50%;
                     background: transparent; font-size: 15px; line-height: 1; cursor: pointer; }
    .picker button:hover { background: #1f2633; }
    .picker button.cur { background: #263041; box-shadow: inset 0 0 0 1.5px #58708f; }
    .card .t { margin: 9px 2px 2px; font-size: 14px; font-weight: 600; line-height: 1.3;
               display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .card .c { margin: 0 2px; font-size: 12.5px; color: #8b949e; }
    .card:hover .t { color: #fff; }
    .card:hover .thumb { outline: 2px solid #2b3140; }
    .resting { text-align: center; color: #8b949e; font-size: 15px; line-height: 1.6;
               margin: 4vh auto 0; max-width: 520px; }

    .drift { margin: 4px 0 30px; border-top: 1px solid #1e2430; padding-top: 14px; }
    .drift > summary { cursor: pointer; list-style: none; user-select: none;
                       display: flex; align-items: center; gap: 8px;
                       color: #8b949e; font-size: 14px; font-weight: 600; padding: 4px 0; }
    .drift > summary::-webkit-details-marker { display: none; }
    .drift > summary:hover { color: #c9d1d9; }
    .chev { display: inline-block; transition: transform .15s ease; font-size: 11px; }
    .drift[open] .chev { transform: rotate(90deg); }
    .dlist { margin-top: 10px; display: flex; flex-direction: column; gap: 1px; max-width: 880px; }
    .drow { display: flex; align-items: center; justify-content: space-between; gap: 14px;
            padding: 7px 10px; border-radius: 8px; }
    .drow:hover { background: #11141c; }
    .dtitle { font-size: 13px; color: #c9d1d9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dmeta { color: #8b949e; font-size: 11px; }
    .dpick { display: flex; gap: 4px; flex-shrink: 0; }
    .dpick button { width: 28px; height: 26px; padding: 0; border: 1px solid #2b3140; border-radius: 7px;
                    background: #161b24; font-size: 14px; line-height: 1; cursor: pointer; }
    .dpick button:hover { background: #1f2633; border-color: #3a4252; }
  `;

  // Compact stats bar that lives inside YouTube's masthead.
  const HEAD_CSS = `
    :host { all: initial; }
    .bar { display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 12px;
           border-radius: 16px; background: rgba(255,255,255,.08);
           font-family: Roboto, "Segoe UI", system-ui, sans-serif; font-size: 12px; color: #f1f1f1;
           white-space: nowrap; user-select: none; }
    .bar.dim { opacity: .55; }
    .b-logo { font-size: 13px; opacity: .85; }
    .b-item { display: inline-flex; align-items: center; gap: 4px; }
    .b-item .t { font-weight: 700; font-variant-numeric: tabular-nums; }
    .b-item .r { color: #aaa; font-size: 11px; margin-left: 2px; }
    .b-item.active .t { color: #fff; }
    .b-item.warn .r { color: #f1c40f; }
    .b-item.over .t, .b-item.over .r { color: #ff6b6b; }
    .b-tag { text-transform: uppercase; font-size: 10px; font-weight: 700; color: #aaa;
             border: 1px solid currentColor; border-radius: 6px; padding: 1px 5px; }
  `;

  // Transient fullscreen nudge, mounted inside the fullscreen element so it paints over video.
  const ALERT_CSS = `
    :host { all: initial; }
    .toast { position: fixed; top: 28px; left: 50%; transform: translate(-50%, -16px);
             display: flex; align-items: center; gap: 10px; max-width: 90vw;
             background: rgba(17,20,28,.94); color: #f1f1f1; border: 1px solid #2b3140;
             padding: 12px 18px; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.6);
             font-family: Roboto, "Segoe UI", system-ui, sans-serif; font-size: 15px;
             z-index: 2147483647; opacity: 0; transition: opacity .25s ease, transform .25s ease;
             cursor: pointer; pointer-events: auto; }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
    .toast .i { font-size: 18px; }
    .toast b { font-weight: 800; }
  `;

  // Lane picker under the video title. Uses YouTube's theme variables so it reads on
  // both light and dark themes.
  const TAG_CSS = `
    :host { all: initial; }
    .tagger { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;
              font-family: Roboto, "Segoe UI", system-ui, sans-serif; }
    .lbl { font-size: 12px; font-weight: 600; opacity: .6;
           color: var(--yt-spec-text-primary, #f1f1f1); margin-right: 2px; }
    button { font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
             display: inline-flex; align-items: center; gap: 4px; padding: 5px 11px;
             border-radius: 16px; border: 1px solid var(--yt-spec-10-percent-layer, #ffffff22);
             background: transparent; color: var(--yt-spec-text-primary, #f1f1f1); }
    button:hover { background: var(--yt-spec-badge-chip-background, #ffffff14); }
    button.cur.lane-enrich { background: #3fb95022; border-color: #3fb950; color: #3fb950; }
    button.cur.lane-recharge { background: #d2a00022; border-color: #d2a000; color: #d2a000; }
    button.cur.lane-drift { background: #e5534b22; border-color: #e5534b; color: #e5534b; }
  `;
})();
