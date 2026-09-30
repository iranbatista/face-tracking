import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, redirect } from "@tanstack/react-router";
import { Masthead } from "@/components/Masthead";
import { Toaster } from "@/components/ui/sonner";
import { SelfieSearchProvider, type SelfieSearchState } from "@/features/gallery/SelfieSearchProvider";
import { UploadQueueProvider } from "@/features/studio/UploadQueueProvider";
import { legacyHashTarget } from "@/lib/legacyHash";

export type RouterContext = {
  queryClient: QueryClient;
  /** Só para testes: monta a tela com a busca por selfie já feita (Task 14). */
  initialSearch?: Partial<SelfieSearchState>;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ location }) => {
    // links compartilhados antes das URLs novas: #galeria?e=4 -> /galeria/4
    // (no TanStack Router `location.hash` vem da history; legacyHashTarget aceita com ou sem "#")
    const target = legacyHashTarget(location.hash);
    if (target) throw redirect({ href: target, replace: true });
  },
  component: RootLayout,
});

function RootLayout() {
  const { initialSearch } = Route.useRouteContext();
  return (
    <SelfieSearchProvider initialState={initialSearch}>
      <UploadQueueProvider>
        <Masthead />
        <main className="mx-auto max-w-[1440px] px-gutter pb-20">
          <Outlet />
        </main>
        <Toaster />
      </UploadQueueProvider>
    </SelfieSearchProvider>
  );
}
