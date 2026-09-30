import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

test("o ambiente de testes renderiza React", () => {
  render(<h1>Foco</h1>);
  expect(screen.getByRole("heading", { name: "Foco" })).toBeInTheDocument();
});
