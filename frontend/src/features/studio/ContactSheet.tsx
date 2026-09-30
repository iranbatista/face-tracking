import { memo } from "react";
import { thumbUrl } from "@/api/client";
import { usePhotos } from "@/api/queries";
import { Icon } from "@/components/Icon";
import { plural } from "@/lib/format";
import { focusPos } from "@/lib/geometry";

/** Folha de contato: miniaturas do evento com a contagem de rostos.
 *  static/index.html:268-273; static/app.js:372-387; static/style.css:378-393 */
export const ContactSheet = memo(function ContactSheet({ eventId }: { eventId: number }) {
  const { data: photos } = usePhotos(eventId);
  return (
    <section className="mt-12" aria-labelledby="sheet-title">
      <h2 id="sheet-title" className="mb-4 font-medium text-t-base leading-[1.3]">
        Fotos do evento
      </h2>
      {photos && photos.length === 0 && (
        <p className="max-w-[62ch] text-chumbo text-t-sm">
          As fotos enviadas aparecem aqui, com o número de rostos encontrados em cada uma.
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-1 mobile:grid-cols-3 mobile:gap-[3px]">
        {photos?.map((p) =>
          p.status === "done" ? (
            <div key={p.id} title={p.filename} className="relative aspect-square overflow-hidden bg-passe">
              <img
                src={thumbUrl(p.id)}
                alt={p.filename}
                loading="lazy"
                className="block size-full object-cover"
                style={{ objectPosition: focusPos(p) }}
              />
              <span
                title={plural(p.n_faces, "rosto", "rostos")}
                className="absolute bottom-[6px] left-[6px] flex items-center gap-1 rounded-[3px] bg-white/[.92] px-[.4rem] py-[.22rem] text-t-xs leading-none tabular-nums"
              >
                <Icon name="face" className="ico size-[13px]" />
                {p.n_faces}
              </span>
            </div>
          ) : (
            <div
              key={p.id}
              title={p.filename}
              className="grid aspect-square place-items-center overflow-hidden bg-passe text-chumbo text-t-xs"
            >
              {p.status === "error" ? "Erro" : p.status === "processing" ? "Detectando" : "Na fila"}
            </div>
          ),
        )}
      </div>
    </section>
  );
});
