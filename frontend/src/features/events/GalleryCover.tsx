import type { CoverPhoto } from "@/api/types";
import { PhotoImg } from "./PhotoImg";

/** Capa do card: 1 foto, díptico (2) ou uma grande + duas empilhadas (3). static/app.js:268-275 */
const BIG = "(max-width: 820px) 100vw, 30vw";
const SMALL = "(max-width: 820px) 40vw, 12vw";
const AREAS = ["a", "b", "c"];

export function GalleryCover({ cover }: { cover: CoverPhoto[] }) {
  const photos = cover.slice(0, 3);
  return (
    <div className="gal-cover" data-n={photos.length}>
      {photos.map((p, i) => (
        <div key={p.id} className={`gt gt-${AREAS[i]}`}>
          <PhotoImg photo={p} sizes={i === 0 && photos.length !== 2 ? BIG : SMALL} />
        </div>
      ))}
    </div>
  );
}
