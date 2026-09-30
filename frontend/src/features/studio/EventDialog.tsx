import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useDeleteEvent, useSaveEvent } from "@/api/queries";
import type { EventSummary } from "@/api/types";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label, Optional } from "@/components/ui/label";
import { notify } from "@/components/ui/sonner";
import { plural } from "@/lib/format";
import { setLastEvent } from "@/lib/storage";

type Editing = Pick<EventSummary, "id" | "name" | "event_date" | "location" | "n_photos">;

/** Criar, editar e excluir evento. static/index.html:377-409; static/app.js:389-456 */
export function EventDialog({
  event,
  open,
  onOpenChange,
}: {
  event?: Editing;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* remonta ao abrir: campos e etapa de exclusão voltam ao começo */}
      {open && <EventDialogBody event={event} onOpenChange={onOpenChange} />}
    </Dialog>
  );
}

function EventDialogBody({
  event,
  onOpenChange,
}: {
  event?: Editing;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const save = useSaveEvent();
  const del = useDeleteEvent();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const pending = save.isPending || del.isPending;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    try {
      if (confirming && event) {
        await del.mutateAsync(event.id);
        onOpenChange(false);
        setLastEvent(null);
        notify("Evento excluído");
        await navigate({ to: "/estudio" });
        return;
      }
      const f = new FormData(e.currentTarget);
      const saved = await save.mutateAsync({
        id: event?.id,
        body: {
          name: String(f.get("name") ?? ""),
          event_date: String(f.get("date") ?? "") || null,
          location: String(f.get("location") ?? ""),
        },
      });
      onOpenChange(false);
      notify(event ? "Evento salvo" : "Evento criado");
      if (!event) await navigate({ to: "/estudio/$eventId", params: { eventId: saved.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    }
  }

  const n = event?.n_photos ?? 0;
  return (
    <DialogContent aria-describedby={undefined}>
      <form onSubmit={onSubmit} noValidate>
        <DialogBody hidden={confirming}>
          <DialogTitle>{event ? "Editar evento" : "Novo evento"}</DialogTitle>
          <Label>
            <span>Nome</span>
            <Input
              name="name"
              maxLength={120}
              placeholder="Ex.: Corrida de Rua 2026"
              required
              defaultValue={event?.name ?? ""}
            />
          </Label>
          <div className="grid grid-cols-[180px_1fr] gap-4 mobile:grid-cols-1">
            <Label>
              <span>Data</span>
              <Input name="date" type="date" defaultValue={event?.event_date ?? ""} />
            </Label>
            <Label>
              <span>
                Local <Optional />
              </span>
              <Input
                name="location"
                maxLength={120}
                placeholder="Cidade ou lugar"
                defaultValue={event?.location ?? ""}
              />
            </Label>
          </div>
          <p role="alert" className="empty:hidden text-erro text-t-sm">
            {error}
          </p>
        </DialogBody>
        {confirming && event && (
          <DialogBody>
            <DialogTitle>Excluir evento?</DialogTitle>
            <DialogDescription className="max-w-[52ch] text-chumbo">
              {n
                ? `As ${plural(n, "foto", "fotos")} de “${event.name}” e os rostos encontrados nelas serão apagados deste servidor, e o link da galeria deixa de funcionar.`
                : `“${event.name}” será apagado.`}{" "}
              Isso não pode ser desfeito.
            </DialogDescription>
          </DialogBody>
        )}
        {confirming && error && (
          <p role="alert" className="px-7 text-erro text-t-sm mobile:px-5">
            {error}
          </p>
        )}
        <DialogFooter>
          {event && !confirming && (
            <Button variant="text-danger" onClick={() => setConfirming(true)}>
              <Icon name="trash" className="ico" />
              Excluir evento
            </Button>
          )}
          <span className="flex-1" />
          <Button onClick={() => (confirming ? setConfirming(false) : onOpenChange(false))}>Cancelar</Button>
          <Button type="submit" variant={confirming ? "danger" : "primary"} disabled={pending}>
            {confirming ? "Excluir evento" : event ? "Salvar" : "Criar evento"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
