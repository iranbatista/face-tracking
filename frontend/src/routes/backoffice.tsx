import { createFileRoute } from "@tanstack/react-router";
import { RouteError, RoutePending } from "@/components/RouteStates";
import { Backoffice } from "@/features/admin/Backoffice";
import { titles, useDocumentTitle } from "@/lib/title";

export const Route = createFileRoute("/backoffice")({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: Page,
});

function Page() {
  useDocumentTitle(titles.admin);
  return <Backoffice />;
}
