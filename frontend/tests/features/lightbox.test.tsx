import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

const hit = {
  face_id: 11,
  photo_id: 7,
  score: 0.691,
  bbox: [10, 10, 30, 30],
  width: 100,
  height: 80,
  filename: "praia.jpg",
};
const crowd = { ...hit, bbox: [10, 10, 14, 14] }; // rosto pequeno: "Onde estou?" também dá zoom
const result = { query_token: "T", threshold: 0.4, total_photos: 1, indexed_faces: 1, matches: [hit] };

function api() {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/events/:id", () =>
      HttpResponse.json({
        id: 4,
        name: "Corrida",
        location: null,
        event_date: null,
        created_at: "2026-09-29T12:00:00+00:00",
        n_photos: 1,
        n_done: 1,
        n_pending: 0,
        n_faces: 1,
        cover: [{ id: 7, fx: 0.5, fy: 0.3 }],
      }),
    ),
  );
}

const open = async (r: typeof result = result) => {
  api();
  const ctx = await renderRoute("/galeria/4", { search: { eventId: 4, result: r, status: "done" } });
  await userEvent.click(await screen.findByRole("button", { name: "Abrir praia.jpg" }));
  return ctx;
};
const closeBtn = () => screen.getByText("Fechar", { selector: "button" });

test("abrir a foto põe ?foto na URL; voltar fecha", async () => {
  const { router } = await open();
  expect(router.state.location.search).toEqual({ foto: 7 });
  expect(screen.getByText("69% de semelhança")).toBeInTheDocument();
  expect(document.body).toHaveClass("modal-open");
  act(() => router.history.back());
  await waitFor(() => expect(screen.queryByText("69% de semelhança")).not.toBeInTheDocument(), {
    timeout: 3000,
  });
  expect(router.state.location.search).toEqual({});
  expect(document.body).not.toHaveClass("modal-open");
});

test("Fechar volta no histórico", async () => {
  const { router } = await open();
  await userEvent.click(closeBtn());
  await waitFor(() => expect(router.state.location.search).toEqual({}));
  expect(screen.queryByText("69% de semelhança")).not.toBeInTheDocument();
});

test("o X do canto fecha", async () => {
  const { router } = await open();
  const [x] = screen.getAllByRole("button", { name: "Fechar" }); // o X vem antes da barra
  expect(x).not.toHaveTextContent("Fechar");
  await userEvent.click(x as HTMLElement);
  await waitFor(() => expect(router.state.location.search).toEqual({}));
});

test("Esc fecha e desfaz o push do histórico", async () => {
  const { router } = await open();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByText("69% de semelhança")).not.toBeInTheDocument());
  expect(router.state.location.search).toEqual({});
  expect(router.history.location.href).toBe("/galeria/4"); // voltou, em vez de empilhar outra entrada
});

test("clicar no espaço vazio em volta da foto fecha; clicar na foto não", async () => {
  const { router } = await open();
  await userEvent.click(screen.getByAltText("praia.jpg"));
  expect(screen.getByText("69% de semelhança")).toBeInTheDocument();
  await userEvent.click(screen.getByTestId("lb-stage"));
  await waitFor(() => expect(router.state.location.search).toEqual({}));
});

test("Onde estou? alterna a marcação fixa e o rótulo", async () => {
  await open({ ...result, matches: [crowd] });
  const btn = screen.getByRole("button", { name: "Onde estou?" });
  expect(btn).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(btn);
  expect(btn).toHaveAttribute("aria-pressed", "true");
  expect(btn).toHaveTextContent("Ver foto inteira");
  await userEvent.click(btn);
  expect(btn).toHaveAttribute("aria-pressed", "false");
  expect(btn).toHaveTextContent("Onde estou?");
});

test("rosto grande: o rótulo continua Onde estou? mesmo pressionado", async () => {
  await open();
  const btn = screen.getByRole("button", { name: "Onde estou?" });
  await userEvent.click(btn);
  expect(btn).toHaveAttribute("aria-pressed", "true");
  expect(btn).toHaveTextContent("Onde estou?");
});

test("Baixar foto aponta para o original", async () => {
  await open();
  expect(screen.getByRole("link", { name: "Baixar foto" })).toHaveAttribute(
    "href",
    "/api/photos/7/full?download=1",
  );
  expect(screen.getByText("praia.jpg", { selector: "span" })).toHaveAttribute(
    "title",
    "praia.jpg (score 0.691)",
  );
});

test("recarregar com ?foto sem busca remove o parâmetro", async () => {
  api();
  const { router } = await renderRoute("/galeria/4?foto=7");
  await waitFor(() => expect(router.state.location.search).toEqual({}));
  expect(screen.queryByText("69% de semelhança")).not.toBeInTheDocument();
});

test("?foto de uma foto fora dos resultados é removido", async () => {
  api();
  const { router } = await renderRoute("/galeria/4?foto=99", {
    search: { eventId: 4, result, status: "done" },
  });
  await waitFor(() => expect(router.state.location.search).toEqual({}));
});

test("duplo clique no espaço vazio fecha uma vez só e não sai da galeria", async () => {
  const { router } = await open();
  const back = vi.spyOn(router.history, "back");
  const stage = screen.getByTestId("lb-stage");
  act(() => {
    fireEvent.click(stage); // os dois cliques chegam antes de o visualizador desmontar
    fireEvent.click(stage);
  });
  expect(back).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByText("69% de semelhança")).not.toBeInTheDocument());
  expect(router.state.location.pathname).toBe("/galeria/4");
  expect(screen.getByRole("button", { name: "Abrir praia.jpg" })).toBeInTheDocument();
});

test.each([
  ["Esc", async () => userEvent.keyboard("{Escape}")],
  ["Fechar", async () => userEvent.click(closeBtn())],
  [
    "voltar",
    async (ctx: { router: { history: { back: () => void } } }) => act(() => ctx.router.history.back()),
  ],
])("ao fechar com %s o foco volta para a foto", async (_n, close) => {
  const ctx = await open();
  await close(ctx);
  await waitFor(() => expect(screen.queryByText("69% de semelhança")).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("button", { name: "Abrir praia.jpg" })).toHaveFocus());
});
