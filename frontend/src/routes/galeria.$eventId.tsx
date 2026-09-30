import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useEvent } from "@/api/queries";
import { EmptyState, NotFoundEvent, RouteError, RoutePending } from "@/components/RouteStates";
import { eventIdParams, loadEvent } from "@/features/events/routeData";
import { EventHero } from "@/features/gallery/EventHero";
import { SelfieFinder } from "@/features/gallery/SelfieFinder";
import { useSelfieSearch } from "@/features/gallery/SelfieSearchProvider";
import { pickInts } from "@/lib/search";
import { setLastEvent } from "@/lib/storage";
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

function Gallery() {
  const { eventId } = Route.useParams();
  const { data: ev } = useEvent(eventId);
  useDocumentTitle(titles.event(ev?.name ?? ""));
  useEffect(() => setLastEvent(eventId), [eventId]);
  const { setEvent } = useSelfieSearch();
  useEffect(() => setEvent(eventId), [eventId, setEvent]);
  if (!ev) return <RoutePending />;
  const published = ev.cover.length > 0;
  return (
    <section aria-labelledby="g-title">
      <EventHero ev={ev} />
      {published ? (
        <SelfieFinder />
      ) : (
        <EmptyState>As fotos deste evento ainda não foram publicadas. Volte mais tarde.</EmptyState>
      )}
    </section>
  );
}
