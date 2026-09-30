import { type CSSProperties, useLayoutEffect, useMemo, useRef, useState } from "react";
import { thumbUrl } from "@/api/client";
import type { DebugHit } from "@/api/types";
import { faceCropStyle, rulerRows, rulerX } from "@/lib/geometry";
import { cn } from "@/lib/utils";

/** Borda do recorte de rosto dos aceitos (acima do corte): o verde de foco. */
export const faceStyle = (m: DebugHit): CSSProperties =>
  m.width && m.height
    ? faceCropStyle({ url: thumbUrl(m.photo_id), bbox: m.bbox, width: m.width, height: m.height })
    : {};

/** Régua: cada rosto num x = score. O corte e a faixa "aceito" seguem o slider na hora.
 *  static/index.html:327-332; static/app.js:1026-1070; static/style.css:405-426 */
export function Ruler({
  items,
  threshold,
  onOpen,
}: {
  items: DebugHit[];
  threshold: number;
  onOpen: (m: DebugHit) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sorted = useMemo(() => [...items].sort((a, b) => a.score - b.score), [items]);
  const { dot, rows, count } = useMemo(
    () =>
      rulerRows(
        sorted.map((m) => m.score),
        width || 800,
      ),
    [sorted, width],
  );
  const x = rulerX(threshold);
  return (
    <figure className="m-0 mb-12">
      <div
        ref={ref}
        className="relative min-h-[170px] overflow-hidden border border-linha bg-papel"
        style={{ height: 38 + count * (dot + 4) + 12 }}
      >
        {Array.from({ length: 11 }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: marcas fixas
            key={i}
            className="absolute inset-y-0 w-0 border-passe border-l"
            style={{ left: rulerX(i / 10) }}
          />
        ))}
        <div className="absolute inset-y-0 right-0 bg-viridian-tint" style={{ left: x }} />
        <div className="absolute inset-y-0 w-0 border-viridian border-l-[1.5px]" style={{ left: x }}>
          <span className="absolute top-[9px] left-2 whitespace-nowrap font-medium text-t-xs text-viridian tabular-nums">
            corte {threshold.toFixed(2)}
          </span>
        </div>
        {sorted.map((m, i) => {
          const above = m.score > threshold;
          return (
            <button
              key={m.face_id}
              type="button"
              className={cn(
                "absolute cursor-pointer rounded-full border-[1.5px] border-papel bg-passe bg-no-repeat p-0 shadow-[0_0_0_1px_var(--color-linha)] transition-transform duration-[120ms] hover:z-[3] hover:scale-[1.7] focus-visible:z-[3] focus-visible:scale-[1.7]",
                above && "above shadow-[0_0_0_1.5px_var(--color-viridian)]",
              )}
              title={`${m.score.toFixed(3)}, ${m.filename}`}
              aria-label={`score ${m.score.toFixed(3)}, ${m.filename}`}
              style={{
                ...faceStyle(m),
                left: rulerX(m.score),
                top: 38 + (rows[i] ?? 0) * (dot + 4),
                width: dot,
                height: dot,
                marginLeft: -dot / 2,
              }}
              onClick={() => onOpen(m)}
            />
          );
        })}
      </div>
      <figcaption className="grid grid-cols-[1fr_auto_1fr] pt-2 text-chumbo text-t-xs tabular-nums">
        <span>
          0<small className="ml-[.4rem] text-[length:inherit] opacity-80">sem relação</small>
        </span>
        <span>0.5</span>
        <span className="text-right">
          1<small className="ml-[.4rem] text-[length:inherit] opacity-80">idêntico</small>
        </span>
      </figcaption>
    </figure>
  );
}
