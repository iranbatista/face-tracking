import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchFeatures, qk } from "@/api/queries";
import { RouteError, RoutePending } from "@/components/RouteStates";
import { pickInts } from "@/lib/search";
import { titles, useDocumentTitle } from "@/lib/title";

export const Route = createFileRoute("/calibracao")({
  validateSearch: (s: Record<string, unknown>): { e?: number; rosto?: number } => pickInts(s, ["e", "rosto"]),
  beforeLoad: async ({ context }) => {
    // flag desligada no backoffice: a rota não existe
    const flags = await context.queryClient.ensureQueryData({
      queryKey: qk.features,
      queryFn: ({ signal }) => fetchFeatures(signal),
    });
    if (!flags.calibration) throw redirect({ to: "/", replace: true });
  },
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: Lab,
});

// STUB: tela real na Task 17.
function Lab() {
  useDocumentTitle(titles.lab);
  return <h1 className="display text-t-xl">Calibração</h1>;
}
