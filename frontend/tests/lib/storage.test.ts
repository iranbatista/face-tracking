import { afterEach, expect, test, vi } from "vitest";
import { getLastEvent, setLastEvent } from "@/lib/storage";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test("guarda e lê o último evento; null limpa", () => {
  expect(getLastEvent()).toBeNull();
  setLastEvent(7);
  expect(getLastEvent()).toBe(7);
  setLastEvent(null);
  expect(getLastEvent()).toBeNull();
});

test("storage bloqueado não quebra", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(getLastEvent()).toBeNull();
  expect(() => setLastEvent(3)).not.toThrow();
});
