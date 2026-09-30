/** Inteiro >= 1 vindo da URL; qualquer outra coisa vira undefined (parâmetro descartado). */
export function positiveInt(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

/** Chaves inválidas ficam `undefined` de propósito: o search da rota é mesclado com o do pai
 *  (que é o bruto da URL), e só uma chave presente sobrescreve o valor inválido. */
export function pickInts<K extends string>(search: Record<string, unknown>, keys: readonly K[]) {
  const out: Partial<Record<K, number>> = {};
  for (const k of keys) {
    out[k] = positiveInt(search[k]);
  }
  return out;
}
