// src/shared/constants.js — shared data + tiny helpers (SW, popup, options).
// NOTE: content.js can't import (it's a classic content script), so it inlines the few
// constants it needs. Keep LANE_META / SURGERY_PROFILES in sync there if you change them.

import { DEFAULT_KEYWORD_RULES } from './keywords.js';

export const SCHEMA_VERSION = 1;

export const LANES = ['enrich', 'recharge', 'drift', 'unset'];

export const LANE_META = {
  enrich:   { emoji: '🟢', label: 'Enrich',   color: '#3fb950' },
  recharge: { emoji: '🟡', label: 'Recharge', color: '#d2a000' },
  drift:    { emoji: '🔴', label: 'Drift',    color: '#e5534b' },
  unset:    { emoji: '⚪', label: 'Unsorted', color: '#8b949e' },
};

// Surgery profiles → which recommendation surfaces to neutralize.
export const SURGERY_PROFILES = {
  gentle:   { dimHome: true,  dimSidebar: true },
  balanced: { hideHome: true, hideSidebar: true, autoplayOff: true },
  strict:   { hideHome: true, hideSidebar: true, autoplayOff: true,
              hideShorts: true, hideEndscreen: true, hideComments: true },
};

export function surgeryFlags(surgery) {
  if (surgery && typeof surgery === 'object') return surgery;
  return SURGERY_PROFILES[surgery] || SURGERY_PROFILES.balanced;
}

export const DEFAULT_CONFIG = {
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  pausedUntil: 0,                         // ms timestamp; > now ⇒ Balance paused
  lanes: {
    shortsAsDrift: true,                  // locked decision: Shorts are Drift
    defaultLaneForUnknown: 'recharge',    // benefit of the doubt, but budgeted
  },
  budgets: {                              // fixed daily caps per lane, in minutes (0 = unlimited)
    enrich:   { dailyMinutes: 0 },
    recharge: { dailyMinutes: 30 },
    drift:    { dailyMinutes: 15 },
  },
  rules: {
    channelLanes: {},                     // channelKey -> lane
    keywordRules: DEFAULT_KEYWORD_RULES,
  },
  surgery: 'balanced',
  driftThresholds: { coolDownAt: 4, hardStopAt: 6 },  // reserved for Phase 2
};

// 4am rollover so late-night watching counts to the previous day.
export function todayKey(now = Date.now()) {
  const d = new Date(now - 4 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Recursive merge used to backfill new default fields onto a stored config.
export function deepMerge(base, over) {
  if (Array.isArray(over)) return over.slice();
  if (over && typeof over === 'object') {
    const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
    for (const k of Object.keys(over)) out[k] = deepMerge(out[k], over[k]);
    return out;
  }
  return over === undefined ? base : over;
}

export function secondsToClock(s) {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function minutesLabel(s) {
  const m = s / 60;
  return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}m`;
}
