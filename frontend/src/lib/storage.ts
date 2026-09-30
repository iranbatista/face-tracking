/** Último evento aberto (localStorage pode estar bloqueado). static/app.js:171, 1204 */
const KEY = "event";

export function getLastEvent(): number | null {
  try {
    return Number(localStorage.getItem(KEY)) || null;
  } catch {
    return null; // storage bloqueado
  }
}

export function setLastEvent(id: number | null) {
  try {
    localStorage.setItem(KEY, String(id ?? ""));
  } catch {
    /* storage bloqueado */
  }
}
