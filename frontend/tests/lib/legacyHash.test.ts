import { expect, test } from "vitest";
import { legacyHashTarget } from "@/lib/legacyHash";

test.each([
  ["#galeria?e=4", "/galeria/4"],
  ["#galeria", "/"],
  ["#estudio?e=4", "/estudio/4"],
  ["#estudio", "/estudio"],
  ["#calibracao?e=4", "/calibracao?e=4"],
  ["#calibracao", "/calibracao"],
  ["#backoffice", "/backoffice"],
])("%s -> %s", (hash, target) => expect(legacyHashTarget(hash)).toBe(target));

test.each(["", "#", "#qualquer", "#galeria?e=abc"])("ignora %s", (hash) => {
  expect(legacyHashTarget(hash)).toBe(hash === "#galeria?e=abc" ? "/" : null);
});
