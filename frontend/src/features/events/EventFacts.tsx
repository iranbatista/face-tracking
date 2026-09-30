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
    { key: "date", text: fmtEventDate(ev.event_date) },
    { key: "location", text: ev.location || null },
    { key: "count", text: count ? plural(ev.n_done, "foto", "fotos") : null },
  ].filter((x): x is { key: string; text: string } => Boolean(x.text));
  if (!items.length) return null;
  return (
    <p className={cn("facts", className)}>
      <span className="facts-in">
        {items.map((t) => (
          <span key={t.key}>{t.text}</span>
        ))}
      </span>
    </p>
  );
}
