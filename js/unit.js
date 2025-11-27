/* ============================================================
   unit.js — Temperature unit selection
============================================================ */

export let unit = "F";

const unitFBtn = document.getElementById("unitF");
const unitCBtn = document.getElementById("unitC");

/* Switch unit */
export function setUnit(newUnit) {
  if (unit === newUnit) return;

  unit = newUnit;

  unitFBtn.classList.toggle("active", unit === "F");
  unitCBtn.classList.toggle("active", unit === "C");

  // Tell dashboard to re-render in new unit
  document.dispatchEvent(new CustomEvent("unit-change"));
}

unitFBtn.addEventListener("click", () => setUnit("F"));
unitCBtn.addEventListener("click", () => setUnit("C"));
