'use strict';

const MIN = 60000;
const DAY = 1440;
const HIST_DAYS = 7;
const Z80 = 1.2816;
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const SYMBOLS = [
  { s: 'PAXGUSDT', g: 'ذهب', b: '🥇 ذهب', n: 'ذهب — أونصة بالدولار (PAXG)' },
  { s: 'XAUTUSDT', g: 'ذهب', b: '🥇 ذهب XAUT', n: 'ذهب — أونصة بالدولار (XAUT)' },
  { s: 'EURUSDT', g: 'عملات', b: '🇪🇺 يورو', n: 'يورو — سعر اليورو بالدولار' },
  { s: 'GBPUSDT', g: 'عملات', b: '🇬🇧 إسترليني', n: 'جنيه إسترليني — سعرو بالدولار' },
  { s: 'AUDUSDT', g: 'عملات', b: '🇦🇺 دولار أسترالي', n: 'دولار أسترالي — سعرو بالدولار الأميركي' },
  { s: 'USDTTRY', g: 'عملات', b: '🇹🇷 ليرة تركية', n: 'الدولار بالليرة التركية' },
  { s: 'USDTRUB', g: 'عملات', b: '🇷🇺 روبل', n: 'الدولار بالروبل الروسي' },
  { s: 'USDTBRL', g: 'عملات', b: '🇧🇷 ريال برازيلي', n: 'الدولار بالريال البرازيلي' },
  { s: 'USDTMXN', g: 'عملات', b: '🇲🇽 بيزو مكسيكي', n: 'الدولار بالبيزو المكسيكي' },
  { s: 'USDTARS', g: 'عملات', b: '🇦🇷 بيزو أرجنتيني', n: 'الدولار بالبيزو الأرجنتيني' },
  { s: 'USDTZAR', g: 'عملات', b: '🇿🇦 راند', n: 'الدولار بالراند الجنوب أفريقي' },
  { s: 'USDTPLN', g: 'عملات', b: '🇵🇱 زلوتي', n: 'الدولار بالزلوتي البولندي' },
  { s: 'USDTUAH', g: 'عملات', b: '🇺🇦 هريفنيا', n: 'الدولار بالهريفنيا الأوكرانية' },
  { s: 'USDTCZK', g: 'عملات', b: '🇨🇿 كورونا تشيكية', n: 'الدولار بالكورونا التشيكية' },
  { s: 'USDTCOP', g: 'عملات', b: '🇨🇴 بيزو كولومبي', n: 'الدولار بالبيزو الكولومبي' },
  { s: 'USDTIDR', g: 'عملات', b: '🇮🇩 روبية', n: 'الدولار بالروبية الإندونيسية' },
  { s: 'BTCUSDT', g: 'كريبتو', b: 'بيتكوين', n: 'بيتكوين (BTC) بالدولار' },
  { s: 'ETHUSDT', g: 'كريبتو', b: 'إيثيريوم', n: 'إيثيريوم (ETH) بالدولار' },
  { s: 'SOLUSDT', g: 'كريبتو', b: 'سولانا', n: 'سولانا (SOL) بالدولار' },
  { s: 'BNBUSDT', g: 'كريبتو', b: 'BNB', n: 'BNB بالدولار' },
  { s: 'XRPUSDT', g: 'كريبتو', b: 'ريبل', n: 'ريبل (XRP) بالدولار' },
];

const $ = id => document.getElementById(id);
const state = {
  sym: localStorage.getItem('fc:sym2') || 'PAXGUSDT',
  store: null,        // { start, c: [] } one close per minute, start aligned to local midnight
  model: null,        // seasonal model for the current day
  modelKey: '',
  hostIdx: 0,
  busy: false,
  filter: 'next',
  shownL: null,       // last index currently drawn (used for catch-up animation)
  lastSync: 0,
};

// ---------- time helpers ----------
const dayStartOf = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const hhmm = ts => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const lastClosedOpen = () => Math.floor(Date.now() / MIN) * MIN - MIN;

function fmt(p) {
  if (p == null || !isFinite(p)) return '—';
  const d = p >= 100 ? 2 : p >= 1 ? 4 : 6;
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
const pct = (x, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d) + '%';

// ---------- storage ----------
function loadStore(sym) {
  try { return JSON.parse(localStorage.getItem('fc:data:' + sym)); } catch { return null; }
}
function saveStore(sym, st) {
  try { localStorage.setItem('fc:data:' + sym, JSON.stringify(st)); }
  catch { // quota: drop other symbols' caches and retry
    for (const { s } of SYMBOLS) if (s !== sym) localStorage.removeItem('fc:data:' + s);
    try { localStorage.setItem('fc:data:' + sym, JSON.stringify(st)); } catch {}
  }
}

// ---------- data sync ----------
async function fetchKlines(sym, startTime, endTime) {
  let lastErr;
  for (let k = 0; k < HOSTS.length; k++) {
    const host = HOSTS[(state.hostIdx + k) % HOSTS.length];
    try {
      const url = `${host}/api/v3/klines?symbol=${sym}&interval=1m&startTime=${startTime}&endTime=${endTime}&limit=1000`;
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      state.hostIdx = (state.hostIdx + k) % HOSTS.length;
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Returns number of new minutes appended.
async function sync(onProgress) {
  const sym = state.sym;
  const from = dayStartOf(Date.now()) - HIST_DAYS * DAY * MIN;
  let st = state.store || loadStore(sym);
  if (!st || st.start > from || (st.start - from) % MIN !== 0 || (from - st.start) % (DAY * MIN) !== 0) st = { start: from, c: [] };
  if (st.start < from) {
    const drop = (from - st.start) / MIN;
    st = { start: from, c: st.c.slice(drop) };
  }
  const end = lastClosedOpen();
  let next = st.start + st.c.length * MIN;
  const total = Math.max(1, (end - next) / MIN + 1);
  let added = 0;
  while (next <= end) {
    const rows = await fetchKlines(sym, next, end);
    if (!rows.length) break;
    for (const k of rows) {
      const idx = Math.round((k[0] - st.start) / MIN);
      if (idx < st.c.length) continue;
      const close = +k[4];
      while (st.c.length < idx) st.c.push(st.c.length ? st.c[st.c.length - 1] : close);
      st.c.push(close);
      added++;
    }
    next = st.start + st.c.length * MIN;
    if (onProgress) onProgress(Math.min(1, added / total));
    if (rows.length < 1000) break;
    if (state.sym !== sym) throw new Error('switched');
  }
  if (state.sym !== sym) throw new Error('switched');
  state.store = st;
  saveStore(sym, st);
  return added;
}

// ---------- model ----------
// Seasonal (minute-of-day) volatility and mean from the 7 days before today's midnight,
// plus a 60-minute momentum coefficient estimated on the same history.
function buildModel(st, ds) {
  const mid = (ds - st.start) / MIN;
  const c = st.c;
  const sum = new Float64Array(DAY), sq = new Float64Array(DAY), n = new Float64Array(DAY);
  let gsq = 0, gn = 0;
  for (let i = 1; i < Math.min(mid, c.length); i++) {
    const r = Math.log(c[i] / c[i - 1]);
    if (!isFinite(r)) continue;
    const m = i % DAY;
    sum[m] += r; sq[m] += r * r; n[m]++;
    gsq += r * r; gn++;
  }
  const gVar = gn ? gsq / gn : 1e-8;
  const days = Math.max(1, gn / DAY);
  const smooth = (arr, w) => {
    const out = new Float64Array(DAY);
    for (let m = 0; m < DAY; m++) {
      let s = 0;
      for (let k = -w; k <= w; k++) s += arr[(m + k + DAY) % DAY];
      out[m] = s / (2 * w + 1);
    }
    return out;
  };
  const rawVar = new Float64Array(DAY), rawMu = new Float64Array(DAY);
  for (let m = 0; m < DAY; m++) {
    rawVar[m] = n[m] ? sq[m] / n[m] : gVar;
    rawMu[m] = n[m] ? sum[m] / n[m] : 0;
  }
  const sig2 = smooth(rawVar, 10);
  const lambda = days / (days + 30);
  const muS = smooth(rawMu, 30);
  const mu = muS.map(v => v * lambda);

  let sxy = 0, sxx = 0;
  for (let i = 120; i + 60 < Math.min(mid, c.length); i += 60) {
    const x = Math.log(c[i] / c[i - 60]), y = Math.log(c[i + 60] / c[i]);
    if (isFinite(x) && isFinite(y)) { sxy += x * y; sxx += x * x; }
  }
  const beta = sxx ? Math.max(-0.3, Math.min(0.3, sxy / sxx)) * 0.5 : 0;

  const pMu = new Float64Array(2 * DAY + 1), pVar = new Float64Array(2 * DAY + 1);
  for (let k = 0; k < 2 * DAY; k++) { pMu[k + 1] = pMu[k] + mu[k % DAY]; pVar[k + 1] = pVar[k] + sig2[k % DAY]; }
  return { mu, sig2, beta, pMu, pVar, mid, days: Math.round(days * 10) / 10 };
}

// Forecast for index a+h made with information up to index a (h >= 1, h <= DAY).
function pointForecast(model, c, a, h) {
  const P = c[a];
  const x60 = a >= 60 ? Math.log(c[a] / c[a - 60]) : 0;
  const s = (a + 1) % DAY;
  const cumMu = model.pMu[s + h] - model.pMu[s];
  const cumVar = model.pVar[s + h] - model.pVar[s];
  const mom = model.beta * x60 * (1 - Math.exp(-h / 60)) / (1 - Math.exp(-1));
  const m = Math.log(P) + cumMu + mom;
  const sd = Math.sqrt(cumVar);
  return { v: Math.exp(m), lo: Math.exp(m - Z80 * sd), hi: Math.exp(m + Z80 * sd) };
}

function ensureModel(ds) {
  const key = state.sym + ':' + ds;
  if (state.modelKey !== key) { state.model = buildModel(state.store, ds); state.modelKey = key; }
  return state.model;
}

// ---------- analysis for today ----------
function analyze(L) {
  const st = state.store, c = st.c;
  const ds = dayStartOf(Date.now());
  const model = ensureModel(ds);
  const mid = model.mid;
  const endIdx = mid + DAY - 1;
  L = Math.min(L, c.length - 1);
  const dayF = [], liveF = [], hourF = [];
  for (let j = 0; j < DAY; j++) {
    const idx = mid + j;
    dayF.push(mid >= 1 ? pointForecast(model, c, mid - 1, j + 1) : null);
    liveF.push(idx > L ? pointForecast(model, c, L, idx - L) : null);
    hourF.push(idx <= L && idx - 60 >= 0 ? pointForecast(model, c, idx - 60, 60) : null);
  }
  let eD = 0, inD = 0, nD = 0, eH = 0, inH = 0, nH = 0, dirOk = 0, dirN = 0;
  for (let j = 0; mid + j <= L; j++) {
    const act = c[mid + j];
    const d = dayF[j];
    if (d) { eD += Math.abs(act - d.v) / act; inD += act >= d.lo && act <= d.hi; nD++; }
    const h = hourF[j];
    if (h) {
      eH += Math.abs(act - h.v) / act; inH += act >= h.lo && act <= h.hi; nH++;
      const base = c[mid + j - 60];
      const sp = Math.sign(h.v - base), sa = Math.sign(act - base);
      if (sa !== 0 && sp !== 0) { dirN++; dirOk += sp === sa; }
    }
  }
  return {
    ds, mid, L, endIdx, dayF, liveF, hourF, model,
    acc: {
      day: nD ? { mape: 100 * eD / nD, band: 100 * inD / nD, n: nD } : null,
      hour: nH ? { mape: 100 * eH / nH, band: 100 * inH / nH, n: nH } : null,
      dir: dirN ? 100 * dirOk / dirN : null,
    },
  };
}

// ---------- rendering ----------
const cv = $('cv'), g = cv.getContext('2d');
let lastA = null;

function render(L) {
  if (!state.store || state.store.c.length < 2) return;
  if (state.store.c.length <= (dayStartOf(Date.now()) - state.store.start) / MIN) return;   // no data for today yet
  const A = analyze(L);
  lastA = A;
  const c = state.store.c;
  const price = c[A.L];
  const midPrice = A.mid >= 1 ? c[A.mid - 1] : c[0];
  const symInfo = SYMBOLS.find(x => x.s === state.sym);

  $('symName').textContent = symInfo ? symInfo.n : state.sym;
  $('price').textContent = fmt(price);
  const ch = 100 * (price / midPrice - 1);
  $('chg').textContent = pct(ch) + ' منذ منتصف الليل';
  $('chg').className = 'chg ' + (ch >= 0 ? 'up' : 'down');
  $('asof').textContent = 'سعر الدقيقة ' + hhmm(state.store.start + A.L * MIN);

  const last = A.liveF[DAY - 1];
  if (last) {
    $('eod').textContent = fmt(last.v);
    $('eodRange').textContent = fmt(last.lo) + ' — ' + fmt(last.hi);
  } else {
    $('eod').textContent = fmt(c[A.endIdx]);
    $('eodRange').textContent = 'انتهى اليوم';
  }
  const h1 = pointForecast(A.model, c, A.L, 60);
  $('h1').textContent = fmt(h1.v);
  $('h1Range').textContent = fmt(h1.lo) + ' — ' + fmt(h1.hi) + ' · ' + hhmm(state.store.start + (A.L + 60) * MIN);

  const a = A.acc;
  $('accDay').textContent = a.day ? a.day.mape.toFixed(2) + '%' : '—';
  $('accDaySub').textContent = a.day ? `متوسط الخطأ · ضمن المدى ${a.day.band.toFixed(0)}%` : 'بعد أول دقيقة';
  $('accH').textContent = a.hour ? a.hour.mape.toFixed(2) + '%' : '—';
  $('accHSub').textContent = a.hour ? `متوسط الخطأ · ضمن المدى ${a.hour.band.toFixed(0)}%` : 'بعد أول ساعة';
  $('accDir').textContent = a.dir != null ? a.dir.toFixed(0) + '%' : '—';

  drawChart(A);
  renderTable(A);
}

function drawChart(A) {
  const c = state.store.c;
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const padL = 8, padR = 62, padT = 10, padB = 22;

  let lo = Infinity, hi = -Infinity;
  const take = v => { if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } };
  for (let j = 0; j < DAY; j++) {
    if (A.mid + j <= A.L) take(c[A.mid + j]);
    const d = A.dayF[j]; if (d) { take(d.v); take(d.lo); take(d.hi); }
    const l = A.liveF[j]; if (l) { take(l.lo); take(l.hi); }
  }
  if (A.mid >= 1) take(c[A.mid - 1]);
  const span = (hi - lo) || hi * 0.001;
  lo -= span * 0.05; hi += span * 0.05;
  const X = j => padL + (w - padL - padR) * j / (DAY - 1);
  const Y = v => padT + (h - padT - padB) * (1 - (v - lo) / (hi - lo));

  g.font = '11px system-ui'; g.fillStyle = '#6f7ba0'; g.strokeStyle = '#1c2547'; g.lineWidth = 1;
  g.textAlign = 'center';
  for (let hr = 0; hr <= 24; hr += 3) {
    const x = X(Math.min(DAY - 1, hr * 60));
    g.beginPath(); g.moveTo(x, padT); g.lineTo(x, h - padB); g.stroke();
    g.fillText(String(hr).padStart(2, '0'), x, h - 6);
  }
  g.textAlign = 'left';
  for (let k = 0; k <= 4; k++) {
    const v = lo + (hi - lo) * k / 4, y = Y(v);
    g.beginPath(); g.moveTo(padL, y); g.lineTo(w - padR, y); g.stroke();
    g.fillText(fmt(v), w - padR + 4, y + 4);
  }

  const band = (arr, color) => {
    g.fillStyle = color; g.beginPath(); let started = false, lastJ = 0;
    for (let j = 0; j < DAY; j++) { const p = arr[j]; if (!p) continue; started ? g.lineTo(X(j), Y(p.hi)) : g.moveTo(X(j), Y(p.hi)); started = true; lastJ = j; }
    for (let j = lastJ; j >= 0; j--) { const p = arr[j]; if (p) g.lineTo(X(j), Y(p.lo)); }
    if (started) { g.closePath(); g.fill(); }
  };
  const line = (get, color, width, dash) => {
    g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []); g.beginPath(); let started = false;
    for (let j = 0; j < DAY; j++) { const v = get(j); if (v == null) continue; started ? g.lineTo(X(j), Y(v)) : g.moveTo(X(j), Y(v)); started = true; }
    g.stroke(); g.setLineDash([]);
  };

  band(A.dayF, 'rgba(245,158,11,0.10)');
  band(A.liveF, 'rgba(56,189,248,0.16)');
  line(j => A.dayF[j] && A.dayF[j].v, '#f59e0b', 1.5, [5, 4]);
  line(j => A.liveF[j] && A.liveF[j].v, '#38bdf8', 2);
  line(j => (A.mid + j <= A.L ? c[A.mid + j] : null), '#f8fafc', 1.6);

  const nowJ = A.L - A.mid;
  if (nowJ >= 0 && nowJ < DAY) {
    g.strokeStyle = '#22c55e'; g.lineWidth = 1; g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(X(nowJ), padT); g.lineTo(X(nowJ), h - padB); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#22c55e'; g.beginPath(); g.arc(X(nowJ), Y(c[A.L]), 3.5, 0, 7); g.fill();
  }
  cv._geom = { X, padL, padR, w };
}

function showTip(clientX) {
  if (!lastA || !cv._geom) return;
  const r = cv.getBoundingClientRect(), { padL, padR, w } = cv._geom;
  const j = Math.max(0, Math.min(DAY - 1, Math.round((clientX - r.left - padL) / (w - padL - padR) * (DAY - 1))));
  const A = lastA, c = state.store.c, idx = A.mid + j;
  const act = idx <= A.L ? c[idx] : null, d = A.dayF[j], l = A.liveF[j];
  let html = `<b>${hhmm(A.ds + j * MIN)}</b><br>`;
  if (act != null) html += `الفعلي: ${fmt(act)}<br>`;
  if (d) html += `توقع منتصف الليل: ${fmt(d.v)}<br>`;
  if (l) html += `التوقع المحدَّث: ${fmt(l.v)}<br><span style="color:#8f9bc0">${fmt(l.lo)} — ${fmt(l.hi)}</span>`;
  const tip = $('tip');
  tip.innerHTML = html; tip.style.display = 'block';
  const x = clientX - r.left;
  tip.style.top = '14px';
  tip.style.left = (x > r.width / 2 ? x - tip.offsetWidth - 12 : x + 12) + 'px';
}
cv.addEventListener('pointermove', e => showTip(e.clientX));
cv.addEventListener('pointerdown', e => showTip(e.clientX));
cv.addEventListener('pointerleave', () => { $('tip').style.display = 'none'; });

function renderTable(A) {
  const c = state.store.c;
  let from = 0, to = DAY - 1;
  const nowJ = A.L - A.mid;
  if (state.filter === 'next') from = Math.max(0, nowJ);
  if (state.filter === 'past') to = Math.min(DAY - 1, nowJ);
  const rows = [];
  for (let j = from; j <= to; j++) {
    const idx = A.mid + j, past = idx <= A.L;
    const f = past ? A.dayF[j] : A.liveF[j];
    const act = past ? c[idx] : null;
    const err = act != null && f ? pct(100 * (f.v / act - 1)) : '';
    const cls = j === nowJ ? 'now' : past ? 'past' : '';
    rows.push(`<tr class="${cls}"><td>${hhmm(A.ds + j * MIN)}</td><td>${f ? fmt(f.v) : '—'}</td><td>${f ? fmt(f.lo) + ' – ' + fmt(f.hi) : ''}</td><td>${act != null ? fmt(act) : ''}</td><td>${err}</td></tr>`);
  }
  if (state.filter === 'past') rows.reverse();
  $('tb').innerHTML = rows.join('');
}

document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  state.filter = b.dataset.f;
  if (lastA) renderTable(lastA);
});

// ---------- status / catch-up ----------
function setStatus(kind, text) {
  $('dot').className = 'dot' + (kind === 'on' ? ' on' : kind === 'busy' ? ' busy' : '');
  $('stat').textContent = text;
}

function animateCatchUp(fromL, toL) {
  return new Promise(resolve => {
    const n = toL - fromL;
    const banner = $('catch');
    banner.style.display = 'block';
    const steps = Math.min(n, 120), dur = Math.min(3500, 30 * n);
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      const L = Math.round(fromL + n * k);
      banner.textContent = `⏩ عم مرّق على ${n} دقيقة فاتتك… ${hhmm(state.store.start + L * MIN)}`;
      render(L);
      if (k < 1) requestAnimationFrame(step);
      else { banner.style.display = 'none'; resolve(); }
    };
    if (steps > 0) requestAnimationFrame(step); else { banner.style.display = 'none'; resolve(); }
  });
}

async function tick(first) {
  if (state.busy) return;
  if (!navigator.onLine) {
    setStatus('off', 'غير متصل — بكمّل لما ترجع');
    if (state.store && state.store.c.length > 1) render(state.store.c.length - 1);
    return;
  }
  state.busy = true;
  const sym = state.sym;
  const prevL = state.store ? state.store.c.length - 1 : null;
  try {
    setStatus('busy', first ? 'عم حمّل آخر 7 أيام…' : 'عم حدّث…');
    const added = await sync(p => { if (first) setStatus('busy', `عم حمّل آخر 7 أيام… ${Math.round(p * 100)}%`); });
    const L = state.store.c.length - 1;
    if (!first && prevL != null && added > 3 && state.shownL != null) await animateCatchUp(state.shownL, L);
    render(L);
    state.shownL = L;
    state.lastSync = Date.now();
    setStatus('on', 'محدَّث ' + hhmm(Date.now()));
  } catch (e) {
    if (state.sym === sym) {
      setStatus('off', 'تعذر الاتصال بالبيانات — رح جرّب كمان شوي');
      if (state.store && state.store.c.length > 1) render(state.store.c.length - 1);
    }
  } finally {
    state.busy = false;
  }
  if (state.sym !== sym) tick(!state.store);
}

function scheduleNext() {
  const wait = MIN - (Date.now() % MIN) + 2500;
  setTimeout(async () => { await tick(false); scheduleNext(); }, wait);
}

// ---------- boot ----------
function renderPicker() {
  const groups = [...new Set(SYMBOLS.map(x => x.g))];
  $('picker').innerHTML = groups.map(g => `<span class="grp">${g}</span>` +
    SYMBOLS.filter(x => x.g === g).map(x => `<button data-s="${x.s}" class="${x.s === state.sym ? 'on' : ''}">${x.b}</button>`).join('')).join('');
  $('picker').querySelectorAll('button').forEach(b => b.onclick = () => selectSym(b.dataset.s));
  const p = $('picker'), on = p.querySelector('.on');
  if (on) p.scrollLeft += on.getBoundingClientRect().left - p.getBoundingClientRect().left - (p.clientWidth - on.offsetWidth) / 2;
}

function selectSym(s) {
  if (s === state.sym) return;
  state.sym = s;
  localStorage.setItem('fc:sym2', s);
  state.store = loadStore(s); state.model = null; state.modelKey = ''; state.shownL = null; lastA = null;
  renderPicker();
  for (const id of ['price', 'chg', 'eod', 'eodRange', 'h1', 'h1Range', 'accDay', 'accH', 'accDir']) $(id).textContent = '—';
  $('symName').textContent = (SYMBOLS.find(x => x.s === s) || {}).n || s;
  $('tb').innerHTML = '';
  const cv = $('cv'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  if (state.store && state.store.c.length > 1) { render(state.store.c.length - 1); state.shownL = state.store.c.length - 1; }
  tick(!state.store);
}

renderPicker();
$('symName').textContent = (SYMBOLS.find(x => x.s === state.sym) || {}).n || state.sym;

window.addEventListener('online', () => tick(false));
window.addEventListener('offline', () => setStatus('off', 'غير متصل — بكمّل لما ترجع'));
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(false); });
window.addEventListener('resize', () => { if (lastA) drawChart(lastA); });

state.store = loadStore(state.sym);
if (state.store && state.store.c.length > 1) { render(state.store.c.length - 1); state.shownL = state.store.c.length - 1; }
tick(!state.store);
scheduleNext();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
