import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";
import type { UploadResult } from "@/api/types";
import {
  type EventSourceLike,
  UploadQueueProvider,
  useUploadQueue,
} from "@/features/studio/UploadQueueProvider";
import { newQueryClient } from "../render";

type Pending = { file: File; resolve: (r: UploadResult) => void; progress: (s: number) => void };

function setup() {
  const pending: Pending[] = [];
  const upload = vi.fn(
    (_: number, file: File, progress: (s: number) => void) =>
      new Promise<UploadResult>((resolve) => pending.push({ file, resolve, progress })),
  );
  const streams: Array<EventSourceLike & { url: string; emit: (d: unknown) => void; closed: boolean }> = [];
  const openProgress = (url: string) => {
    const es = {
      url,
      closed: false,
      onmessage: null as ((m: { data: string }) => void) | null,
      onerror: null,
      close() {
        this.closed = true;
      },
      emit(d: unknown) {
        this.onmessage?.({ data: JSON.stringify(d) });
      },
    };
    streams.push(es);
    return es;
  };
  const qc = newQueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <UploadQueueProvider upload={upload} openProgress={openProgress} sseDelayMs={0}>
        {children}
      </UploadQueueProvider>
    </QueryClientProvider>
  );
  return { pending, upload, streams, invalidate, ...renderHook(() => useUploadQueue(), { wrapper }) };
}

const files = (n: number) =>
  Array.from({ length: n }, (_, i) => new File(["x"], `f${i}.jpg`, { type: "image/jpeg" }));
const phases = (r: { current: ReturnType<typeof useUploadQueue> }) =>
  r.current.batch?.items.map((it) => it.phase);

test("no máximo 3 envios ao mesmo tempo", async () => {
  const { result, pending } = setup();
  act(() => result.current.addFiles(4, files(5)));
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(phases(result)).toEqual(["uploading", "uploading", "uploading", "waiting", "waiting"]);
  act(() =>
    pending[0]?.resolve({ id: 1, status: "queued", filename: "f0.jpg", n_faces: 0, duplicate: false }),
  );
  await waitFor(() => expect(pending).toHaveLength(4));
});

test("progresso de envio e fases pelo SSE", async () => {
  const { result, pending, streams } = setup();
  act(() => result.current.addFiles(4, files(1)));
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => pending[0]?.progress(0.5));
  expect(result.current.batch?.items[0]?.sent).toBe(0.5);
  act(() =>
    pending[0]?.resolve({ id: 7, status: "queued", filename: "f0.jpg", n_faces: 0, duplicate: false }),
  );
  await waitFor(() => expect(streams).toHaveLength(1));
  expect(streams[0]?.url).toBe("/api/events/4/progress?ids=7");
  act(() => streams[0]?.emit({ items: [{ id: 7, status: "processing" }], done: false, queue: 1 }));
  expect(phases(result)).toEqual(["processing"]);
  act(() =>
    streams[0]?.emit({ items: [{ id: 7, status: "done", n_faces: 3, proc_ms: 900 }], done: true, queue: 0 }),
  );
  expect(result.current.batch?.items[0]).toMatchObject({ phase: "done", n_faces: 3, proc_ms: 900 });
  expect(streams[0]?.closed).toBe(true);
});

test("duplicata e arquivo inválido", async () => {
  const { result, pending } = setup();
  act(() => result.current.addFiles(4, files(2)));
  await waitFor(() => expect(pending).toHaveLength(2));
  act(() => {
    pending[0]?.resolve({ id: 1, status: "done", filename: "f0.jpg", n_faces: 2, duplicate: true });
    pending[1]?.resolve({ status: "error", filename: "f1.jpg", error: "arquivo não é uma imagem válida" });
  });
  await waitFor(() => expect(phases(result)).toEqual(["dup", "error"]));
  expect(result.current.batch?.items[1]?.error).toBe("arquivo não é uma imagem válida");
});

test("lote terminado + novas fotos começa um resumo novo; outro evento também", async () => {
  const { result, pending } = setup();
  act(() => result.current.addFiles(4, files(1)));
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => pending[0]?.resolve({ id: 1, status: "done", filename: "f0.jpg", n_faces: 0, duplicate: true }));
  await waitFor(() => expect(phases(result)).toEqual(["dup"]));
  act(() => result.current.addFiles(4, files(1)));
  expect(result.current.batch?.items).toHaveLength(1);
  act(() => result.current.addFiles(5, files(1)));
  expect(result.current.batch?.eventId).toBe(5);
});

test("fechar o resumo no meio ignora respostas atrasadas", async () => {
  const { result, pending } = setup();
  act(() => result.current.addFiles(4, files(1)));
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => result.current.reset());
  act(() =>
    pending[0]?.resolve({ id: 1, status: "queued", filename: "f0.jpg", n_faces: 0, duplicate: false }),
  );
  expect(result.current.batch).toBeNull();
});

// invalidateEvent: a chave ["events", id] é prefixo das fotos; a lista é exata
test("fim do lote invalida fotos, stats e eventos", async () => {
  const { result, pending, invalidate } = setup();
  act(() => result.current.addFiles(4, files(1)));
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => pending[0]?.resolve({ id: 1, status: "done", filename: "f0.jpg", n_faces: 1, duplicate: true }));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events", 4] }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["stats", 4] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events"], exact: true });
});

const okQueued = (id: number) => ({
  id,
  status: "queued" as const,
  filename: `f${id}.jpg`,
  n_faces: 0,
  duplicate: false,
});

test("sem openProgress no props: um único stream, aberto durante progressos e mensagens", async () => {
  const opened: Array<{ url: string; closed: boolean; onmessage: ((m: { data: string }) => void) | null }> =
    [];
  class FakeES {
    url: string;
    closed = false;
    onmessage: ((m: { data: string }) => void) | null = null;
    onerror = null;
    constructor(url: string) {
      this.url = url;
      opened.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  vi.stubGlobal("EventSource", FakeES);
  try {
    const pending: Pending[] = [];
    const upload = vi.fn(
      (_: number, file: File, progress: (s: number) => void) =>
        new Promise<UploadResult>((resolve) => pending.push({ file, resolve, progress })),
    );
    const qc = newQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>
        <UploadQueueProvider upload={upload} sseDelayMs={0}>
          {children}
        </UploadQueueProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useUploadQueue(), { wrapper });
    act(() => result.current.addFiles(4, files(2)));
    await waitFor(() => expect(pending).toHaveLength(2));
    act(() => pending[0]?.resolve(okQueued(1)));
    await waitFor(() => expect(opened).toHaveLength(1));
    for (const v of [0.1, 0.3, 0.6]) {
      act(() => pending[1]?.progress(v));
      await new Promise((r) => setTimeout(r, 20));
    }
    act(() =>
      opened[0]?.onmessage?.({
        data: JSON.stringify({ items: [{ id: 1, status: "processing" }], done: false, queue: 1 }),
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(opened).toHaveLength(1);
    expect(opened[0]?.closed).toBe(false);
    act(() =>
      opened[0]?.onmessage?.({
        data: JSON.stringify({ items: [{ id: 1, status: "done", n_faces: 1 }], done: true, queue: 0 }),
      }),
    );
    expect(opened[0]?.closed).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("resposta já final (duplicata) não reabre o stream", async () => {
  const { result, pending, streams } = setup();
  act(() => result.current.addFiles(4, files(2)));
  await waitFor(() => expect(pending).toHaveLength(2));
  act(() => pending[0]?.resolve(okQueued(1)));
  await waitFor(() => expect(streams).toHaveLength(1));
  act(() => pending[1]?.resolve({ id: 2, status: "done", filename: "f1.jpg", n_faces: 1, duplicate: true }));
  await new Promise((r) => setTimeout(r, 30));
  expect(streams).toHaveLength(1);
  expect(streams[0]?.closed).toBe(false);
});

test("trocar de evento com o stream aberto fecha o stream antigo", async () => {
  const { result, pending, streams } = setup();
  act(() => result.current.addFiles(4, files(1)));
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => pending[0]?.resolve(okQueued(1)));
  await waitFor(() => expect(streams).toHaveLength(1));
  act(() => result.current.addFiles(5, files(1)));
  await waitFor(() => expect(streams[0]?.closed).toBe(true));
  expect(streams).toHaveLength(1);
});

test("upload que rejeita vira erro e a fila segue", async () => {
  const { result, upload } = setup();
  upload.mockImplementationOnce(() => Promise.reject(new Error("Falha de conexão")));
  act(() => result.current.addFiles(4, files(1)));
  await waitFor(() => expect(phases(result)).toEqual(["error"]));
  expect(result.current.batch?.items[0]?.error).toBe("Falha de conexão");
});
