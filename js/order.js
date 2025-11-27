/* ============================================================
   order.js — Drag/drop + manual reorder buttons
============================================================ */

const ORDER_KEY = "goveePanelOrder";

/* -------------------------------
   Load saved order
--------------------------------*/
export function getSavedOrder() {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) || "[]"); }
  catch { return []; }
}

export function saveOrder(order) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch {}
}

export function clearOrder() {
  try { localStorage.removeItem(ORDER_KEY); } catch {}
}

/* -------------------------------
   Apply ordering to items array
--------------------------------*/
export function orderItems(items) {
  const saved = getSavedOrder();
  if (!saved.length) return items;

  const map = new Map(items.map(i => [i.device, i]));
  const ordered = [];

  saved.forEach(id => {
    if (map.has(id)) {
      ordered.push(map.get(id));
      map.delete(id);
    }
  });

  ordered.push(...map.values());
  return ordered;
}

/* -------------------------------
   Move up/down via buttons
--------------------------------*/
export function moveDevice(deviceId, dir) {
  const cards = Array.from(document.querySelectorAll(".card"))
    .map(c => c.dataset.device);

  const saved = getSavedOrder();
  const order = saved.length ? saved : cards;

  const i = order.indexOf(deviceId);
  if (i === -1) return;

  const j = i + dir;
  if (j < 0 || j >= order.length) return;

  [order[i], order[j]] = [order[j], order[i]];
  saveOrder(order);

  document.dispatchEvent(new Event("order-change"));
}

/* -------------------------------
   Drag-and-drop support
--------------------------------*/
export function makeCardDraggable(card) {
  const handle = card.querySelector(".handle");
  if (!handle) return;

  handle.setAttribute("draggable", "true");

  handle.addEventListener("dragstart", e => {
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", card.dataset.device || "");
  });

  handle.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    document.querySelectorAll(".card.drop-target")
      .forEach(el => el.classList.remove("drop-target"));
  });

  card.addEventListener("dragover", e => {
    e.preventDefault();
    const dragging = document.querySelector(".card.dragging");
    if (!dragging || dragging === card) return;
    card.classList.add("drop-target");
  });

  card.addEventListener("dragleave", () => {
    card.classList.remove("drop-target");
  });

  card.addEventListener("drop", e => {
    e.preventDefault();

    const srcId = e.dataTransfer.getData("text/plain");
    const dstId = card.dataset.device;
    if (!srcId || !dstId || srcId === dstId) return;

    const current = getSavedOrder().length
      ? getSavedOrder()
      : Array.from(document.querySelectorAll(".card"))
          .map(c => c.dataset.device);

    const srcIdx = current.indexOf(srcId);
    const dstIdx = current.indexOf(dstId);
    if (srcIdx === -1 || dstIdx === -1) return;

    current.splice(dstIdx, 0, ...current.splice(srcIdx, 1));
    saveOrder(current);

    document.dispatchEvent(new Event("order-change"));
  });
}
