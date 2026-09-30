import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, expect, test, vi } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

const event = {
  id: 4,
  name: "Corrida",
  location: "SP",
  event_date: "2026-09-13",
  created_at: "2026-09-29T12:00:00+00:00",
  n_photos: 2,
  n_done: 2,
  n_pending: 0,
  n_faces: 3,
  cover: [
    { id: 7, fx: 0.5, fy: 0.3 },
    { id: 8, fx: 0.5, fy: 0.3 },
  ],
};
const selfie = {
  bbox: [10, 10, 60, 60],
  det_score: 0.9,
  n_faces: 1,
  all_bboxes: [[10, 10, 60, 60]],
  width: 100,
  height: 100,
  warning: null,
};

function mock() {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/events/:id", () => HttpResponse.json(event)),
  );
}
// jsdom FormData/File não passam pelo fetch do Node (ver tests/api/client.test.ts): troca o fetch só na busca.
function stubSearch(reply: () => Response | Promise<Response>) {
  const real = globalThis.fetch;
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith("/api/search") ? reply() : real(input, init),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const viewfinder = () => document.querySelector<HTMLElement>(".viewfinder");
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]');
const photo = () => new File(["x"], "eu.jpg", { type: "image/jpeg" });

test("bloco de busca: textos, visor vazio e o input de selfie", async () => {
  mock();
  await renderRoute("/galeria/4");
  expect(await screen.findByRole("heading", { level: 2, name: "Encontre suas fotos" })).toBeInTheDocument();
  expect(
    screen.getByText(
      "Envie uma selfie de frente, com o rosto bem iluminado. Procuramos você em todas as fotos do evento.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("Enviar selfie")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Usar a câmera" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Tirar foto" })).not.toBeInTheDocument();
  expect(screen.getByText("Sua selfie é usada só nesta busca e não fica salva.")).toBeInTheDocument();
  expect(viewfinder()).toHaveAttribute("data-mode", "empty");
  expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1);
  expect(fileInput()).not.toBeNull();
});

test("enviar selfie: procura (colchetes caçando) e depois trava no rosto", async () => {
  mock();
  let finish = () => {};
  const gate = new Promise<void>((r) => {
    finish = r;
  });
  stubSearch(async () => {
    await gate;
    return HttpResponse.json({
      query_token: "T",
      threshold: 0.4,
      total_photos: 2,
      indexed_faces: 3,
      matches: [],
      selfie,
    });
  });
  await renderRoute("/galeria/4");
  await screen.findByRole("heading", { level: 2, name: "Encontre suas fotos" });
  await userEvent.upload(fileInput() as HTMLInputElement, photo());
  await waitFor(() => expect(viewfinder()).toHaveAttribute("data-mode", "searching"));
  expect(screen.getByRole("status")).toHaveTextContent("Procurando você nas fotos do evento");
  await act(async () => finish());
  await waitFor(() => expect(viewfinder()).toHaveAttribute("data-mode", "face"));
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
});

test("rosto não encontrado: mensagem de erro e a selfie inteira no visor", async () => {
  mock();
  stubSearch(() => HttpResponse.json({ detail: "Nenhum rosto" }, { status: 422 }));
  await renderRoute("/galeria/4");
  await screen.findByRole("heading", { level: 2, name: "Encontre suas fotos" });
  await userEvent.upload(fileInput() as HTMLInputElement, photo());
  expect(
    await screen.findByText("Não encontramos um rosto nesta foto. Tente de frente, com mais luz."),
  ).toHaveClass("text-erro");
  expect(viewfinder()).toHaveAttribute("data-mode", "photo");
});

test("câmera: abre, mostra Tirar foto e fecha parando as tracks", async () => {
  mock();
  const stop = vi.fn();
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  await renderRoute("/galeria/4");
  await screen.findByRole("heading", { level: 2, name: "Encontre suas fotos" });
  await userEvent.click(screen.getByRole("button", { name: "Usar a câmera" }));
  expect(await screen.findByRole("button", { name: "Fechar câmera" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tirar foto" })).toBeInTheDocument();
  expect(viewfinder()).toHaveAttribute("data-mode", "cam");
  expect(getUserMedia).toHaveBeenCalledWith({ video: { width: 1280, height: 960, facingMode: "user" } });
  await userEvent.click(screen.getByRole("button", { name: "Fechar câmera" }));
  expect(stop).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Tirar foto" })).not.toBeInTheDocument();
  expect(viewfinder()).toHaveAttribute("data-mode", "empty");
});

test("câmera negada: pede para permitir o acesso", async () => {
  mock();
  const denied = Object.assign(new Error("x"), { name: "NotAllowedError" });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: async () => Promise.reject(denied) },
    configurable: true,
  });
  await renderRoute("/galeria/4");
  await screen.findByRole("heading", { level: 2, name: "Encontre suas fotos" });
  await userEvent.click(screen.getByRole("button", { name: "Usar a câmera" }));
  expect(
    await screen.findByText("Não foi possível abrir a câmera. Permita o acesso no navegador."),
  ).toBeInTheDocument();
});

test("initialSearch passa pelo provider: a rota abre com a busca já feita", async () => {
  mock();
  await renderRoute("/galeria/4", {
    search: {
      eventId: 4,
      selfieUrl: "blob:x",
      queryToken: "T",
      status: "done",
      result: { query_token: "T", threshold: 0.4, total_photos: 2, indexed_faces: 3, matches: [], selfie },
    },
  });
  await screen.findByRole("heading", { level: 2, name: "Encontre suas fotos" });
  expect(viewfinder()).toHaveAttribute("data-mode", "face");
});

test("trocar de evento na rota limpa a busca (setEvent)", async () => {
  mock();
  const { router } = await renderRoute("/galeria/4", {
    search: {
      eventId: 4,
      selfieUrl: "blob:x",
      status: "done",
      result: { query_token: "T", threshold: 0.4, total_photos: 2, indexed_faces: 3, matches: [], selfie },
    },
  });
  await waitFor(() => expect(viewfinder()).toHaveAttribute("data-mode", "face"));
  await act(async () => {
    await router.navigate({ to: "/galeria/$eventId", params: { eventId: 5 } });
  });
  await waitFor(() => expect(viewfinder()).toHaveAttribute("data-mode", "empty"));
});
