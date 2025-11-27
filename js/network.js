/* ============================================================
   network.js — Fetch sensor readings + history
============================================================ */

export const state = {
  sensors: [],
  history: {},
  loading: false,
  error: null,
};

const notice = document.getElementById("notice");

async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

export async function loadData() {
  if (state.loading) return;

  state.loading = true;
  state.error = null;

  try {
    const [readings, history] = await Promise.all([
      fetchJSON("/api/readings"),
      fetchJSON("/api/history").catch(() => ({ series: {} })),
    ]);

    state.sensors = readings.items || [];
    state.history = history.series || {};

    notice.textContent = readings.note || "";

    // Let app.js decide how to render
    document.dispatchEvent(new Event("data-change"));

  } catch (err) {
    console.error("Load failed:", err);
    state.error = err.message;
    notice.textContent = `Failed to load: ${err.message}`;
  }

  state.loading = false;
}

/* Auto-refresh every 20s */
setInterval(loadData, 20000);

/* Network status */
function updateOnlineStatus() {
  if (!navigator.onLine) {
    notice.textContent = "You’re offline — showing last loaded values.";
  } else if (notice.textContent.startsWith("You’re offline")) {
    notice.textContent = "";
  }
}

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
