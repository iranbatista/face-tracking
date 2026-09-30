import { createFileRoute } from "@tanstack/react-router";
import { useEvent } from "@/api/queries";
import { NotFoundEvent, RouteError, RoutePending } from "@/components/RouteStates";
import { eventIdParams, loadEvent } from "@/features/events/routeData";
import { pickInts } from "@/lib/search";
import { titles, useDocumentTitle } from "@/lib/title";

export const Route = createFileRoute("/galeria/$eventId")({
  params: eventIdParams,
  validateSearch: (s: Record<string, unknown>): { foto?: number } => pickInts(s, ["foto"]),
  loader: ({ context, params }) => loadEvent(context.queryClient, params.eventId),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  notFoundComponent: () => <NotFoundEvent area="gallery" />,
  component: Gallery,
});

// STUB: tela real na Task 12+.
function Gallery() {
  const { eventId } = Route.useParams();
  const { data } = useEvent(eventId);
  useDocumentTitle(titles.event(data?.name ?? ""));
  return <h1 className="display text-t-xl">{data?.name}</h1>;
}
