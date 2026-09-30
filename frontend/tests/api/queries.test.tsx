import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { invalidateEvent, shouldRetry, useEvent, useEvents, usePhotos, useStats } from "@/api/queries";
import { server } from "../msw";
import { newQueryClient } from "../render";

test("shouldRetry: não repete 4xx, repete 5xx até 2x", () => {
  expect(shouldRetry(0, { status: 404 })).toBe(false);
  expect(shouldRetry(0, { status: 500 })).toBe(true);
  expect(shouldRetry(2, { status: 500 })).toBe(false);
  expect(shouldRetry(0, new TypeError("rede"))).toBe(true);
});

test("shouldRetry não estoura com null/undefined", () => {
  expect(shouldRetry(0, null)).toBe(true);
  expect(shouldRetry(0, undefined)).toBe(true);
});

test("useEvents com polling: refaz enquanto há pendente e para quando zera", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
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
    await waitFor(() => expect(calls).toBe(1));
    await waitFor(() => expect(result.current.data?.[0]?.n_pending).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(3100));
    await waitFor(() => expect(result.current.data?.[0]?.n_pending).toBe(0));
    const settled = calls;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(calls).toBe(settled);
  } finally {
    vi.useRealTimers();
  }
});

test("invalidateEvent refaz cada query montada uma única vez (4 requisições)", async () => {
  const counts: Record<string, number> = {};
  const hit = (k: string) => {
    counts[k] = (counts[k] ?? 0) + 1;
  };
  server.use(
    http.get("*/api/events", () => {
      hit("list");
      return HttpResponse.json([]);
    }),
    http.get("*/api/events/:id", () => {
      hit("event");
      return HttpResponse.json({ id: 1 });
    }),
    http.get("*/api/events/:id/photos", () => {
      hit("photos");
      return HttpResponse.json([]);
    }),
    http.get("*/api/stats", () => {
      hit("stats");
      return HttpResponse.json({});
    }),
  );
  const qc = newQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => [useEvents(), useEvent(1), usePhotos(1), useStats(1)] as const, {
    wrapper,
  });
  await waitFor(() => expect(result.current.every((q) => q.isSuccess)).toBe(true));
  for (const k of Object.keys(counts)) counts[k] = 0;
  await act(async () => {
    invalidateEvent(qc, 1);
  });
  await waitFor(() => expect(result.current.every((q) => !q.isFetching)).toBe(true));
  await new Promise((r) => setTimeout(r, 50));
  expect(counts).toEqual({ list: 1, event: 1, photos: 1, stats: 1 });
});
