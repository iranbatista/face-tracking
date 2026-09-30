/** Geometria pura (recorte de rosto, zoom, colunas da galeria, régua da Calibração).
 *  Porte literal de static/app.js; onde o original lia/escrevia o DOM, recebe/devolve valores. */
import type { CSSProperties } from "react";

type Bbox = [number, number, number, number];

/** Recorte guiado pelos rostos: a API manda o ponto de foco (fx, fy em 0..1,
 *  média dos centros dos rostos); `object-position` alinha o corte nele. static/app.js:120 */
export const focusPos = (p: { fx?: number | null; fy?: number | null }) =>
  `${((p.fx ?? 0.5) * 100).toFixed(1)}% ${((p.fy ?? 0.33) * 100).toFixed(1)}%`;

/** Estilo de background que dá zoom no rosto (recorte quadrado). `pad` = margem em volta do rosto.
 *  Tudo em %, independe do tamanho. static/app.js:104-114 */
export function faceCropStyle(
  {
    url,
    bbox: [x1, y1, x2, y2],
    width: W,
    height: H,
  }: { url: string; bbox: Bbox | number[]; width: number; height: number },
  pad = 1.5,
): CSSProperties {
  const side = Math.min(Math.max(x2 - x1, y2 - y1) * pad, W, H);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
  const sx = clamp((x1 + x2) / 2 - side / 2, W - side);
  const sy = clamp((y1 + y2) / 2 - side / 2, H - side);
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: `${(W / side) * 100}% ${(H / side) * 100}%`,
    backgroundPosition: `${W > side ? (sx / (W - side)) * 100 : 0}% ${H > side ? (sy / (H - side)) * 100 : 0}%`,
  };
}

export type Zoom = { scale: number; cx: number; cy: number };

/** Rosto pequeno na foto (multidão): "Onde estou?" também aproxima até ele. static/app.js:941-949 */
export function faceZoom(m: { bbox: Bbox | number[]; width: number; height: number }): Zoom | null {
  const [x1, y1, x2, y2] = m.bbox as Bbox;
  const frac = (x2 - x1) / m.width; // largura do rosto em fração da foto
  if (frac >= 0.1) return null; // rosto já é visível sem zoom
  return {
    scale: Math.min(3, 0.22 / frac), // rosto passa a ocupar ~22% da largura
    cx: (x1 + x2) / 2 / m.width,
    cy: (y1 + y2) / 2 / m.height,
  };
}

type FrameRect = { left: number; top: number; width: number; height: number };
type StageRect = { left: number; top: number; right: number; bottom: number };

/** Transform que amplia a foto e traz o rosto para o centro da tela. O
 *  deslocamento é limitado para a foto ampliada sempre cobrir a área visível.
 *  Os retângulos vêm já medidos, com o transform da foto zerado. static/app.js:955-973 */
export function zoomTransform(f: FrameRect, st: StageRect, { scale: s, cx, cy }: Zoom) {
  const fc = { x: f.left + f.width / 2, y: f.top + f.height / 2 }; // centro da foto (origem do scale)
  const face = { x: f.left + cx * f.width, y: f.top + cy * f.height };
  const axis = (k: "x" | "y", size: number, lo: number, hi: number) => {
    // translate que leva o rosto (já ampliado) ao centro da área visível
    let t = (lo + hi) / 2 - (fc[k] + s * (face[k] - fc[k]));
    const scaled = size * s;
    if (scaled >= hi - lo) {
      // foto ampliada maior que a tela: não deixar sobrar borda vazia
      t = Math.min(t, lo - (fc[k] - scaled / 2));
      t = Math.max(t, hi - (fc[k] + scaled / 2));
    } else t = (lo + hi) / 2 - fc[k];
    return t;
  };
  const tx = axis("x", f.width, st.left, st.right);
  const ty = axis("y", f.height, st.top, st.bottom);
  return `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)})`;
}

/** Colunas da galeria para a largura do contêiner (o chamador aplica o fallback de innerWidth). static/app.js:899-902 */
export const galleryColumns = (w: number) => (w < 600 ? 2 : Math.max(2, Math.floor(w / 260)));

/** score (0..1) -> posição na régua, com 20px de margem para os rostos das pontas. static/app.js:1026 */
export const rulerX = (score: number) => `calc(20px + (100% - 40px) * ${Math.max(0, Math.min(1, score))})`;

/** Linhas da régua: cada rosto num x = score. Na mesma linha, rostos podem se
 *  sobrepor até ~40%; além disso vão para a linha de baixo e a régua cresce.
 *  Recebe os scores em ordem crescente e devolve a linha de cada um. static/app.js:1048-1056 */
export function rulerRows(scoresSortedAsc: number[], widthPx: number) {
  const dot = widthPx < 600 ? 26 : 32;
  const minGap = ((dot * 0.6) / (widthPx - 40)) * 100;
  const rowsLastX: number[] = [];
  const rows = scoresSortedAsc.map((score) => {
    const x = Math.max(0, Math.min(1, score)) * 100;
    let row = rowsLastX.findIndex((last) => x - last >= minGap);
    if (row === -1) {
      row = rowsLastX.length;
      rowsLastX.push(x);
    } else rowsLastX[row] = x;
    return row;
  });
  return { dot, rows, count: rowsLastX.length };
}
