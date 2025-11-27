/* ============================================================
   utils.js — Shared small helper functions
============================================================ */

export function fmt(n, dp = 1) {
  return (n !== null && n !== undefined && isFinite(n))
    ? Number(n).toFixed(dp)
    : "—";
}

export function cToF(c) {
  return (c * 9 / 5) + 32;
}

export function fToC(f) {
  return (f - 32) * 5 / 9;
}

export function classifyF(f) {
  if (!isFinite(f)) return "comfy";
  if (f < 68) return "cool";
  if (f <= 78) return "comfy";
  if (f <= 84) return "warm";
  return "hot";
}

export function batteryClass(p) {
  if (!isFinite(p)) return "battery-unknown";
  if (p >= 60) return "battery-ok";
  if (p >= 30) return "battery-mid";
  if (p >= 15) return "battery-low";
  return "battery-crit";
}

export function getVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/* Smooth a series by moving average */
export function smoothSeries(values, window = 4) {
  if (!Array.isArray(values) || values.length < 3) return values;
  
  const smoothed = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(values.length - 1, i + window);
    const slice = values.slice(start, end + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    smoothed.push(Number(avg.toFixed(2)));
  }
  return smoothed;
}

/* Convert wind degrees → compass string */
export function degToCompass(num) {
  const val = Math.floor((num / 22.5) + 0.5);
  const dirs = [
    "N","NNE","NE","ENE","E","ESE","SE","SSE",
    "S","SSW","SW","WSW","W","WNW","NW","NNW"
  ];
  return dirs[val % 16];
}
