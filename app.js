/* === CONFIG & ICONS === */
const THEME_KEY = 'goveeTheme';
const COMPACT_KEY = 'goveeCompact';
const FONT_SIZE_KEY = 'goveeFontSize';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

let unit = 'F'; // Default unit
let autoTimer = null;

// SVG Paths for Weather Codes
const WEATHER_ICONS = {
  clear: '<path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-2a1 1 0 0 1 1-1h.01a1 1 0 0 1 0 2H13a1 1 0 0 1-1-1zm0 14a1 1 0 0 1 1-1h.01a1 1 0 0 1 0 2H13a1 1 0 0 1-1-1zm7-7a1 1 0 0 1-1 1h-1.99a1 1 0 0 1 0-2H19a1 1 0 0 1 1 1zM5 12a1 1 0 0 1-1 1H2.01a1 1 0 0 1 0-2H4a1 1 0 0 1 1 1zm11.95-4.95a1 1 0 0 1 0 1.41l-1.41 1.42a1 1 0 0 1-1.42-1.42l1.42-1.41a1 1 0 0 1 1.41 0zm-9.9 9.9a1 1 0 0 1 0 1.41l-1.41 1.42a1 1 0 0 1-1.42-1.42l1.42-1.41a1 1 0 0 1 1.41 0zm0-9.9a1 1 0 0 1-1.41 0l-1.42-1.41a1 1 0 0 1 1.42-1.42l1.41 1.42a1 1 0 0 1 0 1.41zm9.9 9.9a1 1 0 0 1-1.41 0l-1.42-1.41a1 1 0 0 1 1.42-1.42l1.41 1.42a1 1 0 0 1 0 1.41z"/>',
  cloud: '<path d="M17 10h-1.09c-.55-2.7-2.91-4.72-5.66-4.72A5.76 5.76 0 0 0 4.5 10.73c0 .09 0 .18.01.27C2.01 11.58 0 13.61 0 16.08c0 2.76 2.24 5 5 5h12c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96A5.45 5.45 0 0 0 17 10z"/>',
  rain: '<path d="M16 11h-1.09c-.55-2.7-2.91-4.72-5.66-4.72A5.76 5.76 0 0 0 3.5 11.73c0 .09 0 .18.01.27C1.01 12.58-1 14.61-1 17.08c0 2.76 2.24 5 5 5h12c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96A5.45 5.45 0 0 0 16 11zm-5 14v3m-4-3v3m8-3v3"/>',
  snow: '<path d="M12 2L12 22M2 12L22 12M5 5L19 19M5 19L19 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  storm: '<path d="M17 10h-1.09c-.55-2.7-2.91-4.72-5.66-4.72A5.76 5.76 0 0 0 4.5 10.73c0 .09 0 .18.01.27C2.01 11.58 0 13.61 0 16.08c0 2.76 2.24 5 5 5h12c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96A5.45 5.45 0 0 0 17 10z"/><polygon points="11 14 13 17 10 17 12 22 8 22 10 18 7 18" fill="currentColor"/>'
};

// WMO Weather Code Descriptions
const WEATHER_DESC = {
  0: "Clear Sky", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
  45: "Fog", 48: "Depositing Rime Fog",
  51: "Light Drizzle", 53: "Moderate Drizzle", 55: "Dense Drizzle",
  61: "Slight Rain", 63: "Moderate Rain", 65: "Heavy Rain",
  71: "Slight Snow", 73: "Moderate Snow", 75: "Heavy Snow",
  77: "Snow Grains",
  80: "Slight Showers", 81: "Moderate Showers", 82: "Violent Showers",
  95: "Thunderstorm", 96: "Thunderstorm & Hail", 99: "Thunderstorm & Heavy Hail"
};

function getIcon(code) {
  let path = WEATHER_ICONS.clear;
  if (code > 1 && code < 45) path = WEATHER_ICONS.cloud;
  else if (code >= 45 && code < 51) path = WEATHER_ICONS.cloud;
  else if (code >= 51 && code < 71) path = WEATHER_ICONS.rain;
  else if (code >= 71 && code < 80) path = WEATHER_ICONS.snow;
  else if (code >= 80 && code < 95) path = WEATHER_ICONS.rain;
  else if (code >= 95) path = WEATHER_ICONS.storm;
  return `<svg class="weather-icon-svg" viewBox="0 0 24 24">${path}</svg>`;
}

/* === DOM ELEMENTS === */
const elements = {
  grid: document.getElementById('grid'),
  count: document.getElementById('count'),
  notice: document.getElementById('notice'),
  buttons: {
    refresh: document.getElementById('refreshBtn'),
    reset: document.getElementById('resetOrderBtn'),
    compact: document.getElementById('compactToggleBtn'),
    reorder: document.getElementById('reorderToggleBtn'),
    themeDark: document.getElementById('themeDark'),
    themeLight: document.getElementById('themeLight'),
    unitF: document.getElementById('unitF'),
    unitC: document.getElementById('unitC')
  },
  weather: {
    card: document.getElementById('weatherCard'),
    temp: document.getElementById('weatherTemp'),
    loc: document.getElementById('weatherLocation'),
    hum: document.getElementById('weatherHumidity'),
    wind: document.getElementById('weatherWind'),
    status: document.getElementById('weatherStatus'),
    daily: document.getElementById('weatherDaily'),
    upcoming: document.getElementById('weatherUpcoming'),
    canvas: document.getElementById('weatherForecast')
  }
};

/* === UTILITIES === */
const cToF = c => (c * 9 / 5) + 32;
const fToC = f => (f - 32) * 5 / 9;
const fmt = (n, dp = 1) => (n != null && isFinite(n)) ? Number(n).toFixed(dp) : '—';
const isValid = n => typeof n === 'number' && isFinite(n);

function classifyF(f) {
  if (!isFinite(f)) return 'comfy';
  if (f < 68) return 'cool';
  if (f <= 78) return 'comfy';
  if (f <= 84) return 'warm';
  return 'hot';
}

/* === THEME & SETTINGS === */
function applyTheme(mode, persist = true) {
  document.documentElement.setAttribute('data-theme', mode);
  elements.buttons.themeDark.classList.toggle('active', mode === 'dark');
  elements.buttons.themeLight.classList.toggle('active', mode === 'light');
  if (persist) localStorage.setItem(THEME_KEY, mode);
}

function applyFontSize(size) {
  const root = document.documentElement;
  root.style.setProperty('--insight-font-size', size + 'px');
  localStorage.setItem(FONT_SIZE_KEY, size);
}

function changeFontSize(delta) {
  const currentSize = parseInt(localStorage.getItem(FONT_SIZE_KEY)) || 15;
  const newSize = Math.max(12, Math.min(20, currentSize + delta)); // Min 12px, Max 20px
  applyFontSize(newSize);
}

function initSettings() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(savedTheme || (prefersLight ? 'light' : 'dark'), false);

  if (localStorage.getItem(COMPACT_KEY) === '1') document.body.classList.add('compact');

  // Initialize font size
  const savedFontSize = parseInt(localStorage.getItem(FONT_SIZE_KEY)) || 15;
  applyFontSize(savedFontSize);

  elements.buttons.themeDark.onclick = () => applyTheme('dark');
  elements.buttons.themeLight.onclick = () => applyTheme('light');
  elements.buttons.compact.onclick = () => {
    document.body.classList.toggle('compact');
    localStorage.setItem(COMPACT_KEY, document.body.classList.contains('compact') ? '1' : '0');
    // Force chart redraw
    document.querySelectorAll('canvas.spark').forEach(c => {
       try { drawSpark(c, JSON.parse(c.dataset.series)); } catch {}
    });
  };

  // Font size controls
  const fontSizeUp = document.getElementById('fontSizeUp');
  const fontSizeDown = document.getElementById('fontSizeDown');
  if (fontSizeUp) fontSizeUp.onclick = () => changeFontSize(1);
  if (fontSizeDown) fontSizeDown.onclick = () => changeFontSize(-1);
}

/* === INTERACTIVE CHARTING === */
function drawSpark(canvas, data) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  const pad = 4;

  if (!data || data.length < 2) {
    ctx.clearRect(0,0,W,H);
    return;
  }

  const values = data.map(d => d.val);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = (max - min) || 1;

  const getPt = (i) => ({
    x: pad + (i / (values.length - 1)) * (W - pad * 2),
    y: pad + (1 - (values[i] - min) / range) * (H - pad * 2)
  });

  function render(highlightIndex = -1) {
    ctx.clearRect(0, 0, W, H);

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#ef4444');
    grad.addColorStop(0.5, '#fbbf24');
    grad.addColorStop(1, '#3b82f6');

    ctx.beginPath();
    ctx.moveTo(getPt(0).x, getPt(0).y);

    for (let i = 0; i < values.length - 1; i++) {
       const pCurrent = getPt(i);
       const pNext = getPt(i+1);
       const cp1x = pCurrent.x + (pNext.x - pCurrent.x) / 2;
       const cp1y = pCurrent.y; 
       const cp2x = pCurrent.x + (pNext.x - pCurrent.x) / 2;
       const cp2y = pNext.y;
       ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, pNext.x, pNext.y);
    }
    
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = grad;
    ctx.stroke();

    ctx.lineTo(getPt(values.length-1).x, H);
    ctx.lineTo(getPt(0).x, H);
    ctx.fillStyle = "rgba(96, 165, 250, 0.05)";
    ctx.fill();

    if (highlightIndex !== -1) {
      const pt = getPt(highlightIndex);
      const pointData = data[highlightIndex];

      ctx.beginPath();
      ctx.moveTo(pt.x, 0);
      ctx.lineTo(pt.x, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();

      let label = `${pointData.val.toFixed(1)}°`;
      if (pointData.ts) {
        const date = new Date(pointData.ts);
        const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        label = `${timeStr} • ${label}`;
      }

      ctx.font = "10px sans-serif";
      const textWidth = ctx.measureText(label).width;
      let tx = pt.x + 6;
      if (tx + textWidth > W) tx = pt.x - textWidth - 6;

      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(tx - 3, 2, textWidth + 6, 15);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, tx, 13);
    }
  }

  render();

  canvas.style.cursor = "crosshair";
  canvas.onmousemove = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    let idx = Math.round((x / W) * (values.length - 1));
    idx = Math.max(0, Math.min(idx, values.length - 1));
    render(idx);
  };
  canvas.onmouseleave = () => render(-1);
}

/* === SUN CYCLE DRAWING === */
function drawSunPath(canvas, riseStr, setStr) {
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  
  const W = rect.width;
  const H = rect.height;
  const now = new Date();
  const rise = new Date(riseStr);
  const set = new Date(setStr);

  const elRise = document.getElementById('sunriseText');
  const elSet = document.getElementById('sunsetText');
  if(elRise) elRise.textContent = rise.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}).toLowerCase();
  if(elSet) elSet.textContent = set.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}).toLowerCase();

  let pct = (now - rise) / (set - rise);
  if (pct < 0) pct = 0; if (pct > 1) pct = 1;

  ctx.clearRect(0, 0, W, H);

  ctx.beginPath();
  ctx.arc(W/2, H + 20, W/1.8, Math.PI, 0); 
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  const angle = Math.PI - (pct * Math.PI);
  const r = W/1.8; 
  const sx = (W/2) + (r * Math.cos(angle));
  const sy = (H + 20) + (r * Math.sin(angle)); 

  const isDay = now >= rise && now <= set;
  
  if (isDay) {
      const grad = ctx.createRadialGradient(sx, sy, 2, sx, sy, 12);
      grad.addColorStop(0, 'rgba(251, 191, 36, 1)');
      grad.addColorStop(1, 'rgba(251, 191, 36, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI*2); ctx.fill();
  }

  ctx.fillStyle = isDay ? '#fff' : '#94a3b8';
  ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI*2); ctx.fill();
}

// Resize Observer
const resizeObserver = new ResizeObserver(entries => {
  entries.forEach(entry => {
    const canvas = entry.target;
    if(canvas.id === 'sunCanvas') return; 
    try {
      const points = JSON.parse(canvas.dataset.series || '[]');
      if (points.length) requestAnimationFrame(() => drawSpark(canvas, points));
    } catch(e) {}
  });
});

/* === AI INSIGHTS LOGIC === */
async function loadAlmanacInsights() {
  const container = document.getElementById('aiInsights');
  if (!container) return;

  container.innerHTML = '<div class="skeleton" style="height:16px; margin-bottom:6px; width:100%;"></div><div class="skeleton" style="height:16px; margin-bottom:6px; width:95%;"></div><div class="skeleton" style="height:16px; width:90%;"></div>';

  try {
    const res = await fetch('/api/almanac/insights');
    if (!res.ok) {
      container.innerHTML = '<div style="font-size:12px; color:var(--muted); font-style:italic;">Insights unavailable</div>';
      return;
    }

    const data = await res.json();
    const insights = data.insights || [];

    if (insights.length === 0) {
      container.innerHTML = '<div style="font-size:12px; color:var(--muted); font-style:italic;">No insights available</div>';
      return;
    }

    let html = '';
    insights.forEach(insight => {
      html += `
        <div class="ai-insight-item">
          <svg class="icon" style="width:12px; height:12px; fill:var(--accent); flex-shrink:0; margin-top:2px;" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span>${insight}</span>
        </div>
      `;
    });

    container.innerHTML = html;
  } catch (e) {
    console.error("AI insights error", e);
    container.innerHTML = '<div style="font-size:12px; color:var(--muted); font-style:italic;">Failed to load insights</div>';
  }
}

/* === ALMANAC & HISTORY LOGIC === */
async function loadAlmanac(weatherData) {
  // 1. Sun Cycle
  if (weatherData && weatherData.daily) {
    const rise = weatherData.daily.sunrise[0];
    const set = weatherData.daily.sunset[0];
    drawSunPath(document.getElementById('sunCanvas'), rise, set);
  }

  // 2. Almanac Stats
  try {
    const res = await fetch('/api/almanac');
    if (!res.ok) return;
    const hist = await res.json();

    const elHigh = document.getElementById('almHigh');
    const elLow = document.getElementById('almLow');
    const elDelta = document.getElementById('almDelta');

    if(elHigh) elHigh.textContent = Math.round(hist.avg_high);
    if(elLow) elLow.textContent = Math.round(hist.avg_low);

    const todayHigh = weatherData.daily.temperature_2m_max[0];
    const diff = todayHigh - hist.avg_high;
    
    const pct = ((diff / hist.avg_high) * 100).toFixed(1);
    const sign = diff > 0 ? '+' : '';
    const color = diff > 0 ? '#fbbf24' : '#3b82f6';
    
    if(elDelta) elDelta.innerHTML = `<span style="color:${color}">${sign}${Math.round(diff)}°F <span style="opacity:0.7; font-size:11px">(${sign}${pct}%)</span></span>`;

    // 3. Render History Grid
    const histContainer = document.getElementById('almHistory');
    if (histContainer && hist.history) {
        let html = '<div class="hist-grid">';
        hist.history.forEach(item => {
            const lowColor = item.low < 40 ? '#38bdf8' : (item.low > 80 ? '#fbbf24' : 'inherit');
            html += `
              <div class="hist-item">
                <span class="hist-year">${item.year}</span>
                <div class="hist-vals">
                  <span style="color:${lowColor}; font-weight:600;">${Math.round(item.low)}°</span>
                  <span style="opacity:0.3; margin:0 2px;">/</span>
                  <span>${Math.round(item.high)}°</span>
                </div>
              </div>
            `;
        });
        html += '</div>';
        histContainer.innerHTML = html;
    }

  } catch (e) {
    console.error("Almanac error", e);
  }
}

/* === SENSOR DATA LOGIC === */
function renderSensors(data, history) {
  elements.count.textContent = data.items.length;
  const now = Date.now();

  const processedItems = data.items.map(item => {
    let tF = item.temp_f;
    let tC = item.temp_c;

    // Glitch Fix
    if (isValid(tC) && (tC > 40 && tC < 120)) { tF = tC; tC = fToC(tF); } 
    else {
      if (isValid(tC) && !isValid(tF)) tF = cToF(tC);
      else if (isValid(tF) && !isValid(tC)) tC = fToC(tF);
    }
    if (tF > 160 || tF < -40) { tF = null; tC = null; }

    return { ...item, _tF: tF, _tC: tC };
  }).sort((a, b) => {
    const valA = unit === 'F' ? a._tF : a._tC;
    const valB = unit === 'F' ? b._tF : b._tC;
    if (!isValid(valA)) return 1;
    if (!isValid(valB)) return -1;
    return valA - valB;
  });

  processedItems.forEach(item => {
    let card = elements.grid.querySelector(`[data-device="${item.device}"]`);
    
    if (!card) {
      card = document.createElement('div');
      card.dataset.device = item.device;
      card.innerHTML = `
        <div class="toprow">
          <div class="title">
            <div class="name"></div>
            <div class="device"></div>
          </div>
        </div>
        <div class="reading">
          <div class="temp-wrap">
            <span class="temp"></span>
            <span class="unit"></span>
          </div>
          <div class="badges">
            <div class="humidity-badge"></div>
            <div class="battery-badge"></div>
          </div>
        </div>
        <canvas class="spark"></canvas>
        <div class="status"></div>
      `;
      resizeObserver.observe(card.querySelector('canvas'));
    }

    const displayTemp = unit === 'F' ? item._tF : item._tC;
    const cls = classifyF(item._tF);
    const lastTs = item.timestamp ? new Date(item.timestamp) : null;
    const minsAgo = lastTs ? (now - lastTs.getTime())/60000 : 0;
    const staleClass = minsAgo > 30 ? 'stale-card' : '';

    card.className = `card sensor-card ${cls} ${staleClass}`;
    
    card.querySelector('.name').textContent = item.name || 'Unnamed';
    card.querySelector('.device').textContent = item.device;
    card.querySelector('.temp').textContent = fmt(displayTemp, 1);
    card.querySelector('.unit').textContent = `°${unit}`;
    
    const humBadge = card.querySelector('.humidity-badge');
    humBadge.textContent = isValid(item.humidity) ? `💧 ${fmt(item.humidity, 0)}%` : '—%';
    humBadge.className = `humidity-badge ${item.humidity < 30 || item.humidity > 60 ? 'humidity-bad' : ''}`;
    
    const batBadge = card.querySelector('.battery-badge');
    if (isValid(item.battery)) {
        batBadge.style.display = ''; 
        batBadge.textContent = `${fmt(item.battery, 0)}%`;
        batBadge.className = `battery-badge ${item.battery < 20 ? 'battery-low' : ''}`;
    } else {
        batBadge.style.display = 'none';
    }

    const statusDiv = card.querySelector('.status');
    let statusHtml = `<span>${minsAgo > 60 ? Math.round(minsAgo/60)+'h ago' : Math.round(minsAgo)+'m ago'}</span>`;
    statusHtml += ` <span style="opacity:0.5; margin-left:auto; font-size:9px;">24h History</span>`;
    if (minsAgo > 30) statusHtml += ` <span class="chip">STALE</span>`;
    statusDiv.innerHTML = statusHtml;
    statusDiv.style.display = 'flex';

    // Chart Logic
    const rawHist = history[item.device] || [];
    const recentPoints = rawHist.filter(p => {
        const ptTime = p.timestamp ? new Date(p.timestamp).getTime() : 0;
        return ptTime > (now - ONE_DAY_MS);
    });

    const points = recentPoints.map(p => {
      let hF = p.temp_f;
      let hC = p.temp_c;
      if (isValid(hC) && (hC > 40 && hC < 120)) { hF = hC; hC = fToC(hF); } 
      else {
          if (isValid(hC) && !isValid(hF)) hF = cToF(hC);
          else if (isValid(hF) && !isValid(hC)) hC = fToC(hF);
      }
      if (hF > 160 || hF < -40) return null;

      return { val: unit === 'F' ? hF : hC, ts: p.timestamp };
    }).filter(p => p && isValid(p.val)); 

    const canvas = card.querySelector('canvas');
    const newSeriesStr = JSON.stringify(points);
    if (canvas.dataset.series !== newSeriesStr) {
        canvas.dataset.series = newSeriesStr;
        drawSpark(canvas, points);
    }
    elements.grid.appendChild(card);
  });

  const activeIds = processedItems.map(i => i.device);
  Array.from(elements.grid.children).forEach(c => {
    if (!activeIds.includes(c.dataset.device)) c.remove();
  });
}

async function loadData() {
  try {
    // --- REFRESH ANIMATION UPDATE ---
    // Instead of adding .pulse to the wrapper, we toggle .spin on the icon itself
    const refreshIcon = elements.buttons.refresh.querySelector('.icon');
    if (refreshIcon) refreshIcon.classList.add('spin');

    const [rRead, rHist] = await Promise.all([
      fetch('/api/readings'), fetch('/api/history')
    ]);
    const readings = await rRead.json();
    const history = await rHist.json();
    renderSensors(readings, history.series || {});
    
    setTimeout(() => {
        if (refreshIcon) refreshIcon.classList.remove('spin');
    }, 800); // Min spin time to feel responsive

  } catch (e) {
    elements.notice.textContent = "Offline / API Error";
  }
}

/* === WEATHER LOGIC === */
async function loadWeather() {
  let lat = 36.17, lon = -115.14, locName = "Las Vegas";
  
  if (location.protocol === 'https:' || location.hostname === 'localhost') {
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, {timeout:5000}));
      lat = pos.coords.latitude; lon = pos.coords.longitude;
      const geo = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`).then(r=>r.json());
      locName = geo.locality || geo.city || "Local Weather";
    } catch {}
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weathercode,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,sunrise,sunset&hourly=temperature_2m&temperature_unit=fahrenheit&windspeed_unit=mph&forecast_days=6&timezone=auto`;
  
  try {
    const data = await fetch(url).then(r=>r.json());
    document.querySelectorAll('.skeleton').forEach(el => el.classList.remove('skeleton'));

    elements.weather.loc.textContent = locName;
    elements.weather.temp.textContent = data.current.temperature_2m.toFixed(1);
    elements.weather.hum.textContent = `💧 ${data.current.relative_humidity_2m}%`;
    elements.weather.wind.textContent = `💨 ${data.current.wind_speed_10m} mph`;
    
    const code = data.current.weathercode;
    const desc = WEATHER_DESC[code] || "Unknown";
    const timeStr = new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
    elements.weather.status.textContent = `${desc} • Updated ${timeStr}`;

    const d = data.daily;
    elements.weather.daily.innerHTML = `Today: ${Math.round(d.temperature_2m_min[0])}° / ${Math.round(d.temperature_2m_max[0])}° • ${d.precipitation_probability_max[0]}% rain`;

    let html = '';
    for(let i=1; i<6; i++) {
      const date = new Date(d.time[i] + 'T00:00:00');
      const dayName = date.toLocaleDateString('en-US', {weekday:'short'});
      html += `
        <div class="forecast-tile">
          <div class="day">${dayName}</div>
          <div class="icon">${getIcon(d.weathercode[i])}</div>
          <div class="temps">${Math.round(d.temperature_2m_min[i])}°/${Math.round(d.temperature_2m_max[i])}°</div>
          <div class="rain">${d.precipitation_probability_max[i]}% rain</div>
        </div>`;
    }
    elements.weather.upcoming.innerHTML = html;

    // Weather Sparkline
    const hourly = data.hourly.temperature_2m.slice(0, 24).map(v => ({ val: v })); 
    drawSpark(elements.weather.canvas, hourly);

    // Trigger Almanac & AI Insights
    loadAlmanac(data);
    loadAlmanacInsights();

  } catch (e) {
    elements.weather.status.textContent = "Weather Unavailable";
  }
}

/* === INIT === */
initSettings();
loadData();
loadWeather();
setInterval(loadData, 20000);
setInterval(loadWeather, 900000);

// Event Listeners
elements.buttons.refresh.onclick = loadData;
elements.buttons.unitF.onclick = () => { unit='F'; elements.buttons.unitF.classList.add('active'); elements.buttons.unitC.classList.remove('active'); loadData(); };
elements.buttons.unitC.onclick = () => { unit='C'; elements.buttons.unitC.classList.add('active'); elements.buttons.unitF.classList.remove('active'); loadData(); };