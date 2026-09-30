import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FaceHit } from "@/api/types";
import { PhotoImg } from "@/features/events/PhotoImg";
import { pct } from "@/lib/format";
import { galleryColumns } from "@/lib/geometry";

const RESIZE_DEBOUNCE_MS = 150;
const GUTTER = 0.02; // ≈ a calha, em "larguras de coluna"

/** Masonry: cada foto vai para a coluna mais baixa até agora. A proporção vem da API,
 *  então a altura é conhecida ANTES da imagem carregar (nada pula), e a ordem por score
 *  segue da esquerda para a direita, de cima para baixo. static/app.js:872-923 */
export function ResultsGrid({ matches, onOpen }: { matches: FaceHit[]; onOpen: (photoId: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(() => galleryColumns(globalThis.innerWidth));

  // colunas pela largura do contêiner, recalculadas ao redimensionar (com debounce)
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setCols(galleryColumns(el.clientWidth || globalThis.innerWidth));
    measure();
    let timer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, RESIZE_DEBOUNCE_MS);
    });
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  const columns = useMemo(() => {
    const out: FaceHit[][] = Array.from({ length: cols }, () => []);
    const heights = new Array<number>(cols).fill(0);
    for (const m of matches) {
      const i = heights.indexOf(Math.min(...heights));
      out[i]?.push(m);
      heights[i] = (heights[i] ?? 0) + (m.width && m.height ? m.height / m.width : 1) + GUTTER;
    }
    return matches.length ? out : [];
  }, [matches, cols]);

  // o contêiner medido existe mesmo sem resultados: o ResizeObserver liga uma vez só
  return (
    <div
      ref={box}
      data-cols={cols}
      className={matches.length ? "flex items-start gap-[6px] mobile:gap-1" : undefined}
    >
      {!matches.length && (
        <p className="max-w-[52ch] py-8 text-chumbo">
          Nenhuma foto passou do nível de precisão atual. Mova a precisão para "mais fotos" ou tente uma
          selfie de frente, com boa luz.
        </p>
      )}
      {columns.map((col, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: colunas são posicionais
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-[6px] mobile:gap-1">
          {col.map((m) => (
            <button
              key={m.face_id}
              type="button"
              aria-label={`Abrir ${m.filename}`}
              onClick={() => onOpen(m.photo_id)}
              className="group/shot relative block cursor-zoom-in border-0 bg-passe p-0"
            >
              <span className="relative block leading-[0]">
                <PhotoImg
                  photo={{ id: m.photo_id }}
                  sizes="(max-width: 600px) 50vw, 25vw"
                  width={m.width ?? undefined}
                  height={m.height ?? undefined}
                  decoding="auto" // o <img> do original não tinha decoding
                  className="block h-auto w-full"
                />
              </span>
              <span className="absolute bottom-2 left-2 rounded-[3px] bg-white/92 px-[.45rem] py-[.3rem] font-medium text-grafite text-t-xs leading-none tabular-nums opacity-0 transition-opacity duration-150 group-hover/shot:opacity-100 group-focus-visible/shot:opacity-100 nohover:opacity-100">
                {pct(m.score)}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
