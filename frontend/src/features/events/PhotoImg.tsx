import type { ComponentProps } from "react";
import { mediumUrl, thumbUrl } from "@/api/client";
import { focusPos } from "@/lib/geometry";

/** Imagem com duas resoluções: o navegador escolhe a miniatura (400px) ou a média
 *  (1600px) conforme o tamanho na tela e a densidade. static/app.js:124-129 */
export function PhotoImg({
  photo,
  sizes,
  style,
  ...rest
}: { photo: { id: number; fx?: number | null; fy?: number | null }; sizes: string } & Omit<
  ComponentProps<"img">,
  "src" | "srcSet" | "sizes"
>) {
  return (
    <img
      src={thumbUrl(photo.id)}
      srcSet={`${thumbUrl(photo.id)} 400w, ${mediumUrl(photo.id)} 1600w`}
      sizes={sizes}
      alt=""
      loading="lazy"
      decoding="async"
      style={{ objectPosition: focusPos(photo), ...style }}
      {...rest}
    />
  );
}
