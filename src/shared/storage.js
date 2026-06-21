// src/shared/storage.js — typed-ish storage gateway with daily rollover + migrations.
// Keys in chrome.storage.local: config, ledger, cache.
// (Sync is desktop-only single-machine for now; everything lives in local.)

import { DEFAULT_CONFIG, SCHEMA_VERSION, todayKey, deepMerge } from './constants.js';

const area = chrome.storage.local;

// ---- config ----------------------------------------------------------------

export async function getConfig() {
  const { config } = await area.get('config');
  // deepMerge backfills any fields added in newer versions onto the stored config.
  return deepMerge(structuredClone(DEFAULT_CONFIG), config || {});
}

export async function setConfig(config) {
  config.schemaVersion = SCHEMA_VERSION;
  await area.set({ config });
  return config;
}

export async function patchConfig(patch) {
  return setConfig(deepMerge(await getConfig(), patch));
}

// ---- ledger ----------------------------------------------------------------

function freshDay() {
  return {
    dateKey: todayKey(),
    byLane: { enrich: 0, recharge: 0, drift: 0, unset: 0 }, // seconds watched
    bonusSec: { recharge: 0, drift: 0 },                    // temporary extensions from "take a pass"
    driftEvents: 0,                                         // rabbit-holes caught
    videos: {},                                            // videoId -> { sec, lane, title, channel, last }
  };
}

// Archived days only keep their top-N watched videos, so ~8 weeks of per-video
// detail stays small. Today is left intact (a single day is naturally bounded).
function pruneDayVideos(day, keep = 60) {
  const v = day.videos;
  if (!v) return day;
  const ids = Object.keys(v);
  if (ids.length > keep) {
    const top = ids.sort((a, b) => (v[b].sec || 0) - (v[a].sec || 0)).slice(0, keep);
    const out = {};
    for (const id of top) out[id] = v[id];
    day.videos = out;
  }
  return day;
}

export async function getLedger() {
  let { ledger } = await area.get('ledger');
  if (!ledger) ledger = { today: freshDay(), history: [] };

  if (ledger.today.dateKey !== todayKey()) {       // daily rollover
    ledger.history.unshift(pruneDayVideos(ledger.today));
    ledger.history = ledger.history.slice(0, 56);  // keep ~8 weeks
    ledger.today = freshDay();
    await area.set({ ledger });
  }
  return ledger;
}

export async function setLedger(ledger) {
  await area.set({ ledger });
  return ledger;
}

// ---- classification cache --------------------------------------------------

export async function getCache() {
  const { cache } = await area.get('cache');
  return cache || { byVideo: {}, byChannel: {} };
}

export async function setCache(cache) {
  await area.set({ cache });
  return cache;
}

// ---- first-run init --------------------------------------------------------

export async function ensureInitialized() {
  const stored = await area.get(['config', 'ledger', 'cache']);
  const patch = {};
  if (!stored.config) patch.config = structuredClone(DEFAULT_CONFIG);
  if (!stored.ledger) patch.ledger = { today: freshDay(), history: [] };
  if (!stored.cache) patch.cache = { byVideo: {}, byChannel: {} };
  if (Object.keys(patch).length) await area.set(patch);
}
