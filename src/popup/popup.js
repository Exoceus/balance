// src/popup/popup.js — at-a-glance status + quick actions.
import { LANE_META, secondsToClock, minutesLabel } from '../shared/constants.js';
import { patchConfig } from '../shared/storage.js';

const $ = (id) => document.getElementById(id);
let activeTabId = null;

async function load() {
  const state = await chrome.runtime.sendMessage({ type: 'getState' });
  renderState(state);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && /youtube\.com/.test(tab.url || '')) {
    activeTabId = tab.id;
    try { renderNow(await chrome.tabs.sendMessage(tab.id, { type: 'getNowPlaying' })); }
    catch { renderNow(null); }
  } else {
    renderNow(null);
  }
}

function renderState(s) {
  if (!s || s.error) return;
  $('enabled').checked = !!s.enabled;

  const cap = (s.caps && s.caps.recharge) || 0;
  const used = s.byLane.recharge || 0;
  const remaining = s.remaining ? s.remaining.recharge : undefined;
  $('budgetVal').textContent = cap <= 0 ? 'unlimited'
    : remaining >= 0 ? `${secondsToClock(remaining)} left` : `over by ${secondsToClock(-remaining)}`;
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const fill = $('barFill');
  fill.style.width = pct + '%';
  fill.style.background = remaining < 0 ? 'var(--red)' : remaining < 300 ? 'var(--amber)' : 'var(--green)';

  const dr = s.remaining ? s.remaining.drift : undefined;
  $('credits').textContent = dr == null ? ''
    : dr >= 0 ? `🔴 Drift: ${secondsToClock(dr)} left today` : `🔴 Drift: over by ${secondsToClock(-dr)}`;

  $('lanes').innerHTML = ['enrich', 'recharge', 'drift'].map((k) => {
    const m = LANE_META[k];
    return `<div class="l"><div class="v">${m.emoji} ${minutesLabel(s.byLane[k] || 0)}</div>
            <div class="k">${m.label}</div></div>`;
  }).join('');

  if (s.paused) $('enabled').closest('.head').title = 'Paused until ' + new Date(s.pausedUntil).toLocaleTimeString();
}

function renderNow(np) {
  const el = $('now');
  if (!np) { el.className = 'now muted'; el.textContent = 'Open a YouTube video to see its lane.'; return; }
  const m = LANE_META[np.lane] || LANE_META.unset;
  el.className = 'now';
  el.innerHTML = `
    <div class="lane-pill" style="color:${m.color}">${m.emoji} ${m.label}</div>
    <div class="muted small" style="margin:4px 0 2px">${escapeHtml(np.meta?.title || '')}</div>
    <div class="muted small">${escapeHtml(np.meta?.channelName || '')}</div>
    <div class="retag">
      <button data-lane="enrich">🟢</button>
      <button data-lane="recharge">🟡</button>
      <button data-lane="drift">🔴</button>
    </div>`;
  el.querySelectorAll('.retag button').forEach((b) => {
    b.onclick = async () => {
      if (activeTabId) await chrome.tabs.sendMessage(activeTabId, { type: 'reclassifyCurrent', lane: b.dataset.lane });
      load();
    };
  });
}

$('enabled').addEventListener('change', async (e) => {
  await patchConfig({ enabled: e.target.checked, pausedUntil: 0 });
  load();
});
$('pause').addEventListener('click', async () => {
  await patchConfig({ pausedUntil: Date.now() + 15 * 60 * 1000 });
  load();
});
$('end').addEventListener('click', async () => {
  if (activeTabId) { try { await chrome.tabs.sendMessage(activeTabId, { type: 'endSession' }); } catch {} }
  window.close();
});
$('history').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/history/history.html') });
});
$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

load();
