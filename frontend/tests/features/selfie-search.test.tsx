import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { qk } from "@/api/queries";
import { SelfieSearchProvider, useSelfieSearch } from "@/features/gallery/SelfieSearchProvider";
import { newQueryClient } from "../render";

const selfie = {
  bbox: [0, 0, 10, 10],
  det_score: 0.9,
  n_faces: 1,
  all_bboxes: [[0, 0, 10, 10]],
  width: 100,
  height: 100,
  warning: null,
};
const hit = {
  face_id: 1,
  photo_id: 7,
  score: 0.69,
  bbox: [1, 2, 3, 4],
  width: 100,
  height: 100,
  filename: "a.jpg",
};

function setup(calibration = false) {
  const qc = newQueryClient();
  qc.setQueryData(qk.features, { calibration });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <SelfieSearchProvider>{children}</SelfieSearchProvider>
    </QueryClientProvider>
  );
  return { qc, ...renderHook(() => useSelfieSearch(), { wrapper }) };
}

// No jsdom, FormData/File são do jsdom e o fetch do Node (undici) não os serializa
// (mesmo motivo de tests/api/client.test.ts): troca o fetch e guarda o FormData recebido.
const forms: FormData[] = [];
function searchReplies(...replies: Array<() => Response | Promise<Response>>) {
  forms.length = 0;
  vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
    forms.push(init?.body as FormData);
    const next = replies.shift();
    if (!next) throw new Error("busca inesperada");
    return next();
  });
}
afterEach(() => vi.unstubAllGlobals());
const blob = () => new Blob(["x"], { type: "image/jpeg" });

test("selfie -> token; slider busca pelo token e reaproveita a selfie e os tempos", async () => {
  searchReplies(
    () =>
      HttpResponse.json({
        query_token: "T1",
        threshold: 0.4,
        total_photos: 2,
        indexed_faces: 3,
        matches: [hit],
        selfie,
        timings_ms: { detection: 300, search: 2 },
      }),
    () =>
      HttpResponse.json({
        query_token: "T1",
        threshold: 0.3,
        total_photos: 2,
        indexed_faces: 3,
        matches: [hit],
        timings_ms: { search: 1 },
        timings_from_cache: true,
      }),
  );
  const { result } = setup();
  act(() => result.current.setEvent(4));
  act(() => result.current.submitSelfie(blob()));
  await waitFor(() => expect(result.current.state.status).toBe("done"));
  expect(forms[0]?.get("event_id")).toBe("4");
  expect(forms[0]?.get("selfie")).toBeInstanceOf(File);

  act(() => result.current.setThreshold(0.3));
  await waitFor(() => expect(forms).toHaveLength(2));
  expect(forms[1]?.get("query_token")).toBe("T1");
  expect(forms[1]?.get("selfie")).toBeNull();
  await waitFor(() => expect(result.current.state.result?.threshold).toBe(0.3));
  expect(result.current.state.result?.selfie).toEqual(selfie);
  expect(result.current.state.result?.timings_ms).toEqual({ detection: 300, search: 1 });
});

test("410 reenvia a selfie guardada uma vez", async () => {
  searchReplies(
    () =>
      HttpResponse.json({
        query_token: "T1",
        threshold: 0.4,
        total_photos: 1,
        indexed_faces: 1,
        matches: [],
        selfie,
      }),
    () => HttpResponse.json({ detail: "Busca expirada. Envie a selfie de novo." }, { status: 410 }),
    () =>
      HttpResponse.json({
        query_token: "T2",
        threshold: 0.35,
        total_photos: 1,
        indexed_faces: 1,
        matches: [],
        selfie,
      }),
  );
  const { result } = setup();
  act(() => result.current.setEvent(4));
  act(() => result.current.submitSelfie(blob()));
  await waitFor(() => expect(result.current.state.status).toBe("done"));
  act(() => result.current.setThreshold(0.35));
  await waitFor(() => expect(forms).toHaveLength(3));
  expect(forms[2]?.get("selfie")).toBeInstanceOf(File);
  await waitFor(() => expect(result.current.state.queryToken).toBe("T2"));
});

test("422 mostra a mensagem de rosto não encontrado", async () => {
  searchReplies(() => HttpResponse.json({ detail: "Nenhum rosto" }, { status: 422 }));
  const { result } = setup();
  act(() => result.current.setEvent(4));
  act(() => result.current.submitSelfie(blob()));
  await waitFor(() => expect(result.current.state.status).toBe("error"));
  expect(result.current.state.message).toEqual({
    text: "Não encontramos um rosto nesta foto. Tente de frente, com mais luz.",
    kind: "err",
  });
});

test("vários rostos: aviso", async () => {
  searchReplies(() =>
    HttpResponse.json({
      query_token: "T",
      threshold: 0.4,
      total_photos: 1,
      indexed_faces: 1,
      matches: [],
      selfie: { ...selfie, n_faces: 3, warning: "3 rostos" },
    }),
  );
  const { result } = setup();
  act(() => result.current.setEvent(4));
  act(() => result.current.submitSelfie(blob()));
  await waitFor(() => expect(result.current.state.message.kind).toBe("warn"));
  expect(result.current.state.message.text).toBe("3 rostos na selfie. Usamos o maior.");
});

test("cura: calibração ligada mas resposta sem top 30 desliga a flag", async () => {
  searchReplies(() =>
    HttpResponse.json({
      query_token: "T",
      threshold: 0.4,
      total_photos: 1,
      indexed_faces: 1,
      matches: [],
      selfie,
    }),
  );
  const { result, qc } = setup(true);
  act(() => result.current.setEvent(4));
  act(() => result.current.submitSelfie(blob()));
  await waitFor(() => expect(qc.getQueryData(qk.features)).toEqual({ calibration: false }));
});

test("trocar de evento limpa a busca e mantém o corte", async () => {
  searchReplies(() =>
    HttpResponse.json({
      query_token: "T",
      threshold: 0.45,
      total_photos: 1,
      indexed_faces: 1,
      matches: [hit],
      selfie,
    }),
  );
  const { result } = setup();
  act(() => result.current.setEvent(4));
  act(() => result.current.setThreshold(0.45));
  act(() => result.current.submitSelfie(blob()));
  await waitFor(() => expect(result.current.state.status).toBe("done"));
  act(() => result.current.setEvent(5));
  expect(result.current.state).toMatchObject({
    eventId: 5,
    result: null,
    queryToken: null,
    selfieBlob: null,
    selfieUrl: null,
    status: "idle",
    threshold: 0.45,
  });
});

test("initialState entra no estado inicial (só para testes)", () => {
  const qc = newQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <SelfieSearchProvider initialState={{ eventId: 4, threshold: 0.6 }}>{children}</SelfieSearchProvider>
    </QueryClientProvider>
  );
  const { result } = renderHook(() => useSelfieSearch(), { wrapper });
  expect(result.current.state).toMatchObject({ eventId: 4, threshold: 0.6, status: "idle", result: null });
});

const body = (token: string, threshold: number, photo: number) => ({
  query_token: token,
  threshold,
  total_photos: 2,
  indexed_faces: 3,
  matches: [{ ...hit, photo_id: photo }],
  selfie,
});
const later = () => {
  let release = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return { gate, release };
};

test("selfie B com o slider mexido durante a busca: o resultado final é o de B", async () => {
  const b = later();
  searchReplies(
    () => HttpResponse.json(body("TA", 0.4, 1)),
    async () => {
      await b.gate;
      return HttpResponse.json(body("TB", 0.4, 2));
    },
    () => HttpResponse.json({ ...body("TB", 0.3, 2), selfie: undefined }),
  );
  const { result } = setup();
  act(() => result.current.setEvent(4));
  act(() => result.current.submitSelfie(blob()));
  await waitFor(() => expect(result.current.state.status).toBe("done"));
  act(() => result.current.submitSelfie(blob()));
  await waitFor(() => expect(forms).toHaveLength(2));
  act(() => result.current.setThreshold(0.3));
  await new Promise((r) => setTimeout(r, 300)); // passa do debounce: nenhuma busca por token (a de A) pode sair
  expect(forms).toHaveLength(2);
  await act(async () => b.release());
  await waitFor(() => expect(forms).toHaveLength(3));
  expect(forms[2]?.get("query_token")).toBe("TB");
  expect(forms[2]?.get("threshold")).toBe("0.3");
  await waitFor(() => expect(result.current.state.result?.threshold).toBe(0.3));
  expect(result.current.state.result?.matches[0]?.photo_id).toBe(2);
  expect(result.current.state.queryToken).toBe("TB");
});

test("submitSelfie cancela o debounce pendente do slider", async () => {
  searchReplies(
    () => HttpResponse.json(body("TA", 0.4, 1)),
    () => HttpResponse.json(body("TB", 0.3, 2)),
  );
  const { result } = setup();
  act(() => result.current.setEvent(4));
  act(() => result.current.submitSelfie(blob()));
  await waitFor(() => expect(result.current.state.status).toBe("done"));
  act(() => result.current.setThreshold(0.3)); // agenda a busca por token de A...
  act(() => result.current.submitSelfie(blob())); // ...que a nova selfie cancela
  await waitFor(() => expect(result.current.state.queryToken).toBe("TB"));
  await new Promise((r) => setTimeout(r, 300));
  expect(forms).toHaveLength(2);
  expect(forms[1]?.get("selfie")).toBeInstanceOf(File);
});

test("resposta velha do slider não sobrescreve a mais nova", async () => {
  const slow = later();
  searchReplies(
    () => HttpResponse.json(body("T", 0.4, 1)),
    async () => {
      await slow.gate;
      return HttpResponse.json({ ...body("T", 0.3, 1), matches: [] });
    },
    () => HttpResponse.json({ ...body("T", 0.5, 1), matches: [hit, hit] }),
  );
  const { result } = setup();
  act(() => result.current.setEvent(4));
  act(() => result.current.submitSelfie(blob()));
  await waitFor(() => expect(result.current.state.status).toBe("done"));
  act(() => result.current.setThreshold(0.3));
  await waitFor(() => expect(forms).toHaveLength(2));
  act(() => result.current.setThreshold(0.5));
  await waitFor(() => expect(result.current.state.result?.threshold).toBe(0.5));
  await act(async () => slow.release());
  await new Promise((r) => setTimeout(r, 50));
  expect(result.current.state.result?.threshold).toBe(0.5);
  expect(result.current.state.result?.matches).toHaveLength(2);
});

test("trocar de evento com busca em andamento ignora a resposta", async () => {
  const slow = later();
  searchReplies(async () => {
    await slow.gate;
    return HttpResponse.json(body("T", 0.4, 1));
  });
  const { result } = setup();
  act(() => result.current.setEvent(4));
  act(() => result.current.submitSelfie(blob()));
  await waitFor(() => expect(forms).toHaveLength(1));
  act(() => result.current.setEvent(5));
  await act(async () => slow.release());
  await new Promise((r) => setTimeout(r, 50));
  expect(result.current.state).toMatchObject({ eventId: 5, result: null, queryToken: null, status: "idle" });
});

test("a URL do objeto é liberada ao trocar de selfie e de evento", async () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const create = vi.spyOn(URL, "createObjectURL");
  create.mockReturnValueOnce("blob:1").mockReturnValueOnce("blob:2");
  searchReplies(
    () => HttpResponse.json(body("TA", 0.4, 1)),
    () => HttpResponse.json(body("TB", 0.4, 2)),
  );
  const { result } = setup();
  act(() => result.current.setEvent(4));
  act(() => result.current.submitSelfie(blob()));
  await waitFor(() => expect(result.current.state.status).toBe("done"));
  act(() => result.current.submitSelfie(blob()));
  expect(revoke).toHaveBeenCalledWith("blob:1");
  await waitFor(() => expect(result.current.state.status).toBe("done"));
  act(() => result.current.setEvent(5));
  expect(revoke).toHaveBeenCalledWith("blob:2");
  revoke.mockRestore();
  create.mockRestore();
});
