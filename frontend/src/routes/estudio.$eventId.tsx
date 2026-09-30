import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useEvent } from "@/api/queries";
import { Icon } from "@/components/Icon";
import { NotFoundEvent, RouteError, RoutePending } from "@/components/RouteStates";
import { eventIdParams, loadEvent } from "@/features/events/routeData";
import { ContactSheet } from "@/features/studio/ContactSheet";
import { Dropzone } from "@/features/studio/Dropzone";
import { StudioHead } from "@/features/studio/StudioHead";
import { UploadBatch } from "@/features/studio/UploadBatch";
import { useUploadQueue } from "@/features/studio/UploadQueueProvider";
import { setLastEvent } from "@/lib/storage";
import { titles, useDocumentTitle } from "@/lib/title";

export const Route = createFileRoute("/estudio/$eventId")({
  params: eventIdParams,
  loader: ({ context, params }) => loadEvent(context.queryClient, params.eventId),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  notFoundComponent: () => <NotFoundEvent area="studio" />,
  component: StudioEvent,
});

/** Página do evento no Estúdio. static/index.html:211-275; static/app.js:342-387 */
function StudioEvent() {
  const { eventId } = Route.useParams();
  const { data: ev } = useEvent(eventId);
  const { batch, addFiles, reset } = useUploadQueue();
  useDocumentTitle(titles.studioEvent(ev?.name ?? ""));
  useEffect(() => setLastEvent(eventId), [eventId]);
  if (!ev) return <RoutePending />;
  return (
    <section className="pt-7 mobile:pt-5" aria-labelledby="s-title">
      <nav className="flex min-w-0 items-center gap-[.35rem] text-chumbo text-t-sm" aria-label="Caminho">
        <Link to="/estudio" className="text-chumbo no-underline hover:text-grafite">
          Eventos
        </Link>
        <Icon name="chev-r" className="ico size-[14px]" />
        <span aria-current="page" className="overflow-hidden text-ellipsis whitespace-nowrap text-grafite">
          {ev.name}
        </span>
      </nav>
      <StudioHead ev={ev} />
      <Dropzone onFiles={(files) => addFiles(eventId, files)} />
      {batch?.eventId === eventId && batch.items.length > 0 && (
        // a chave é a primeira foto da sessão: sessão nova, resumo novo (lista recolhida)
        <UploadBatch key={batch.items[0]?.key} batch={batch} onClose={reset} />
      )}
      <ContactSheet eventId={eventId} />
    </section>
  );
}
