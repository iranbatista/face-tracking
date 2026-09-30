import { useEffect, useState } from "react";
import { thumbUrl } from "@/api/client";

/** Miniatura (já em cache) na hora; troca pela versão maior quando ela carregar.
 *  Se o id mudar antes, a troca pendente é cancelada. static/app.js:240-248 */
export function useProgressiveSrc(photoId: number, size: "medium" | "full" = "medium") {
  const big = `/api/photos/${photoId}/${size}`;
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setLoaded(big);
    img.src = big;
    return () => {
      img.onload = null;
    };
  }, [big]);
  return loaded === big ? big : thumbUrl(photoId);
}
