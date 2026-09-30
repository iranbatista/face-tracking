import { Link } from "@tanstack/react-router";
import { useEvents } from "@/api/queries";
import type { EventSummary } from "@/api/types";
import { Icon } from "@/components/Icon";
import { EventFacts } from "@/features/events/EventFacts";
import { GalleryCover } from "@/features/events/GalleryCover";
import { PhotoImg } from "@/features/events/PhotoImg";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";

function Status({ ev, className }: { ev: EventSummary; className?: string }) {
  const [state, text] = ev.n_pending
    ? (["busy", `Indexando ${plural(ev.n_pending, "foto", "fotos")}`] as const)
    : ev.n_done
      ? (["live", "Na galeria"] as const)
      : (["", "Sem fotos"] as const);
  return (
    <span
      data-state={state}
      className={cn(
        "status inline-flex items-center gap-[.45rem] text-chumbo text-t-sm data-[state=live]:text-grafite",
        className,
      )}
    >
      {text}
    </span>
  );
}

const fig =
  "flex flex-col text-chumbo text-t-xs mobile:mt-[.65rem] mobile:flex-row mobile:items-baseline mobile:gap-[.3rem] mobile:text-t-sm";
const figNum = "display text-[1.5rem] text-grafite leading-[1.05] mobile:text-[1.2rem]";

/** Lista de eventos do Estúdio. static/index.html:203-209; static/app.js:314-340; static/style.css:514-536, 634-655 */
export function EventRows() {
  const { data: events = [] } = useEvents({ pollWhilePending: true });
  return (
    <ol className="-mt-8 m-0 list-none p-0 mobile:-mt-6">
      {events.map((e) => (
        <li key={e.id}>
          <Link
            to="/estudio/$eventId"
            params={{ eventId: e.id }}
            className={cn(
              "grid grid-cols-[88px_minmax(0,1fr)_90px_90px_190px_20px] items-center gap-6 border-linha border-b px-1 py-4 text-inherit no-underline transition-colors duration-150 hover:bg-papel",
              "mobile:grid-cols-[auto_auto_minmax(0,1fr)_20px] mobile:gap-x-[1.1rem] mobile:gap-y-0 mobile:px-0 mobile:pt-5 mobile:pb-[1.35rem] mobile:hover:bg-transparent",
              "mobile:[grid-template-areas:'banner_banner_banner_banner'_'main_main_main_go'_'photos_faces_status_status']",
            )}
          >
            {/* desktop: miniatura única ao lado do nome; celular: faixa com o mosaico do evento */}
            <div className="grid aspect-[4/3] w-[88px] place-items-center overflow-hidden bg-passe text-chumbo mobile:hidden">
              {e.cover.length ? (
                <PhotoImg
                  photo={e.cover[0] as EventSummary["cover"][number]}
                  sizes="88px"
                  className="block size-full object-cover"
                />
              ) : (
                <Icon name="images" />
              )}
            </div>
            <div className="hidden mobile:mb-[.9rem] mobile:block mobile:[grid-area:banner] mobile:[&_.gal-cover]:aspect-[16/7]">
              {e.cover.length ? (
                <GalleryCover cover={e.cover} />
              ) : (
                <div className="flex aspect-[16/3.5] items-center justify-center gap-2 bg-passe text-chumbo text-t-sm">
                  <Icon name="images" />
                  Sem fotos ainda
                </div>
              )}
            </div>
            <div className="min-w-0 mobile:[grid-area:main]">
              <div className="display truncate text-[1.3rem] leading-[1.4] mobile:text-[1.55rem] mobile:leading-[1.3]">
                {e.name}
              </div>
              <EventFacts ev={e} count={false} className="mt-1 text-t-sm" />
            </div>
            <div className={cn(fig, "mobile:[grid-area:photos]")}>
              <b className={figNum}>{e.n_done}</b>
              {e.n_done === 1 ? "foto" : "fotos"}
            </div>
            <div className={cn(fig, "mobile:[grid-area:faces]")}>
              <b className={figNum}>{e.n_faces}</b>
              {e.n_faces === 1 ? "rosto" : "rostos"}
            </div>
            <Status ev={e} className="mobile:mt-[.65rem] mobile:justify-self-end mobile:[grid-area:status]" />
            <span className="text-chumbo [&_svg]:inline [&_svg]:align-baseline mobile:self-center mobile:[grid-area:go]">
              <Icon name="chev-r" />
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
