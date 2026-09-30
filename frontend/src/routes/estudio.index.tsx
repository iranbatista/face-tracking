import { createFileRoute } from "@tanstack/react-router";
import { RouteError, RoutePending } from "@/components/RouteStates";
import { titles, useDocumentTitle } from "@/lib/title";

export const Route = createFileRoute("/estudio/")({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: Studio,
});

// STUB: tela real na Task 15.
function Studio() {
  useDocumentTitle(titles.studio);
  return <h1 className="display text-t-xl">Estúdio</h1>;
}
