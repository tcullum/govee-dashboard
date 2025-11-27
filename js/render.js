/* ============================================================
   render.js — Render sensor cards + update UI
============================================================ */

import {
  cToF,
  fToC,
  classifyF,
  batteryClass,
  fmt,
  smoothSeries,
  getVar
} from "./utils.js";
import { unit } from "./unit.js";
import { makeCardDraggable, moveDevice, orderItems } from "./order.js";
import { drawSparkline } from "./sparkline.js";

const grid = document.getElementById("grid");
const countEl = document.getElementById("count");

/* ============================================================
   buildCard()
   Internal helper: builds an empty card DOM
============================================================ */
function buildCard(sensor) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.device = sensor.device || "";

  /* ---------- Title Row ---------- */
  const top = document.createElement("div");
  top.className = "toprow";

  const title = document.createElement("div");
  title.className = "title";

  const nameEl = document.createElement("div");
  nameEl.className = "name";
  nameEl.textContent = sensor.name || "Unnamed Sensor";

  const devEl = document.createElement("div");
  devEl.className = "device";
  devEl.textContent = sensor.device || "";

  title.append(nameEl, devEl);
  top.append(title);

  /* Drag handle */
  const handle = document.createElement("div");
  handle.className = "handle";
  handle.innerHTML = `<div class="grip">⋮⋮</div>`;
  top.append(handle);

  /* ---------- Reorder Controls ---------- */
  const reorderWrap = document.createElement("div");
  reorderWrap.className = "reorder-controls";
  reorderWrap.innerHTML = `
    <button class="btn small up">▲</button>
    <button class="btn small down">▼</button>
  `;
  top.append(reorderWrap);

  /* ---------- Reading Row ---------- */
  const reading = document.createElement("div");
  reading.className = "reading";

  const tempWrap = document.createElement("div");
  tempWrap.className = "temp-wrap";

  const tempEl = document.createElement("span");
  tempEl.className = "temp";

  const unitEl = document.createElement("span");
  unitEl.className = "unit";
  unitEl.textContent = `°${unit}`;

  tempWrap.append(tempEl, unitEl);

  const badges = document.createElement("div");
  badges.className = "badges";

  const humidity = document.createElement("div");
  humidity.className = "chip humidity-badge";
  badges.append(humidity);

  const battery = document.createElement("div");
  battery.className = "chip battery-badge";
  badges.append(battery);

  reading.append(tempWrap, badges);

  /* ---------- Sparkline Canvas ---------- */
  const canvas = document.createElement("canvas");
  canvas.className = "spark";

  /* ---------- Status ---------- */
  const status = document.createElement("div");
  status.className = "status";

  /* ---------- Assemble ---------- */
  card.append(top, reading, canvas, status);

  // Store references for updates
  card._tempEl = tempEl;
  card._unitEl = unitEl;
  card._humidityEl = humidity;
  card._batteryEl = battery;
  card._canvas = canvas;
  card._status = status;

  makeCardDraggable(card);
  return card;
}

/* ============================================================
   updateCard()
   Updates one card given sensor + history
============================================================ */
function updateCard(card, sensor, historySeries) {
  const tempC = (typeof sensor.temp_c === "number" && isFinite(sensor.temp_c))
    ? sensor.temp_c
    : (typeof sensor.temp_f === "number" && isFinite(sensor.temp_f)
        ? fToC(sensor.temp_f)
        : NaN);

  const tempF = isFinite(tempC) ? cToF(tempC) : NaN;
  const displayTemp = unit === "F" ? tempF : tempC;
  const cls = classifyF(tempF);

  // Temperature
  if (isFinite(displayTemp)) {
    card._tempEl.textContent = fmt(displayTemp, 1);
    card._tempEl.className = `temp ${cls}`;
    card._unitEl.textContent = `°${unit}`;
  } else {
    card._tempEl.textContent = "—";
    card._tempEl.className = "temp";
  }

  // Humidity
  const hum = sensor.humidity;
  if (hum != null && isFinite(hum)) {
    card._humidityEl.textContent = `${fmt(hum, 0)}%`;
    card._humidityEl.classList.remove("humidity-ok","humidity-warn","humidity-bad");
    if (hum >= 30 && hum <= 60) card._humidityEl.classList.add("humidity-ok");
    else if ((hum > 20 && hum < 30) || (hum > 60 && hum < 70)) card._humidityEl.classList.add("humidity-warn");
    else card._humidityEl.classList.add("humidity-bad");
  } else {
    card._humidityEl.textContent = "—%";
  }

  // Battery
  const bat = sensor.battery;
  card._batteryEl.className = "chip battery-badge " + batteryClass(bat);
  if (bat != null && isFinite(bat)) {
    card._batteryEl.textContent = `${fmt(bat, 0)}%`;
  } else {
    card._batteryEl.textContent = "—";
  }

  // Status text
  const statusParts = [];
  if (sensor.timestamp) {
    const ts = new Date(sensor.timestamp);
    statusParts.push(`Updated: ${ts.toLocaleString()}`);
  }
  if (bat != null && bat < 15) statusParts.push("LOW BATTERY");
  card._status.textContent = statusParts.join(" • ");

  // Sparkline from history
  if (card._canvas && historySeries && historySeries.length) {
    const values = historySeries
      .map(p => {
        let c = null;
        if (typeof p.temp_c === "number" && isFinite(p.temp_c)) c = p.temp_c;
        else if (typeof p.temp_f === "number" && isFinite(p.temp_f)) c = fToC(p.temp_f);
        if (!isFinite(c)) return null;
        return unit === "F" ? cToF(c) : c;
      })
      .filter(v => v !== null && isFinite(v));

    const sm = smoothSeries(values, 2);
    const color =
      cls === "hot"  ? getVar("--hot") :
      cls === "warm" ? getVar("--warm") :
      cls === "cool" ? getVar("--cool") :
                       getVar("--accent");

    drawSparkline(card._canvas, sm, color || "#60a5fa");
  }
}

/* ============================================================
   renderAll(sensors, historyMap)
============================================================ */
export function renderAll(sensors, historyMap) {
  const items = orderItems((sensors || []).slice());
  countEl.textContent = items.length.toString();

  grid.innerHTML = "";
  if (!items.length) return;

  const frag = document.createDocumentFragment();

  items.forEach(sensor => {
    const card = buildCard(sensor);
    const hist = (historyMap[sensor.device] || []).slice(-100);

    // Wire reorder buttons
    const upBtn = card.querySelector(".reorder-controls .up");
    const downBtn = card.querySelector(".reorder-controls .down");
    if (upBtn) upBtn.addEventListener("click", () => moveDevice(sensor.device, -1));
    if (downBtn) downBtn.addEventListener("click", () => moveDevice(sensor.device, 1));

    updateCard(card, sensor, hist);
    frag.appendChild(card);
  });

  grid.appendChild(frag);
}
