/** Busca sem acento e sem caixa: "florianopolis" acha "Florianópolis". static/app.js:253 */
export const fold = (s: string | null | undefined) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
