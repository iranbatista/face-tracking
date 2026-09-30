import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useEvent } from "@/api/queries";
import { EmptyState, NotFoundEvent, RouteError, RoutePending } from "@/components/RouteStates";
import { eventIdParams, loadEvent } from "@/features/events/routeData";
import { EventHero } from "@/features/gallery/EventHero";
import { Lightbox } from "@/features/gallery/Lightbox";
import { ResultsBar } from "@/features/gallery/ResultsBar";
import { ResultsGrid } from "@/features/gallery/ResultsGrid";
import { SelfieFinder } from "@/features/gallery/SelfieFinder";
import { useSelfieSearch } from "@/features/gallery/SelfieSearchProvider";
import { useLightboxParam } from "@/features/gallery/useLightboxParam";
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
  const { state, setEvent, setThreshold } = useSelfieSearch();
  useEffect(() => setEvent(eventId), [eventId, setEvent]);
  const matches = state.result && state.eventId === eventId ? state.result.matches : undefined;
  const lightbox = useLightboxParam("foto", matches);
  if (!ev) return <RoutePending />;
  const published = ev.cover.length > 0;
  return (
    <section aria-labelledby="g-title">
      <EventHero ev={ev} />
      {published ? (
        <>
          <SelfieFinder />
          {state.result && state.eventId === eventId && (
            <div className="mt-6">
              <ResultsBar
                matches={state.result.matches}
                totalPhotos={state.result.total_photos}
                threshold={state.threshold}
                onThreshold={setThreshold}
              />
              <ResultsGrid
                matches={state.result.matches}
                onOpen={(foto) => {
                  const m = state.result?.matches.find((x) => x.photo_id === foto);
                  if (m) lightbox.open(m);
                }}
              />
            </div>
          )}
        </>
      ) : (
        <EmptyState>As fotos deste evento ainda não foram publicadas. Volte mais tarde.</EmptyState>
      )}
      {lightbox.match && <Lightbox match={lightbox.match} onClose={lightbox.close} />}
    </section>
  );
}
