/* ============================================================
   app.js — Main bootstrap & wiring
============================================================ */

import { initTheme, initCompact } from "./theme.js";
import { loadData, state } from "./network.js";
import { clearOrder } from "./order.js";
import { renderAll } from "./render.js";
import { initWeather } from "./weather.js";

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initCompact();

  const refreshBtn = document.getElementById("refreshBtn");
  const resetOrderBtn = document.getElementById("resetOrderBtn");
  const reorderToggleBtn = document.getElementById("reorderToggleBtn");
  const refreshWrapper = document.querySelector(".refresh-wrapper");

  function pulseRefresh() {
    if (!refreshWrapper) return;
    refreshWrapper.classList.add("pulse");
    setTimeout(() => refreshWrapper.classList.remove("pulse"), 800);
  }

  refreshBtn?.addEventListener("click", () => {
    pulseRefresh();
    loadData();
  });

  resetOrderBtn?.addEventListener("click", () => {
    clearOrder();
    loadData();
  });

  reorderToggleBtn?.addEventListener("click", () => {
    const on = !document.body.classList.contains("reorder-on");
    document.body.classList.toggle("reorder-on", on);
    reorderToggleBtn.setAttribute("aria-pressed", on ? "true" : "false");
  });

  // Initial loads
  loadData();
  initWeather();
});

/* Re-render on data/unit/order/sparkline changes */
document.addEventListener("data-change", () => {
  renderAll(state.sensors, state.history);
});

document.addEventListener("unit-change", () => {
  renderAll(state.sensors, state.history);
});

document.addEventListener("order-change", () => {
  renderAll(state.sensors, state.history);
});

document.addEventListener("sparkline-redraw", () => {
  renderAll(state.sensors, state.history);
});

/* Service Worker registration */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then(() => console.log("Service Worker registered"))
      .catch(err => console.error("SW registration failed:", err));
  });
}
