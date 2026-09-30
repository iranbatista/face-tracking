/** Fila de upload do Estúdio. Fica no __root para o resumo sobreviver à
 *  navegação (sair do evento e voltar mostra o mesmo lote).
 *  Cada foto: aguardando -> enviando -> na fila -> detectando -> pronta. */
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { progressUrl } from "@/api/client";
import { invalidateEvent } from "@/api/queries";
import type { ProgressOut, UploadResult } from "@/api/types";
import { type UploadFn, xhrUpload } from "@/api/upload";

export type Phase = "waiting" | "uploading" | "queued" | "processing" | "done" | "dup" | "error";
export interface UploadItem {
  key: string;
  file: File;
  phase: Phase;
  sent: number;
  n_faces: number;
  proc_ms: number | null;
  id: number | null;
  error: string | null;
}
export interface Batch {
  eventId: number;
  items: UploadItem[];
}
export interface EventSourceLike {
  onmessage: ((m: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

const FINAL = new Set<Phase>(["done", "dup", "error"]);
export const isFinal = (it: UploadItem) => FINAL.has(it.phase);
// quanto cada fase vale na barra geral (envio = primeira metade, indexação = segunda)
const PHASE_PROGRESS: Record<Phase, number> = {
  waiting: 0,
  uploading: 0,
  queued: 0.5,
  processing: 0.75,
  done: 1,
  dup: 1,
  error: 1,
};
export const itemProgress = (it: UploadItem) =>
  it.phase === "uploading" ? it.sent * 0.5 : PHASE_PROGRESS[it.phase];
const MAX_PARALLEL = 3; // rápido, sem abrir 200 conexões de uma vez

type Action =
  | { type: "add"; eventId: number; items: UploadItem[] }
  | { type: "patch"; key: string; patch: Partial<UploadItem> }
  | { type: "patchById"; id: number; patch: Partial<UploadItem> }
  | { type: "reset" };

function reducer(batch: Batch | null, a: Action): Batch | null {
  switch (a.type) {
    case "add":
      return batch && batch.eventId === a.eventId
        ? { ...batch, items: [...batch.items, ...a.items] }
        : { eventId: a.eventId, items: a.items };
    case "patch":
      return (
        batch && { ...batch, items: batch.items.map((it) => (it.key === a.key ? { ...it, ...a.patch } : it)) }
      );
    case "patchById":
      return (
        batch && {
          ...batch,
          items: batch.items.map((it) => (it.id === a.id && !isFinal(it) ? { ...it, ...a.patch } : it)),
        }
      );
    case "reset":
      return null;
  }
}

function resultPatch(r: UploadResult): Partial<UploadItem> {
  if (r.duplicate)
    return { phase: r.status === "done" ? "dup" : "queued", n_faces: r.n_faces ?? 0, id: r.id ?? null };
  if (r.status === "error") return { phase: "error", error: r.error ?? "Erro" };
  return {
    phase: r.status === "done" ? "done" : (r.status as Phase),
    id: r.id ?? null,
    n_faces: r.n_faces ?? 0,
    proc_ms: r.proc_ms ?? null,
  };
}

interface UploadQueue {
  batch: Batch | null;
  addFiles: (eventId: number, files: File[]) => void;
  reset: () => void;
}

const Ctx = createContext<UploadQueue | null>(null);
let seq = 0;

export function UploadQueueProvider({
  children,
  upload = xhrUpload,
  openProgress = (url) => new EventSource(url) as unknown as EventSourceLike,
  sseDelayMs = 300,
}: {
  children: ReactNode;
  upload?: UploadFn;
  openProgress?: (url: string) => EventSourceLike;
  sseDelayMs?: number;
}) {
  const qc = useQueryClient();
  const [batch, dispatch] = useReducer(reducer, null);
  const batchRef = useRef(batch);
  batchRef.current = batch;
  const queue = useRef<UploadItem[]>([]);
  const running = useRef(0);
  const session = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // fotos, stats e lista mudam a cada foto pronta: agrupa as atualizações
  const refreshSoon = useCallback(
    (eventId: number) => {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => invalidateEvent(qc, eventId), 800);
    },
    [qc],
  );

  const pump = useCallback(() => {
    while (running.current < MAX_PARALLEL && queue.current.length) {
      const it = queue.current.shift() as UploadItem;
      const sess = session.current;
      const eventId = batchRef.current?.eventId as number;
      running.current += 1;
      dispatch({ type: "patch", key: it.key, patch: { phase: "uploading", sent: 0 } });
      upload(eventId, it.file, (sent) => {
        if (sess === session.current) dispatch({ type: "patch", key: it.key, patch: { sent } });
      })
        .then((r) => {
          if (sess !== session.current) return; // resumo fechado no meio do envio
          dispatch({ type: "patch", key: it.key, patch: resultPatch(r) });
          refreshSoon(eventId);
        })
        .finally(() => {
          running.current -= 1;
          pump();
        });
    }
  }, [upload, refreshSoon]);

  const reset = useCallback(() => {
    session.current += 1;
    queue.current = [];
    dispatch({ type: "reset" });
  }, []);

  const addFiles = useCallback(
    (eventId: number, files: File[]) => {
      if (!files.length) return;
      const cur = batchRef.current;
      // sessão anterior terminada (ou de outro evento): começa um resumo novo
      if (cur && (cur.items.every(isFinal) || cur.eventId !== eventId)) {
        session.current += 1;
        queue.current = [];
        batchRef.current = null;
        dispatch({ type: "reset" });
      }
      const items = files.map<UploadItem>((file) => ({
        key: `u${++seq}`,
        file,
        phase: "waiting",
        sent: 0,
        n_faces: 0,
        proc_ms: null,
        id: null,
        error: null,
      }));
      batchRef.current = { eventId, items: [...(batchRef.current?.items ?? []), ...items] };
      dispatch({ type: "add", eventId, items });
      queue.current.push(...items);
      pump();
    },
    [pump],
  );

  // SSE com as fotos ainda pendentes; reabre quando fotos novas ganham id
  const watchKey = batch
    ? `${batch.eventId}:${batch.items
        .filter((it) => it.id != null)
        .map((it) => it.id)
        .join(",")}`
    : "";
  useEffect(() => {
    const cur = batchRef.current;
    if (!cur || !watchKey) return;
    let es: EventSourceLike | null = null;
    const timer = setTimeout(() => {
      const ids = cur.items.filter((it) => it.id != null && !isFinal(it)).map((it) => it.id as number);
      if (!ids.length) return;
      es = openProgress(progressUrl(cur.eventId, ids));
      es.onmessage = (msg) => {
        const data = JSON.parse(msg.data) as ProgressOut;
        for (const p of data.items) {
          dispatch({
            type: "patchById",
            id: p.id,
            patch:
              p.status === "error"
                ? { phase: "error", error: p.error || "Erro ao processar" }
                : { phase: p.status as Phase, n_faces: p.n_faces, proc_ms: p.proc_ms ?? null },
          });
        }
        refreshSoon(cur.eventId);
        if (data.done) es?.close(); // sem close o EventSource reconecta sozinho
      };
      es.onerror = () => es?.close();
    }, sseDelayMs);
    return () => {
      clearTimeout(timer);
      es?.close();
    };
  }, [watchKey, openProgress, sseDelayMs, refreshSoon]);

  // lote terminou: atualiza tudo na hora (sem esperar o agrupamento)
  const finished = !!batch && batch.items.length > 0 && batch.items.every(isFinal);
  useEffect(() => {
    if (finished && batchRef.current) {
      clearTimeout(refreshTimer.current);
      invalidateEvent(qc, batchRef.current.eventId);
    }
  }, [finished, qc]);

  const value = useMemo(() => ({ batch, addFiles, reset }), [batch, addFiles, reset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUploadQueue(): UploadQueue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUploadQueue fora do UploadQueueProvider");
  return ctx;
}
