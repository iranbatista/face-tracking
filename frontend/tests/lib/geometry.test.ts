import { expect, test } from "vitest";
import {
  faceCropStyle,
  faceZoom,
  focusPos,
  galleryColumns,
  rulerRows,
  rulerX,
  zoomTransform,
} from "@/lib/geometry";

test("focusPos com e sem foco", () => {
  expect(focusPos({ fx: 0.2, fy: 0.3 })).toBe("20.0% 30.0%");
  expect(focusPos({})).toBe("50.0% 33.0%");
});

test("faceCropStyle: mesmo cálculo do app antigo", () => {
  const s = faceCropStyle({ url: "u", bbox: [100, 100, 200, 200], width: 1000, height: 800 }, 1.5);
  expect(s.backgroundImage).toBe("url(u)");
  expect(s.backgroundSize).toBe("666.6666666666667% 533.3333333333333%");
  expect(s.backgroundPosition).toBe("8.823529411764707% 11.538461538461538%");
});

test("faceZoom: rosto grande não amplia, pequeno amplia até 3x", () => {
  expect(faceZoom({ bbox: [0, 0, 200, 200], width: 1000, height: 1000 })).toBeNull();
  const z = faceZoom({ bbox: [500, 500, 550, 550], width: 1000, height: 1000 });
  expect(z).toEqual({ scale: 3, cx: 0.525, cy: 0.525 });
});

test("zoomTransform: foto ampliada nunca deixa borda vazia", () => {
  const frame = { left: 0, top: 0, width: 1000, height: 600 };
  const stage = { left: 0, top: 0, right: 1000, bottom: 600 };
  expect(zoomTransform(frame, stage, { scale: 2, cx: 0.99, cy: 0.5 })).toBe(
    "translate(-500.0px, 0.0px) scale(2.000)",
  );
});

test("galleryColumns", () => {
  expect(galleryColumns(375)).toBe(2);
  expect(galleryColumns(1280)).toBe(4);
});

test("rulerX e rulerRows (sobreposição até ~40% na mesma linha)", () => {
  expect(rulerX(0.5)).toBe("calc(20px + (100% - 40px) * 0.5)");
  expect(rulerX(2)).toBe("calc(20px + (100% - 40px) * 1)");
  const rows = rulerRows([0.4, 0.401, 0.9], 800);
  expect(rows.dot).toBe(32);
  expect(rows.rows).toEqual([0, 1, 0]);
  expect(rows.count).toBe(2);
});
