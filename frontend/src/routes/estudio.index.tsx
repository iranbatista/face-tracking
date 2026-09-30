import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { eventsQuery, useEvents } from "@/api/queries";
import { Icon } from "@/components/Icon";
import { Prints } from "@/components/Illustration";
import { RouteError, RoutePending } from "@/components/RouteStates";
import { Button } from "@/components/ui/button";
import { EventDialog } from "@/features/studio/EventDialog";
import { EventRows } from "@/features/studio/EventRows";
import { titles, useDocumentTitle } from "@/lib/title";

export const Route = createFileRoute("/estudio/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(eventsQuery),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: Studio,
});

/** Lista de eventos do Estúdio. static/index.html:195-209; static/app.js:314-340 */
function Studio() {
  useDocumentTitle(titles.studio);
  const { data: events = [] } = useEvents({ pollWhilePending: true });
  const [creating, setCreating] = useState(false);
  return (
    <section aria-labelledby="si-title">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-8 border-linha border-b pt-11 pb-7 mobile:mb-6 mobile:gap-5 mobile:pt-7 mobile:pb-5">
        <div>
          <h1 id="si-title" className="display text-t-2xl">
            Estúdio
          </h1>
          <p className="mt-[.7rem] max-w-[52ch] text-chumbo">
            Seus eventos, as fotos enviadas e o link de cada galeria.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Icon name="plus" className="ico" />
          Novo evento
        </Button>
      </header>
      {events.length > 0 ? (
        <EventRows />
      ) : (
        <div className="flex max-w-[52ch] flex-col items-start gap-4 py-12 text-chumbo">
          <Prints />
          <p>Crie um evento para enviar as fotos e gerar o link da galeria para os participantes.</p>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Icon name="plus" className="ico" />
            Criar o primeiro evento
          </Button>
        </div>
      )}
      <EventDialog open={creating} onOpenChange={setCreating} />
    </section>
  );
}
