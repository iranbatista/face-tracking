import { useId } from "react";
import { zipUrl } from "@/api/client";
import type { FaceHit } from "@/api/types";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { plural, precisionWord } from "@/lib/format";

/** Barra de resultados, grudada sob o cabeçalho: contagem, precisão e download.
 *  static/index.html:179-191; static/app.js:845-870; static/style.css:253-265 e 685-694. */
export function ResultsBar({
  matches,
  totalPhotos,
  threshold,
  onThreshold,
}: {
  matches: FaceHit[];
  totalPhotos: number;
  threshold: number;
  onThreshold: (value: number) => void;
}) {
  const n = matches.length;
  const label = useId();
  const hint = useId();
  return (
    <div className="sticky top-16 z-10 mb-5 grid grid-cols-[1fr_minmax(220px,300px)_auto] items-center gap-8 border-linha border-b bg-parede py-4 mobile:top-0 mobile:-mx-gutter mobile:mb-3 mobile:grid-cols-[1fr_auto] mobile:gap-x-4 mobile:gap-y-[.6rem] mobile:px-gutter mobile:py-3">
      <p className="display text-t-lg leading-[1.05]">
        {n ? plural(n, "foto com você", "fotos com você") : "Nenhuma foto encontrada"}{" "}
        <span className="ml-[.4rem] font-sans text-chumbo text-t-sm normal-case tracking-normal mobile:mt-1 mobile:ml-0 mobile:block">
          de {totalPhotos} no evento
        </span>
      </p>
      <div className="mobile:col-span-full mobile:row-start-2">
        <div id={label} className="flex justify-between font-medium text-t-sm">
          <span>Precisão</span>
          <output className="text-viridian">{precisionWord(threshold)}</output>
        </div>
        <Slider
          min={0.15}
          max={0.8}
          step={0.01}
          value={[threshold]}
          onValueChange={([v]) => v !== undefined && onThreshold(v)}
          aria-labelledby={label}
          aria-describedby={hint}
          className="mb-[7px]" // o <input> do original é inline: a linha ganha ~7px de baseline
        />
        <span id={hint} className="flex justify-between text-chumbo text-t-xs">
          <span>mais fotos</span>
          <span>mais certeza</span>
        </span>
      </div>
      {n ? (
        <Button asChild className="mobile:h-[38px] mobile:px-[.8rem]">
          <a href={zipUrl(matches.map((x) => x.photo_id))}>
            <Icon name="download" />
            Baixar todas
          </a>
        </Button>
      ) : (
        <Button disabled className="mobile:h-[38px] mobile:px-[.8rem]">
          <Icon name="download" />
          Baixar todas
        </Button>
      )}
    </div>
  );
}
