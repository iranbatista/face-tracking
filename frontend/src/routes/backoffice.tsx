import { createFileRoute } from "@tanstack/react-router";
import { RouteError, RoutePending } from "@/components/RouteStates";
import { titles, useDocumentTitle } from "@/lib/title";

export const Route = createFileRoute("/backoffice")({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: Backoffice,
});

// STUB: tela real na Task 18.
function Backoffice() {
  useDocumentTitle(titles.admin);
  return <h1 className="display text-t-xl">Backoffice</h1>;
}
