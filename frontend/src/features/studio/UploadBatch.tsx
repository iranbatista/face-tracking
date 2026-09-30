import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/button";
import { fmtEta, fmtMs, pct, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type Batch, itemProgress, type UploadItem } from "./UploadQueueProvider";

function itemState(it: UploadItem): [string, "" | "ok" | "dup" | "err"] {
  const faces = plural(it.n_faces, "rosto", "rostos");
  switch (it.phase) {
    case "waiting":
      return ["Aguardando", ""];
    case "uploading":
      return [`Enviando ${pct(it.sent)}`, ""];
    case "queued":
      return ["Na fila", ""];
    case "processing":
      return ["Detectando rostos", ""];
    case "done":
      return [`${faces}, ${fmtMs(it.proc_ms ?? 0)}`, "ok"];
    case "dup":
      return [`Já enviada, ${faces}`, "dup"];
    case "error":
      return [it.error || "Erro", "err"];
  }
}

const TALLY = [
  ["done", "pronta", "prontas"],
  ["processing", "detectando", "detectando"],
  ["queued", "na fila", "na fila"],
  ["sending", "enviando", "enviando"],
  ["dup", "já enviada", "já enviadas"],
  ["error", "com erro", "com erro"],
] as const;

/** Resumo do envio: sempre compacto; a lista por foto é opcional e tem altura fixa.
 *  Apresentacional: recebe o lote e `onClose`. static/index.html:244-266; static/app.js:503-611, 694-706;
 *  static/style.css:343-376, 696-702 */
export function UploadBatch({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const { items } = batch;
  const count = (ph: UploadItem["phase"]) => items.filter((it) => it.phase === ph).length;
  const counts = {
    done: count("done"),
    dup: count("dup"),
    error: count("error"),
    processing: count("processing"),
    queued: count("queued"),
    sending: count("uploading") + count("waiting"),
  };
  const finished = counts.done + counts.dup + counts.error;
  const total = items.length;
  const allDone = finished === total;

  // barra geral: média do progresso de cada foto (anda suave, não aos saltos)
  const prog = items.reduce((a, it) => a + itemProgress(it), 0) / (total || 1);

  const label = allDone
    ? counts.error
      ? `Pronto, ${plural(counts.error, "foto com erro", "fotos com erro")}`
      : "Pronto"
    : counts.sending
      ? "Enviando"
      : "Indexando";
  const state = allDone ? (counts.error ? "err" : "live") : "busy";

  // rostos encontrados + estimativa: fotos restantes x tempo médio medido nesta sessão
  const faces = items.reduce((a, it) => a + (it.phase === "done" ? it.n_faces : 0), 0);
  const timed = items.filter((it) => it.phase === "done" && it.proc_ms);
  const avg = timed.length ? timed.reduce((a, it) => a + (it.proc_ms as number), 0) / timed.length : null;
  const left = total - finished;
  const extra = [
    counts.done ? plural(faces, "rosto encontrado", "rostos encontrados") : null,
    !allDone && avg && left ? fmtEta(left * avg) : null,
  ]
    .filter(Boolean)
    .join(", ");

  // deu erro em alguma foto: abre a lista com as fotos com erro no topo
  const failed = allDone && counts.error > 0;
  const [open, setOpen] = useState(failed);
  const list = useRef<HTMLUListElement>(null);
  const wasFailed = useRef(failed);
  useEffect(() => {
    if (failed && !wasFailed.current) {
      setOpen(true);
      if (list.current) list.current.scrollTop = 0;
    }
    wasFailed.current = failed;
  }, [failed]);
  const rows = failed
    ? [...items.filter((it) => it.phase === "error"), ...items.filter((it) => it.phase !== "error")]
    : items;

  return (
    <section className="mt-5 border border-linha bg-papel" aria-label="Envio de fotos">
      <div className="px-5 pt-4 pb-[.85rem] mobile:px-4 mobile:pt-[.9rem] mobile:pb-[.8rem]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-[.4rem]">
          <p className="flex items-baseline gap-[.6rem]" role="status">
            <span
              data-state={state}
              className="status inline-flex items-center gap-[.45rem] font-medium text-grafite text-t-sm"
            >
              {label}
            </span>
            <span className="num text-chumbo text-t-sm">
              {finished} de {plural(total, "foto", "fotos")}
            </span>
          </p>
          <p className="mr-auto text-chumbo text-t-sm mobile:order-3 mobile:flex-[1_1_100%]">{extra}</p>
          <div className="flex items-center gap-1 mobile:ml-auto">
            <Button
              variant="text"
              className="h-[34px] text-grafite text-t-sm [&[aria-expanded=true]_.ico]:rotate-180"
              aria-expanded={open}
              aria-controls="upload-list"
              onClick={() => setOpen((o) => !o)}
            >
              <span>{open ? "Ocultar fotos" : "Ver fotos"}</span>
              <Icon name="chev-d" className="ico size-4 transition-transform duration-200" />
            </Button>
            {allDone && (
              <Button variant="icon" size="small" aria-label="Fechar resumo do envio" onClick={onClose}>
                <Icon name="close" className="ico" />
              </Button>
            )}
          </div>
        </div>
        <div className="mt-[.8rem] mb-[.65rem] h-[3px] overflow-hidden bg-linha">
          <div
            data-batch-bar
            data-done={allDone && !counts.error}
            className="bar-fill h-full bg-grafite transition-[width] duration-[250ms] data-[done=true]:bg-viridian"
            style={{ width: `${prog * 100}%` }}
          />
        </div>
        <p data-tally className="flex flex-wrap gap-x-[1.1rem] gap-y-1 text-chumbo text-t-xs">
          {TALLY.filter(([k]) => counts[k]).map(([k, one, many]) => (
            <span key={k} className={cn(k === "error" && "text-erro")}>
              <b className={cn("font-medium text-grafite tabular-nums", k === "error" && "text-erro")}>
                {counts[k]}
              </b>{" "}
              {counts[k] === 1 ? one : many}
            </span>
          ))}
        </p>
      </div>
      <ul
        ref={list}
        id="upload-list"
        hidden={!open}
        className="m-0 max-h-[296px] list-none overflow-y-auto overscroll-contain border-linha border-t px-5 py-0 mobile:max-h-[260px] mobile:px-4"
      >
        {rows.map((it) => {
          const [text, cls] = itemState(it);
          const active = it.phase === "uploading" || it.phase === "processing";
          return (
            <li
              key={it.key}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-[.35rem] border-passe border-b py-[.6rem] text-t-sm [grid-template-areas:'name_state'_'bar_bar'] last:border-b-0"
            >
              <span
                title={it.file.name}
                className="overflow-hidden text-ellipsis whitespace-nowrap [grid-area:name]"
              >
                {it.file.name}
              </span>
              <span
                className={cn(
                  "flex items-center gap-[.35rem] whitespace-nowrap text-chumbo tabular-nums [grid-area:state]",
                  cls === "ok" && "text-viridian",
                  cls === "err" && "text-erro",
                )}
              >
                {cls === "ok" && <Icon name="check" className="ico size-[15px]" />}
                {cls === "err" && <Icon name="alert" className="ico size-[15px]" />}
                {text}
              </span>
              {active && (
                <div className="h-[2px] overflow-hidden bg-linha [grid-area:bar]">
                  <div
                    data-working={it.phase === "processing"}
                    className="bar-fill h-full bg-grafite transition-[width] duration-[250ms]"
                    style={{ width: `${itemProgress(it) * 100}%` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
