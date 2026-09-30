import { expect, test } from "vitest";
import { fmtDate, fmtEta, fmtEventDate, fmtMs, pct, plural, precisionWord } from "@/lib/format";

test("pct", () => expect(pct(0.691)).toBe("69%"));
test("fmtMs", () => {
  expect(fmtMs(250.4)).toBe("250 ms");
  expect(fmtMs(3624.5)).toBe("3,6 s");
});
test("plural", () => {
  expect(plural(1, "foto", "fotos")).toBe("1 foto");
  expect(plural(0, "foto", "fotos")).toBe("0 fotos");
});
test("fmtEventDate: data local sem fuso", () => {
  expect(fmtEventDate("2026-09-13")).toBe("13 de setembro de 2026");
  expect(fmtEventDate(null)).toBeNull();
});
test("fmtDate: ISO com fuso", () => {
  expect(fmtDate("2026-09-29T12:00:00+00:00")).toBe("29 de setembro de 2026");
});
test("fmtEta", () => {
  expect(fmtEta(2000)).toBe("cerca de 5 s restantes");
  expect(fmtEta(42_000)).toBe("cerca de 42 s restantes");
  expect(fmtEta(60_000)).toBe("cerca de 1 min restante");
  expect(fmtEta(150_000)).toBe("cerca de 3 min restantes");
});
test("precisionWord", () => {
  expect(precisionWord(0.3)).toBe("Ampla");
  expect(precisionWord(0.4)).toBe("Equilibrada");
  expect(precisionWord(0.48)).toBe("Equilibrada");
  expect(precisionWord(0.5)).toBe("Rigorosa");
});
