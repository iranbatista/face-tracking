import { createFileRoute } from "@tanstack/react-router";
import { useEvent } from "@/api/queries";
import { NotFoundEvent, RouteError, RoutePending } from "@/components/RouteStates";
import { eventIdParams, loadEvent } from "@/features/events/routeData";
import { titles, useDocumentTitle } from "@/lib/title";

export const Route = createFileRoute("/estudio/$eventId")({
  params: eventIdParams,
  loader: ({ context, params }) => loadEvent(context.queryClient, params.eventId),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  notFoundComponent: () => <NotFoundEvent area="studio" />,
  component: StudioEvent,
});

// STUB: tela real na Task 16+.
function StudioEvent() {
  const { eventId } = Route.useParams();
  const { data } = useEvent(eventId);
  useDocumentTitle(titles.studioEvent(data?.name ?? ""));
  return <h1 className="display text-t-xl">{data?.name}</h1>;
}
