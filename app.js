/* === CONFIG & ICONS === */
const THEME_KEY = 'goveeTheme';
const COMPACT_KEY = 'goveeCompact';
const FONT_SIZE_KEY = 'goveeFontSize';
const UNIT_KEY = 'goveeUnit';
const LOCATIONS_KEY = 'goveeSelectedLocations';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const OUTDOOR_KEYWORDS = ['backyard', 'outdoor', 'outside', 'patio', 'porch', 'deck', 'garage', 'yard', 'garden', 'shed'];

const LOCATION_PRESETS = [
  { id: 'seattle', name: 'Seattle', lat: 47.61, lon: -122.33 },
  { id: 'san-diego', name: 'San Diego', lat: 32.72, lon: -117.16 },
  { id: 'orlando', name: 'Orlando', lat: 28.54, lon: -81.38 },
  { id: 'new-york', name: 'New York', lat: 40.71, lon: -74.01 },
  { id: 'las-vegas', name: 'Las Vegas', lat: 36.17, lon: -115.14 },
  { id: 'los-angeles', name: 'Los Angeles', lat: 34.05, lon: -118.24 },
  { id: 'phoenix', name: 'Phoenix', lat: 33.45, lon: -112.07 },
  { id: 'chicago', name: 'Chicago', lat: 41.88, lon: -87.63 },
  { id: 'austin', name: 'Austin', lat: 30.27, lon: -97.74 },
  { id: 'boston', name: 'Boston', lat: 42.36, lon: -71.06 },
];
const DEFAULT_LOCATION_IDS = ['seattle', 'san-diego', 'orlando', 'new-york'];
let _locationData = null;

let unit = localStorage.getItem(UNIT_KEY) || 'F'; // Default unit
let autoTimer = null;

// Inline weather illustrations. Kept dependency-free so forecast tiles render offline.
const WEATHER_ICONS = {
  clear: `
    <g class="sun-rays" stroke="#ffd166" stroke-width="3" stroke-linecap="round">
      <path d="M32 5v7"/><path d="M32 52v7"/><path d="M5 32h7"/><path d="M52 32h7"/>
      <path d="m13 13 5 5"/><path d="m46 46 5 5"/><path d="m51 13-5 5"/><path d="m18 46-5 5"/>
    </g>
    <circle cx="32" cy="32" r="14" fill="#ffb703"/>
    <circle cx="27" cy="27" r="10" fill="#ffe066" opacity=".95"/>
    <path d="M22 39c4 6 16 6 20 0" fill="none" stroke="#fb8500" stroke-width="3" stroke-linecap="round" opacity=".55"/>`,
  cloud: `
    <circle cx="25" cy="32" r="12" fill="#d9f0ff"/>
    <circle cx="38" cy="28" r="15" fill="#f4fbff"/>
    <circle cx="48" cy="36" r="11" fill="#c8e1f2"/>
    <path d="M17 42h32c6 0 10-4 10-9 0-5-4-9-10-9h-1C45 15 37 10 28 12c-8 1-14 8-14 16v1c-5 1-9 5-9 10 0 6 5 10 12 10Z" fill="#eef8ff"/>
    <path d="M14 42h35c5 0 9-3 10-7 0 8-5 13-13 13H17c-7 0-12-4-12-10 0-1 0-2 1-3 1 4 4 7 8 7Z" fill="#a9c9df" opacity=".65"/>`,
  fog: `
    <circle cx="25" cy="28" r="11" fill="#d9f0ff"/>
    <circle cx="39" cy="25" r="14" fill="#f4fbff"/>
    <path d="M14 39h36c6 0 10-4 10-9 0-4-4-8-9-8h-2C46 14 38 10 30 12c-8 1-14 8-14 16-6 0-11 5-11 10 0 6 4 10 9 10Z" fill="#d7e8f2"/>
    <g stroke="#92b8ca" stroke-width="4" stroke-linecap="round" opacity=".9">
      <path d="M10 45h28"/><path d="M45 45h9"/><path d="M7 53h18"/><path d="M32 53h25"/>
    </g>`,
  rain: `
    <circle cx="25" cy="25" r="11" fill="#d9f0ff"/>
    <circle cx="39" cy="23" r="14" fill="#f4fbff"/>
    <path d="M13 37h36c6 0 10-4 10-9s-4-9-10-9h-2C44 12 36 8 28 10c-8 1-14 8-14 16-6 0-11 5-11 10 0 6 4 10 10 10Z" fill="#cfe4f2"/>
    <path d="M13 38h36c5 0 8-3 10-6-1 8-6 12-14 12H15c-6 0-11-4-12-9 2 2 5 3 10 3Z" fill="#8fb3ca" opacity=".62"/>
    <g stroke="#4cc9f0" stroke-width="4" stroke-linecap="round">
      <path d="M18 48 14 57"/><path d="M33 48 29 57"/><path d="M48 48 44 57"/>
    </g>`,
  snow: `
    <circle cx="25" cy="25" r="11" fill="#d9f0ff"/>
    <circle cx="39" cy="23" r="14" fill="#f8fdff"/>
    <path d="M13 37h36c6 0 10-4 10-9s-4-9-10-9h-2C44 12 36 8 28 10c-8 1-14 8-14 16-6 0-11 5-11 10 0 6 4 10 10 10Z" fill="#dceef8"/>
    <g stroke="#90e0ef" stroke-width="3" stroke-linecap="round">
      <path d="M18 49v10"/><path d="M13 54h10"/><path d="m15 51 6 6"/><path d="m21 51-6 6"/>
      <path d="M35 48v11"/><path d="M29 54h12"/><path d="m31 50 8 8"/><path d="m39 50-8 8"/>
      <path d="M50 49v10"/><path d="M45 54h10"/>
    </g>`,
  storm: `
    <circle cx="25" cy="24" r="11" fill="#b8c7da"/>
    <circle cx="40" cy="22" r="15" fill="#d4deeb"/>
    <path d="M13 36h36c6 0 10-4 10-9s-4-9-10-9h-2C44 11 36 7 28 9c-8 1-14 8-14 16-6 0-11 5-11 10 0 6 4 10 10 10Z" fill="#8fa4bd"/>
    <path d="M30 37h11l-8 11h9L27 62l4-13h-8l7-12Z" fill="#ffca3a"/>
    <path d="M41 37 33 48h9L27 62l9-18h-8l4-7h9Z" fill="#ff8f00" opacity=".72"/>
    <g stroke="#4cc9f0" stroke-width="3.5" stroke-linecap="round" opacity=".95">
      <path d="M15 49 11 57"/><path d="M51 47 47 55"/>
    </g>`
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
  let type = 'clear';
  if (code > 1 && code < 45) type = 'cloud';
  else if (code >= 45 && code < 51) type = 'fog';
  else if (code >= 51 && code < 71) type = 'rain';
  else if (code >= 71 && code < 80) type = 'snow';
  else if (code >= 80 && code < 95) type = 'rain';
  else if (code >= 95) type = 'storm';
  return `<svg class="weather-icon-svg weather-icon-${type}" viewBox="0 0 64 64" role="img" aria-label="${WEATHER_DESC[code] || 'Weather'}">${WEATHER_ICONS[type]}</svg>`;
}

function weatherSceneClass(code) {
  if (code >= 95) return 'scene-storm';
  if ((code >= 51 && code < 71) || (code >= 80 && code < 95)) return 'scene-rain';
  if (code >= 71 && code < 80) return 'scene-snow';
  if (code >= 45 && code < 51) return 'scene-fog';
  if (code > 1 && code < 45) return 'scene-cloud';
  return 'scene-clear';
}

function moonPhaseFraction(date = new Date()) {
  const synodicMonth = 29.530588853;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - knownNewMoon) / ONE_DAY_MS;
  return ((days % synodicMonth) + synodicMonth) % synodicMonth / synodicMonth;
}

function moonPhaseClass(phase) {
  if (phase < 0.03 || phase >= 0.97) return 'moon-new';
  if (phase < 0.22) return 'moon-waxing-crescent';
  if (phase < 0.28) return 'moon-first-quarter';
  if (phase < 0.47) return 'moon-waxing-gibbous';
  if (phase < 0.53) return 'moon-full';
  if (phase < 0.72) return 'moon-waning-gibbous';
  if (phase < 0.78) return 'moon-last-quarter';
  return 'moon-waning-crescent';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildHourlyTempsByDay(hourly = {}) {
  const byDay = new Map();
  const times = hourly.time || [];
  const temps = hourly.temperature_2m || [];

  times.forEach((time, index) => {
    const day = time.slice(0, 10);
    const temp = Number(temps[index]);
    if (!Number.isFinite(temp)) return;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(temp);
  });

  return byDay;
}

function createTempHillSvg(dayIndex, temps, chartMin, chartMax, low, high) {
  const values = temps.length ? temps.slice(0, 24) : [low, high];
  const span = Math.max(1, chartMax - chartMin);
  const points = values.map((temp, index) => {
    const x = values.length === 1 ? 50 : 5 + (index / (values.length - 1)) * 90;
    const y = 88 - ((temp - chartMin) / span) * 76;
    return { x, y: clamp(y, 8, 88), temp };
  });
  const linePath = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L95 92 L5 92 Z`;
  const segmentWidth = values.length > 18 ? 2.7 : 4;
  const segments = points.map(point => {
    const tempNorm = clamp((point.temp - chartMin) / span, 0, 1);
    const hue = 190 - (tempNorm * 170);
    const height = Math.max(3, 92 - point.y);
    return `<rect class="temp-hill-segment" x="${(point.x - (segmentWidth / 2)).toFixed(1)}" y="${point.y.toFixed(1)}" width="${segmentWidth}" height="${height.toFixed(1)}" rx="1.3" style="fill:hsl(${hue.toFixed(0)}, 88%, 62%)"></rect>`;
  }).join('');
  const gradientId = `tempHillGradient-${dayIndex}`;
  const fillId = `tempHillFill-${dayIndex}`;

  return `
    <svg class="temp-hill" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="24-hour temperature profile, ${low} to ${high} degrees" role="img">
      <defs>
        <linearGradient id="${gradientId}" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#55d6e8"></stop>
          <stop offset="56%" stop-color="#ffd166"></stop>
          <stop offset="100%" stop-color="#ff7a45"></stop>
        </linearGradient>
        <linearGradient id="${fillId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffd166" stop-opacity=".32"></stop>
          <stop offset="100%" stop-color="#55d6e8" stop-opacity=".04"></stop>
        </linearGradient>
      </defs>
      <path class="temp-hill-fill" style="fill:url(#${fillId})" d="${areaPath}"></path>
      <g class="temp-hill-segments">${segments}</g>
      <path class="temp-hill-line" style="stroke:url(#${gradientId})" d="${linePath}"></path>
    </svg>`;
}

function updateSkyMotion(card, current = {}, sunrise, sunset, isDay) {
  const windMph = Number(current.wind_speed_10m) || 0;
  const gustMph = Number(current.wind_gusts_10m) || windMph;
  const baseDuration = clamp(110 - (windMph * 4.4), 24, 118);
  const gustDuration = clamp(22 - (gustMph * .38), 7, 24);
  const gustOpacity = clamp((Math.max(gustMph, windMph) - 14) / 22, 0, .82);
  const gustDistance = clamp(96 + (gustMph * 2.8), 116, 188);
  const windDirection = Number(current.wind_direction_10m);

  card.style.setProperty('--cloud-speed', `${baseDuration.toFixed(1)}s`);
  card.style.setProperty('--cloud-speed-slow', `${(baseDuration * 1.34).toFixed(1)}s`);
  card.style.setProperty('--cloud-speed-fast', `${Math.max(18, baseDuration * .72).toFixed(1)}s`);
  card.style.setProperty('--cloud-speed-night-drift', `${(baseDuration * 1.68).toFixed(1)}s`);
  card.style.setProperty('--cloud-speed-night-wisp', `${(baseDuration * 1.5).toFixed(1)}s`);
  card.style.setProperty('--gust-speed', `${gustDuration.toFixed(1)}s`);
  card.style.setProperty('--gust-opacity', gustOpacity.toFixed(2));
  card.style.setProperty('--gust-distance', `${gustDistance.toFixed(1)}%`);

  if (Number.isFinite(windDirection)) {
    const eastboundWind = windDirection > 180;
    card.style.setProperty('--cloud-direction', eastboundWind ? 'normal' : 'reverse');
  }

  if (isDay && sunrise && sunset && sunset > sunrise) {
    const daylightProgress = clamp((Date.now() - sunrise.getTime()) / (sunset.getTime() - sunrise.getTime()), 0, 1);
    const arc = Math.sin(daylightProgress * Math.PI);
    const sunX = 12 + daylightProgress * 76;
    const sunY = 72 - arc * 58;
    card.style.setProperty('--sun-x', `${sunX.toFixed(1)}%`);
    card.style.setProperty('--sun-y', `${sunY.toFixed(1)}%`);
  } else {
    card.style.setProperty('--sun-x', '78%');
    card.style.setProperty('--sun-y', '18%');
  }
}

function applyWeatherScene(code, daily, current) {
  const card = elements.weather.card;
  if (!card) return;

  const sceneClasses = [
    'scene-clear', 'scene-cloud', 'scene-rain', 'scene-snow', 'scene-storm', 'scene-fog',
    'scene-day', 'scene-night',
    'moon-new', 'moon-waxing-crescent', 'moon-first-quarter', 'moon-waxing-gibbous',
    'moon-full', 'moon-waning-gibbous', 'moon-last-quarter', 'moon-waning-crescent'
  ];
  card.classList.remove(...sceneClasses);
  card.classList.add(weatherSceneClass(code));

  const now = new Date();
  const sunrise = daily?.sunrise?.[0] ? new Date(daily.sunrise[0]) : null;
  const sunset = daily?.sunset?.[0] ? new Date(daily.sunset[0]) : null;
  const isDay = sunrise && sunset ? now >= sunrise && now <= sunset : true;
  card.classList.add(isDay ? 'scene-day' : 'scene-night');
  updateSkyMotion(card, current, sunrise, sunset, isDay);

  if (!isDay) {
    card.classList.add(moonPhaseClass(moonPhaseFraction(now)));
  }
}

/* === DOM ELEMENTS === */
const elements = {
  grid: document.getElementById('grid'),
  count: document.getElementById('count'),
  freshness: document.getElementById('readingsFreshness'),
  notice: document.getElementById('notice'),
  buttons: {
    refresh: document.getElementById('refreshBtn'),
    compact: document.getElementById('compactToggleBtn'),
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
    canvas: document.getElementById('weatherForecast'),
    condition: document.getElementById('weatherCondition'),
    rainBadge: document.getElementById('rainBadge'),
    alerts: document.getElementById('weatherAlerts')
  },
  pollen: {
    card: document.getElementById('pollenCard'),
    level: document.getElementById('pollenLevel'),
    source: document.getElementById('pollenSource'),
    detail: document.getElementById('pollenDetail'),
    types: document.getElementById('pollenTypes')
  },
  usActivity: {
    list: document.getElementById('usWeatherActivity'),
    map: document.getElementById('usActivityMap'),
    states: document.getElementById('usMapStates'),
    markers: document.getElementById('usActivityMarkers'),
    updated: document.getElementById('usActivityUpdated')
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

function isOutdoorSensor(item) {
  const name = (item.name || '').toLowerCase();
  return OUTDOOR_KEYWORDS.some(keyword => name.includes(keyword));
}

function getSensorNotes(item, minsAgo) {
  const outdoor = isOutdoorSensor(item);
  const notes = [];
  let needsAttention = false;
  let outdoorCondition = false;

  if (minsAgo > 30) {
    notes.push({ text: 'Stale data', type: 'attention' });
    needsAttention = true;
  }

  if (isValid(item._tF)) {
    if (outdoor) {
      if (item._tF >= 95) {
        notes.push({ text: 'Outdoor heat', type: 'condition' });
        outdoorCondition = true;
      } else if (item._tF <= 40) {
        notes.push({ text: 'Outdoor cold', type: 'condition' });
        outdoorCondition = true;
      }
    } else if (item._tF < 60 || item._tF > 85) {
      notes.push({ text: item._tF > 85 ? 'Indoor hot' : 'Indoor cold', type: 'attention' });
      needsAttention = true;
    }
  }

  if (isValid(item.humidity)) {
    if (outdoor) {
      if (item.humidity < 15) {
        notes.push({ text: 'Very dry outside', type: 'condition' });
        outdoorCondition = true;
      } else if (item.humidity > 80) {
        notes.push({ text: 'Humid outside', type: 'condition' });
        outdoorCondition = true;
      }
    } else if (item.humidity < 30 || item.humidity > 60) {
      notes.push({ text: item.humidity < 30 ? 'Dry indoor air' : 'Humid indoor air', type: 'attention' });
      needsAttention = true;
    }
  }

  if (isValid(item.battery) && item.battery < 15) {
    notes.push({ text: 'Low battery', type: 'attention' });
    needsAttention = true;
  }

  return { notes, needsAttention, outdoorCondition, outdoor };
}

function sensorComfortLabel(item, sensorState) {
  if (sensorState.needsAttention) return 'Check';
  if (sensorState.outdoorCondition) {
    if (isValid(item.humidity) && item.humidity < 20) return 'Very dry';
    if (isValid(item.humidity) && item.humidity > 80) return 'Humid';
    if (isValid(item._tF) && item._tF >= 95) return 'Hot';
    if (isValid(item._tF) && item._tF <= 40) return 'Cold';
    return 'Dry';
  }
  return sensorState.outdoor ? 'Outdoor' : 'Comfort';
}

function displaySensorName(item) {
  return (item.name || 'Unnamed').replace(/^smart\s+/i, '');
}

function updateHouseAlert(items, counts, reasons) {
  const banner = document.getElementById('alertBanner');
  const title = document.getElementById('alertTitle');
  const body = document.getElementById('alertBody');
  const pills = document.getElementById('alertPills');
  const list = document.getElementById('attentionList');
  if (!banner || !title || !body || !pills || !list) return;

  const outdoor = items.find(item => isOutdoorSensor(item)) || items[items.length - 1];
  const indoor = items.filter(item => !isOutdoorSensor(item));
  const indoorStable = indoor.length && indoor.every(item =>
    isValid(item._tF) && item._tF >= 60 && item._tF <= 85 &&
    (!isValid(item.humidity) || (item.humidity >= 30 && item.humidity <= 60))
  );

  let headline = 'House weather looks steady';
  let message = indoorStable ? 'Indoor rooms are inside target range.' : 'Watch indoor rooms for comfort changes.';
  const alertItems = [];

  if (outdoor && isValid(outdoor._tF) && isValid(outdoor.humidity) && outdoor.humidity < 20) {
    headline = `${displaySensorName(outdoor)} is very dry right now`;
    message = `${fmt(outdoor._tF, 1)} F with ${fmt(outdoor.humidity, 0)}% humidity. ${indoorStable ? 'Indoor rooms are stable, so keep windows closed and hydrate.' : 'Check indoor humidity and avoid bringing the dry air inside.'}`;
    alertItems.push({ type: 'bad', title: 'Outdoor humidity is extreme', text: `${fmt(outdoor.humidity, 0)}% is the only out-of-range live sensor value.` });
  } else if (counts.attention > 0) {
    headline = 'A room needs attention';
    message = reasons[0] || 'One or more readings are outside the expected range.';
  } else if (counts.condition > 0) {
    headline = 'Outdoor conditions are notable';
    message = reasons[0] || 'Outdoor readings are outside the usual comfort range.';
  }

  if (outdoor && isValid(outdoor._tF)) {
    alertItems.unshift({
      type: outdoor._tF >= 90 ? 'bad' : 'info',
      title: outdoor._tF >= 90 ? 'Heat is still rising outside' : 'Outdoor trend is calm',
      text: `${displaySensorName(outdoor)} is ${fmt(outdoor._tF, 1)} F right now.`
    });
  }

  if (indoor.length) {
    alertItems.push({
      type: 'info',
      title: indoorStable ? 'Indoor comfort is holding' : 'Indoor comfort needs a look',
      text: indoorStable ? 'Living spaces remain inside target range despite outdoor conditions.' : 'At least one indoor room is outside the preferred range.'
    });
  }

  title.textContent = headline;
  body.textContent = message;
  banner.hidden = false;

  pills.innerHTML = '';
  if (outdoor && isValid(outdoor._tF)) {
    const tempPill = document.createElement('span');
    tempPill.className = 'alert-pill';
    tempPill.textContent = `Outdoor ${fmt(outdoor._tF, 1)} F`;
    pills.appendChild(tempPill);
  }
  if (outdoor && isValid(outdoor.humidity)) {
    const humPill = document.createElement('span');
    humPill.className = 'alert-pill';
    humPill.textContent = `Humidity ${fmt(outdoor.humidity, 0)}%`;
    pills.appendChild(humPill);
  }

  list.innerHTML = alertItems.slice(0, 4).map(item => `
    <div class="attention-item ${item.type}">
      <strong>${item.title}</strong>
      ${item.text}
    </div>
  `).join('');
}

function formatAge(seconds) {
  if (!isValid(seconds)) return '';
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

function updateFreshness(readings) {
  if (!elements.freshness) return;
  elements.freshness.title = 'Govee refreshes automatically in the background';

  const liveAge = readings.last_live_age_seconds;
  const cacheAge = readings.age_seconds;
  const isLog = readings.source === 'log';
  const isRefreshing = readings.refreshing;

  elements.freshness.className = 'chip freshness-chip';

  if (isLog) {
    elements.freshness.textContent = isRefreshing ? 'Last logged · refreshing' : 'Last logged';
    elements.freshness.classList.add('stale');
    return;
  }

  if (isValid(liveAge)) {
    elements.freshness.textContent = `${isRefreshing ? 'Refreshing · ' : 'Live '}${formatAge(liveAge)}`;
    if (liveAge > 180) elements.freshness.classList.add('stale');
    else if (isRefreshing || cacheAge > 45) elements.freshness.classList.add('refreshing');
    return;
  }

  elements.freshness.textContent = isRefreshing ? 'Refreshing' : 'Waiting';
  elements.freshness.classList.add('refreshing');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function alertSeverityClass(alert) {
  const event = (alert.event || '').toLowerCase();
  const severity = (alert.severity || '').toLowerCase();
  if (severity === 'extreme' || event.includes('warning')) return 'severe';
  if (severity === 'severe' || event.includes('watch')) return 'watch';
  if (severity === 'moderate' || event.includes('advisory')) return 'advisory';
  return 'info';
}

function alertRank(alert) {
  const event = (alert.event || '').toLowerCase();
  const severity = (alert.severity || '').toLowerCase();
  if (severity === 'extreme') return 0;
  if (event.includes('warning')) return 1;
  if (severity === 'severe') return 2;
  if (event.includes('watch')) return 3;
  if (event.includes('advisory')) return 4;
  return 5;
}

const US_STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'DC', PR: 'Puerto Rico',
  VI: 'Virgin Islands', GU: 'Guam', AS: 'American Samoa', MP: 'Northern Marianas'
};

const FIPS_TO_STATE = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO',
  '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
  '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY'
};

let usMapCenters = new Map();
let usMapReady = null;

const EXTREME_EVENT_KEYWORDS = [
  'tornado', 'severe thunderstorm', 'flash flood', 'flood', 'hurricane', 'tropical storm',
  'storm surge', 'blizzard', 'winter storm', 'ice storm', 'snow squall', 'high wind',
  'red flag', 'fire weather', 'excessive heat', 'extreme heat', 'freeze', 'tsunami',
  'volcano', 'ashfall', 'coastal flood', 'surf', 'avalanche'
];

const MARINE_UGC_STATE_PREFIXES = {
  PK: 'AK',
  PH: 'HI'
};

function stateCodesFromAlert(alert) {
  const codes = new Set();
  (alert.geocode?.UGC || []).forEach(code => {
    const prefix = String(code).slice(0, 2).toUpperCase();
    const state = MARINE_UGC_STATE_PREFIXES[prefix] || prefix;
    if (US_STATE_NAMES[state]) codes.add(state);
  });
  const areaText = String(alert.areaDesc || '');
  Object.keys(US_STATE_NAMES).forEach(state => {
    const name = US_STATE_NAMES[state];
    const hasStateCode = new RegExp(`,\\s*${state}\\b`).test(areaText);
    const hasStateName = name.length > 2 && new RegExp(`\\b${name.replace(/\s+/g, '\\s+')}\\b`, 'i').test(areaText);
    if (hasStateCode || hasStateName) codes.add(state);
  });
  return [...codes];
}

function stateListLabel(codes) {
  const sorted = [...new Set(codes)].sort((a, b) => {
    if (a === 'AK' || a === 'HI') return -1;
    if (b === 'AK' || b === 'HI') return 1;
    return a.localeCompare(b);
  });
  if (!sorted.length) return 'regional areas';
  if (sorted.length <= 3) return sorted.map(code => US_STATE_NAMES[code] || code).join(', ');
  return `${sorted.slice(0, 3).map(code => US_STATE_NAMES[code] || code).join(', ')} + ${sorted.length - 3} more`;
}

function decodeTopoArcs(topology) {
  const [scaleX, scaleY] = topology.transform.scale;
  const [translateX, translateY] = topology.transform.translate;
  return topology.arcs.map(arc => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scaleX + translateX, y * scaleY + translateY];
    });
  });
}

function resolveTopoArc(arcs, arcIndex) {
  const reversed = arcIndex < 0;
  const arc = arcs[reversed ? -arcIndex - 1 : arcIndex] || [];
  return reversed ? [...arc].reverse() : arc;
}

function collectTopoRing(arcs, ring) {
  const points = [];
  ring.forEach((arcIndex, index) => {
    const arc = resolveTopoArc(arcs, arcIndex);
    points.push(...(index ? arc.slice(1) : arc));
  });
  return points;
}

function topoGeometryToPaths(geometry, arcs) {
  const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs;
  return polygons.map(polygon => (
    polygon.map(ring => {
      const points = collectTopoRing(arcs, ring);
      if (!points.length) return '';
      return `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`;
    }).join('')
  ));
}

function stateCenterFromPaths(paths) {
  const values = paths.join(' ').match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (values.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < values.length; i += 2) {
    minX = Math.min(minX, values[i]);
    maxX = Math.max(maxX, values[i]);
    minY = Math.min(minY, values[i + 1]);
    maxY = Math.max(maxY, values[i + 1]);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

async function renderUsActivityMap() {
  if (!elements.usActivity.map || !elements.usActivity.states) return;
  if (usMapReady) return usMapReady;

  usMapReady = fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/states-albers-10m.json')
    .then(res => {
      if (!res.ok) throw new Error(`US map returned ${res.status}`);
      return res.json();
    })
    .then(topology => {
      const arcs = decodeTopoArcs(topology);
      const bbox = topology.bbox || [-58, 13, 958, 607];
      elements.usActivity.map.setAttribute('viewBox', `${bbox[0]} ${bbox[1]} ${bbox[2] - bbox[0]} ${bbox[3] - bbox[1]}`);

      const paths = [];
      usMapCenters = new Map();
      (topology.objects.states?.geometries || []).forEach(geometry => {
        const code = FIPS_TO_STATE[String(geometry.id).padStart(2, '0')];
        if (!code) return;
        const statePaths = topoGeometryToPaths(geometry, arcs);
        const center = stateCenterFromPaths(statePaths);
        if (center) usMapCenters.set(code, center);
        paths.push(`<path class="us-map-state" data-state="${code}" d="${statePaths.join('')}"><title>${escapeHtml(US_STATE_NAMES[code] || code)}</title></path>`);
      });
      elements.usActivity.states.innerHTML = paths.join('');
    })
    .catch(e => {
      console.warn('US map unavailable', e);
      elements.usActivity.states.innerHTML = '';
    });

  return usMapReady;
}

function markerClassForRank(rank) {
  if (rank <= 3) return 'extreme';
  if (rank <= 12) return 'severe';
  if (rank <= 28) return 'watch';
  return 'advisory';
}

function buildActivityMarkers(activity) {
  const states = new Map();
  activity.forEach((group, groupIndex) => {
    group.states.forEach(code => {
      const point = usMapCenters.get(code);
      if (!point) return;
      const state = states.get(code) || {
        code,
        point,
        count: 0,
        rank: group.rank,
        events: new Set(),
        groups: []
      };
      state.count += group.count;
      state.rank = Math.min(state.rank, group.rank);
      state.events.add(group.event);
      state.groups.push(group.index || groupIndex + 1);
      states.set(code, state);
    });
  });

  return [...states.values()]
    .sort((a, b) => a.rank - b.rank || b.count - a.count)
    .map(state => {
      const radius = clamp(6 + Math.sqrt(state.count) * 2.4, 8, 20);
      const events = [...state.events].slice(0, 2).join(', ');
      const groups = [...new Set(state.groups)].join(',');
      return `
        <g class="us-map-marker ${markerClassForRank(state.rank)}" data-state="${escapeHtml(state.code)}" data-groups="${escapeHtml(groups)}" tabindex="0" role="button" aria-label="${escapeHtml(US_STATE_NAMES[state.code] || state.code)} weather activity" transform="translate(${state.point.x.toFixed(1)} ${state.point.y.toFixed(1)})">
          <circle class="marker-pulse" r="${(radius + 5).toFixed(1)}"></circle>
          <circle class="marker-dot" r="${radius.toFixed(1)}"></circle>
          <text y="4">${escapeHtml(state.code)}</text>
          <title>${escapeHtml(US_STATE_NAMES[state.code] || state.code)}: ${escapeHtml(events)}</title>
        </g>`;
    }).join('');
}

function isInterestingNationalAlert(alert) {
  const event = (alert.event || '').toLowerCase();
  const severity = (alert.severity || '').toLowerCase();
  const urgency = (alert.urgency || '').toLowerCase();
  return severity === 'extreme' ||
    severity === 'severe' ||
    urgency === 'immediate' ||
    event.includes('warning') ||
    event.includes('watch') ||
    EXTREME_EVENT_KEYWORDS.some(keyword => event.includes(keyword));
}

function nationalAlertScore(alert) {
  const event = (alert.event || '').toLowerCase();
  let score = alertRank(alert) * 10;
  if (event.includes('tornado')) score -= 8;
  if (event.includes('flash flood')) score -= 6;
  if (event.includes('hurricane') || event.includes('tropical')) score -= 6;
  if (event.includes('tsunami') || event.includes('volcano')) score -= 6;
  if (stateCodesFromAlert(alert).some(code => code === 'AK' || code === 'HI')) score -= 2;
  return score;
}

function cwaFromNationalAlert(alert) {
  const params = alert.parameters || {};
  const vtec = params.VTEC?.find(Boolean) || '';
  const awips = params.AWIPSidentifier?.find(Boolean) || '';
  const wmo = params.WMOidentifier?.find(Boolean) || '';
  const vtecMatch = vtec.match(/\.([KP][A-Z]{3})\./);
  const wmoMatch = wmo.match(/\b([KP][A-Z]{3})\b/);
  const awipsMatch = awips.match(/[A-Z]{3}$/);

  const office = vtecMatch?.[1] || wmoMatch?.[1];
  if (office) return office.slice(1).toUpperCase();
  return (awipsMatch?.[0] || 'USA').toUpperCase();
}

function buildNationalWeatherAlertUrl(alert) {
  if (alert.event) {
    const params = new URLSearchParams({
      cwa: cwaFromNationalAlert(alert),
      wwa: alert.event
    });
    return `https://forecast.weather.gov/wwamap/wwatxtget.php?${params.toString()}`;
  }

  const featureUrl = alert._featureId || alert['@id'];
  if (featureUrl && /^https?:\/\//i.test(featureUrl)) return featureUrl;
  if (alert.id) return `https://api.weather.gov/alerts/${encodeURIComponent(alert.id)}`;
  return 'https://www.weather.gov/alerts';
}

function simplifyNationalAlertGroup(group) {
  const states = stateListLabel(group.states);
  const countText = group.count === 1 ? '1 active area' : `${group.count} active areas`;
  const sampleArea = group.sampleArea ? ` Example: ${group.sampleArea}.` : '';
  const marker = group.index ? `<em>${group.index}</em>` : '';
  const stateCodes = group.states.join(',');
  const detailUrl = escapeHtml(group.detailUrl || 'https://www.weather.gov/alerts');
  return `<li data-group="${escapeHtml(group.index || '')}" data-states="${escapeHtml(stateCodes)}">
    <a href="${detailUrl}" target="_blank" rel="noopener noreferrer">
      ${marker}<strong>${escapeHtml(group.event)}</strong> in ${escapeHtml(states)}<span>${escapeHtml(countText)}.${escapeHtml(sampleArea)}</span>
    </a>
  </li>`;
}

function clearUsActivityHighlight() {
  document.querySelectorAll('.us-map-marker.is-linked, .us-activity-list li.is-linked')
    .forEach(el => el.classList.remove('is-linked'));
}

function highlightUsActivity({ state = '', group = '' } = {}) {
  clearUsActivityHighlight();
  const groups = group ? String(group).split(',').filter(Boolean) : [];

  if (state) {
    document.querySelectorAll('.us-map-marker').forEach(marker => {
      if (marker.dataset.state === state) marker.classList.add('is-linked');
    });
    document.querySelectorAll('.us-activity-list li').forEach(item => {
      const states = (item.dataset.states || '').split(',');
      if (states.includes(state)) item.classList.add('is-linked');
    });
  }

  groups.forEach(groupId => {
    document.querySelectorAll('.us-activity-list li').forEach(item => {
      if (item.dataset.group === groupId) item.classList.add('is-linked');
    });
  });

  if (group) {
    document.querySelectorAll('.us-map-marker').forEach(marker => {
      const markerGroups = (marker.dataset.groups || '').split(',');
      if (groups.some(groupId => markerGroups.includes(groupId))) marker.classList.add('is-linked');
    });
  }
}

function bindUsActivityInteractions() {
  if (!elements.usActivity.map || !elements.usActivity.list || elements.usActivity.map.dataset.hoverBound) return;
  elements.usActivity.map.dataset.hoverBound = 'true';

  const showMarkerLink = event => {
    const marker = event.target.closest?.('.us-map-marker');
    if (!marker) return;
    highlightUsActivity({ state: marker.dataset.state, group: marker.dataset.groups });
  };
  const hideMapLink = event => {
    if (!event.relatedTarget || !elements.usActivity.map.contains(event.relatedTarget)) clearUsActivityHighlight();
  };
  const showItemLink = event => {
    const item = event.target.closest?.('.us-activity-list li[data-group]');
    if (!item) return;
    highlightUsActivity({ group: item.dataset.group });
  };
  const hideListLink = event => {
    if (!event.relatedTarget || !elements.usActivity.list.contains(event.relatedTarget)) clearUsActivityHighlight();
  };

  elements.usActivity.map.addEventListener('pointerover', showMarkerLink);
  elements.usActivity.map.addEventListener('mouseover', showMarkerLink);
  elements.usActivity.map.addEventListener('pointerout', hideMapLink);
  elements.usActivity.map.addEventListener('mouseout', hideMapLink);
  elements.usActivity.map.addEventListener('focusin', event => {
    const marker = event.target.closest?.('.us-map-marker');
    if (marker) highlightUsActivity({ state: marker.dataset.state, group: marker.dataset.groups });
  });
  elements.usActivity.map.addEventListener('focusout', clearUsActivityHighlight);

  elements.usActivity.list.addEventListener('pointerover', showItemLink);
  elements.usActivity.list.addEventListener('mouseover', showItemLink);
  elements.usActivity.list.addEventListener('pointerout', hideListLink);
  elements.usActivity.list.addEventListener('mouseout', hideListLink);
  elements.usActivity.list.addEventListener('focusin', event => {
    const item = event.target.closest?.('.us-activity-list li[data-group]');
    if (item) highlightUsActivity({ group: item.dataset.group });
  });
  elements.usActivity.list.addEventListener('focusout', clearUsActivityHighlight);
}

async function loadUsWeatherActivity() {
  if (!elements.usActivity.list) return;
  bindUsActivityInteractions();

  elements.usActivity.list.innerHTML = '<li>Scanning active national weather alerts...</li>';
  if (elements.usActivity.markers) elements.usActivity.markers.innerHTML = '';
  if (elements.usActivity.updated) elements.usActivity.updated.textContent = 'Checking NWS';

  try {
    await renderUsActivityMap();
    const res = await fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert', {
      headers: { Accept: 'application/geo+json' }
    });
    if (!res.ok) throw new Error(`National alerts API returned ${res.status}`);

    const data = await res.json();
    const groups = new Map();
    (data.features || [])
      .map(feature => ({ ...(feature.properties || {}), _featureId: feature.id }))
      .filter(alert => alert.event && isInterestingNationalAlert(alert))
      .forEach(alert => {
        const event = alert.event.replace(/\s+/g, ' ').trim();
        const states = stateCodesFromAlert(alert);
        const key = event;
        const current = groups.get(key) || {
          event,
          states: new Set(),
          count: 0,
          rank: nationalAlertScore(alert),
          sampleArea: '',
          detailUrl: ''
        };
        states.forEach(state => current.states.add(state));
        current.count += 1;
        current.rank = Math.min(current.rank, nationalAlertScore(alert));
        if (!current.sampleArea && alert.areaDesc) {
          current.sampleArea = String(alert.areaDesc).split(';').slice(0, 2).join(', ');
        }
        if (!current.detailUrl) current.detailUrl = buildNationalWeatherAlertUrl(alert);
        groups.set(key, current);
      });

    const activity = [...groups.values()]
      .map(group => ({ ...group, states: [...group.states] }))
      .sort((a, b) => a.rank - b.rank || b.count - a.count)
      .slice(0, 6)
      .map((group, index) => ({ ...group, index: index + 1 }));

    if (!activity.length) {
      elements.usActivity.list.innerHTML = '<li>No major active US weather alerts are standing out right now.</li>';
      if (elements.usActivity.markers) elements.usActivity.markers.innerHTML = '';
    } else {
      elements.usActivity.list.innerHTML = activity.map(simplifyNationalAlertGroup).join('');
      if (elements.usActivity.markers) elements.usActivity.markers.innerHTML = buildActivityMarkers(activity);
    }

    if (elements.usActivity.updated) {
      elements.usActivity.updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }
  } catch (e) {
    console.warn('US weather activity unavailable', e);
    elements.usActivity.list.innerHTML = '<li>National weather activity is unavailable right now.</li>';
    if (elements.usActivity.markers) elements.usActivity.markers.innerHTML = '';
    if (elements.usActivity.updated) elements.usActivity.updated.textContent = 'NWS unavailable';
  }
}

function formatAlertTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function nwsIdFromUrl(value) {
  if (!value) return '';
  return String(value).split('/').filter(Boolean).pop() || '';
}

function firstCode(codes, pattern) {
  return (codes || []).find(code => pattern.test(code)) || '';
}

async function loadNwsPointMeta(lat, lon, fallbackPlace) {
  try {
    const pointUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
    const res = await fetch(pointUrl, { headers: { Accept: 'application/geo+json' } });
    if (!res.ok) throw new Error(`Points API returned ${res.status}`);
    const point = await res.json();
    const props = point.properties || {};
    const relative = props.relativeLocation?.properties || {};
    const city = relative.city || fallbackPlace || 'Local Area';
    const state = relative.state || '';

    return {
      forecastZone: nwsIdFromUrl(props.forecastZone),
      county: nwsIdFromUrl(props.county),
      fireWeatherZone: nwsIdFromUrl(props.fireWeatherZone),
      place: state && !city.includes(state) ? `${city} ${state}` : city
    };
  } catch (e) {
    console.warn('NWS point metadata unavailable', e);
    return { forecastZone: '', county: '', fireWeatherZone: '', place: fallbackPlace || 'Local Area' };
  }
}

function buildWeatherAlertUrl(alert, pointMeta, lat, lon) {
  const ugcCodes = alert.geocode?.UGC || [];
  const warnzone = firstCode(ugcCodes, /^[A-Z]{2}Z\d{3}$/) || pointMeta.forecastZone;
  const warncounty = firstCode(ugcCodes, /^[A-Z]{2}C\d{3}$/) || pointMeta.county;
  const firewxzone = pointMeta.fireWeatherZone || warnzone;

  if (!warnzone || !warncounty) {
    return `https://forecast.weather.gov/MapClick.php?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  }

  const params = new URLSearchParams({
    warnzone,
    warncounty,
    firewxzone,
    local_place1: pointMeta.place || 'Local Area',
    product1: alert.event || 'Weather Alert',
    lat: lat.toFixed(4),
    lon: lon.toFixed(4)
  });

  return `https://forecast.weather.gov/showsigwx.php?${params.toString()}`;
}

function compactAlertDetail(alert) {
  const parts = [alert.description, alert.instruction]
    .filter(Boolean)
    .map(part => String(part).trim());
  const raw = parts.join(' ');
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\* WHAT\.\.\./gi, 'What: ')
    .replace(/\* WHERE\.\.\./gi, ' Where: ')
    .replace(/\* WHEN\.\.\./gi, ' When: ')
    .replace(/\* IMPACTS\.\.\./gi, ' Impacts: ')
    .replace(/\* ADDITIONAL DETAILS\.\.\./gi, ' Details: ')
    .replace(/\* PRECAUTIONARY\/PREPAREDNESS ACTIONS\.\.\./gi, ' Safety: ')
    .trim();
}

async function loadWeatherAlerts(lat, lon, locName = 'Local Area') {
  if (!elements.weather.alerts) return;

  elements.weather.alerts.innerHTML = '<div class="weather-alert empty">Checking active weather alerts...</div>';

  try {
    const alertPoint = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const alertsUrl = `https://api.weather.gov/alerts/active?point=${alertPoint}`;
    const [res, pointMeta] = await Promise.all([
      fetch(alertsUrl, { headers: { Accept: 'application/geo+json' } }),
      loadNwsPointMeta(lat, lon, locName)
    ]);
    if (!res.ok) throw new Error(`Alerts API returned ${res.status}`);

    const data = await res.json();
    const alerts = (data.features || [])
      .map(feature => feature.properties || {})
      .filter(alert => alert.event)
      .sort((a, b) => alertRank(a) - alertRank(b));

    if (!alerts.length) {
      elements.weather.alerts.innerHTML = '<div class="weather-alert empty">No active local weather warnings.</div>';
      return;
    }

    elements.weather.alerts.innerHTML = alerts.slice(0, 2).map(alert => {
      const event = escapeHtml(alert.event);
      const area = escapeHtml((alert.areaDesc || '').split(';').slice(0, 2).join(', '));
      const expires = formatAlertTime(alert.expires);
      const timing = expires ? `Until ${escapeHtml(expires)}` : escapeHtml(alert.status || 'Active');
      const headline = escapeHtml(alert.headline || alert.description || '');
      const summary = area || headline.replace(event, '').trim();
      const details = escapeHtml(compactAlertDetail(alert));
      const detailUrl = escapeHtml(buildWeatherAlertUrl(alert, pointMeta, lat, lon));

      return `
        <a class="weather-alert ${alertSeverityClass(alert)}" href="${detailUrl}" target="_blank" rel="noopener noreferrer">
          <div>
            <strong>${event}</strong>
            <span>${summary}</span>
            <span class="weather-alert-detail">${details}</span>
          </div>
          <time>${timing}</time>
        </a>
      `;
    }).join('');
  } catch (e) {
    console.warn('Weather alerts unavailable', e);
    elements.weather.alerts.innerHTML = '<div class="weather-alert empty">Weather alerts unavailable.</div>';
  }
}

const POLLEN_TYPES = [
  { key: 'alder_pollen', label: 'Alder' },
  { key: 'birch_pollen', label: 'Birch' },
  { key: 'grass_pollen', label: 'Grass' },
  { key: 'mugwort_pollen', label: 'Mugwort' },
  { key: 'olive_pollen', label: 'Olive' },
  { key: 'ragweed_pollen', label: 'Ragweed' },
];

function pollenRisk(value) {
  if (!isValid(value) || value <= 0) return { label: 'Low', className: 'low' };
  if (value < 10) return { label: 'Low', className: 'low' };
  if (value < 50) return { label: 'Moderate', className: 'moderate' };
  if (value < 100) return { label: 'High', className: 'high' };
  return { label: 'Very high', className: 'very-high' };
}

function setPollenUnavailable(message) {
  if (!elements.pollen.card) return;
  elements.pollen.card.className = 'card pollen-card unavailable';
  elements.pollen.level.textContent = 'Unavailable';
  elements.pollen.source.textContent = 'Pollen';
  elements.pollen.detail.textContent = message;
  elements.pollen.types.innerHTML = '';
}

async function loadPollen(lat, lon) {
  if (!elements.pollen.card) return;

  elements.pollen.card.className = 'card pollen-card loading';
  elements.pollen.level.textContent = 'Checking';
  elements.pollen.source.textContent = 'Open-Meteo';
  elements.pollen.detail.textContent = 'Looking for local pollen readings...';
  elements.pollen.types.innerHTML = '';

  try {
    const variables = POLLEN_TYPES.map(type => type.key).join(',');
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=${variables}&timezone=auto`;
    const data = await fetch(url).then(r => {
      if (!r.ok) throw new Error(`Pollen API returned ${r.status}`);
      return r.json();
    });

    const current = data.current || {};
    const readings = POLLEN_TYPES
      .map(type => ({ ...type, value: Number(current[type.key]) }))
      .filter(item => isValid(item.value));

    if (!readings.length) {
      setPollenUnavailable('Pollen readings are not available for this area from Open-Meteo.');
      return;
    }

    const top = readings.reduce((best, item) => item.value > best.value ? item : best, readings[0]);
    const risk = pollenRisk(top.value);
    elements.pollen.card.className = `card pollen-card ${risk.className}`;
    elements.pollen.level.textContent = risk.label;
    elements.pollen.source.textContent = 'Current';
    elements.pollen.detail.textContent = top.value > 0
      ? `${top.label} is the highest current reading at ${Math.round(top.value)} grains/m3.`
      : 'No meaningful pollen detected in current Open-Meteo readings.';
    elements.pollen.types.innerHTML = readings
      .sort((a, b) => b.value - a.value)
      .slice(0, 4)
      .map(item => `<span>${item.label} ${Math.round(item.value)}</span>`)
      .join('');
  } catch (e) {
    console.warn('Pollen unavailable', e);
    setPollenUnavailable('Unable to load pollen readings right now.');
  }
}

/* === THEME & SETTINGS === */
function applyTheme(mode, persist = true) {
  document.documentElement.setAttribute('data-theme', mode);
  elements.buttons.themeDark.classList.toggle('active', mode === 'dark');
  elements.buttons.themeLight.classList.toggle('active', mode === 'light');
  elements.buttons.themeDark.hidden = mode === 'dark';
  elements.buttons.themeLight.hidden = mode === 'light';
  elements.buttons.themeDark.setAttribute('aria-hidden', mode === 'dark' ? 'true' : 'false');
  elements.buttons.themeLight.setAttribute('aria-hidden', mode === 'light' ? 'true' : 'false');
  if (persist) localStorage.setItem(THEME_KEY, mode);
}

function applyUnitButtons() {
  elements.buttons.unitF.classList.toggle('active', unit === 'F');
  elements.buttons.unitC.classList.toggle('active', unit === 'C');
  elements.buttons.unitF.hidden = unit === 'F';
  elements.buttons.unitC.hidden = unit === 'C';
  elements.buttons.unitF.setAttribute('aria-hidden', unit === 'F' ? 'true' : 'false');
  elements.buttons.unitC.setAttribute('aria-hidden', unit === 'C' ? 'true' : 'false');
}

function setUnit(nextUnit) {
  unit = nextUnit;
  localStorage.setItem(UNIT_KEY, nextUnit);
  applyUnitButtons();
  loadData();
  renderLocationStrip();
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

  // Insights refresh button
  const refreshInsights = document.getElementById('refreshInsights');
  if (refreshInsights) {
    refreshInsights.onclick = () => {
      const icon = refreshInsights.querySelector('.icon');
      if (icon) icon.classList.add('spin');
      loadAlmanacInsights(true).finally(() => {
        setTimeout(() => {
          if (icon) icon.classList.remove('spin');
        }, 800);
      });
    };
  }

  const closeLocations = document.getElementById('closeLocationManager');
  const locationModal = document.getElementById('locationModal');
  if (closeLocations) closeLocations.onclick = closeLocationManager;
  if (locationModal) {
    locationModal.onclick = (event) => {
      if (event.target === locationModal) closeLocationManager();
    };
  }
}

/* === INTERACTIVE CHARTING === */
function smoothSparkValues(values, radius = 4) {
  if (!Array.isArray(values) || values.length < 4) return values;
  return values.map((value, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    const slice = values.slice(start, end + 1);
    return slice.reduce((sum, n) => sum + n, 0) / slice.length;
  });
}

function smoothStep(t) {
  return t * t * (3 - 2 * t);
}

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

  const rawValues = data.map(d => d.val);
  const values = smoothSparkValues(rawValues, 4);
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

    const sourcePoints = values.map((_, i) => getPt(i));
    const points = [];
    const samplesPerSegment = 6;

    for (let i = 0; i < sourcePoints.length - 1; i++) {
      const start = sourcePoints[i];
      const end = sourcePoints[i + 1];
      if (i === 0) points.push(start);

      for (let sample = 1; sample <= samplesPerSegment; sample++) {
        const t = sample / samplesPerSegment;
        const eased = smoothStep(t);
        points.push({
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * eased
        });
      }
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
       ctx.lineTo(points[i].x, points[i].y);
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

// Debounced Resize Observer
let resizeTimeout;
const resizeObserver = new ResizeObserver(entries => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    entries.forEach(entry => {
      const canvas = entry.target;
      if(canvas.id === 'sunCanvas') return;
      try {
        const points = JSON.parse(canvas.dataset.series || '[]');
        if (points.length) requestAnimationFrame(() => drawSpark(canvas, points));
      } catch(e) {}
    });
  }, 100); // 100ms debounce
});

/* === AI INSIGHTS LOGIC === */
function getTimeAgo(timestamp) {
  if (!timestamp) return '';
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return 'Updated just now';
  if (diffMins < 60) return `Updated ${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
  if (diffHours < 24) return `Updated ${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `Updated ${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
}

async function loadAlmanacInsights(forceRefresh = false) {
  const container = document.getElementById('aiInsights');
  const timestampEl = document.getElementById('aiInsightsTimestamp');
  if (!container) return;

  // Save scroll position and container height to prevent scroll jump
  const scrollY = window.scrollY;
  const containerHeight = container.offsetHeight;

  // Set min-height to prevent layout shift during loading
  if (containerHeight > 0) {
    container.style.minHeight = `${containerHeight}px`;
  }

  container.innerHTML = '<div class="skeleton" style="height:16px; margin-bottom:6px; width:100%;"></div><div class="skeleton" style="height:16px; margin-bottom:6px; width:95%;"></div><div class="skeleton" style="height:16px; width:90%;"></div>';
  if (timestampEl) timestampEl.textContent = '';

  // Restore scroll position after DOM update
  window.scrollTo(0, scrollY);

  try {
    const url = forceRefresh ? '/api/almanac/insights?refresh=1' : '/api/almanac/insights';
    const res = await fetch(url);
    if (!res.ok) {
      container.innerHTML = '<div style="font-size:12px; color:var(--muted); font-style:italic;">Insights unavailable</div>';
      container.style.minHeight = '';
      window.scrollTo(0, scrollY);
      return;
    }

    const data = await res.json();
    const insights = data.insights || [];

    if (insights.length === 0) {
      container.innerHTML = '<div style="font-size:12px; color:var(--muted); font-style:italic;">No insights available</div>';
      container.style.minHeight = '';
      window.scrollTo(0, scrollY);
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

    // Update timestamp
    if (timestampEl && data.timestamp) {
      const timeAgo = getTimeAgo(data.timestamp);
      const cacheStatus = data.cached ? ' (cached)' : ' (fresh)';
      timestampEl.textContent = timeAgo + cacheStatus;
    }

    // Clear min-height and restore scroll position after rendering
    container.style.minHeight = '';
    window.scrollTo(0, scrollY);
  } catch (e) {
    console.error("AI insights error", e);
    container.innerHTML = '<div style="font-size:12px; color:var(--muted); font-style:italic;">Failed to load insights</div>';
    container.style.minHeight = '';
    window.scrollTo(0, scrollY);
  }
}

/* === LOCATION STRIP === */
function getSelectedLocationIds() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCATIONS_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) {
      return saved.filter(id => LOCATION_PRESETS.some(loc => loc.id === id));
    }
  } catch {}
  return DEFAULT_LOCATION_IDS;
}

function getSelectedLocations() {
  const ids = getSelectedLocationIds();
  return LOCATION_PRESETS.filter(loc => ids.includes(loc.id));
}

function saveSelectedLocationIds(ids) {
  const clean = ids.filter(id => LOCATION_PRESETS.some(loc => loc.id === id));
  localStorage.setItem(LOCATIONS_KEY, JSON.stringify(clean.length ? clean : DEFAULT_LOCATION_IDS));
}

function renderLocationManager() {
  const options = document.getElementById('locationOptions');
  if (!options) return;

  const selected = new Set(getSelectedLocationIds());
  options.innerHTML = LOCATION_PRESETS.map(loc => `
    <label class="location-option">
      <input type="checkbox" value="${loc.id}" ${selected.has(loc.id) ? 'checked' : ''}>
      <span>${loc.name}</span>
    </label>
  `).join('');

  options.querySelectorAll('input').forEach(input => {
    input.onchange = () => {
      const ids = Array.from(options.querySelectorAll('input:checked')).map(item => item.value);
      saveSelectedLocationIds(ids);
      loadLocationStrip();
    };
  });
}

function openLocationManager() {
  renderLocationManager();
  const modal = document.getElementById('locationModal');
  if (modal) modal.hidden = false;
}

function closeLocationManager() {
  const modal = document.getElementById('locationModal');
  if (modal) modal.hidden = true;
}

function renderLocationStrip() {
  const strip = document.getElementById('locationStrip');
  if (!strip || !_locationData) return;

  const cards = _locationData.map(loc => {
    if (!loc.current) {
      return `<div class="loc-card">
        <div class="loc-name">${loc.name}</div>
        <div class="loc-temp-row"><span class="loc-temp">—</span></div>
      </div>`;
    }
    const tempF = loc.current.temperature_2m;
    const hiF   = loc.daily_high;
    const loF   = loc.daily_low;
    const code  = loc.current.weathercode;
    const disp  = v => Math.round(unit === 'C' ? fToC(v) : v);
    const desc  = WEATHER_DESC[code] || '';
    return `<div class="loc-card">
      <div class="loc-name">${loc.name}</div>
      <div class="loc-temp-row">
        <span class="loc-temp">${disp(tempF)}°</span>
        <span class="loc-icon">${getIcon(code)}</span>
      </div>
      <div class="loc-hi-lo">
        <span class="lo">${disp(loF)}°</span>
        <span style="opacity:.4"> / </span>
        <span class="hi">${disp(hiF)}°</span>
        <span style="opacity:.5; font-size:10px; margin-left:3px;">${desc}</span>
      </div>
    </div>`;
  }).join('');

  strip.innerHTML = `${cards}
    <button class="loc-card loc-edit-card" id="editLocations" type="button">
      <span class="loc-name">Locations</span>
      <span class="loc-edit-label">Edit</span>
    </button>`;

  const edit = document.getElementById('editLocations');
  if (edit) edit.onclick = openLocationManager;
}

async function loadLocationStrip() {
  const strip = document.getElementById('locationStrip');
  if (!strip) return;
  const locations = getSelectedLocations();

  // Skeleton placeholders
  strip.innerHTML = locations.map(() =>
    `<div class="loc-card skeleton" style="height:74px;"></div>`
  ).join('') + `<button class="loc-card loc-edit-card" id="editLocations" type="button"><span class="loc-name">Locations</span><span class="loc-edit-label">Edit</span></button>`;

  const loadingEdit = document.getElementById('editLocations');
  if (loadingEdit) loadingEdit.onclick = openLocationManager;

  const results = await Promise.allSettled(
    locations.map(loc => {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
        `&current=temperature_2m,weathercode&daily=temperature_2m_max,temperature_2m_min` +
        `&temperature_unit=fahrenheit&forecast_days=1&timezone=auto`;
      return fetch(url).then(r => r.json()).then(data => ({ ...loc, data }));
    })
  );

  _locationData = results.map((r, i) => {
    if (r.status !== 'fulfilled') return { name: locations[i].name, current: null };
    const d = r.value.data;
    return {
      name:       r.value.name,
      current:    d.current   || null,
      daily_high: (d.daily?.temperature_2m_max || [])[0] ?? null,
      daily_low:  (d.daily?.temperature_2m_min || [])[0] ?? null,
    };
  });

  renderLocationStrip();
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
  const elHigh = document.getElementById('almHigh');
  const elLow = document.getElementById('almLow');
  const elDelta = document.getElementById('almDelta');
  const histContainer = document.getElementById('almHistory');

  // Show loading state
  if(elHigh) elHigh.innerHTML = '<span style="opacity:0.5">...</span>';
  if(elLow) elLow.innerHTML = '<span style="opacity:0.5">...</span>';
  if(elDelta) elDelta.innerHTML = '<span style="opacity:0.5">Loading...</span>';

  try {
    const res = await fetch('/api/almanac', { timeout: 20000 });

    if (!res.ok) {
      throw new Error(`API returned ${res.status}`);
    }

    const hist = await res.json();

    if (hist.error || !hist.avg_high || !hist.avg_low) {
      throw new Error('Invalid almanac data');
    }

    if(elHigh) elHigh.textContent = Math.round(hist.avg_high);
    if(elLow) elLow.textContent = Math.round(hist.avg_low);

    const todayHigh = weatherData.daily.temperature_2m_max[0];
    const diff = todayHigh - hist.avg_high;

    const pct = ((diff / hist.avg_high) * 100).toFixed(1);
    const sign = diff > 0 ? '+' : '';
    const color = diff > 0 ? '#fbbf24' : '#3b82f6';

    if(elDelta) elDelta.innerHTML = `<span style="color:${color}">${sign}${Math.round(diff)}°F <span style="opacity:0.7; font-size:11px">(${sign}${pct}%)</span></span>`;

    // 3. Render History Grid
    if (histContainer && hist.history) {
        let html = '<div class="hist-grid">';
        hist.history.forEach(item => {
            const lowColor = item.low < 40 ? '#38bdf8' : (item.low > 80 ? '#fbbf24' : 'inherit');
            html += `
              <div class="hist-item">
                <span class="hist-year">${item.year}</span>
                <div class="hist-vals">
                  <span style="color:${lowColor}; font-weight:600;">${Math.round(item.low)}°</span>
                  <span>${Math.round(item.high)}°</span>
                </div>
              </div>
            `;
        });
        html += '</div>';
        histContainer.innerHTML = html;
    }

  } catch (e) {
    console.error("Almanac error:", e);

    // Show error state with user-friendly message
    if(elHigh) elHigh.innerHTML = '<span style="opacity:0.5">--</span>';
    if(elLow) elLow.innerHTML = '<span style="opacity:0.5">--</span>';
    if(elDelta) elDelta.innerHTML = '<span style="opacity:0.5; font-size:11px">Historical data unavailable</span>';

    if(histContainer) {
      histContainer.innerHTML = `<div style="text-align:center; padding:12px; opacity:0.5; font-size:11px;">
        Unable to load historical climate data. This may be due to a network issue or API timeout.
      </div>`;
    }
  }
}

/* === SENSOR DATA LOGIC === */
function renderSensors(data, history) {
  elements.count.textContent = data.items.length;
  const now = Date.now();
  let attentionCount = 0;
  let outdoorConditionCount = 0;
  const headerReasons = [];

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
          <div class="sensor-tags"></div>
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
    const sensorState = getSensorNotes(item, minsAgo);

    if (sensorState.needsAttention) {
      attentionCount++;
      headerReasons.push(`${displaySensorName(item)}: ${sensorState.notes.filter(n => n.type === 'attention').map(n => n.text).join(', ')}`);
    } else if (sensorState.outdoorCondition) {
      outdoorConditionCount++;
      headerReasons.push(`${displaySensorName(item)}: ${sensorState.notes.filter(n => n.type === 'condition').map(n => n.text).join(', ')}`);
    }

    const stateClass = sensorState.needsAttention ? 'attention-card' : (sensorState.outdoorCondition ? 'condition-card' : '');
    card.className = `card sensor-card ${cls} ${staleClass} ${stateClass}`;

    card.querySelector('.name').textContent = displaySensorName(item);
    card.querySelector('.device').textContent = item.device;
    card.querySelector('.temp').textContent = fmt(displayTemp, 1);
    card.querySelector('.unit').textContent = `\u00b0${unit}`;

    const tagWrap = card.querySelector('.sensor-tags');
    tagWrap.innerHTML = '';
    const stateTag = document.createElement('span');
    stateTag.className = `sensor-tag ${sensorState.needsAttention ? 'attention' : (sensorState.outdoorCondition ? 'condition' : '')}`;
    stateTag.textContent = sensorComfortLabel(item, sensorState);
    tagWrap.appendChild(stateTag);
    
    const humBadge = card.querySelector('.humidity-badge');
    humBadge.textContent = isValid(item.humidity) ? `${fmt(item.humidity, 0)}%` : '--%';
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
    const updatedText = minsAgo > 60 ? `${Math.round(minsAgo / 60)}h ago` : `${Math.max(0, Math.round(minsAgo))}m ago`;
    const reasonText = sensorState.notes.length ? sensorState.notes.map(n => n.text).join(' / ') : 'Within expected range';
    statusDiv.innerHTML = `<span>Updated ${updatedText}</span><span class="status-reason">${reasonText}</span><span class="history-label">24h</span>`;
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

  // Update alert badge
  const alertBadge = document.getElementById('alertCount');
  if (alertBadge) {
    if (attentionCount > 0) {
      alertBadge.textContent = `Attention ${attentionCount}`;
      alertBadge.className = 'chip alert-chip attention';
      alertBadge.title = headerReasons.join('\n');
      alertBadge.style.display = '';
    } else if (outdoorConditionCount > 0) {
      alertBadge.textContent = `Outdoor condition ${outdoorConditionCount}`;
      alertBadge.className = 'chip alert-chip condition';
      alertBadge.title = headerReasons.join('\n');
      alertBadge.style.display = '';
    } else {
      alertBadge.title = '';
      alertBadge.style.display = 'none';
    }
  }

  updateHouseAlert(processedItems, { attention: attentionCount, condition: outdoorConditionCount }, headerReasons);
}

async function loadData() {
  try {
    // --- REFRESH ANIMATION UPDATE ---
    // Instead of adding .pulse to the wrapper, we toggle .spin on the icon itself
    const refreshIcon = elements.buttons.refresh?.querySelector('.icon');
    if (refreshIcon) refreshIcon.classList.add('spin');

    const [rRead, rHist] = await Promise.all([
      fetch('/api/readings'), fetch('/api/history')
    ]);

    // Check if API calls succeeded
    if (!rRead.ok) {
      throw new Error(`Readings API failed: ${rRead.status}`);
    }

    const readings = await rRead.json();
    const history = await rHist.json();

    // Only render if we have data - prevents panels from disappearing on empty response
    if (readings && readings.items && readings.items.length > 0) {
      renderSensors(readings, history.series || {});
      updateFreshness(readings);
      elements.notice.textContent = ""; // Clear any error message
    } else {
      console.warn("API returned empty sensor data - preserving existing panels");
      elements.notice.textContent = "⚠ No sensor data received";
    }

    setTimeout(() => {
        if (refreshIcon) refreshIcon.classList.remove('spin');
    }, 800); // Min spin time to feel responsive

  } catch (e) {
    console.error("loadData error:", e);
    elements.notice.textContent = `⚠ API Error: ${e.message}`;

    // Stop refresh animation even on error
    const refreshIcon = elements.buttons.refresh?.querySelector('.icon');
    if (refreshIcon) refreshIcon.classList.remove('spin');
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

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weathercode,wind_speed_10m,wind_direction_10m,wind_gusts_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,sunrise,sunset&hourly=temperature_2m&temperature_unit=fahrenheit&windspeed_unit=mph&forecast_days=11&timezone=auto`;
  
  try {
    const data = await fetch(url).then(r=>r.json());
    document.querySelectorAll('.skeleton').forEach(el => el.classList.remove('skeleton'));

    elements.weather.loc.textContent = locName;
    elements.weather.temp.textContent = data.current.temperature_2m.toFixed(1);
    elements.weather.hum.textContent = `Humidity ${data.current.relative_humidity_2m}%`;
    elements.weather.wind.textContent = `Wind ${data.current.wind_speed_10m} mph`;
    
    const code = data.current.weathercode;
    const desc = WEATHER_DESC[code] || "Unknown";
    const timeStr = new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
    applyWeatherScene(code, data.daily, data.current);
    if (elements.weather.condition) elements.weather.condition.textContent = desc.replace(' Sky', '');
    elements.weather.status.textContent = `${desc}, updated ${timeStr}`;

    const d = data.daily;
    elements.weather.daily.textContent = `Today ${Math.round(d.temperature_2m_min[0])} / ${Math.round(d.temperature_2m_max[0])} F with ${d.precipitation_probability_max[0]}% rain.`;

    let html = '';
    const forecastCount = Math.min(10, d.time.length);
    const lows = d.temperature_2m_min.slice(0, forecastCount);
    const highs = d.temperature_2m_max.slice(0, forecastCount);
    const rangeMin = Math.min(...lows);
    const rangeMax = Math.max(...highs);
    const hourlyTempsByDay = buildHourlyTempsByDay(data.hourly);
    const chartTemps = d.time.slice(0, forecastCount).flatMap(day => hourlyTempsByDay.get(day) || []);
    const chartMin = Math.min(rangeMin, ...(chartTemps.length ? chartTemps : lows));
    const chartMax = Math.max(rangeMax, ...(chartTemps.length ? chartTemps : highs));
    const maxRain = Math.max(...d.precipitation_probability_max.slice(0, forecastCount));
    if (elements.weather.rainBadge) {
      elements.weather.rainBadge.textContent = maxRain < 5 ? 'Rain risk stays under 5%' : `Peak rain risk ${maxRain}%`;
    }

    for(let i=0; i<forecastCount; i++) {
      const date = new Date(d.time[i] + 'T00:00:00');
      const dayName = i === 0 ? 'Today' : date.toLocaleDateString('en-US', {weekday:'short'});
      const low = Math.round(d.temperature_2m_min[i]);
      const high = Math.round(d.temperature_2m_max[i]);
      const tempHill = createTempHillSvg(i, hourlyTempsByDay.get(d.time[i]) || [], chartMin, chartMax, low, high);
      html += `
        <div class="forecast-tile">
          <div class="day">${dayName}</div>
          <div class="icon">${getIcon(d.weathercode[i])}</div>
          <div class="temps"><span class="low">${low}</span><span class="high">${high}</span></div>
          ${tempHill}
          <div class="rain">${d.precipitation_probability_max[i]}% rain</div>
        </div>`;
    }
    elements.weather.upcoming.innerHTML = html;

    // Weather Sparkline
    const hourly = data.hourly.temperature_2m.slice(0, 24).map(v => ({ val: v })); 
    drawSpark(elements.weather.canvas, hourly);
    loadWeatherAlerts(lat, lon, locName);
    loadPollen(lat, lon);

    // Trigger Almanac & AI Insights
    loadAlmanac(data);
    loadAlmanacInsights();

  } catch (e) {
    elements.weather.status.textContent = "Weather Unavailable";
  }
}

/* === INIT === */
initSettings();

// Initialize unit buttons based on saved preference
applyUnitButtons();

loadData();
loadWeather();
loadLocationStrip();
loadUsWeatherActivity();
setInterval(loadData, 60000);
setInterval(loadWeather, 900000);
setInterval(loadLocationStrip, 15 * 60 * 1000);
setInterval(loadUsWeatherActivity, 15 * 60 * 1000);

// Export function
function exportData() {
  // Create a link to download the CSV file
  const link = document.createElement('a');
  link.href = '/govee_readings.csv';
  link.download = `govee_readings_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Event Listeners
const exportBtn = document.getElementById('exportBtn');
if (exportBtn) exportBtn.onclick = exportData;
if (elements.buttons.refresh) elements.buttons.refresh.onclick = loadData;
elements.buttons.unitF.onclick = () => setUnit('F');
elements.buttons.unitC.onclick = () => setUnit('C');
