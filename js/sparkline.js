/* ============================================================
   sparkline.js — Draw sparklines for sensors + weather
============================================================ */

import { smoothSeries } from "./utils.js";

/* Global cache to reduce redraw cost */
const sparkCache = new WeakMap();

function getCtx(canvas) {
  return canvas.getContext("2d", { alpha: false });
}

/* ============================================================
   drawSparkline(canvas, values)
============================================================ */
export function drawSparkline(canvas, values, color = "#60a5fa") {
  if (!canvas || !values || values.length < 2) return;

  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 60;

  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;

  const ctx = getCtx(canvas);
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const smoothed = smoothSeries(values, 3);

  const min = Math.min(...smoothed);
  const max = Math.max(...smoothed);
  const range = max - min || 1;

  const stepX = w / (smoothed.length - 1);

  /* Background */
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, w, h);

  /* Line path */
  ctx.beginPath();
  smoothed.forEach((v, i) => {
    const x = i * stepX;
    const y = h - ((v - min) / range) * h * 0.95;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();
}

/* ============================================================
   scheduleRedraw()
   Called when resizing or compact mode changes
============================================================ */

let resizeTimeout = null;

export function scheduleRedraw() {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    document.dispatchEvent(new Event("sparkline-redraw"));
  }, 120);
}

/* Redraw on resize */
window.addEventListener("resize", scheduleRedraw);

/* Force redraw after theme / compact mode change */
window.addEventListener("compact-redraw", scheduleRedraw);
