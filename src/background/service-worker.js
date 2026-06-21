// src/background/service-worker.js — the brain.
// Owns classification orchestration + the accounting engine. Stateless across suspends:
// every handler reads fresh from storage and writes back, so MV3 worker death is harmless.

import { getConfig, getLedger, setLedger, getCache, setCache, ensureInitialized } from '../shared/storage.js';
import { classifyVideo, channelKeyOf } from '../shared/classify.js';
import { surgeryFlags } from '../shared/constants.js';

chrome.runtime.onInstalled.addListener(async () => {
  await ensureInitialized();
  chrome.alarms.create('balance-rollover', { periodInMinutes: 30 });
});
chrome.runtime.onStartup.addListener(ensureInitialized);
// Touching the ledger triggers the daily rollover even if no tab is open.
chrome.alarms.onAlarm.addListener(() => { getLedger(); });

// Serialize all handling so concurrent messages from multiple tabs can't interleave a
// ledger read-modify-write and lose an update. Handlers are in-memory-fast, so a global
// queue is plenty; each op resolves before the next starts.
let opQueue = Promise.resolve();
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  opQueue = opQueue.then(
    () => handle(msg).then(sendResponse, (e) => sendResponse({ error: String(e?.message || e) }))
  );
  return true; // async response
});

async function handle(msg) {
  switch (msg.type) {
    case 'classify':     return classify(msg.meta);
    case 'classifyMany': return classifyMany(msg.metas);
    case 'tick':         return tick(msg.payload);
    case 'getState':     return getState();
    case 'reclassify':   return reclassify(msg.payload);
    case 'takePass':     return takePass(msg.payload);
    case 'driftEvent':   return bumpDrift();
    default:             return { error: 'unknown message ' + msg.type };
  }
}

// ---- classification --------------------------------------------------------

async function classify(meta) {
  const [config, cache] = await Promise.all([getConfig(), getCache()]);
  const res = classifyVideo(meta, config, cache);

  // Learn heuristic results into the cache so we don't recompute (and so the AI,
  // once added, runs rarely). Don't cache explicit lists/shorts — they're already fast.
  if (meta.videoId && (res.source === 'keyword' || res.source === 'default')) {
    cache.byVideo[meta.videoId] = entry(res);
    if (res.source === 'keyword') {
      const ck = channelKeyOf(meta);
      if (ck) cache.byChannel[ck] = entry(res);
    }
    await setCache(cache);
  }
  return res;
}

// Read-only bulk classify for the curated home feed. Doesn't touch the cache —
// it's a passive scan of recommendations, not a deliberate open.
async function classifyMany(metas) {
  const [config, cache] = await Promise.all([getConfig(), getCache()]);
  const results = (metas || []).map((meta) => {
    const r = classifyVideo(meta, config, cache);
    return { videoId: meta.videoId, lane: r.lane, source: r.source, confidence: r.confidence };
  });
  return { results };
}

const entry = (r) => ({ lane: r.lane, confidence: r.confidence, source: r.source, ts: Date.now() });

// ---- accounting ------------------------------------------------------------

async function tick(p) {
  const [config, ledger] = await Promise.all([getConfig(), getLedger()]);
  if (!config.enabled || config.pausedUntil > Date.now()) return state(config, ledger);

  const lane = p.lane in ledger.today.byLane ? p.lane : 'unset';
  const burn = p.burnMultiplier || 1;
  ledger.today.byLane[lane] += p.seconds * burn;

  await setLedger(ledger);
  return state(config, ledger);
}

const capSec = (config, lane) => (config.budgets?.[lane]?.dailyMinutes || 0) * 60; // 0 ⇒ unlimited

function state(config, ledger) {
  const t = ledger.today;
  const caps = { enrich: capSec(config, 'enrich'), recharge: capSec(config, 'recharge'), drift: capSec(config, 'drift') };
  const remaining = {};                                   // seconds left, only for capped lanes
  for (const lane of ['enrich', 'recharge', 'drift']) {
    if (caps[lane] > 0) remaining[lane] = caps[lane] + ((t.bonusSec?.[lane]) || 0) - (t.byLane[lane] || 0);
  }
  return {
    enabled: config.enabled,
    paused: config.pausedUntil > Date.now(),
    pausedUntil: config.pausedUntil,
    dateKey: t.dateKey,
    byLane: t.byLane,
    caps,
    remaining,
    driftEvents: t.driftEvents || 0,
  };
}

async function getState() {
  const [config, ledger] = await Promise.all([getConfig(), getLedger()]);
  return { ...state(config, ledger), config, surgery: surgeryFlags(config.surgery) };
}

// ---- learning + budget actions ---------------------------------------------

async function reclassify(p) {
  const [config, cache] = await Promise.all([getConfig(), getCache()]);
  const key = p.channelKey || (p.channelName ? 'n:' + p.channelName.toLowerCase() : null);
  if (key) {
    config.rules.channelLanes[key] = p.lane;                       // fixes the whole channel
    cache.byChannel[key] = { lane: p.lane, confidence: 1, source: 'user', ts: Date.now() };
  }
  if (p.videoId) cache.byVideo[p.videoId] = { lane: p.lane, confidence: 1, source: 'user', ts: Date.now() };
  await Promise.all([chrome.storage.local.set({ config }), setCache(cache)]);
  return { ok: true, lane: p.lane };
}

// A temporary extension of one lane's cap for the rest of today.
async function takePass({ lane, seconds }) {
  const [config, ledger] = await Promise.all([getConfig(), getLedger()]);
  ledger.today.bonusSec = ledger.today.bonusSec || {};
  const key = lane in ledger.today.bonusSec ? lane : 'recharge';
  ledger.today.bonusSec[key] = (ledger.today.bonusSec[key] || 0) + Math.max(0, seconds || 0);
  await setLedger(ledger);
  return state(config, ledger);
}

async function bumpDrift() {
  const ledger = await getLedger();
  ledger.today.driftEvents = (ledger.today.driftEvents || 0) + 1;
  await setLedger(ledger);
  return { ok: true };
}
