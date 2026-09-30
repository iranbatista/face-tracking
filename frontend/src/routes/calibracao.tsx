import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { eventsQuery, featuresQuery, useEvents, useFeatures } from "@/api/queries";
import { Icon } from "@/components/Icon";
import { ContactStrip } from "@/components/Illustration";
import { RouteError, RoutePending } from "@/components/RouteStates";
import { buttonVariants } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Lightbox } from "@/features/gallery/Lightbox";
import { useSelfieSearch } from "@/features/gallery/SelfieSearchProvider";
import { useLightboxParam } from "@/features/gallery/useLightboxParam";
import { EventPicker } from "@/features/lab/EventPicker";
import { Ruler } from "@/features/lab/Ruler";
import { Timings } from "@/features/lab/Timings";
import { TopList } from "@/features/lab/TopList";
import { pickInts } from "@/lib/search";
import { getLastEvent } from "@/lib/storage";
import { titles, useDocumentTitle } from "@/lib/title";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/calibracao")({
  validateSearch: (s: Record<string, unknown>): { e?: number; rosto?: number } => pickInts(s, ["e", "rosto"]),
  beforeLoad: async ({ context }) => {
    // flag desligada no backoffice: a rota não existe
    const flags = await context.queryClient.ensureQueryData(featuresQuery);
    if (!flags.calibration) throw redirect({ to: "/", replace: true });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(eventsQuery),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: Lab,
});

/** Calibração: onde cada rosto cai na régua de semelhança. static/index.html:277-349 */
function Lab() {
  useDocumentTitle(titles.lab);
  const navigate = useNavigate();
  const { e } = Route.useSearch();
  const { data: events = [] } = useEvents();
  const { data: flags } = useFeatures();
  const { state, setEvent, submitSelfie, setThreshold } = useSelfieSearch();

  // desligaram a Calibração com a página aberta (a "cura" da busca): a rota deixa de existir
  useEffect(() => {
    if (flags && !flags.calibration) void navigate({ to: "/", replace: true });
  }, [flags, navigate]);

  // sempre precisa de um evento: o da URL, o aberto por último ou o primeiro com fotos
  const last = getLastEvent();
  const id =
    e ??
    (events.find((x) => x.id === last)?.n_done ? last : null) ??
    events.find((x) => x.n_done)?.id ??
    null;
  useEffect(() => {
    if (!id) return;
    setEvent(id);
    if (!e) void navigate({ to: ".", search: (prev) => ({ ...prev, e: id }), replace: true });
  }, [id, e, setEvent, navigate]);

  const r = state.result?.debug_top && state.eventId === id ? state.result : null;
  const top = r?.debug_top ?? undefined;
  const lightbox = useLightboxParam("rosto", top);
  const pick = (next: number) =>
    navigate({ to: ".", search: (prev) => ({ ...prev, e: next, rosto: undefined }) });

  return (
    <section aria-labelledby="l-title">
      <header className="pt-11 mobile:pt-7">
        <h1 id="l-title" className="display text-t-xl">
          Calibração
        </h1>
        <p className="mt-[.7rem] max-w-[66ch] text-chumbo">
          Os 30 rostos mais parecidos com a selfie, incluindo os que ficaram abaixo do corte. Cada rosto está
          na posição do seu score de semelhança (cosseno). Ajuste o corte até separar as pessoas certas das
          erradas.
        </p>
      </header>

      <div className="my-8 mb-7 flex flex-wrap items-center gap-6 border-linha border-y bg-parede py-4 mobile:sticky mobile:top-0 mobile:z-[5] mobile:-mx-gutter mobile:mt-6 mobile:mb-5 mobile:gap-x-4 mobile:gap-y-3 mobile:border-t-0 mobile:px-gutter mobile:py-3">
        <EventPicker events={events} value={id} onChange={pick} />
        <label
          className={cn(
            buttonVariants(),
            "has-focus-visible:outline-2 has-focus-visible:outline-viridian has-focus-visible:outline-offset-2",
          )}
        >
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(ev) => {
              const file = ev.target.files?.[0];
              if (file) submitSelfie(file);
              ev.target.value = "";
            }}
          />
          <Icon name="upload" />
          <span className="mobile:hidden">Testar selfie</span>
          <span className="hidden mobile:inline">Selfie</span>
        </label>
        <div className="flex min-w-60 max-w-[520px] flex-1 items-center gap-4 mobile:min-w-0 mobile:gap-[.6rem]">
          <span id="thr-label" className="font-medium text-t-sm mobile:sr-only">
            Corte
          </span>
          <Slider
            min={0.15}
            max={0.8}
            step={0.01}
            value={[state.threshold]}
            onValueChange={([v]) => v !== undefined && setThreshold(v)}
            aria-labelledby="thr-label"
          />
          <output className="display num min-w-[2.4em] text-right text-[2rem] text-viridian leading-none mobile:text-[1.4rem]">
            {state.threshold.toFixed(2)}
          </output>
        </div>
      </div>

      {r && top ? (
        <div>
          <Ruler items={top} threshold={state.threshold} onOpen={lightbox.open} />
          <div className="grid grid-cols-[minmax(260px,1fr)_2fr] gap-14 mobile:grid-cols-1 mobile:gap-8">
            <Timings timings={r.timings_ms ?? {}} fromCache={!!r.timings_from_cache} />
            <TopList items={top} threshold={state.threshold} onOpen={lightbox.open} />
          </div>
        </div>
      ) : (
        <div className="flex max-w-[52ch] flex-col items-start gap-4 py-12 text-chumbo">
          <ContactStrip />
          <p>Faça uma busca na Galeria ou envie uma selfie aqui para ver onde fica a fronteira.</p>
        </div>
      )}
      {lightbox.match && (
        <Lightbox key={lightbox.match.face_id} match={lightbox.match} onClose={lightbox.close} />
      )}
    </section>
  );
}
