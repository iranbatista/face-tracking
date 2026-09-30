import { useEffect } from "react";

/** Define `document.title`. Títulos: `Foco`, `<evento>, Foco`, `Estúdio, Foco`,
 *  `<evento>, Estúdio, Foco`, `Calibração, Foco`, `Backoffice, Foco`. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

export const titles = {
  home: "Foco",
  event: (name: string) => `${name}, Foco`,
  studio: "Estúdio, Foco",
  studioEvent: (name: string) => `${name}, Estúdio, Foco`,
  lab: "Calibração, Foco",
  admin: "Backoffice, Foco",
};
