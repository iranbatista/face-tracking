import type { DebugHit } from "@/api/types";
import { cn } from "@/lib/utils";
import { faceStyle } from "./Ruler";

/** Os 30 mais parecidos. static/app.js:1090-1097; static/style.css:438-442 */
export function TopList({
  items,
  threshold,
  onOpen,
}: {
  items: DebugHit[];
  threshold: number;
  onOpen: (m: DebugHit) => void;
}) {
  return (
    <section aria-labelledby="top-title">
      <h2 id="top-title" className="mb-4 font-medium text-base leading-[1.3]">
        Os 30 mais parecidos
      </h2>
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(156px,1fr))] gap-x-5 p-0 mobile:grid-cols-2">
        {items.map((m, i) => {
          const above = m.score > threshold;
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: como no original, a lista é só de mouse; os pontos da régua dão o acesso por teclado
            <li
              key={m.face_id}
              className={cn(
                "group flex cursor-pointer items-center gap-[.7rem] border-linha border-b py-[.55rem]",
                above && "above",
              )}
              title={m.filename}
              onClick={() => onOpen(m)}
            >
              <div
                className={cn(
                  "size-[42px] flex-none bg-passe bg-no-repeat",
                  above && "shadow-[0_0_0_1.5px_var(--color-viridian)]",
                )}
                style={faceStyle(m)}
              />
              <div>
                <div
                  className={cn(
                    "display text-[1.3rem] leading-none group-hover:underline group-hover:underline-offset-[3px]",
                    above && "text-viridian",
                  )}
                >
                  {m.score.toFixed(3)}
                </div>
                <div className="mt-[.2rem] text-chumbo text-t-xs">
                  {i + 1}º, foto {m.photo_id}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
