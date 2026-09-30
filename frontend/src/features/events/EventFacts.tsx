import { fmtEventDate, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Fatos do evento separados por filete (não por "·"): data | local | fotos.
 *  Nada se vazio. static/app.js:227-236; CSS em components.css (.facts). */
export function EventFacts({
  ev,
  count = true,
  className,
}: {
  ev: { event_date?: string | null; location?: string | null; n_done: number };
  count?: boolean;
  className?: string;
}) {
  const items = [
    fmtEventDate(ev.event_date),
    ev.location || null,
    count ? plural(ev.n_done, "foto", "fotos") : null,
  ].filter((x): x is string => Boolean(x));
  if (!items.length) return null;
  return (
    <p className={cn("facts", className)}>
      <span className="facts-in">
        {items.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </span>
    </p>
  );
}
