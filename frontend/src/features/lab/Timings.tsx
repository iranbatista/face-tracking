/** Cores das etapas: rampa de grafite para o trabalho pesado (redes neurais) e o verde de foco
 *  só na busca do índice, a etapa que o corte controla. static/app.js:1017-1023 */
const STAGES = [
  ["decode", "Ler a imagem", "#C9CCD1"],
  ["resize", "Redimensionar", "#A3A8AF"],
  ["detection", "Detecção (SCRFD)", "#62676F"],
  ["embedding", "Embedding (ArcFace)", "#23262B"],
  ["search", "Busca no índice (pgvector)", "#1F5C4A"],
] as const;

/** Tempo por etapa: barra proporcional + legenda. static/app.js:1072-1088; static/style.css:428-436 */
export function Timings({ timings, fromCache }: { timings: Record<string, number>; fromCache: boolean }) {
  const present = STAGES.filter(([k]) => timings[k] !== undefined);
  const total = present.reduce((a, [k]) => a + (timings[k] ?? 0), 0) || 1;
  const li = "flex items-center gap-[.6rem] border-linha border-b py-2 text-t-sm";
  return (
    <section aria-labelledby="t-title">
      <h2 id="t-title" className="mb-4 font-medium text-base leading-[1.3]">
        Tempo por etapa
      </h2>
      <div className="mt-1 mb-5 flex h-2 overflow-hidden rounded-[1px] bg-passe">
        {present.map(([k, label, c]) => (
          <div
            key={k}
            className="min-w-[3px]"
            title={`${label}: ${timings[k]} ms`}
            style={{ width: `${((timings[k] ?? 0) / total) * 100}%`, background: c }}
          />
        ))}
      </div>
      <ul className="m-0 mb-5 list-none p-0">
        {present.map(([k, label, c]) => (
          <li key={k} className={li}>
            <span className="size-[10px] flex-none" style={{ background: c }} />
            {label}
            <span className="ml-auto tabular-nums">{timings[k]} ms</span>
          </li>
        ))}
        <li className={`${li} border-b-0 font-medium`}>
          Total
          <span className="ml-auto font-normal tabular-nums">{Math.round(total)} ms</span>
        </li>
        {fromCache && (
          <li className="block text-chumbo text-t-xs">
            Na última busca só o índice rodou: a selfie não foi reprocessada (busca pelo token). Os outros
            tempos são da primeira busca, quando a selfie foi enviada.
          </li>
        )}
      </ul>
      <p className="max-w-[62ch] text-chumbo text-t-sm">
        Detecção e embedding rodam redes neurais na CPU. A busca no índice só multiplica vetores, por isso
        mover o corte é instantâneo.
      </p>
    </section>
  );
}
