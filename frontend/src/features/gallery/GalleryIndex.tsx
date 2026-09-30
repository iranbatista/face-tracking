import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useEvents } from "@/api/queries";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/RouteStates";
import { EventFacts } from "@/features/events/EventFacts";
import { GalleryCover } from "@/features/events/GalleryCover";
import { plural } from "@/lib/format";
import { fold } from "@/lib/text";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Índice público de galerias. static/index.html:111-128; static/app.js:250-266 */
export function GalleryIndex() {
  const { data: events = [] } = useEvents();
  const [input, setInput] = useState("");
  const term = useDebounced(input.trim(), 120);
  const published = events.filter((e) => e.n_done > 0); // sem fotos não aparece para o público
  const q = fold(term);
  const list = q ? published.filter((e) => fold(`${e.name} ${e.location}`).includes(q)) : published;
  return (
    <section aria-labelledby="i-title">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-8 border-linha border-b pt-11 pb-7 mobile:mb-6 mobile:gap-5 mobile:pt-7 mobile:pb-5">
        <div>
          <h1 id="i-title" className="display text-t-2xl">
            Galerias
          </h1>
          <p className="mt-[.7rem] max-w-[52ch] text-chumbo">
            Escolha o evento em que você esteve e encontre suas fotos com uma selfie.
          </p>
        </div>
        {published.length >= 4 && (
          <label className="relative flex w-[min(100%,320px)] items-center mobile:w-full">
            <Icon name="search" className="pointer-events-none absolute left-3 text-chumbo" />
            <span className="sr-only">Buscar evento</span>
            <input
              type="search"
              placeholder="Buscar por evento ou cidade"
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="h-11 w-full appearance-none rounded-foco border border-linha bg-papel pr-[.9rem] pl-10 placeholder:text-[#9A9EA5] focus-visible:border-transparent focus-visible:outline-2 focus-visible:outline-viridian focus-visible:outline-offset-0"
            />
          </label>
        )}
      </header>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-x-6 gap-y-11 mobile:grid-cols-1 mobile:gap-8">
        {list.map((e) => (
          <Link key={e.id} to="/galeria/$eventId" params={{ eventId: e.id }} className="gal-card">
            <GalleryCover cover={e.cover} />
            <div className="mt-4 flex items-baseline justify-between gap-4">
              <h2 className="display text-[1.85rem] leading-[1.12]">{e.name}</h2>
              <span className="whitespace-nowrap text-chumbo text-t-sm tabular-nums">
                {plural(e.n_done, "foto", "fotos")}
              </span>
            </div>
            <EventFacts ev={e} count={false} className="mt-[.45rem] text-t-sm" />
          </Link>
        ))}
      </div>
      {list.length === 0 && (
        <EmptyState>
          {published.length
            ? `Nenhuma galeria com “${term}”. Tente o nome do evento ou a cidade.`
            : "Nenhuma galeria publicada ainda."}
        </EmptyState>
      )}
    </section>
  );
}
