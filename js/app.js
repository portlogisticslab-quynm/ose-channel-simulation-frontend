/* Channel Capacity Simulation V6.0 — frontend application.
   All backend calls go through apiCall() -> window.oseFetch (config.js). */
'use strict';
const APP_BUILD = '6.0.5';
console.info('[Channel Capacity] frontend build', APP_BUILD);

// ------------------------------------------------------------------ utilities
const $ = (id) => document.getElementById(id);
const num = (x, d = 0) => { const v = Number(x); return Number.isFinite(v) ? v : d; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fmt = (v, d = 1) => (v == null || !Number.isFinite(+v)) ? '–' : (+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtH = (m, d = 2) => (m == null ? '–' : fmt(m / 60, d));
const pct = (v, d = 1) => (v == null ? '–' : fmt(100 * v, d) + '%');
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const SERIES = () => ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'].map(cssVar);
const fmtClock = (t) => { const d = Math.floor(t / 1440), m = Math.floor(t - d * 1440); return `D${d + 1} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

const KV_SHEETS = ['SIM', 'DEMAND', 'ROUTES', 'MODEL', 'TIDE_PARAMS', 'TURNING_CONFIG', 'RESOURCES', 'WEATHER', 'ANCHORAGE'];
const TABLE_SHEETS = ['SHIP_CLASSES', 'ClassBerthMap', 'SEGMENTS', 'BERTHS', 'TIDE_COMPONENTS', 'BERTH_SERVICE', 'TURNING_BASINS', 'BERTH_TURNING_MAP', 'CLASS_SEGMENT_MEETING', 'MOVEMENT_TYPES'];
const WAITS = [
  ['waitBerth', 'Berth', 'congestion'], ['waitTraffic', 'Traffic / meeting', 'congestion'], ['waitTurning', 'Turning basin', 'congestion'],
  ['waitPilot', 'Pilot', 'congestion'], ['waitTug', 'Tug', 'congestion'], ['waitTide', 'Tide / UKC', 'env'],
  ['waitWeather', 'Weather closure', 'env'], ['waitDaylight', 'Daylight rule', 'env'],
];
// key: [label, unit, scale, decimals]
const KPI_META = {
  throughputPerDay: ['Throughput', 'ships/day', 1, 2], dwtPerDay: ['DWT throughput', 't DWT/day', 1, 0],
  cargoPerDay: ['Cargo throughput (DWT × load factor)', 't/day', 1, 0], avgTurn: ['Mean turnaround time', 'h', 1 / 60, 2],
  avgWait: ['Mean total waiting', 'h', 1 / 60, 2], avgCongestionWait: ['Mean congestion waiting', 'h', 1 / 60, 2],
  avgEnvWait: ['Mean environmental waiting (tide/weather/daylight)', 'h', 1 / 60, 2], waitingFactor: ['Waiting factor (congestion ÷ net time)', '–', 1, 3],
  avgAnchorWait: ['Mean wait at anchorage', 'h', 1 / 60, 2], avgService: ['Mean berth service time', 'h', 1 / 60, 2],
  avgQueue: ['Mean anchorage queue', 'ships', 1, 2], maxQueue: ['Max anchorage queue', 'ships', 1, 1],
  pctTimeQueueOverCap: ['Time anchorage over capacity', '%', 1, 1],
  avgWaitBerth: ['Mean berth wait', 'h', 1 / 60, 2], avgWaitTraffic: ['Mean traffic wait', 'h', 1 / 60, 2], avgWaitTide: ['Mean tide wait', 'h', 1 / 60, 2],
  avgWaitTurning: ['Mean turning-basin wait', 'h', 1 / 60, 2], avgWaitPilot: ['Mean pilot wait', 'h', 1 / 60, 2], avgWaitTug: ['Mean tug wait', 'h', 1 / 60, 2],
  avgWaitWeather: ['Mean weather wait', 'h', 1 / 60, 2], avgWaitDaylight: ['Mean daylight wait', 'h', 1 / 60, 2],
  arrivals: ['Arrivals (after warm-up)', 'ships', 1, 1], throughput: ['Completed movements', 'ships', 1, 1],
  berthCall: ['Completed berth calls', 'ships', 1, 1], transit: ['Completed transits', 'ships', 1, 1], turnOnly: ['Completed turn-only', 'ships', 1, 1],
  rejectedPct: ['Rejected (depth/tide/turning)', '%', 1, 2], pendingPct: ['Not completed at end of horizon', '%', 1, 2],
  rejDepth: ['Rejected — depth', 'ships', 1, 2], rejTide: ['Rejected — no tidal window', 'ships', 1, 2], rejTurning: ['Rejected — turning basin', 'ships', 1, 2],
  pctBerth: ['Ships delayed by berth', '%', 1, 1], pctTraffic: ['Ships delayed by traffic', '%', 1, 1], pctTide: ['Ships delayed by tide', '%', 1, 1],
};

let INPUT = clone(window.CC_DEMO);
let INPUT_LABEL = 'Demo input';
let RESULT = null, CAP = null, SCENARIOS = [], CHARTS = {}, VES_SORT = { key: 'id', dir: 1 };
const ANIM = { t: 0, playing: false, raf: 0 };

// ------------------------------------------------------------------ API (Phụ lục C)
async function apiCall(path, method = 'GET', body, timeoutMs = 300000) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const opts = { method, headers: {}, signal: ctrl.signal };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  try {
    const res = window.oseFetch
      ? await window.oseFetch(path, opts)
      : await fetch(String(window.OSE_API_BASE || '').replace(/\/+$/, '') + path, opts);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Server returned an invalid response (HTTP ${res.status})`); }
    if (!res.ok) {
      const d = data.detail;
      throw new Error(typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => `${(x.loc || []).join('.')}: ${x.msg}`).join('; ') : JSON.stringify(d || 'Backend error'));
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Request timed out — reduce days/replications or try again.');
    if (e instanceof TypeError) throw new Error('Cannot reach the backend (network/CORS). Check that the API is running.');
    throw e;
  } finally { clearTimeout(timer); }
}

async function backendLabel() {
  const base = String(await window.OSE_API_READY || window.OSE_API_BASE || '');
  return base.includes('onrender.com') ? 'Computing on Render (first call may take 30–60 s while it wakes up)…' : 'Backend computing…';
}

async function initBackend() {
  const sel = $('backendSelect');
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local) sel.hidden = true;
  let pinned = new URLSearchParams(location.search).get('api');
  try { pinned = pinned || localStorage.getItem('ose_api'); } catch (e) {}
  sel.value = ['home', 'render'].includes(pinned) ? pinned : 'auto';
  sel.addEventListener('change', () => { const u = new URL(location.href); u.searchParams.set('api', sel.value); location.href = u.toString(); });
  const base = String(await window.OSE_API_READY || '');
  const name = base.includes('onrender.com') ? 'Render' : (base.includes('127.0.0.1') || base.includes('localhost')) ? 'Local' : 'Home server';
  $('backendText').textContent = name + ' · checking…';
  const t0 = performance.now();
  try {
    const h = await apiCall('/api/health', 'GET', undefined, 90000);
    const ms = Math.round(performance.now() - t0);
    $('backendDot').className = 'dot ok';
    $('backendText').textContent = `${name} · v${h.version || '?'} · ${ms} ms`;
    $('backendChip').title = base;
  } catch (e) {
    $('backendDot').className = 'dot bad';
    $('backendText').textContent = `${name} · offline`;
    $('backendChip').title = `${base} — ${e.message}`;
  }
}

// ------------------------------------------------------------------ UI helpers
function setStatus(msg, kind = '') { const e = $('runStatus'); e.className = 'status ' + kind; e.textContent = msg; }
let toastTimer = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4200); }
function busy(on) {
  document.querySelector('.progress').classList.toggle('busy', on);
  ['runBtn', 'capBtn', 'validateBtn'].forEach((id) => { const b = $(id); if (b) b.disabled = on; });
}
function switchTab(name) {
  document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === name));
  if (name === 'channel' && RESULT) requestAnimationFrame(drawHeatmap);
  if (name === 'animation' && RESULT) requestAnimationFrame(() => drawAnimation(ANIM.t));
  // Charts created while their tab was hidden have zero size: rebuild/resize once the tab is visible.
  requestAnimationFrame(() => {
    if (name === 'scenarios') renderScenarios();
    else if (name === 'results' && RESULT) renderCharts();
    else if (name === 'channel' && RESULT) renderChannel();
    else if (name === 'capacity' && CAP) renderCapacity();
  });
  window.scrollTo({ top: 0 });
}
function download(name, data, type = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
function toCSV(rows) {
  if (!rows.length) return '';
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const q = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
  return keys.map(q).join(',') + '\n' + rows.map((r) => keys.map((k) => q(r[k])).join(',')).join('\n');
}
function table(cols, rows, opts = {}) {
  // cols: [{key,label,fmt,txt,sortable}]
  const head = cols.map((c) => `<th${c.sortable ? ` class="sortable" data-key="${esc(c.key)}"` : ''}>${esc(c.label)}${opts.sort && opts.sort.key === c.key ? (opts.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const body = rows.map((r) => '<tr>' + cols.map((c) => {
    const v = c.fmt ? c.fmt(r[c.key], r) : esc(r[c.key]);
    return `<td class="${c.txt ? 'txt' : ''}">${v}</td>`;
  }).join('') + '</tr>').join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ------------------------------------------------------------------ INPUT handling
function ensureDefaults() {
  for (const s of KV_SHEETS) {
    INPUT[s] = INPUT[s] && typeof INPUT[s] === 'object' && !Array.isArray(INPUT[s]) ? INPUT[s] : {};
    for (const [k, v] of Object.entries(window.CC_DEMO[s] || {})) if (!(k in INPUT[s]) || INPUT[s][k] === null || INPUT[s][k] === '') INPUT[s][k] = v;
  }
  for (const s of TABLE_SHEETS) if (!Array.isArray(INPUT[s])) INPUT[s] = [];
}
function getPath(p) { const [s, k] = p.split('.'); return INPUT[s] ? INPUT[s][k] : undefined; }
function setPath(p, v) { const [s, k] = p.split('.'); (INPUT[s] = INPUT[s] || {})[k] = v; }
function syncControls() {
  document.querySelectorAll('[data-bind]').forEach((el) => {
    const v = getPath(el.dataset.bind);
    if (el.type === 'checkbox') el.checked = num(v, 0) !== 0;
    else el.value = v ?? '';
  });
  renderMovementControls();
  updateExpected();
  $('inputName').textContent = INPUT_LABEL + ` · ${(INPUT.SEGMENTS || []).length} segments, ${(INPUT.BERTHS || []).length} berths, ${(INPUT.TURNING_BASINS || []).length} turning basins, ${(INPUT.SHIP_CLASSES || []).length} ship classes.`;
}
function onBindChange(e) {
  const el = e.target; if (!el.dataset.bind) return;
  let v;
  if (el.type === 'checkbox') v = el.checked ? 1 : 0;
  else if (el.type === 'number') v = el.value === '' ? null : Number(el.value);
  else v = el.value;
  setPath(el.dataset.bind, v);
  updateExpected();
}
function renderMovementControls() {
  const d = $('movementControls'); d.innerHTML = '';
  (INPUT.MOVEMENT_TYPES || []).forEach((r, i) => {
    if (num(r.Active, 1) === 0) return;
    const lab = document.createElement('label');
    lab.textContent = `Share — ${r.MovementType}`;
    const inp = document.createElement('input'); inp.type = 'number'; inp.min = '0'; inp.step = '0.05'; inp.value = num(r.Share);
    inp.addEventListener('change', () => { INPUT.MOVEMENT_TYPES[i].Share = Math.max(0, num(inp.value)); });
    lab.appendChild(inp); d.appendChild(lab);
  });
}
function updateExpected() {
  const lam = num(INPUT.DEMAND.lambda_total_hr) * num(INPUT.DEMAND.seasonal_factor, 1);
  const per = lam * 24 * num(INPUT.SIM.days, 10);
  $('expectedShips').textContent = `≈ ${fmt(per, 0)} arrivals per replication · ≈ ${fmt(per * num(INPUT.SIM.nReps, 1), 0)} ship lifecycles in total.`;
  const capEst = $('capEst');
  if (capEst) {
    const pts = num($('capSteps').value, 8), reps = num($('capReps').value, 10);
    const lamAvg = (num($('capMin').value) + num($('capMax').value)) / 2 * num(INPUT.DEMAND.seasonal_factor, 1);
    capEst.textContent = `≈ ${fmt(pts * reps * lamAvg * 24 * num(INPUT.SIM.days, 10), 0)} ship lifecycles (uses the current INPUT, days = ${num(INPUT.SIM.days)}).`;
  }
}
function resetDemo() { INPUT = clone(window.CC_DEMO); INPUT_LABEL = 'Demo input'; syncControls(); populateSheets(); setStatus('Demo input loaded.'); }

async function loadFile() {
  const f = $('xlsxFile').files[0];
  if (!f) { toast('Choose a file first.'); return; }
  try {
    if (/\.json$/i.test(f.name)) {
      const d = JSON.parse(await f.text());
      INPUT = d.input && d.input.SEGMENTS ? d.input : d;
    } else {
      if (typeof XLSX === 'undefined') throw new Error('SheetJS did not load (offline?). Use a .json INPUT instead.');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const data = {}; const found = [];
      for (const s of [...TABLE_SHEETS, ...KV_SHEETS]) {
        if (!wb.Sheets[s]) continue;
        found.push(s);
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[s], { defval: null });
        if (KV_SHEETS.includes(s)) {
          const o = {};
          rows.forEach((r) => { const k = r.Param ?? Object.values(r)[0], v = r.Value ?? Object.values(r)[1]; if (k != null && String(k).trim() !== '') o[String(k).trim()] = v; });
          data[s] = o;
        } else data[s] = rows.filter((r) => Object.values(r).some((x) => x != null && x !== ''));
      }
      if (!data.SEGMENTS || !data.SHIP_CLASSES) throw new Error('Workbook must contain at least SEGMENTS and SHIP_CLASSES sheets.');
      INPUT = data;
      toast(`Loaded sheets: ${found.join(', ')}`);
    }
    INPUT_LABEL = f.name;
    ensureDefaults(); syncControls(); populateSheets();
    setStatus(`Input loaded: ${f.name}. Validate, then run.`, 'ok');
    await validateInput(true);
  } catch (e) { setStatus('Load failed: ' + e.message, 'err'); }
}

function inputWorkbook() {
  const wb = XLSX.utils.book_new();
  for (const s of KV_SHEETS) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.entries(INPUT[s] || {}).map(([Param, Value]) => ({ Param, Value }))), s);
  for (const s of TABLE_SHEETS) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((INPUT[s] || []).length ? INPUT[s] : [{}]), s);
  return wb;
}

// ------------------------------------------------------------------ validation
async function validateInput(silent = false) {
  busy(true);
  try {
    const d = await apiCall('/api/validate', 'POST', { input: INPUT });
    renderValidation(d.validation);
    if (!silent) setStatus(d.validation.errors.length ? `Input has ${d.validation.errors.length} error(s).` : 'Input valid.', d.validation.errors.length ? 'err' : 'ok');
  } catch (e) { if (!silent) setStatus('Validation failed: ' + e.message, 'err'); }
  finally { busy(false); }
}
function renderValidation(v) {
  $('validationCard').hidden = false;
  let h = '';
  v.errors.forEach((m) => { h += `<div class="msg err">✖ ${esc(m)}</div>`; });
  v.warnings.forEach((m) => { h += `<div class="msg warn">⚠ ${esc(m)}</div>`; });
  v.info.forEach((m) => { h += `<div class="msg info">ℹ ${esc(m)}</div>`; });
  if (!v.errors.length && !v.warnings.length) h += '<div class="msg ok">✔ No errors or warnings.</div>';
  const pill = (s) => `<span class="pill ${s === 'always feasible' ? 'ok' : s === 'tide-dependent' ? 'warn' : 'bad'}">${esc(s)}</span>`;
  h += table([
    { key: 'ClassName', label: 'Class', txt: true }, { key: 'RequiredDepth_m', label: 'Required depth (m)', fmt: (x) => fmt(x, 2) },
    { key: 'GoverningSegment', label: 'Governing segment', txt: true }, { key: 'DestinationKm', label: 'Furthest destination (km)', fmt: (x) => fmt(x, 1) },
    { key: 'MarginAtMeanTide_m', label: 'Margin @ mean tide (m)', fmt: (x) => fmt(x, 2) }, { key: 'MarginAtMaxTide_m', label: 'Margin @ max tide (m)', fmt: (x) => fmt(x, 2) },
    { key: 'Status', label: 'Status', fmt: pill },
  ], v.feasibility || []);
  $('validationOut').innerHTML = h;
}

// ------------------------------------------------------------------ run
async function runSimulation() {
  busy(true); setStatus(await backendLabel());
  const t0 = performance.now();
  try {
    const d = await apiCall('/api/run', 'POST', { input: INPUT });
    RESULT = d.result; RESULT._input = clone(INPUT); RESULT._label = INPUT_LABEL; RESULT._version = d.version;
    switchTab('results');          // show the tab first: Chart.js cannot size charts inside a hidden panel
    renderAll();
    addScenarioFromResult();
    setStatus(`Done: ${RESULT.meta.nReps} replications × ${fmt(RESULT.meta.days, 1)} days in ${fmt((performance.now() - t0) / 1000, 1)} s (engine ${fmt(RESULT.meta.elapsed_s, 1)} s).`, 'ok');
  } catch (e) { setStatus('Run failed: ' + e.message, 'err'); toast(e.message); }
  finally { busy(false); }
}

function S(k) { return (RESULT && RESULT.summary[k]) || {}; }
function renderAll() {
  ['results', 'channel', 'anim', 'ves'].forEach((p) => { $(p + 'Empty').hidden = true; $(p + 'Body').hidden = false; });
  renderKPIs(); renderCharts(); renderTables(); renderLog(); renderChannel(); initAnimation(); renderVessels();
  if (RESULT.validation) renderValidation(RESULT.validation);
}

function kpiTile(label, mean, ci, unit, d, cls = '') {
  return `<div class="kpi ${cls}"><div class="k">${esc(label)}</div><div class="v">${fmt(mean, d)}<small>${esc(unit)}</small></div><div class="ci">${ci != null ? '± ' + fmt(ci, d) + ' (95% CI)' : '&nbsp;'}</div></div>`;
}
function tileFor(key, cls, labelOverride) {
  const [label, unit, sc, d] = KPI_META[key]; const s = S(key);
  return kpiTile(labelOverride || label, s.mean == null ? null : s.mean * sc, s.ci95 == null ? null : s.ci95 * sc, unit, d, cls);
}
function renderKPIs() {
  const m = RESULT.meta;
  $('resultsLead').textContent = `${RESULT._label} · ${m.nReps} replications · ${fmt(m.days, 1)} days (warm-up ${fmt(m.warmup_days, 1)}) · λ = ${fmt(m.lambda_total_hr, 2)} ships/h · seed ${m.seed}`;
  $('kpis').innerHTML = [
    tileFor('throughputPerDay', 'accent'), tileFor('dwtPerDay', 'accent'), tileFor('avgTurn'), tileFor('avgWait'),
    tileFor('avgCongestionWait'), tileFor('waitingFactor'), tileFor('avgQueue'), tileFor('rejectedPct'),
  ].join('');
}

function chartBase() {
  if (typeof Chart === 'undefined') return false;
  Chart.defaults.font.family = cssVar('--sans') || 'sans-serif';
  Chart.defaults.font.size = 11.5;
  Chart.defaults.color = cssVar('--muted');
  Chart.defaults.borderColor = cssVar('--line-2');
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.animation = { duration: 250 };
  Chart.defaults.maintainAspectRatio = false;
  return true;
}
// Reference lines / shaded boxes plugin
const refLines = {
  id: 'refLines',
  afterDatasetsDraw(chart, _a, o) {
    if (!o) return;
    const { ctx, chartArea: ca, scales: { x, y } } = chart;
    ctx.save();
    (o.boxes || []).forEach((b) => {
      const x0 = Math.max(ca.left, x.getPixelForValue(b.x0)), x1 = Math.min(ca.right, x.getPixelForValue(b.x1));
      if (x1 > x0) { ctx.fillStyle = b.color || 'rgba(201,42,42,.12)'; ctx.fillRect(x0, ca.top, x1 - x0, ca.bottom - ca.top); }
    });
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.3; ctx.font = '11px ' + (cssVar('--sans') || 'sans-serif');
    (o.h || []).forEach((l) => {
      const py = y.getPixelForValue(l.y); if (py < ca.top || py > ca.bottom) return;
      ctx.strokeStyle = l.color; ctx.beginPath(); ctx.moveTo(ca.left, py); ctx.lineTo(ca.right, py); ctx.stroke();
      if (l.label) { ctx.fillStyle = l.color; ctx.fillText(l.label, ca.left + 6, py - 4); }
    });
    (o.v || []).forEach((l) => {
      const px = x.getPixelForValue(l.x); if (px < ca.left || px > ca.right) return;
      ctx.strokeStyle = l.color; ctx.beginPath(); ctx.moveTo(px, ca.top); ctx.lineTo(px, ca.bottom); ctx.stroke();
      if (l.label) { ctx.fillStyle = l.color; ctx.fillText(l.label, Math.min(px + 5, ca.right - 120), ca.top + 12); }
    });
    ctx.restore();
  },
};
function mkChart(id, cfg) {
  if (!chartBase()) { const c = $(id); if (c) c.parentElement.innerHTML = '<div class="empty">Chart.js did not load (offline?).</div>'; return; }
  if (CHARTS[id]) CHARTS[id].destroy();
  cfg.plugins = [...(cfg.plugins || []), refLines];
  CHARTS[id] = new Chart($(id), cfg);
}

function renderCharts() {
  const C = SERIES();
  // Waiting decomposition
  const wv = WAITS.map(([k]) => (S('avg' + k[0].toUpperCase() + k.slice(1)).mean || 0) / 60);
  const wci = WAITS.map(([k]) => (S('avg' + k[0].toUpperCase() + k.slice(1)).ci95 || 0) / 60);
  mkChart('cWait', {
    type: 'bar',
    data: { labels: WAITS.map((w) => w[1]), datasets: [{ data: wv, backgroundColor: WAITS.map((w) => (w[2] === 'congestion' ? C[0] : C[3])), borderRadius: 4 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmt(c.raw, 2)} h  (± ${fmt(wci[c.dataIndex], 2)} h)` } } },
      scales: { x: { title: { display: true, text: 'hours per served ship' }, beginAtZero: true }, y: { grid: { display: false } } } },
  });
  // Replications
  const reps = RESULT.reps.map((r) => r.throughputPerDay);
  const mean = S('throughputPerDay').mean, ci = S('throughputPerDay').ci95 || 0;
  const xs = reps.map((_, i) => i + 1);
  mkChart('cReps', {
    type: 'line',
    data: { labels: xs, datasets: [
      { label: 'Replication', data: reps, borderColor: C[0], backgroundColor: C[0], pointRadius: 2.5, borderWidth: 1.5, tension: 0 },
      { label: 'CI upper', data: xs.map(() => mean + ci), borderColor: 'transparent', pointRadius: 0, fill: '+1', backgroundColor: C[0] + '22' },
      { label: 'CI lower', data: xs.map(() => mean - ci), borderColor: 'transparent', pointRadius: 0, fill: false },
      { label: 'Mean', data: xs.map(() => mean), borderColor: C[2], borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 },
    ] },
    options: { plugins: { legend: { labels: { filter: (i) => !i.text.startsWith('CI') } } },
      scales: { x: { title: { display: true, text: 'replication' } }, y: { title: { display: true, text: 'ships / day' } } } },
  });
  $('repsHint').textContent = `Mean ${fmt(mean, 2)} ships/day, 95 % CI ± ${fmt(ci, 2)} (${fmt(mean ? 100 * ci / mean : 0, 1)} % of mean). Add replications if the CI is too wide for your decision.`;
  // Segments
  const segs = RESULT.last.segments;
  mkChart('cSeg', {
    type: 'bar',
    data: { labels: segs.map((s) => s.SegmentID), datasets: [{ label: 'Utilisation %', data: RESULT.segUtil.map((u) => 100 * u), backgroundColor: C[1], borderRadius: 4 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: '% of time occupied' } }, x: { grid: { display: false } } } },
  });
  // Berths
  mkChart('cBerth', {
    type: 'bar',
    data: { labels: RESULT.berths.map((b) => b.BerthID), datasets: [{ label: 'Occupancy %', data: RESULT.berths.map((b) => 100 * (b.occupancy || 0)), backgroundColor: RESULT.berths.map((b) => (b.occupancy > 0.75 ? C[7] : C[0])), borderRadius: 4 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, suggestedMax: 100, title: { display: true, text: '% of time' } }, x: { grid: { display: false } } } },
  });
  // Histogram
  const wd = RESULT.waitDist; const ed = wd.histEdges;
  const lbl = wd.hist.map((_, i) => ed[i + 1] == null ? `> ${ed[i] / 60} h` : `${ed[i] / 60}–${ed[i + 1] / 60} h`);
  mkChart('cHist', {
    type: 'bar',
    data: { labels: lbl, datasets: [{ data: wd.hist.map((h) => (wd.n ? 100 * h / wd.n : 0)), backgroundColor: C[4], borderRadius: 4 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmt(c.raw, 1) + ' % of ships' } } }, scales: { y: { beginAtZero: true, title: { display: true, text: '% of served ships' } }, x: { grid: { display: false } } } },
  });
  $('histHint').textContent = `All replications pooled (${wd.n} ships). P50 = ${fmtH(wd.p50)} h · P90 = ${fmtH(wd.p90)} h · P95 = ${fmtH(wd.p95)} h · max = ${fmtH(wd.max)} h.`;
  // Movements
  const od = Math.max(1e-9, RESULT.meta.days - RESULT.meta.warmup_days);
  mkChart('cMov', {
    type: 'bar',
    data: { labels: ['berth_call', 'transit', 'turn_only'], datasets: [{ data: ['berthCall', 'transit', 'turnOnly'].map((k) => (S(k).mean || 0) / od), backgroundColor: [C[2], C[1], C[3]], borderRadius: 4 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'completed / day' } }, x: { grid: { display: false } } } },
  });
}

function renderTables() {
  const h = (x) => fmtH(x);
  $('tClasses').innerHTML = table([
    { key: 'ClassName', label: 'Class', txt: true }, { key: 'arrivals', label: 'Arrivals', fmt: (x) => fmt(x, 1) },
    { key: 'served', label: 'Completed', fmt: (x) => fmt(x, 1) }, { key: 'rejected', label: 'Rejected', fmt: (x) => fmt(x, 1) },
    { key: 'avgWait', label: 'Total wait (h)', fmt: h }, { key: 'avgWaitTide', label: 'Tide wait (h)', fmt: h },
    { key: 'avgWaitTraffic', label: 'Traffic wait (h)', fmt: h }, { key: 'avgTurn', label: 'Turnaround (h)', fmt: h },
  ], RESULT.classes);
  const bar = (u) => `<span class="bar" style="width:${Math.round(60 * Math.min(1, u || 0))}px"></span>${pct(u)}`;
  $('tBerths').innerHTML = table([
    { key: 'BerthID', label: 'Berth', txt: true }, { key: 'calls', label: 'Calls / rep', fmt: (x) => fmt(x, 1) },
    { key: 'occupancy', label: 'Occupancy', fmt: bar }, { key: 'avgWaitBerth', label: 'Berth wait (h)', fmt: h }, { key: 'avgService', label: 'Service (h)', fmt: h },
  ], RESULT.berths);
  $('tBasins').innerHTML = table([
    { key: 'TurningBasinID', label: 'Turning basin', txt: true }, { key: 'turns', label: 'Turns / rep', fmt: (x) => fmt(x, 1) }, { key: 'utilization', label: 'Utilisation', fmt: bar },
  ], RESULT.basins);
  const r = [];
  r.push(RESULT.pilotUtil != null ? `Pilot utilisation ${pct(RESULT.pilotUtil)}` : 'Pilots: unlimited (not modelled)');
  r.push(RESULT.tugUtil != null ? `Tug utilisation ${pct(RESULT.tugUtil)}` : 'Tugs: not modelled');
  if (RESULT.closuresPerRep) r.push(`Weather closures: ${fmt(RESULT.closuresPerRep, 1)} per replication`);
  $('tRes').textContent = r.join(' · ');
}

function renderLog() {
  const m = RESULT.meta, v = RESULT.validation || { warnings: [], info: [] };
  const L = [
    `Channel Capacity Simulation ${RESULT._version || ''} — ${RESULT._label}`,
    `Replications ${m.nReps}, days ${m.days}, warm-up ${m.warmup_days}, seed ${m.seed}, lambda ${m.lambda_total_hr} ships/h, engine time ${m.elapsed_s} s`,
    '',
    'KPI (mean ± 95% CI):',
  ];
  for (const k of ['throughputPerDay', 'dwtPerDay', 'avgTurn', 'avgWait', 'avgCongestionWait', 'avgEnvWait', 'waitingFactor', 'avgQueue', 'maxQueue', 'pendingPct', 'rejectedPct']) {
    const [lab, unit, sc, d] = KPI_META[k]; const s = S(k);
    L.push(`  ${lab.padEnd(52)} ${fmt(s.mean == null ? null : s.mean * sc, d).padStart(12)} ± ${fmt(s.ci95 == null ? null : s.ci95 * sc, d)} ${unit}`);
  }
  L.push('', `Rejected per replication: depth ${fmt(S('rejDepth').mean, 2)}, tide ${fmt(S('rejTide').mean, 2)}, turning ${fmt(S('rejTurning').mean, 2)}; not completed at horizon ${fmt(S('pending').mean, 2)}`);
  if (RESULT.daylightInfeasible) L.push(`⚠ ${RESULT.daylightInfeasible} leg(s) longer than the daylight window — daylight rule ignored for them.`);
  (v.warnings || []).forEach((w) => L.push('⚠ ' + w));
  (v.info || []).forEach((w) => L.push('ℹ ' + w));
  $('runLog').textContent = L.join('\n');
}

// ------------------------------------------------------------------ channel page
function renderChannel() {
  const C = SERIES(); const det = RESULT.last; const segs = det.segments;
  const fz = (RESULT.validation && RESULT.validation.feasibility) || [];
  const depthOf = Object.fromEntries(segs.map((s) => [s.SegmentID, s.Depth_CD_m]));
  const tideX = det.tide.times.map((t) => t / 1440);
  const ds = [{ label: 'Tide level (m)', data: det.tide.level.map((y, i) => ({ x: tideX[i], y })), borderColor: C[0], pointRadius: 0, borderWidth: 1.4 }];
  const h = [];
  fz.forEach((f, i) => {
    if (f.Status === 'always feasible' || !f.GoverningSegment) return;
    const need = f.RequiredDepth_m - depthOf[f.GoverningSegment];
    h.push({ y: need, color: C[(i + 2) % 8], label: `${f.ClassName}: ≥ ${fmt(need, 2)} m${f.Status === 'infeasible' ? ' (never)' : ''}` });
  });
  mkChart('cTide', {
    type: 'line', data: { datasets: ds },
    options: { parsing: false, plugins: { legend: { display: false }, refLines: { h, boxes: (det.closures || []).map((c) => ({ x0: c[0] / 1440, x1: c[1] / 1440 })) } },
      scales: { x: { type: 'linear', title: { display: true, text: 'day' }, min: 0, max: det.T / 1440 }, y: { title: { display: true, text: 'm above chart datum' } } } },
  });
  const cap = num(INPUT.ANCHORAGE && INPUT.ANCHORAGE.capacity);
  mkChart('cQueue', {
    type: 'line',
    data: { datasets: [{ label: 'Ships at anchorage', data: det.queue.times.map((t, i) => ({ x: t / 1440, y: det.queue.count[i] })), borderColor: C[2], backgroundColor: C[2] + '22', fill: true, stepped: true, pointRadius: 0, borderWidth: 1.3 }] },
    options: { parsing: false, plugins: { legend: { display: false }, refLines: { h: cap > 0 ? [{ y: cap, color: C[7], label: `Anchorage capacity ${cap}` }] : [] } },
      scales: { x: { type: 'linear', title: { display: true, text: 'day' } }, y: { beginAtZero: true, title: { display: true, text: 'ships waiting' } } } },
  });
  $('queueHint').textContent = `Mean ${fmt(S('avgQueue').mean, 2)} ships, max ${fmt(S('maxQueue').mean, 1)} (mean of replications). Waiting at anchorage covers berth, tide, traffic, pilot and weather waits before entering.`;
  const occ = det.occ;
  const rows = segs.map((s, j) => ({
    seg: s.SegmentID, km: `${fmt(s.Start_km, 1)}–${fmt(s.End_km, 1)}`, depth: s.Depth_CD_m, vlim: s.SpeedLimit_kn, meet: s.AllowMeet ? 'yes' : 'no',
    util: RESULT.segUtil[j], pass: RESULT.segPassPerDay[j], dwt: RESULT.segDWTPerDay[j],
    maxs: occ.maxSeg[j], pocc: occ.pctOcc[j], pmulti: occ.pctMulti[j], popp: occ.pctOpp[j],
  }));
  $('tSeg').innerHTML = table([
    { key: 'seg', label: 'Segment', txt: true }, { key: 'km', label: 'km', txt: true }, { key: 'depth', label: 'Depth CD (m)', fmt: (x) => fmt(x, 2) },
    { key: 'vlim', label: 'Speed limit (kn)', fmt: (x) => (x ? fmt(x, 1) : '–') }, { key: 'meet', label: 'Meeting', txt: true },
    { key: 'util', label: 'Utilisation', fmt: (u) => `<span class="bar" style="width:${Math.round(60 * Math.min(1, u || 0))}px"></span>${pct(u)}` },
    { key: 'pass', label: 'Passages/day', fmt: (x) => fmt(x, 1) }, { key: 'dwt', label: 'DWT-passages/day', fmt: (x) => fmt(x, 0) },
    { key: 'maxs', label: 'Max ships', fmt: (x) => fmt(x, 0) }, { key: 'pocc', label: '% occupied', fmt: (x) => fmt(x, 1) },
    { key: 'pmulti', label: '% ≥ 2 ships', fmt: (x) => fmt(x, 2) }, { key: 'popp', label: '% opposite coexist', fmt: (x) => fmt(x, 2) },
  ], rows);
  drawHeatmap();
}

function heatColor(q) { // perceptual blue→teal→yellow ramp
  const stops = [[247, 251, 255], [158, 202, 225], [49, 130, 189], [8, 81, 156], [253, 174, 97], [215, 48, 39]];
  if (q <= 0) return 'rgb(247,251,255)';
  const p = Math.min(1, q) * (stops.length - 1); const i = Math.min(stops.length - 2, Math.floor(p)); const f = p - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function drawHeatmap() {
  if (!RESULT) return;
  const cv = $('heatmap'); const W = cv.parentElement.clientWidth || 900, H = 300, dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
  const occ = RESULT.last.occ, segs = RESULT.last.segments, nT = occ.times.length;
  const L = 52, R = 70, T = 10, B = 34, ww = W - L - R, hh = H - T - B, cw = ww / nT, ch = hh / segs.length;
  const mx = Math.max(1, ...occ.maxSeg);
  occ.H.forEach((row, j) => row.forEach((v, i) => { x.fillStyle = heatColor(v / mx); x.fillRect(L + i * cw, T + (segs.length - 1 - j) * ch, Math.ceil(cw) + 0.5, ch - 1); }));
  x.fillStyle = cssVar('--muted'); x.font = '11px ' + cssVar('--mono');
  segs.forEach((s, j) => x.fillText(s.SegmentID, 10, T + (segs.length - j - 0.5) * ch + 4));
  const days = RESULT.last.T / 1440;
  for (let d = 0; d <= days; d += Math.max(1, Math.round(days / 10))) {
    const px = L + ww * d / days; x.fillText('D' + d, px - 6, H - 14); x.fillRect(px, T + hh, 1, 4);
  }
  x.fillText('time (day)', L + ww / 2 - 25, H - 1);
  for (let k = 0; k <= mx; k++) {
    const y0 = T + hh - (k + 1) * hh / (mx + 1);
    x.fillStyle = heatColor(k / mx); x.fillRect(W - R + 14, y0, 16, hh / (mx + 1));
    x.fillStyle = cssVar('--muted'); x.fillText(String(k), W - R + 36, y0 + hh / (mx + 1) / 2 + 4);
  }
  x.strokeStyle = cssVar('--line'); x.strokeRect(W - R + 14, T, 16, hh);
}

// ------------------------------------------------------------------ animation
function initAnimation() {
  const sl = $('animTime'); sl.max = Math.round(RESULT.last.T); sl.value = 0; ANIM.t = 0;
  drawAnimation(0);
}
function posAt(leg, t) {
  const p = leg.pts;
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i][0]) { const [t0, x0] = p[i - 1], [t1, x1] = p[i]; return t1 > t0 ? x0 + (x1 - x0) * (t - t0) / (t1 - t0) : x1; }
  }
  return p[p.length - 1][1];
}
function tideAt(t) { const td = RESULT.last.tide; const i = Math.min(td.level.length - 1, Math.max(0, Math.round(t / 15))); return td.level[i]; }
function drawAnimation(t) {
  if (!RESULT) return;
  ANIM.t = t;
  const cv = $('animCanvas'); const W = cv.parentElement.clientWidth || 900, H = 380, dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
  const C = SERIES(), ink = cssVar('--ink'), muted = cssVar('--muted'), line = cssVar('--line');
  const det = RESULT.last, segs = det.segments, Lkm = Math.max(...segs.map((s) => s.End_km));
  const X0 = 120, X1 = W - 30, Y = 190, half = 32;
  const px = (km) => X0 + (X1 - X0) * km / Lkm;
  const dmin = Math.min(...segs.map((s) => s.Depth_CD_m)), dmax = Math.max(...segs.map((s) => s.Depth_CD_m));
  // segments (depth shading)
  segs.forEach((s) => {
    const q = dmax > dmin ? (s.Depth_CD_m - dmin) / (dmax - dmin) : 0.5;
    const c0 = [207, 227, 243], c1 = [44, 106, 160]; const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * q));
    x.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; x.fillRect(px(s.Start_km), Y - half, px(s.End_km) - px(s.Start_km), 2 * half);
    x.fillStyle = ink; x.font = '600 11px ' + cssVar('--mono');
    x.fillText(s.SegmentID, px(s.Start_km) + 4, Y + half + 13);
    x.fillStyle = muted; x.font = '10px ' + cssVar('--mono');
    x.fillText(`${fmt(s.Depth_CD_m, 1)} m${s.SpeedLimit_kn ? ' · ' + fmt(s.SpeedLimit_kn, 0) + ' kn' : ''}`, px(s.Start_km) + 26, Y + half + 13);
    if (!s.AllowMeet) { x.fillStyle = C[7]; x.fillText('no meeting', px(s.Start_km) + 4, Y + half + 26); }
    x.strokeStyle = 'rgba(255,255,255,.7)'; x.beginPath(); x.moveTo(px(s.Start_km), Y - half); x.lineTo(px(s.Start_km), Y + half); x.stroke();
  });
  x.setLineDash([6, 6]); x.strokeStyle = 'rgba(255,255,255,.8)'; x.beginPath(); x.moveTo(X0, Y); x.lineTo(X1, Y); x.stroke(); x.setLineDash([]);
  // km axis
  x.fillStyle = muted; x.font = '10px ' + cssVar('--mono');
  for (let k = 0; k <= Lkm; k += Lkm > 40 ? 10 : 5) { x.fillText(k + ' km', px(k) - 10, H - 8); x.fillRect(px(k), H - 22, 1, 5); }
  // ships state at t
  const ships = det.ships;
  const atBerth = {}, turning = {}; let anchor = 0, moving = 0;
  ships.forEach((s) => {
    if (s.atBerth != null && s.atBerth <= t && (s.leftBerth == null ? (s.status !== 0 ? false : true) : t < s.leftBerth)) (atBerth[s.berth] = atBerth[s.berth] || []).push(s);
    if (s.turnStart != null && s.turnStart <= t && t < s.turnEnd) (turning[s.tb] = turning[s.tb] || []).push(s);
    const leaveAnch = s.startIn != null ? s.startIn : (s.status === 0 ? Infinity : s.arrival);
    if (s.arrival <= t && t < leaveAnch) anchor++;
  });
  // turning basins: drawn ON the fairway (a basin is a widened part of the channel)
  const tbs = (RESULT._input.TURNING_BASINS || []).filter((b) => num(b.Active, 1) !== 0);
  tbs.forEach((b) => {
    const bx = px(num(b.Pos_km)), act = (turning[b.TurningBasinID] || []).length, blocks = num(b.BlocksChannel, 0) !== 0;
    if (act && blocks) { // fairway closed in the segment(s) containing the basin while the ship turns
      segs.filter((g) => g.Start_km - 1e-9 <= num(b.Pos_km) && num(b.Pos_km) <= g.End_km + 1e-9).forEach((g) => {
        x.fillStyle = 'rgba(201,42,42,.28)'; x.fillRect(px(g.Start_km), Y - half, px(g.End_km) - px(g.Start_km), 2 * half);
        x.fillStyle = C[7]; x.font = '600 10px ' + cssVar('--sans'); x.fillText('closed: turning', px(g.Start_km) + 4, Y - half + 12);
      });
    }
    x.beginPath(); x.ellipse(bx, Y, 15, half + 10, 0, 0, 2 * Math.PI);
    x.fillStyle = act ? C[6] + '66' : C[6] + '22'; x.fill();
    x.setLineDash(blocks ? [] : [4, 3]); x.lineWidth = 2; x.strokeStyle = C[6]; x.stroke(); x.setLineDash([]);
    if (act) { x.save(); x.translate(bx, Y); x.rotate((t / 6) % (2 * Math.PI)); x.fillStyle = C[6]; x.fillRect(-2, -14, 4, 13); x.restore(); }
    x.fillStyle = C[6]; x.font = '600 10px ' + cssVar('--mono'); x.fillText(b.TurningBasinID, bx - 11, Y + half + 40);
  });
  // berths: all on the quay line (upper bank) at their true km; only labels are staggered when crowded
  const berths = (RESULT._input.BERTHS || []).filter((b) => num(b.Active, 1) !== 0).sort((a, b) => num(a.Pos_km) - num(b.Pos_km));
  const quayY = Y - half - 2, bw = 12, bh = 14;
  x.strokeStyle = muted; x.lineWidth = 2; x.beginPath(); x.moveTo(X0, quayY); x.lineTo(X1, quayY); x.stroke();
  let labelEnd = [-1e9, -1e9, -1e9];
  x.font = '600 10px ' + cssVar('--mono');
  berths.forEach((b) => {
    const bx = px(num(b.Pos_km)), occ = (atBerth[b.BerthID] || []).length, cap = Math.max(1, num(b.Capacity, 1));
    const by = quayY - bh;
    x.fillStyle = cssVar('--panel'); x.fillRect(bx - bw / 2, by, bw, bh);
    x.strokeStyle = C[0]; x.lineWidth = 1.5; x.strokeRect(bx - bw / 2, by, bw, bh);
    const f = Math.min(1, occ / cap); x.fillStyle = C[0]; x.fillRect(bx - bw / 2, by + bh * (1 - f), bw, bh * f);
    const label = b.BerthID + (occ ? ` ·${occ}` : ''), w = x.measureText(label).width;
    let lvl = labelEnd.findIndex((e) => bx - w / 2 > e + 4); if (lvl < 0) lvl = 2;
    labelEnd[lvl] = bx + w / 2;
    const ly = by - 5 - lvl * 14;
    if (lvl > 0) { x.strokeStyle = line; x.lineWidth = 1; x.beginPath(); x.moveTo(bx, by); x.lineTo(bx, ly + 2); x.stroke(); }
    x.fillStyle = ink; x.fillText(label, bx - w / 2, ly);
  });
  // moving ships
  const colorOf = (m) => (m === 'transit' ? C[1] : m === 'turn_only' ? C[3] : C[2]);
  ships.forEach((s) => {
    const leg = s.legs.find((l) => t >= l.start && t < l.end); if (!leg) return;
    moving++;
    const xx = px(posAt(leg, t)), yy = leg.dir > 0 ? Y - 13 : Y + 13, dir = leg.dir > 0 ? 1 : -1;
    const len = Math.max(9, Math.min(18, s.loa / 14));
    x.beginPath(); x.moveTo(xx + dir * len / 2, yy); x.lineTo(xx - dir * len / 2, yy - 5); x.lineTo(xx - dir * len / 2, yy + 5); x.closePath();
    x.fillStyle = colorOf(s.movement); x.fill(); x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 0.8; x.stroke();
    x.fillStyle = '#0f2233'; x.font = '9px ' + cssVar('--mono'); x.fillText(String(s.id), xx - 6, leg.dir > 0 ? yy - 8 : yy + 15);
  });
  // anchorage
  x.fillStyle = cssVar('--panel-2'); x.strokeStyle = line; x.lineWidth = 1;
  x.fillRect(12, Y - 60, 88, 120); x.strokeRect(12, Y - 60, 88, 120);
  x.fillStyle = ink; x.font = '600 11px ' + cssVar('--sans'); x.fillText('Anchorage', 20, Y - 44);
  for (let i = 0; i < Math.min(anchor, 30); i++) { x.beginPath(); x.arc(24 + (i % 6) * 13, Y - 28 + Math.floor(i / 6) * 13, 4, 0, 2 * Math.PI); x.fillStyle = C[5]; x.fill(); }
  x.fillStyle = ink; x.font = '600 18px ' + cssVar('--mono'); x.fillText(String(anchor), 20, Y + 52);
  x.strokeStyle = line; x.beginPath(); x.moveTo(100, Y); x.lineTo(X0, Y); x.stroke();
  // HUD: clock, tide, closures
  const tide = tideAt(t);
  x.fillStyle = ink; x.font = '600 12px ' + cssVar('--mono');
  x.fillText(`Tide ${tide >= 0 ? '+' : ''}${fmt(tide, 2)} m`, X1 - 120, 18);
  x.fillText(`In channel ${moving}`, X1 - 120, 36);
  const closed = (det.closures || []).some((c) => c[0] <= t && t < c[1]);
  if (closed) { x.fillStyle = C[7]; x.font = '600 12px ' + cssVar('--sans'); x.fillText('⚠ Channel closed — weather', X0, 22); }
  if (det.dayWindow) { const h = (t % 1440); if (h < det.dayWindow[0] || h >= det.dayWindow[1]) { x.fillStyle = muted; x.font = '12px ' + cssVar('--sans'); x.fillText('Night — daylight-only ships held', X0, 40); } }
  $('animClock').textContent = fmtClock(t);
  $('animTime').value = Math.round(t);
}
function playLoop() {
  if (!ANIM.playing) return;
  const step = num($('animSpeed').value, 5);
  let t = ANIM.t + step; if (t > RESULT.last.T) t = 0;
  drawAnimation(t);
  ANIM.raf = requestAnimationFrame(playLoop);
}
function togglePlay() {
  if (!RESULT) return;
  ANIM.playing = !ANIM.playing; $('playBtn').textContent = ANIM.playing ? '❚❚ Pause' : '▶ Play';
  if (ANIM.playing) playLoop(); else cancelAnimationFrame(ANIM.raf);
}

// ------------------------------------------------------------------ vessels
const VES_COLS = [
  { key: 'id', label: 'ID', sortable: true }, { key: 'className', label: 'Class', txt: true, sortable: true },
  { key: 'movement', label: 'Movement', txt: true, sortable: true }, { key: 'berth', label: 'Berth', txt: true, sortable: true },
  { key: 'tb', label: 'TB', txt: true, sortable: true }, { key: 'arrival', label: 'Arrival', fmt: (x) => fmtClock(x), sortable: true },
  { key: 'statusText', label: 'Status', sortable: true, fmt: (x) => `<span class="pill ${x === 'served' || x === 'completed_transit' ? 'ok' : x === 'pending' ? 'info' : 'bad'}">${esc(x)}</span>` },
  { key: 'waitTotal', label: 'Wait total (h)', fmt: (x) => fmtH(x), sortable: true },
  ...WAITS.map(([k, l]) => ({ key: k, label: l + ' (h)', fmt: (x) => (x > 0.01 ? fmtH(x) : '·'), sortable: true })),
  { key: 'service', label: 'Service (h)', fmt: (x) => (x ? fmtH(x) : '·'), sortable: true },
  { key: 'turnaround', label: 'Turnaround (h)', fmt: (x) => fmtH(x), sortable: true },
];
function renderVessels() {
  const ships = RESULT.last.ships;
  const fill = (id, vals) => { const s = $(id); const cur = s.value; s.innerHTML = '<option value="">All</option>' + vals.map((v) => `<option>${esc(v)}</option>`).join(''); s.value = vals.includes(cur) ? cur : ''; };
  fill('fStat', [...new Set(ships.map((s) => s.statusText))]);
  fill('fCls', [...new Set(ships.map((s) => s.className))]);
  drawVesselTable();
}
function filteredShips() {
  const m = $('fMov').value, st = $('fStat').value, c = $('fCls').value;
  return RESULT.last.ships.filter((s) => (!m || s.movement === m) && (!st || s.statusText === st) && (!c || s.className === c));
}
function drawVesselTable() {
  if (!RESULT) return;
  const rows = filteredShips().slice().sort((a, b) => {
    const k = VES_SORT.key, va = a[k], vb = b[k];
    if (va == null) return 1; if (vb == null) return -1;
    return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))) * VES_SORT.dir;
  });
  $('tVes').innerHTML = table(VES_COLS, rows, { sort: VES_SORT });
  $('vesCount').textContent = `${rows.length} of ${RESULT.last.ships.length} ships`;
}

// ------------------------------------------------------------------ capacity
async function runCapacity() {
  busy(true); setStatus(await backendLabel());
  const body = { input: INPUT, lambda_min: num($('capMin').value), lambda_max: num($('capMax').value), steps: Math.round(num($('capSteps').value, 8)),
    nReps: Math.round(num($('capReps').value, 10)), criterion: $('capCrit').value, threshold: num($('capThr').value) };
  try {
    const d = await apiCall('/api/capacity', 'POST', body, 600000);
    CAP = d.result; CAP._label = INPUT_LABEL;
    renderCapacity();
    setStatus(`Capacity sweep done (${CAP.points.length} points × ${CAP.nReps} reps, ${fmt(CAP.elapsed_s, 1)} s).`, 'ok');
  } catch (e) { setStatus('Capacity sweep failed: ' + e.message, 'err'); toast(e.message); }
  finally { busy(false); }
}
function renderCapacity() {
  $('capEmpty').hidden = true; $('capBody').hidden = false;
  const C = SERIES(), P = CAP.points, pr = CAP.practical, ul = CAP.ultimate;
  const critName = { congestion_wait_hr: 'congestion wait', avg_wait_hr: 'total wait', waiting_factor: 'waiting factor', pending_pct: 'not completed %' }[CAP.criterion];
  $('capKpis').innerHTML = [
    kpiTile('Practical capacity λ*', pr ? pr.lambda : null, null, 'ships/h', 3, 'accent'),
    kpiTile('Throughput at λ*', pr ? pr.shipsPerDay : null, null, 'ships/day', 2, 'accent'),
    kpiTile('DWT throughput at λ*', pr ? pr.dwtPerDay : null, null, 't/day', 0),
    kpiTile('Ultimate (saturation) throughput', ul.shipsPerDay, null, 'ships/day', 2),
  ].join('') + `<p class="hint" style="grid-column:1/-1">Criterion: ${esc(critName)} ≤ ${fmt(CAP.threshold, 2)}. ${pr ? (pr.limitedBySweep ? 'Criterion still met at the end of the sweep — extend λ to find the real limit.' : '') : 'Criterion already violated at the lowest λ — lower λ from or relax the threshold.'}</p>`;
  const key = { congestion_wait_hr: ['congestionWaitHr', 'congestionWaitHrCI'], avg_wait_hr: ['avgWaitHr', 'avgWaitHrCI'], waiting_factor: ['waitingFactor', null], pending_pct: ['pendingPct', null] }[CAP.criterion];
  const xy = (f) => P.map((p) => ({ x: p.lambda, y: p[f] }));
  const ds = [
    { label: 'Congestion wait (h)', data: xy('congestionWaitHr'), borderColor: C[0], backgroundColor: C[0], pointRadius: 3, borderWidth: 2 },
    { label: 'Total wait (h)', data: xy('avgWaitHr'), borderColor: C[5], backgroundColor: C[5], pointRadius: 2, borderDash: [4, 3], borderWidth: 1.5 },
  ];
  if (key[1]) {
    ds.push({ label: 'CI+', data: P.map((p) => ({ x: p.lambda, y: p[key[0]] + (p[key[1]] || 0) })), borderColor: 'transparent', pointRadius: 0, fill: '+1', backgroundColor: C[0] + '22' });
    ds.push({ label: 'CI-', data: P.map((p) => ({ x: p.lambda, y: Math.max(0, p[key[0]] - (p[key[1]] || 0)) })), borderColor: 'transparent', pointRadius: 0, fill: false });
  }
  if (!['congestion_wait_hr', 'avg_wait_hr'].includes(CAP.criterion)) ds.push({ label: critName, data: xy(key[0]), borderColor: C[2], backgroundColor: C[2], pointRadius: 3, yAxisID: 'y2' });
  const thrOnMain = ['congestion_wait_hr', 'avg_wait_hr'].includes(CAP.criterion);
  mkChart('cCapWait', {
    type: 'line', data: { datasets: ds },
    options: { parsing: false, plugins: { legend: { labels: { filter: (i) => !i.text.startsWith('CI') } },
      refLines: { h: thrOnMain ? [{ y: CAP.threshold, color: C[7], label: `threshold ${CAP.threshold} h` }] : [], v: pr ? [{ x: pr.lambda, color: C[2], label: `λ* = ${fmt(pr.lambda, 3)}` }] : [] } },
      scales: { x: { type: 'linear', title: { display: true, text: 'arrival rate λ (ships/h)' } }, y: { beginAtZero: true, title: { display: true, text: 'hours per ship' } },
        ...(thrOnMain ? {} : { y2: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: critName } } }) } },
  });
  mkChart('cCapThr', {
    type: 'line',
    data: { datasets: [
      { label: 'Throughput (ships/day)', data: xy('throughputPerDay'), borderColor: C[1], backgroundColor: C[1], pointRadius: 3, borderWidth: 2 },
      { label: 'CI+', data: P.map((p) => ({ x: p.lambda, y: p.throughputPerDay + (p.throughputPerDayCI || 0) })), borderColor: 'transparent', pointRadius: 0, fill: '+1', backgroundColor: C[1] + '22' },
      { label: 'CI-', data: P.map((p) => ({ x: p.lambda, y: p.throughputPerDay - (p.throughputPerDayCI || 0) })), borderColor: 'transparent', pointRadius: 0, fill: false },
      { label: 'Offered demand (ships/day)', data: xy('shipsPerDayOffered'), borderColor: C[5], borderDash: [5, 4], pointRadius: 0, borderWidth: 1.3 },
    ] },
    options: { parsing: false, plugins: { legend: { labels: { filter: (i) => !i.text.startsWith('CI') } }, refLines: { v: pr ? [{ x: pr.lambda, color: C[2], label: 'practical capacity' }] : [] } },
      scales: { x: { type: 'linear', title: { display: true, text: 'arrival rate λ (ships/h)' } }, y: { beginAtZero: true, title: { display: true, text: 'ships / day' } } } },
  });
  $('tCap').innerHTML = table([
    { key: 'lambda', label: 'λ (ships/h)', fmt: (x) => fmt(x, 3) }, { key: 'shipsPerDayOffered', label: 'Offered/day', fmt: (x) => fmt(x, 1) },
    { key: 'throughputPerDay', label: 'Throughput/day', fmt: (x, r) => `${fmt(x, 2)} ± ${fmt(r.throughputPerDayCI, 2)}` },
    { key: 'dwtPerDay', label: 'DWT/day', fmt: (x) => fmt(x, 0) },
    { key: 'congestionWaitHr', label: 'Congestion wait (h)', fmt: (x, r) => `${fmt(x, 2)} ± ${fmt(r.congestionWaitHrCI, 2)}` },
    { key: 'avgWaitHr', label: 'Total wait (h)', fmt: (x) => fmt(x, 2) }, { key: 'p90WaitHr', label: 'P90 wait (h)', fmt: (x) => fmt(x, 1) },
    { key: 'waitingFactor', label: 'Waiting factor', fmt: (x) => fmt(x, 3) }, { key: 'avgQueue', label: 'Mean queue', fmt: (x) => fmt(x, 2) },
    { key: 'maxBerthOcc', label: 'Max berth occ.', fmt: (x) => pct(x) }, { key: 'maxSegUtil', label: 'Max segment util.', fmt: (x) => pct(x) },
    { key: 'pendingPct', label: 'Not completed %', fmt: (x) => fmt(x, 1) },
  ], P);
}

// ------------------------------------------------------------------ input editor (safe DOM, no raw HTML from data)
function populateSheets() {
  const s = $('sheetSelect'); const cur = s.value;
  s.innerHTML = [...KV_SHEETS, ...TABLE_SHEETS].map((k) => `<option value="${k}">${k}</option>`).join('');
  s.value = cur && [...KV_SHEETS, ...TABLE_SHEETS].includes(cur) ? cur : 'SHIP_CLASSES';
  renderInputTable();
}
function renderInputTable() {
  const key = $('sheetSelect').value, v = INPUT[key], root = $('inputTable');
  root.innerHTML = '';
  const tbl = document.createElement('table'); tbl.className = 'edit'; tbl.dataset.sheet = key;
  const thead = tbl.createTHead().insertRow(); const tb = tbl.createTBody();
  const cell = (row, val, attrs) => { const td = row.insertCell(); const inp = document.createElement('input'); inp.value = val == null ? '' : String(val); Object.assign(inp.dataset, attrs); td.appendChild(inp); return td; };
  const delBtn = (row) => { const td = row.insertCell(); td.className = 'del'; const b = document.createElement('button'); b.type = 'button'; b.title = 'Delete row'; b.textContent = '×'; b.onclick = () => row.remove(); td.appendChild(b); };
  if (Array.isArray(v)) {
    const cols = [...new Set((v.length ? v : [{}]).flatMap(Object.keys))];
    cols.forEach((c) => { const th = document.createElement('th'); th.textContent = c; thead.appendChild(th); });
    thead.appendChild(document.createElement('th'));
    v.forEach((r) => { const row = tb.insertRow(); cols.forEach((c) => cell(row, r[c], { col: c })); delBtn(row); });
    tbl.dataset.cols = JSON.stringify(cols);
    $('sheetHint').textContent = `${v.length} rows. Use Active = 0 to disable a row without deleting it.`;
  } else {
    ['Param', 'Value'].forEach((c) => { const th = document.createElement('th'); th.textContent = c; thead.appendChild(th); });
    thead.appendChild(document.createElement('th'));
    Object.entries(v || {}).forEach(([k, x]) => { const row = tb.insertRow(); cell(row, k, { role: 'k' }); cell(row, x, { role: 'v' }); delBtn(row); });
    $('sheetHint').textContent = 'Key/value sheet. Unknown parameters are ignored by the engine.';
  }
  root.appendChild(tbl);
}
function addRow() {
  const tbl = $('inputTable').querySelector('table'); if (!tbl) return;
  const row = tbl.tBodies[0].insertRow();
  const mk = (attrs) => { const td = row.insertCell(); const inp = document.createElement('input'); Object.assign(inp.dataset, attrs); td.appendChild(inp); };
  if (tbl.dataset.cols) JSON.parse(tbl.dataset.cols).forEach((c) => mk({ col: c })); else { mk({ role: 'k' }); mk({ role: 'v' }); }
  const td = row.insertCell(); td.className = 'del'; const b = document.createElement('button'); b.type = 'button'; b.textContent = '×'; b.onclick = () => row.remove(); td.appendChild(b);
}
function parseCell(s) { s = String(s).trim(); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : s; }
function applySheet() {
  const tbl = $('inputTable').querySelector('table'); if (!tbl) return; const key = tbl.dataset.sheet;
  if (tbl.dataset.cols) {
    INPUT[key] = [...tbl.tBodies[0].rows].map((tr) => { const o = {}; tr.querySelectorAll('input[data-col]').forEach((i) => { o[i.dataset.col] = parseCell(i.value); }); return o; })
      .filter((o) => Object.values(o).some((x) => x != null));
  } else {
    const o = {}; [...tbl.tBodies[0].rows].forEach((tr) => { const k = tr.querySelector('[data-role=k]').value.trim(); if (k) o[k] = parseCell(tr.querySelector('[data-role=v]').value); });
    INPUT[key] = o;
  }
  syncControls(); renderInputTable(); setStatus(`${key} updated.`, 'ok');
}

// ------------------------------------------------------------------ scenarios
const SCN_KEYS = ['throughputPerDay', 'dwtPerDay', 'avgTurn', 'avgWait', 'avgCongestionWait', 'avgEnvWait', 'avgWaitTide', 'avgWaitBerth', 'avgWaitTraffic', 'avgWaitTurning', 'waitingFactor', 'avgQueue', 'rejectedPct', 'pendingPct'];
const HIGHER_BETTER = new Set(['throughputPerDay', 'dwtPerDay']);
const SCN_STORE = 'cc_v6_scenarios';
function loadScenarios() { try { SCENARIOS = JSON.parse(localStorage.getItem(SCN_STORE)) || []; } catch (e) { SCENARIOS = []; } }
function storeScenarios() { try { localStorage.setItem(SCN_STORE, JSON.stringify(SCENARIOS)); } catch (e) {} }
function inputDiff(base, cur) {
  // human-readable list of parameters that differ from the base run
  if (!base) return [];
  const out = [];
  const show = (v) => (v == null || v === '' ? '–' : String(v));
  for (const sh of KV_SHEETS) {
    const a = base[sh] || {}, b = cur[sh] || {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (show(a[k]) !== show(b[k])) out.push(`${sh}.${k}: ${show(a[k])} → ${show(b[k])}`);
  }
  for (const sh of TABLE_SHEETS) {
    const a = base[sh] || [], b = cur[sh] || [];
    if (a.length !== b.length) { out.push(`${sh}: ${a.length} → ${b.length} rows`); continue; }
    a.forEach((ra, i) => {
      const rb = b[i] || {};
      const id = ra.SegmentID || ra.BerthID || ra.TurningBasinID || ra.ClassName || ra.MovementType || ra.Name || `row ${i + 1}`;
      for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) if (show(ra[k]) !== show(rb[k])) out.push(`${sh}[${id}].${k}: ${show(ra[k])} → ${show(rb[k])}`);
    });
  }
  return out;
}
function addScenarioFromResult() {
  if (!RESULT) return;
  const n = SCENARIOS.length + 1;
  SCENARIOS.push({ name: `Run ${n}`, meta: RESULT.meta, summary: Object.fromEntries(SCN_KEYS.map((k) => [k, RESULT.summary[k]])),
    input: clone(RESULT._input), capacity: null, label: RESULT._label, at: new Date().toLocaleString(), base: SCENARIOS.length === 0 });
  if (SCENARIOS.length > 12) SCENARIOS.shift();
  if (!SCENARIOS.some((x) => x.base)) SCENARIOS[0].base = true;
  storeScenarios(); renderScenarios();
}
function saveScenario() { // rename latest run
  if (!SCENARIOS.length) { toast('Run the simulation first.'); return; }
  const name = ($('scnName').value || '').trim(); if (!name) { toast('Type a name first.'); return; }
  SCENARIOS[SCENARIOS.length - 1].name = name; $('scnName').value = ''; storeScenarios(); renderScenarios(); toast(`Latest run renamed to "${name}".`);
}
function renderScenarios() {
  const has = SCENARIOS.length > 0; $('scnEmpty').hidden = has; $('scnBody').hidden = !has; if (!has) return;
  const base = SCENARIOS.find((x) => x.base) || SCENARIOS[0];
  let h = '<table><thead><tr><th>KPI</th>' + SCENARIOS.map((s, i) =>
    `<th>${s === base ? '★ ' : `<button class="link" data-act="base" data-i="${i}" title="Use as base">☆</button> `}${esc(s.name)} <button class="link" data-act="del" data-i="${i}" title="Remove">×</button></th>`).join('') + '</tr></thead><tbody>';
  h += '<tr><td class="txt">Run time · input</td>' + SCENARIOS.map((s) => `<td class="txt">${esc(s.at)}<br>${esc(s.label)}</td>`).join('') + '</tr>';
  h += '<tr><td class="txt">λ (ships/h) · reps · days</td>' + SCENARIOS.map((s) => `<td>${fmt(s.meta.lambda_total_hr, 2)} · ${s.meta.nReps} · ${fmt(s.meta.days, 1)}</td>`).join('') + '</tr>';
  h += '<tr><td class="txt">Changes vs base</td>' + SCENARIOS.map((s) => {
    if (s === base) return '<td class="txt"><span class="pill info">base</span></td>';
    const d = inputDiff(base.input, s.input);
    return `<td class="txt diff">${d.length ? d.slice(0, 8).map(esc).join('<br>') + (d.length > 8 ? `<br>… +${d.length - 8} more` : '') : '<span class="hint">same input (different seed/random only)</span>'}</td>`;
  }).join('') + '</tr>';
  SCN_KEYS.forEach((k) => {
    const [lab, unit, sc, d] = KPI_META[k];
    h += `<tr><td class="txt">${esc(lab)} (${esc(unit)})</td>` + SCENARIOS.map((s) => {
      const m = s.summary[k] && s.summary[k].mean, ci = s.summary[k] && s.summary[k].ci95, b = base.summary[k] && base.summary[k].mean;
      let delta = '';
      if (s !== base && isNum(m) && isNum(b) && Math.abs(b) > 1e-9) {
        const dp = 100 * (m - b) / Math.abs(b);
        const good = HIGHER_BETTER.has(k) ? dp > 0 : dp < 0;
        delta = Math.abs(dp) < 0.05 ? ' <span class="hint">±0%</span>' : ` <span class="${good ? 'delta-down' : 'delta-up'}">${dp > 0 ? '+' : ''}${fmt(dp, 1)}%</span>`;
      }
      return `<td>${fmt(isNum(m) ? m * sc : null, d)}${isNum(ci) ? `<span class="hint"> ±${fmt(ci * sc, d)}</span>` : ''}${delta}</td>`;
    }).join('') + '</tr>';
  });
  $('tScn').innerHTML = h + '</tbody></table>';
  const C = SERIES(), labels = SCENARIOS.map((s) => s.name);
  const val = (s, k, sc = 1) => (s.summary[k] && isNum(s.summary[k].mean) ? s.summary[k].mean * sc : null);
  mkChart('cScn', {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Throughput (ships/day)', data: SCENARIOS.map((s) => val(s, 'throughputPerDay')), backgroundColor: C[1], borderRadius: 4, yAxisID: 'y' },
      { label: 'Congestion wait (h)', data: SCENARIOS.map((s) => val(s, 'avgCongestionWait', 1 / 60)), backgroundColor: C[0], borderRadius: 4, yAxisID: 'y2' },
      { label: 'Environmental wait (h)', data: SCENARIOS.map((s) => val(s, 'avgEnvWait', 1 / 60)), backgroundColor: C[3], borderRadius: 4, yAxisID: 'y2' },
    ] },
    options: { scales: { y: { beginAtZero: true, title: { display: true, text: 'ships / day' } }, y2: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: 'hours per ship' } }, x: { grid: { display: false } } } },
  });
}
function scenarioCSV() {
  const rows = SCN_KEYS.map((k) => { const [lab, unit, sc] = KPI_META[k]; const r = { KPI: lab, Unit: unit }; SCENARIOS.forEach((s) => { const m = s.summary[k] && s.summary[k].mean; r[s.name] = isNum(m) ? m * sc : ''; }); return r; });
  const base = SCENARIOS.find((x) => x.base) || SCENARIOS[0];
  const ch = { KPI: 'Changes vs base', Unit: '' }; SCENARIOS.forEach((s) => { ch[s.name] = s === base ? 'base' : inputDiff(base.input, s.input).join('; '); });
  return toCSV([ch, ...rows]);
}

// ------------------------------------------------------------------ exports
function repRows() { return RESULT.reps.map((r, i) => ({ Replication: i + 1, ...r })); }
function exportExcel() {
  if (!RESULT) { toast('Run the simulation first.'); return; }
  if (typeof XLSX === 'undefined') { toast('SheetJS not loaded — use CSV/JSON.'); return; }
  const wb = XLSX.utils.book_new(); const add = (rows, name) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), name);
  const sum = Object.entries(RESULT.summary).map(([k, s]) => { const [lab, unit, sc] = KPI_META[k] || [k, '', 1]; const f = (v) => (v == null ? null : v * sc); return { KPI: lab, Key: k, Unit: unit, Mean: f(s.mean), SD: f(s.sd), CI95: f(s.ci95), Min: f(s.min), Max: f(s.max), N: s.n }; });
  add([{ Item: 'Input', Value: RESULT._label }, ...Object.entries(RESULT.meta).map(([Item, Value]) => ({ Item, Value }))], 'Run');
  add(sum, 'Summary'); add(repRows(), 'Replications'); add(RESULT.classes, 'Classes'); add(RESULT.berths, 'Berths'); add(RESULT.basins, 'TurningBasins');
  add(RESULT.last.segments.map((s, j) => ({ ...s, Utilisation: RESULT.segUtil[j], PassagesPerDay: RESULT.segPassPerDay[j], DWTPassagesPerDay: RESULT.segDWTPerDay[j], MaxShips_lastRep: RESULT.last.occ.maxSeg[j] })), 'Segments');
  add(RESULT.last.ships.map(({ legs, ...s }) => s), 'Vessels_lastRep');
  if (RESULT.validation) add(RESULT.validation.feasibility || [], 'DepthFeasibility');
  if (CAP) add(CAP.points, 'CapacitySweep');
  const iw = inputWorkbook(); iw.SheetNames.forEach((n) => XLSX.utils.book_append_sheet(wb, iw.Sheets[n], ('IN_' + n).slice(0, 31)));
  XLSX.writeFile(wb, 'ChannelCapacity_V6_results.xlsx');
}

// ------------------------------------------------------------------ wiring
function wire() {
  document.querySelectorAll('.nav').forEach((n) => n.addEventListener('click', () => switchTab(n.dataset.tab)));
  document.addEventListener('change', onBindChange);
  $('runBtn').onclick = runSimulation;
  $('validateBtn').onclick = () => validateInput(false);
  $('loadBtn').onclick = loadFile;
  $('xlsxFile').onchange = () => { const f = $('xlsxFile').files[0]; $('fileName').textContent = f ? f.name : 'Choose .xlsx or .json…'; };
  $('resetBtn').onclick = resetDemo;
  $('tplBtn').onclick = () => { if (typeof XLSX === 'undefined') return toast('SheetJS not loaded.'); XLSX.writeFile(inputWorkbook(), 'INPUT_template_V6.xlsx'); };
  $('inJsonBtn').onclick = () => download('INPUT_V6.json', JSON.stringify(INPUT, null, 1), 'application/json');
  $('xlsxOutBtn').onclick = exportExcel;
  $('csvOutBtn').onclick = () => RESULT ? download('Replications_V6.csv', toCSV(repRows()), 'text/csv') : toast('Run first.');
  $('jsonOutBtn').onclick = () => RESULT ? download('ChannelCapacity_V6_result.json', JSON.stringify({ input: RESULT._input, meta: RESULT.meta, summary: RESULT.summary, replications: RESULT.reps, classes: RESULT.classes, berths: RESULT.berths, basins: RESULT.basins, capacity: CAP }, null, 1), 'application/json') : toast('Run first.');
  $('capBtn').onclick = runCapacity;
  ['capMin', 'capMax', 'capSteps', 'capReps'].forEach((id) => $(id).addEventListener('input', updateExpected));
  $('capCrit').onchange = () => { $('capThr').value = { congestion_wait_hr: 2, avg_wait_hr: 6, waiting_factor: 0.3, pending_pct: 10 }[$('capCrit').value]; };
  $('playBtn').onclick = togglePlay;
  $('animTime').addEventListener('input', (e) => drawAnimation(+e.target.value));
  ['fMov', 'fStat', 'fCls'].forEach((id) => $(id).addEventListener('change', drawVesselTable));
  $('tVes').addEventListener('click', (e) => { const th = e.target.closest('th.sortable'); if (!th) return; const k = th.dataset.key; VES_SORT = { key: k, dir: VES_SORT.key === k ? -VES_SORT.dir : 1 }; drawVesselTable(); });
  $('vesCsvBtn').onclick = () => RESULT ? download('Vessels_lastRep_V6.csv', toCSV(filteredShips().map(({ legs, ...s }) => s)), 'text/csv') : toast('Run first.');
  $('sheetSelect').onchange = renderInputTable;
  $('addRowBtn').onclick = addRow;
  $('applySheetBtn').onclick = applySheet;
  $('scnSaveBtn').onclick = saveScenario;
  $('scnClearBtn').onclick = () => { if (confirm('Remove all saved runs?')) { SCENARIOS = []; storeScenarios(); renderScenarios(); } };
  $('scnCsvBtn').onclick = () => (SCENARIOS.length ? download('Scenario_comparison_V6.csv', scenarioCSV(), 'text/csv') : toast('No runs yet.'));
  $('tScn').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return; const i = +b.dataset.i;
    if (b.dataset.act === 'del') { const wasBase = SCENARIOS[i].base; SCENARIOS.splice(i, 1); if (wasBase && SCENARIOS.length) SCENARIOS[0].base = true; }
    else SCENARIOS.forEach((s, k) => { s.base = k === i; });
    storeScenarios(); renderScenarios();
  });
  let rz = 0; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (RESULT) { drawHeatmap(); drawAnimation(ANIM.t); } }, 150); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (RESULT) renderAll(); if (CAP) renderCapacity(); renderScenarios(); });
}

wire();
ensureDefaults();
syncControls();
populateSheets();
loadScenarios();
renderScenarios();
initBackend();
