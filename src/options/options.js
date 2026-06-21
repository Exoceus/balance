// src/options/options.js — full config editor. Saves instantly via setConfig.
import { LANE_META } from '../shared/constants.js';
import { getConfig, setConfig } from '../shared/storage.js';
import { DEFAULT_KEYWORD_RULES } from '../shared/keywords.js';

const $ = (id) => document.getElementById(id);
let config = null;

async function load() {
  config = await getConfig();
  render();
}

function render() {
  // surgery
  const surg = typeof config.surgery === 'string' ? config.surgery : 'balanced';
  for (const r of document.querySelectorAll('input[name="surgery"]')) r.checked = r.value === surg;

  // daily caps (0 = unlimited)
  $('capEnrich').value = config.budgets.enrich?.dailyMinutes ?? 0;
  $('capRecharge').value = config.budgets.recharge?.dailyMinutes ?? 30;
  $('capDrift').value = config.budgets.drift?.dailyMinutes ?? 15;
  $('shortsAsDrift').checked = config.lanes.shortsAsDrift;
  $('defaultLane').value = config.lanes.defaultLaneForUnknown;

  renderChannels();
  renderRules();
}

function renderChannels() {
  const tbody = $('channelTable').querySelector('tbody');
  const entries = Object.entries(config.rules.channelLanes);
  tbody.innerHTML = entries.length
    ? entries.map(([key, lane]) => {
        const m = LANE_META[lane] || LANE_META.unset;
        const label = key.startsWith('n:') ? key.slice(2) : key.startsWith('h:') ? '@' + key.slice(2) : key;
        return `<tr><td>${escapeHtml(label)}</td>
          <td class="lane" style="color:${m.color}">${m.emoji} ${m.label}</td>
          <td style="text-align:right"><button class="x" data-key="${escapeHtml(key)}">remove</button></td></tr>`;
      }).join('')
    : `<tr><td class="muted" colspan="3">None yet — reclassify videos to build this up.</td></tr>`;
  tbody.querySelectorAll('.x').forEach((b) => {
    b.onclick = async () => { delete config.rules.channelLanes[b.dataset.key]; await save(); renderChannels(); };
  });
}

function renderRules() {
  const tbody = $('ruleTable').querySelector('tbody');
  tbody.innerHTML = config.rules.keywordRules.map((r, i) => {
    const m = LANE_META[r.lane] || LANE_META.unset;
    return `<tr>
      <td><code>${escapeHtml(r.pattern)}</code></td>
      <td class="lane" style="color:${m.color}">${m.emoji}</td>
      <td>×${r.weight || 1}</td>
      <td style="text-align:right"><button class="x" data-i="${i}">remove</button></td></tr>`;
  }).join('');
  tbody.querySelectorAll('.x').forEach((b) => {
    b.onclick = async () => { config.rules.keywordRules.splice(+b.dataset.i, 1); await save(); renderRules(); };
  });
}

async function save() { config = await setConfig(config); }

// ---- wiring ----
document.querySelectorAll('input[name="surgery"]').forEach((r) => {
  r.addEventListener('change', async () => { config.surgery = r.value; await save(); });
});
const bindNum = (id, apply) => $(id).addEventListener('change', async (e) => {
  apply(Math.max(0, Number(e.target.value) || 0)); await save();
});
const setCap = (lane, v) => { (config.budgets[lane] ||= {}).dailyMinutes = v; };
bindNum('capEnrich', (v) => setCap('enrich', v));
bindNum('capRecharge', (v) => setCap('recharge', v));
bindNum('capDrift', (v) => setCap('drift', v));
$('shortsAsDrift').addEventListener('change', async (e) => { config.lanes.shortsAsDrift = e.target.checked; await save(); });
$('defaultLane').addEventListener('change', async (e) => { config.lanes.defaultLaneForUnknown = e.target.value; await save(); });

$('addChannel').addEventListener('click', async () => {
  const raw = $('newChannel').value.trim();
  if (!raw) return;
  const key = /^UC[\w-]{20,}$/.test(raw) ? raw : raw.startsWith('@') ? 'h:' + raw.slice(1).toLowerCase() : 'n:' + raw.toLowerCase();
  config.rules.channelLanes[key] = $('newChannelLane').value;
  $('newChannel').value = '';
  await save(); renderChannels();
});

$('addRule').addEventListener('click', async () => {
  const pattern = $('newPattern').value.trim();
  if (!pattern) return;
  try { new RegExp(pattern); } catch { alert('Invalid regex'); return; }
  config.rules.keywordRules.unshift({ pattern, lane: $('newRuleLane').value, weight: Number($('newWeight').value) || 2 });
  $('newPattern').value = '';
  await save(); renderRules();
});

$('resetRules').addEventListener('click', async () => {
  config.rules.keywordRules = structuredClone(DEFAULT_KEYWORD_RULES);
  await save(); renderRules();
});

$('clearLedger').addEventListener('click', async () => {
  if (!confirm("Reset today's watch counts?")) return;
  const { ledger } = await chrome.storage.local.get('ledger');
  if (ledger) {
    ledger.today = { dateKey: ledger.today.dateKey, byLane: { enrich: 0, recharge: 0, drift: 0, unset: 0 },
      bonusSec: { recharge: 0, drift: 0 }, driftEvents: 0 };
    await chrome.storage.local.set({ ledger });
  }
  alert('Today reset.');
});

$('resetAll').addEventListener('click', async () => {
  if (!confirm('Wipe ALL Balance data (config, history, learned channels)?')) return;
  await chrome.storage.local.clear();
  location.reload();
});

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

load();
