import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SelfieSearchState } from "@/features/gallery/SelfieSearchProvider";
import { routeTree } from "@/routeTree.gen";

export function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 10_000 }, mutations: { retry: false } },
  });
}

export function renderWithQuery(ui: ReactNode, qc = newQueryClient()) {
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

/** Monta o router real (memory history) com o routeTree gerado. `search` preenche o
 *  `initialSearch` do contexto, que o __root repassa ao SelfieSearchProvider. */
export async function renderRoute(path: string, opts: { search?: Partial<SelfieSearchState> } = {}) {
  const qc = newQueryClient();
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: qc, initialSearch: opts.search },
  });
  await router.load();
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  // o redirect do beforeLoad e o carregamento inicial podem terminar depois do primeiro render
  await act(async () => {
    await router.load();
  });
  return { router, qc, ...utils };
}
