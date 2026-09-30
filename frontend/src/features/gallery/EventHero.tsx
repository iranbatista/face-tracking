import { Link } from "@tanstack/react-router";
import type { EventSummary } from "@/api/types";
import { Icon } from "@/components/Icon";
import { EventFacts } from "@/features/events/EventFacts";
import { cn } from "@/lib/utils";
import { Collage } from "./Collage";

/** Capa do evento: mosaico + degradê + título por cima. Sem fotos publicadas, cabeçalho simples.
 *  static/index.html:131-141; CSS em components.css (.event-hero). */
export function EventHero({ ev }: { ev: EventSummary }) {
  const published = ev.cover.length > 0;
  return (
    <header className={cn("event-hero", published && "has-cover")}>
      {published && <Collage cover={ev.cover} />}
      <Link to="/" className="back">
        <Icon name="chev-l" />
        Todas as galerias
      </Link>
      <div className="hero-text">
        <h1 id="g-title" className="display">
          {ev.name}
        </h1>
        <EventFacts ev={ev} />
      </div>
    </header>
  );
}
