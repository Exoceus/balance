// src/history/history.js — read-only view of the daily ledger (today + ~8 weeks of history).
import { getLedger } from '../shared/storage.js';
import { LANE_META } from '../shared/constants.js';

const $ = (id) => document.getElementById(id);
const LANES = ['enrich', 'recharge', 'drift', 'unset'];
const total = (d) => LANES.reduce((a, k) => a + (d.byLane?.[k] || 0), 0);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDur(s) {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return s ? `${s}s` : '0m';
}

// dateKey is "YYYY-MM-DD" from the (4am-shifted) balance day.
const keyToDate = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const shiftKey = (key, days) => {
  const dt = keyToDate(key); dt.setDate(dt.getDate() + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};
function dayLabel(key, todayKey) {
  if (key === todayKey) return { text: 'Today', today: true };
  if (key === shiftKey(todayKey, -1)) return { text: 'Yesterday', today: false };
  const dt = keyToDate(key);
  return { text: dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }), today: false };
}

function laneSplit(byLane) {
  return ['enrich', 'recharge', 'drift'].filter((k) => (byLane?.[k] || 0) > 0)
    .map((k) => `${LANE_META[k].emoji} <b>${fmtDur(byLane[k])}</b>`).join('&nbsp;&nbsp;') || '—';
}

function sumWindow(days, todayKey, n) {
  const cutoff = shiftKey(todayKey, -(n - 1));
  const acc = { enrich: 0, recharge: 0, drift: 0, unset: 0 };
  for (const d of days) if (d.dateKey >= cutoff) for (const k of LANES) acc[k] += d.byLane?.[k] || 0;
  return acc;
}

function renderSummary(days, today) {
  const week = sumWindow(days, today.dateKey, 7);
  const weekTotal = LANES.reduce((a, k) => a + week[k], 0);
  const card = (k, v, splitHtml) =>
    `<div class="scard"><div class="k">${k}</div><div class="v">${v}</div><div class="split">${splitHtml}</div></div>`;
  $('summary').innerHTML =
    card('Today', fmtDur(total(today)), laneSplit(today.byLane)) +
    card('Last 7 days', fmtDur(weekTotal), laneSplit(week)) +
    card('Daily average (7d)', fmtDur(weekTotal / 7),
      `<span>${days.length} day${days.length === 1 ? '' : 's'} on record</span>`);
}

// Per-video rows for one day, most-time-first. Old days (archived before per-video
// tracking) have no video map — show a gentle note instead.
function videoRows(day) {
  const vids = day.videos || {};
  const list = Object.entries(vids)
    .map(([id, r]) => ({ id, title: r.title || '(untitled)', channel: r.channel || '', lane: r.lane || 'unset', sec: r.sec || 0 }))
    .filter((v) => v.sec >= 1)
    .sort((a, b) => b.sec - a.sec);
  if (!list.length) return '<div class="vempty">No per-video detail recorded for this day.</div>';
  return list.map((v) => `
    <a class="vrow" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}" target="_blank" rel="noopener">
      <span class="vdot ${v.lane}" title="${LANE_META[v.lane]?.label || ''}"></span>
      <span class="vmeta"><span class="vtitle">${esc(v.title)}</span>${v.channel ? `<span class="vchan">${esc(v.channel)}</span>` : ''}</span>
      <span class="vsec">${fmtDur(v.sec)}</span>
    </a>`).join('');
}

function renderDays(days, todayKey) {
  const wrap = $('days');
  if (!days.length || days.every((d) => total(d) === 0)) {
    wrap.innerHTML = ''; $('empty').hidden = false; return;
  }
  const max = Math.max(1, ...days.map(total));
  wrap.innerHTML = days.map((d) => {
    const t = total(d);
    const segs = LANES.map((k) => {
      const sec = d.byLane?.[k] || 0;
      if (!sec) return '';
      return `<span class="seg ${k}" style="width:${(sec / max) * 100}%" title="${LANE_META[k].label}: ${fmtDur(sec)}"></span>`;
    }).join('');
    const lab = dayLabel(d.dateKey, todayKey);
    return `<details class="dayx"${lab.today ? ' open' : ''}>
      <summary class="day">
        <span class="chev">▸</span>
        <div class="lbl${lab.today ? ' today' : ''}">${lab.text}</div>
        <div class="track">${segs}</div>
        <div class="tot${t ? '' : ' zero'}">${t ? fmtDur(t) : '—'}</div>
      </summary>
      <div class="vwrap">${videoRows(d)}</div>
    </details>`;
  }).join('');
}

async function load() {
  const ledger = await getLedger();
  const days = [ledger.today, ...(ledger.history || [])].filter((d) => d && d.dateKey);
  renderSummary(days, ledger.today);
  renderDays(days, ledger.today.dateKey);
}

load();
