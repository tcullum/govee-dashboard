/* ============================================================
   weather.js — Local weather + 7-day forecast panel
============================================================ */

import { drawSparkline } from "./sparkline.js";
import { degToCompass } from "./utils.js";

const elLoc = document.getElementById("weatherLocation");
const elTemp = document.getElementById("weatherTemp");
const elHumid = document.getElementById("weatherHumidity");
const elWind = document.getElementById("weatherWind");
const elStatus = document.getElementById("weatherStatus");
const elDaily = document.getElementById("weatherDaily");
const elUpcoming = document.getElementById("weatherUpcoming");
const elCanvas = document.getElementById("weatherForecast");

const FALLBACK = { lat: 36.17, lon: -115.14, label: "Las Vegas (fallback)" };

const CONDITIONS = {
  0: "☀️ Clear",
  1: "🌤 Mostly Clear",
  2: "⛅️ Partly Cloudy",
  3: "☁️ Cloudy",
  45: "🌫 Fog",
  48: "🌫 Fog",
  51: "🌦 Drizzle",
  61: "🌧 Rain",
  71: "🌨 Snow",
  80: "🌦 Showers",
  95: "⛈ Storms",
};

async function getLocation() {
  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    return FALLBACK;
  }

  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
    );
    return {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      label: "Your Location",
    };
  } catch (err) {
    console.warn("Geolocation failed:", err);
    return FALLBACK;
  }
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
    );
    if (!res.ok) return null;

    const geo = await res.json();
    const city = geo.city || geo.locality;
    const region = geo.principalSubdivision;

    return (city ? city : "") + (region ? `, ${region}` : "");
  } catch {
    return null;
  }
}

export async function loadWeather() {
  try {
    const { lat, lon, label: fallbackLabel } = await getLocation();

    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,weathercode,wind_speed_10m,wind_direction_10m` +
      `&hourly=temperature_2m` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,wind_speed_10m_max,wind_direction_10m_dominant` +
      `&temperature_unit=fahrenheit&windspeed_unit=mph&forecast_days=10&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) throw new Error("Weather API error");
    const data = await res.json();

    let label = await reverseGeocode(lat, lon);
    if (!label) label = fallbackLabel;

    elLoc.textContent = label;

    const cur = data.current;
    const condText = CONDITIONS[cur.weathercode] || "🌤 Fair";

    elTemp.textContent = cur.temperature_2m.toFixed(1);
    elHumid.textContent = `💧 ${cur.relative_humidity_2m}%`;
    elWind.textContent = `💨 ${Math.round(cur.wind_speed_10m)} mph ${degToCompass(cur.wind_direction_10m)}`;

    elStatus.textContent =
      `${condText} • Updated ` +
      new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const d = data.daily;
    const hi = Math.round(d.temperature_2m_max[0]);
    const lo = Math.round(d.temperature_2m_min[0]);
    const rain = Math.round(d.precipitation_probability_max[0]);

    elDaily.innerHTML = `<strong>Today:</strong> ${lo}° / ${hi}° • ${rain}% rain`;

    renderUpcoming(d);
    drawSparkline(elCanvas, data.hourly.temperature_2m.slice(0, 24), "#60a5fa");
  } catch (err) {
    console.error("Weather failed:", err);
    elStatus.textContent = "Unable to load weather data.";
    elDaily.textContent = "";
    elUpcoming.innerHTML = "";
  }
}

function renderUpcoming(d) {
  let html = "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = d.time.map((t, i) => {
    const utc = new Date(`${t}T00:00:00Z`);
    const local = new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
    return {
      date: local,
      hi: Math.round(d.temperature_2m_max[i]),
      lo: Math.round(d.temperature_2m_min[i]),
      rain: Math.round(d.precipitation_probability_max[i]),
      code: d.weathercode[i],
      wind: Math.round(d.wind_speed_10m_max[i]),
      dir: degToCompass(d.wind_direction_10m_dominant[i]),
    };
  });

  const startIndex = days.findIndex(day => day.date > today);
  const upcoming = days.slice(startIndex, startIndex + 7);

  upcoming.forEach(day => {
    const label = day.date.toLocaleDateString(undefined, { weekday: "short" });
    const icon = (CONDITIONS[day.code] || "").split(" ")[0] || "🌤";

    html += `
      <div class="forecast-tile">
        <div class="day">${label}</div>
        <div class="icon">${icon}</div>
        <div class="temps">${day.lo}° / ${day.hi}°</div>
        <div class="rain">${day.rain}% rain</div>
        <div class="wind">💨 ${day.wind} mph ${day.dir}</div>
      </div>
    `;
  });

  elUpcoming.innerHTML = html;
}

/* Initialize weather loop */
export function initWeather() {
  loadWeather();
  setInterval(loadWeather, 1800000);
}
