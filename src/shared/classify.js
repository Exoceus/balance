// src/shared/classify.js — the classification orchestrator (Phase 1: no AI).
// Pure functions, no chrome APIs, so they're trivially unit-testable.
// Pipeline: shorts → channel list → video cache → channel cache → keywords → default.

export function channelKeyOf(meta) {
  if (!meta) return null;
  if (meta.channelId) return meta.channelId;
  if (meta.channelHandle) return 'h:' + String(meta.channelHandle).toLowerCase();
  if (meta.channelName) return 'n:' + String(meta.channelName).toLowerCase();
  return null;
}

function keywordClassify(meta, config) {
  const text = `${meta.title || ''} ${meta.description || ''}`.toLowerCase();
  if (!text.trim()) return null;

  const scores = {};
  for (const rule of config.rules.keywordRules || []) {
    let re;
    try { re = new RegExp(rule.pattern, 'i' + (rule.flags || '')); } catch { continue; }
    if (re.test(text)) scores[rule.lane] = (scores[rule.lane] || 0) + (rule.weight || 1);
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;

  const [lane, top] = ranked[0];
  const runnerUp = ranked[1]?.[1] || 0;
  // Win only if there's a signal AND it's clearly ahead of the next lane.
  // (Ties fall through to default — e.g. "fails compilation highlights" lets the
  // weight-2 drift rule outrank the weight-1 recharge rule and win as drift.)
  if (top >= 1 && top - runnerUp >= 1) {
    return { lane, confidence: Math.min(1, top / 4), source: 'keyword' };
  }
  return null;
}

export function classifyVideo(meta, config, cache) {
  const ck = channelKeyOf(meta);

  // 0 — Shorts are Drift (locked decision).
  if (meta.isShort && config.lanes.shortsAsDrift) {
    return { lane: 'drift', confidence: 1, source: 'shorts', channelKey: ck };
  }
  // 1 — Explicit channel list (strongest signal).
  if (ck && config.rules.channelLanes[ck]) {
    return { lane: config.rules.channelLanes[ck], confidence: 1, source: 'channel-list', channelKey: ck };
  }
  // 2 — Per-video cache.
  if (meta.videoId && cache.byVideo?.[meta.videoId]) {
    const c = cache.byVideo[meta.videoId];
    return { lane: c.lane, confidence: c.confidence, source: c.source + ' (cache)', channelKey: ck };
  }
  // 3 — Per-channel cache.
  if (ck && cache.byChannel?.[ck]) {
    const c = cache.byChannel[ck];
    return { lane: c.lane, confidence: c.confidence, source: c.source + ' (chan)', channelKey: ck };
  }
  // 4 — Keyword rules.
  const kw = keywordClassify(meta, config);
  if (kw) return { ...kw, channelKey: ck };

  // 5 — Default for genuine unknowns (Phase 4 swaps in Claude Haiku here).
  return { lane: config.lanes.defaultLaneForUnknown || 'recharge', confidence: 0.2, source: 'default', channelKey: ck };
}
