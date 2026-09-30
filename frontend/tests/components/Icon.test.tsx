import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { Icon } from "@/components/Icon";

test("ícone é decorativo e tem o traço do original", () => {
  const { container } = render(<Icon name="search" />);
  const svg = container.querySelector("svg");
  expect(svg).toHaveAttribute("aria-hidden", "true");
  expect(svg).toHaveClass("ico");
  expect(container.querySelector("circle")).toHaveAttribute("r", "6");
});
