import type { EventSummary } from "@/api/types";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { plural } from "@/lib/format";

/** Seletor de evento da Calibração: só eventos com fotos prontas.
 *  static/index.html:283-291; static/app.js:458-488; static/style.css:565-583 */
export function EventPicker({
  events,
  value,
  onChange,
}: {
  events: EventSummary[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  const ready = events.filter((e) => e.n_done);
  const current = ready.find((e) => e.id === value);
  return (
    <div className="mobile:min-w-0 mobile:flex-[1_1_100%]">
      <Select value={current ? String(current.id) : ""} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger label="Evento" placeholder="Nenhum evento com fotos" aria-label="Evento" />
        <SelectContent>
          {ready.map((e) => (
            <SelectItem key={e.id} value={String(e.id)} hint={plural(e.n_done, "foto", "fotos")}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
