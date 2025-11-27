/* ============================================================
   theme.js — Theme toggling + compact mode
============================================================ */

const THEME_KEY = "goveeTheme";
const COMPACT_KEY = "goveeCompact";

const root = document.documentElement;

const darkBtn = document.getElementById("themeDark");
const lightBtn = document.getElementById("themeLight");
const compactToggle = document.getElementById("compactToggleBtn");

/* -------------------------------
   Apply Theme
--------------------------------*/
export function applyTheme(mode, persist = true) {
  root.setAttribute("data-theme", mode);

  if (persist) {
    try { localStorage.setItem(THEME_KEY, mode); } catch {}
  }

  darkBtn.classList.toggle("active", mode === "dark");
  lightBtn.classList.toggle("active", mode === "light");
}

/* -------------------------------
   Initialize Theme on Page Load
--------------------------------*/
export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);

  if (saved === "dark" || saved === "light") {
    applyTheme(saved, false);
    return;
  }

  const prefersLight = window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: light)").matches;

  applyTheme(prefersLight ? "light" : "dark", false);
}

/* -------------------------------
   Compact Mode
--------------------------------*/
export function setCompact(on) {
  document.body.classList.toggle("compact", !!on);
  compactToggle.classList.toggle("active", !!on);
  compactToggle.setAttribute("aria-pressed", on ? "true" : "false");

  try { localStorage.setItem(COMPACT_KEY, on ? "1" : "0"); } catch {}

  requestAnimationFrame(() => {
    window.dispatchEvent(new Event("compact-redraw"));
  });
}

export function initCompact() {
  const saved = localStorage.getItem(COMPACT_KEY);

  if (saved === "1") setCompact(true);
  else if (saved === "0") setCompact(false);
  else setCompact(window.matchMedia("(max-width: 700px)").matches);
}

/* -------------------------------
   Event Bindings
--------------------------------*/
darkBtn.addEventListener("click", () => applyTheme("dark"));
lightBtn.addEventListener("click", () => applyTheme("light"));

compactToggle.addEventListener("click", () =>
  setCompact(!document.body.classList.contains("compact"))
);
