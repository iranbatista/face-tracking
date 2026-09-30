/** Busca por selfie, compartilhada entre Galeria e Calibração (como no app antigo).
 *  Nunca persistida (nem localStorage, nem URL): a selfie é dado biométrico. */
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { ApiError, searchPhotos } from "@/api/client";
import { qk } from "@/api/queries";
import type { SearchOut, SelfieInfo } from "@/api/types";

export type SearchStatus = "idle" | "searching" | "done" | "error";
export type Message = { text: string; kind: "" | "warn" | "err" };

export interface SearchState {
  eventId: number | null;
  selfieBlob: Blob | null;
  selfieUrl: string | null;
  queryToken: string | null;
  selfieInfo: SelfieInfo | null;
  firstTimings: Record<string, number> | null;
  threshold: number;
  result: SearchOut | null;
  status: SearchStatus;
  message: Message;
}

const NO_FACE = "Não encontramos um rosto nesta foto. Tente de frente, com mais luz.";
const EMPTY: Message = { text: "", kind: "" };

const initial = (threshold = 0.4, eventId: number | null = null): SearchState => ({
  eventId,
  selfieBlob: null,
  selfieUrl: null,
  queryToken: null,
  selfieInfo: null,
  firstTimings: null,
  threshold,
  result: null,
  status: "idle",
  message: EMPTY,
});

interface SelfieSearch {
  state: SearchState;
  setEvent: (id: number | null) => void;
  submitSelfie: (blob: Blob) => void;
  setThreshold: (value: number) => void;
}

const Ctx = createContext<SelfieSearch | null>(null);

/** `initialState` só para testes (montar uma tela já com resultado). */
export function SelfieSearchProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: Partial<SearchState>;
}) {
  const qc = useQueryClient();
  const [state, setState] = useState<SearchState>(() => ({ ...initial(), ...initialState }));
  const ref = useRef(state);
  const update = useCallback((fn: (s: SearchState) => SearchState) => {
    ref.current = fn(ref.current); // estado mais novo já disponível para as buscas assíncronas
    setState(ref.current);
  }, []);
  const request = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const selfieBusy = useRef(false); // busca com selfie em andamento: busca por token esperaria um token velho

  const run = useCallback(
    async (blob?: Blob): Promise<void> => {
      const cur = ref.current;
      if (!cur.eventId) return;
      if (!blob && selfieBusy.current) return; // o token ainda é o da selfie anterior
      const form = new FormData();
      form.append("event_id", String(cur.eventId));
      form.append("threshold", String(cur.threshold));
      if (blob) form.append("selfie", blob, "selfie.jpg");
      else if (cur.queryToken) form.append("query_token", cur.queryToken);
      else return;
      const id = ++request.current;
      if (blob) selfieBusy.current = true;
      if (blob)
        update((s) => ({
          ...s,
          status: "searching",
          message: { text: "Procurando você nas fotos do evento", kind: "" },
        }));
      try {
        const r = await searchPhotos(form);
        if (id !== request.current) return; // resposta velha: o slider já pediu outra
        if (blob) selfieBusy.current = false;
        const selfieInfo = r.selfie ?? ref.current.selfieInfo;
        const firstTimings = r.selfie ? (r.timings_ms ?? null) : ref.current.firstTimings;
        // A busca pelo token não traz a selfie nem os tempos da detecção: reaproveita os da primeira.
        const timings =
          !r.selfie && r.timings_ms && firstTimings
            ? { ...firstTimings, search: r.timings_ms.search ?? 0 }
            : r.timings_ms;
        const result: SearchOut = { ...r, selfie: selfieInfo ?? undefined, timings_ms: timings };
        // Desligaram a Calibração com a página aberta: a resposta veio sem o top 30.
        const flags = qc.getQueryData<Record<string, boolean>>(qk.features);
        if (!r.debug_top && flags?.calibration)
          qc.setQueryData(qk.features, { ...flags, calibration: false });
        update((s) => ({
          ...s,
          queryToken: r.query_token,
          selfieInfo,
          firstTimings,
          result,
          status: "done",
          message: blob
            ? r.selfie?.warning
              ? { text: `${r.selfie.n_faces} rostos na selfie. Usamos o maior.`, kind: "warn" }
              : EMPTY
            : s.message,
        }));
        // o slider andou enquanto a selfie era procurada: alinha o resultado ao corte atual
        if (blob && ref.current.threshold !== r.threshold) void run();
      } catch (e) {
        if (id !== request.current) return;
        if (blob) selfieBusy.current = false;
        // token expirado (410): reenvia a selfie guardada; a retentativa vai com a selfie, então não entra em loop
        if (e instanceof ApiError && e.status === 410 && !blob && ref.current.selfieBlob)
          return run(ref.current.selfieBlob);
        const text = e instanceof ApiError && e.status === 422 ? NO_FACE : (e as Error).message;
        update((s) => ({
          ...s,
          ...(blob ? { result: null } : {}),
          status: "error",
          message: { text, kind: "err" },
        }));
      }
    },
    [qc, update],
  );

  const setEvent = useCallback(
    (id: number | null) => {
      if (id === ref.current.eventId) return;
      request.current += 1; // ignora respostas do evento anterior
      selfieBusy.current = false;
      clearTimeout(debounce.current);
      if (ref.current.selfieUrl) URL.revokeObjectURL(ref.current.selfieUrl);
      update((s) => initial(s.threshold, id));
    },
    [update],
  );

  const submitSelfie = useCallback(
    (blob: Blob) => {
      if (ref.current.selfieUrl) URL.revokeObjectURL(ref.current.selfieUrl);
      clearTimeout(debounce.current); // busca por token agendada seria com o token da selfie anterior
      update((s) => ({
        ...s,
        selfieBlob: blob,
        selfieUrl: URL.createObjectURL(blob),
        queryToken: null,
        selfieInfo: null,
        firstTimings: null,
        status: "searching", // o resultado anterior fica até chegar o novo (como no app antigo)
      }));
      void run(blob);
    },
    [run, update],
  );

  const setThreshold = useCallback(
    (value: number) => {
      update((s) => ({ ...s, threshold: value }));
      clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        if (ref.current.queryToken) void run();
      }, 150);
    },
    [run, update],
  );

  const value = useMemo(
    () => ({ state, setEvent, submitSelfie, setThreshold }),
    [state, setEvent, submitSelfie, setThreshold],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSelfieSearch(): SelfieSearch {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSelfieSearch fora do SelfieSearchProvider");
  return ctx;
}
