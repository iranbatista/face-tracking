import { memo } from "react";
import { useStats } from "@/api/queries";
import { fmtMs } from "@/lib/format";

/** Quatro números do evento. static/index.html:227-232; static/app.js:363-370; static/style.css:314-320, 698-704 */
export const Figures = memo(function Figures({ eventId }: { eventId: number }) {
  const { data: s } = useStats(eventId);
  const items = [
    { label: <>Fotos</>, value: s?.done ?? 0 },
    { label: <>Rostos</>, value: s?.faces ?? 0 },
    {
      label: (
        <>
          <span className="mobile:hidden">Tempo por foto</span>
          <span className="hidden mobile:inline">Por foto</span>
        </>
      ),
      value: s?.avg_ms_per_photo ? fmtMs(s.avg_ms_per_photo) : "–",
    },
    { label: <>Na fila</>, value: s?.pending ?? 0 },
  ];
  return (
    <dl className="col-span-full m-0 mt-8 grid grid-cols-4 border-linha border-y mobile:mt-5">
      {items.map((it, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: quatro itens fixos
          key={i}
          className="flex flex-col border-linha border-l py-4 pl-5 first:border-l-0 first:pl-0 mobile:py-[.7rem] mobile:pl-[.7rem] mobile:first:pl-0"
        >
          <dt className="overflow-hidden text-ellipsis whitespace-nowrap text-chumbo text-t-xs">
            {it.label}
          </dt>
          <dd className="display num m-0 mt-auto pt-[.35rem] text-[2.3rem] leading-none mobile:text-[1.45rem]">
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
});
