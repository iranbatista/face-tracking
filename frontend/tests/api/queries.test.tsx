import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { shouldRetry, useEvents } from "@/api/queries";
import { server } from "../msw";
import { newQueryClient } from "../render";

test("shouldRetry: não repete 4xx, repete 5xx até 2x", () => {
  expect(shouldRetry(0, { status: 404 })).toBe(false);
  expect(shouldRetry(0, { status: 500 })).toBe(true);
  expect(shouldRetry(2, { status: 500 })).toBe(false);
  expect(shouldRetry(0, new TypeError("rede"))).toBe(true);
});

test("useEvents com polling: refaz enquanto há pendente e para quando zera", async () => {
  let calls = 0;
  server.use(
    http.get("*/api/events", () => {
      calls += 1;
      return HttpResponse.json([{ id: 1, n_pending: calls < 2 ? 1 : 0 }]);
    }),
  );
  const qc = newQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useEvents({ pollWhilePending: true }), { wrapper });
  await waitFor(() => expect(result.current.data?.[0]?.n_pending).toBe(0), { timeout: 5000 });
  const settled = calls;
  await new Promise((r) => setTimeout(r, 3500));
  expect(calls).toBe(settled);
}, 10_000);
