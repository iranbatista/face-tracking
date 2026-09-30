import type { CoverPhoto } from "@/api/types";
import { useProgressiveSrc } from "@/features/events/useProgressiveSrc";
import { focusPos } from "@/lib/geometry";

const AREAS = ["a", "b", "c", "d", "e"];

function Tile({ photo, index }: { photo: CoverPhoto; index: number }) {
  const src = useProgressiveSrc(photo.id, "medium");
  return (
    <div className={`ct ct-${AREAS[index]}`}>
      <img src={src} alt="" decoding="async" style={{ objectPosition: focusPos(photo) }} />
    </div>
  );
}

/** Capa em mosaico (1 a 5 fotos): o CSS escolhe a grade por data-n e cada foto ocupa a área a, b, c...
 *  Os tiles têm `key` = id da foto: mesma capa não recria (nem reanima). static/app.js:299-312 */
export function Collage({ cover }: { cover: CoverPhoto[] }) {
  const photos = cover.slice(0, 5);
  return (
    <div className="collage" aria-hidden="true" data-n={photos.length}>
      {photos.map((p, i) => (
        <Tile key={p.id} photo={p} index={i} />
      ))}
    </div>
  );
}
