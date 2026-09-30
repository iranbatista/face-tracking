/** Formatação pt-BR. Porte literal de static/app.js (68-75, 221-226, 549-554, 846). */

export const pct = (s: number) => `${Math.round(s * 100)}%`;

export const fmtMs = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(1).replace(".", ",")} s` : `${Math.round(ms)} ms`;

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** created_at vem do Postgres em ISO 8601 com fuso ("2026-09-29T00:49:24.123+00:00"). */
export function fmtDate(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

/** "13 de setembro de 2026" a partir de "2026-09-13" (data local, sem fuso). */
export function fmtEventDate(iso: string | null | undefined) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function fmtEta(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `cerca de ${Math.max(s, 5)} s restantes`;
  const m = Math.round(s / 60);
  return `cerca de ${m} min restante${m === 1 ? "" : "s"}`;
}

// Precisão (Galeria) e corte (Calibração): o mesmo threshold, dois controles.
export const precisionWord = (t: number) => (t < 0.32 ? "Ampla" : t <= 0.48 ? "Equilibrada" : "Rigorosa");
