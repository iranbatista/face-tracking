/** Links antigos (#galeria?e=4...) -> rotas novas. null = não é link antigo. */
export function legacyHashTarget(hash: string): string | null {
  const [name, query = ""] = hash.replace(/^#/, "").split("?");
  const e = Number(new URLSearchParams(query).get("e")) || null;
  switch (name) {
    case "galeria":
      return e ? `/galeria/${e}` : "/";
    case "estudio":
      return e ? `/estudio/${e}` : "/estudio";
    case "calibracao":
      return e ? `/calibracao?e=${e}` : "/calibracao";
    case "backoffice":
      return "/backoffice";
    default:
      return null;
  }
}
