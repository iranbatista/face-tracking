import type { Ref } from "react";
import type { SelfieInfo } from "@/api/types";
import { faceCropStyle } from "@/lib/geometry";

/** O visor mostra: silhueta (empty) | câmera (cam) | selfie inteira (searching: colchetes
 *  "caçando"; photo: busca falhou, colchetes parados) | rosto recortado (face: colchetes
 *  "travam"). static/index.html:150-162; static/app.js:729-742; CSS em components.css (.viewfinder). */
export type ViewfinderMode = "empty" | "cam" | "searching" | "photo" | "face";

const AF = "absolute z-[2] size-[22%] border-0";
const CORNERS = [
  ["af-tl", "top-[9%] left-[9%] border-t-2 border-l-2 [--dx:-10px] [--dy:-10px]"],
  ["af-tr", "top-[9%] right-[9%] border-t-2 border-r-2 [--dx:10px] [--dy:-10px]"],
  ["af-bl", "bottom-[9%] left-[9%] border-b-2 border-l-2 [--dx:-10px] [--dy:10px]"],
  ["af-br", "right-[9%] bottom-[9%] border-r-2 border-b-2 [--dx:10px] [--dy:10px]"],
] as const;

export function Viewfinder({
  mode,
  selfieUrl,
  face,
  videoRef,
}: {
  mode: ViewfinderMode;
  selfieUrl: string | null;
  /** rosto usado na busca (recorte); sem ele mostra a selfie inteira */
  face: SelfieInfo | null;
  videoRef: Ref<HTMLVideoElement>;
}) {
  const showPhoto = selfieUrl && (mode === "searching" || mode === "photo" || mode === "face");
  const photoStyle =
    mode === "face" && face && selfieUrl
      ? faceCropStyle({ url: selfieUrl, ...face }, 1.9)
      : { backgroundImage: `url(${selfieUrl})`, backgroundSize: "cover", backgroundPosition: "center" };
  return (
    <div
      className="viewfinder relative aspect-square w-full overflow-hidden border border-linha bg-papel mobile:row-span-2"
      data-mode={mode}
    >
      {mode === "empty" && (
        <svg className="absolute inset-[14%] size-[72%]" viewBox="0 0 120 120" aria-hidden="true">
          <g fill="none" stroke="var(--color-chumbo)" strokeWidth="1.4" strokeLinecap="round">
            <ellipse cx="60" cy="52" rx="17" ry="21" />
            <path d="M30 104c5-15 16-22 30-22s25 7 30 22" />
          </g>
        </svg>
      )}
      {showPhoto && <div className="absolute inset-0 bg-passe bg-no-repeat" style={photoStyle} />}
      {mode === "cam" && (
        <video
          ref={videoRef}
          className="absolute inset-0 size-full -scale-x-100 object-cover"
          autoPlay
          playsInline
          muted
        />
      )}
      {CORNERS.map(([name, pos]) => (
        <span key={name} className={`af ${name} ${AF} ${pos}`} />
      ))}
    </div>
  );
}
