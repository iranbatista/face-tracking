import { Link } from "@tanstack/react-router";
import { memo, useState } from "react";
import type { EventSummary } from "@/api/types";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/sonner";
import { EventFacts } from "@/features/events/EventFacts";
import { fmtDate } from "@/lib/format";
import { EventDialog } from "./EventDialog";
import { Figures } from "./Figures";

/** Cabeçalho do evento no Estúdio: nome, fatos, ações e números.
 *  static/index.html:219-233; static/app.js:342-361; static/style.css:314-320, 686-704 */
export const StudioHead = memo(function StudioHead({ ev }: { ev: EventSummary }) {
  const [editing, setEditing] = useState(false);

  async function copyLink() {
    const url = `${location.origin}/galeria/${ev.id}`;
    try {
      await navigator.clipboard.writeText(url);
      notify("Link da galeria copiado");
    } catch {
      prompt("Copie o link da galeria:", url);
    }
  }

  const actionBtn = "mobile:flex-1 mobile:px-[.7rem]";
  return (
    <header className="mt-[1.1rem] grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-8 mobile:grid-cols-[minmax(0,1fr)]">
      <div>
        <h1 id="s-title" className="display text-t-xl">
          {ev.name}
        </h1>
        {ev.event_date || ev.location ? (
          <EventFacts ev={ev} count={false} />
        ) : (
          <p className="facts">
            <span className="facts-in">
              <span>Criado em {fmtDate(ev.created_at)}</span>
            </span>
          </p>
        )}
      </div>
      <div className="flex gap-2 mobile:mt-4 mobile:flex-wrap">
        <Button className={actionBtn} onClick={copyLink}>
          <Icon name="copy" className="ico" />
          <span>Copiar link</span>
        </Button>
        <Button asChild className={actionBtn}>
          <Link to="/galeria/$eventId" params={{ eventId: ev.id }}>
            <Icon name="eye" className="ico" />
            <span>Ver galeria</span>
          </Link>
        </Button>
        <Button className={actionBtn} onClick={() => setEditing(true)}>
          <Icon name="edit" className="ico" />
          <span>Editar</span>
        </Button>
      </div>
      <Figures eventId={ev.id} />
      <EventDialog event={ev} open={editing} onOpenChange={setEditing} />
    </header>
  );
});
