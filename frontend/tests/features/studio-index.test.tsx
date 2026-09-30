import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

const ev = (over: object) => ({
  id: 1,
  name: "Corrida",
  location: null,
  event_date: null,
  created_at: "2026-09-29T12:00:00+00:00",
  n_photos: 0,
  n_done: 0,
  n_pending: 0,
  n_faces: 0,
  cover: [],
  ...over,
});

function base(list: unknown[]) {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/events", () => HttpResponse.json(list)),
  );
}

test("status de cada evento", async () => {
  base([
    ev({ id: 1, n_pending: 2, n_photos: 2 }),
    ev({ id: 2, name: "Show", n_done: 3, n_photos: 3 }),
    ev({ id: 3, name: "Nada" }),
  ]);
  await renderRoute("/estudio");
  expect(await screen.findByText("Indexando 2 fotos")).toBeInTheDocument();
  expect(screen.getByText("Na galeria")).toBeInTheDocument();
  expect(screen.getByText("Sem fotos")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Show/ })).toHaveAttribute("href", "/estudio/2");
});

test("criar evento navega para o estúdio do evento", async () => {
  base([]);
  server.use(
    http.post("*/api/events", async ({ request }) => {
      const body = (await request.json()) as { name: string };
      return HttpResponse.json({ id: 9, name: body.name, event_date: null, location: null });
    }),
  );
  const { router } = await renderRoute("/estudio");
  await userEvent.click(await screen.findByRole("button", { name: "Criar o primeiro evento" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Nome"), "Festa");
  await userEvent.click(within(dialog).getByRole("button", { name: "Criar evento" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/estudio/9"));
});

test("erro do servidor aparece no diálogo", async () => {
  base([]);
  server.use(
    http.post("*/api/events", () => HttpResponse.json({ detail: "Dê um nome ao evento." }, { status: 400 })),
  );
  await renderRoute("/estudio");
  await userEvent.click(await screen.findByRole("button", { name: "Novo evento" }));
  await userEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", { name: "Criar evento" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Dê um nome ao evento.");
});
