import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { downloadUrl } from "@/api/client";
import type { FaceHit } from "@/api/types";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useProgressiveSrc } from "@/features/events/useProgressiveSrc";
import { pct } from "@/lib/format";
import { faceZoom, zoomTransform } from "@/lib/geometry";

const FLASH_MS = 2000;

/** Visualizador em tela cheia. Montado só enquanto há uma foto; ao desmontar, tudo reinicia.
 *  static/index.html:411-431, static/app.js:925-1011 */
export function Lightbox({ match, onClose }: { match: FaceHit; onClose: () => void }) {
  const { photo_id, bbox, filename, score } = match;
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = bbox;
  const w = match.width ?? undefined;
  const h = match.height ?? undefined;
  const src = useProgressiveSrc(photo_id, "medium"); // exibe 1600px; "Baixar foto" entrega o original
  const [where, setWhere] = useState(false);
  const [flash, setFlash] = useState(true); // ao abrir: marca o rosto por ~2 s e some
  const [zoomed, setZoomed] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // o foco volta para quem abriu (o cartão da foto); o Radix não tem gatilho para devolvê-lo
  useLayoutEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, []);

  const toggleWhere = () => {
    const on = !where;
    const el = frame.current;
    const zoom = on && w && h ? faceZoom({ bbox, width: w, height: h }) : null;
    if (el && stage.current) {
      el.style.transform = ""; // mede com o transform zerado
      el.style.transform = zoom
        ? zoomTransform(el.getBoundingClientRect(), stage.current.getBoundingClientRect(), zoom)
        : "";
    }
    setZoomed(!!zoom);
    setWhere(on);
    if (on) setFlash(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        variant="lightbox"
        aria-describedby={undefined}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          opener.current?.focus();
        }}
        className="flex flex-col"
      >
        <DialogTitle className="sr-only">Foto</DialogTitle>
        <Button
          variant="icon"
          aria-label="Fechar"
          onClick={onClose}
          className="absolute top-[calc(14px+env(safe-area-inset-top))] right-[calc(14px+env(safe-area-inset-right))] z-2"
        >
          <Icon name="close" />
        </Button>
        {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: atalho de mouse/toque; teclado fecha com Esc e pelos botões */}
        <div
          ref={stage}
          data-testid="lb-stage"
          // tocar no espaço vazio em volta da foto fecha
          onClick={(e) => e.target === e.currentTarget && onClose()}
          className="grid min-h-0 flex-1 place-items-center overflow-hidden px-[72px] pt-6 mobile:px-0 mobile:pt-[calc(64px+env(safe-area-inset-top))] short:px-16 short:pt-2"
        >
          <div
            ref={frame}
            data-zoomed={zoomed}
            className="lb-frame relative mx-auto block w-fit origin-center leading-[0] transition-transform duration-[550ms] ease-[cubic-bezier(.2,.7,.2,1)]"
          >
            <img
              src={src}
              alt={filename}
              width={w}
              height={h}
              className="block h-auto w-auto max-h-[calc(100dvh-120px)] max-w-[min(100%,calc(100vw-144px))] mobile:max-h-[calc(100dvh-210px-env(safe-area-inset-bottom)-env(safe-area-inset-top))] mobile:max-w-[100vw] short:max-h-[calc(100dvh-70px)]"
            />
            <div className="lb-boxes" data-show={where || flash}>
              {w && h && (
                <div
                  className="af-box"
                  style={{
                    left: `${(x1 / w) * 100}%`,
                    top: `${(y1 / h) * 100}%`,
                    width: `${((x2 - x1) / w) * 100}%`,
                    height: `${((y2 - y1) / h) * 100}%`,
                  }}
                />
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 border-linha border-t bg-parede px-gutter pt-[.9rem] pb-[calc(.9rem+env(safe-area-inset-bottom))] mobile:flex-wrap short:flex-nowrap short:py-2">
          <div className="mr-auto flex min-w-0 items-baseline gap-[.8rem] mobile:flex-[1_1_100%] mobile:flex-col mobile:items-start mobile:gap-[.2rem] short:flex-[1_1_auto] short:flex-row short:items-baseline">
            <strong className="display whitespace-nowrap text-t-lg leading-none">
              {pct(score)} de semelhança
            </strong>
            <span
              title={`${filename} (score ${score.toFixed(3)})`}
              className="overflow-hidden text-ellipsis whitespace-nowrap text-chumbo text-t-sm"
            >
              {filename}
            </span>
          </div>
          <Button
            aria-pressed={where}
            onClick={toggleWhere}
            className="aria-pressed:border-viridian aria-pressed:text-viridian aria-pressed:not-disabled:hover:border-viridian mobile:h-[46px] mobile:flex-1 short:h-[38px] short:flex-none"
          >
            <Icon name="mark" />
            <span>{where && zoomed ? "Ver foto inteira" : "Onde estou?"}</span>
          </Button>
          <Button
            asChild
            variant="primary"
            className="mobile:h-[46px] mobile:flex-1 short:h-[38px] short:flex-none"
          >
            <a href={downloadUrl(photo_id)}>
              <Icon name="download" />
              Baixar foto
            </a>
          </Button>
          <Button onClick={onClose} className="mobile:hidden short:h-[38px] short:flex-none">
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
