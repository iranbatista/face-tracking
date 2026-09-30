import { expect, test } from "vitest";
import { fold } from "@/lib/text";

test("fold: sem acento e sem caixa", () => {
  expect(fold("Florianópolis")).toBe("florianopolis");
  expect(fold(null)).toBe("");
});
