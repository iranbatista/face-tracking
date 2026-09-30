import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

const ev = (id: number, name: string, n_done: number, location: string | null = null) => ({
  id,
  name,
  location,
  event_date: null,
  created_at: "2026-09-29T12:00:00+00:00",
  n_photos: n_done,
  n_done,
  n_pending: 0,
  n_faces: 0,
  cover: n_done ? [{ id: id * 10, fx: 0.5, fy: 0.3 }] : [],
});

function events(list: unknown[]) {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({ calibration: false })),
    http.get("*/api/events", () => HttpResponse.json(list)),
  );
}

test("mostra só eventos com fotos prontas, com link para a galeria", async () => {
  events([ev(1, "Corrida", 3), ev(2, "Vazio", 0)]);
  await renderRoute("/");
  const link = await screen.findByRole("link", { name: /Corrida/ });
  expect(link).toHaveAttribute("href", "/galeria/1");
  expect(screen.queryByText("Vazio")).not.toBeInTheDocument();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument(); // menos de 4
});

test("busca sem acento aparece com 4+ galerias", async () => {
  events([ev(1, "Corrida", 1, "Florianópolis"), ev(2, "Casamento", 1), ev(3, "Show", 1), ev(4, "Feira", 1)]);
  await renderRoute("/");
  await userEvent.type(await screen.findByRole("searchbox"), "florianopolis");
  expect(await screen.findByRole("link", { name: /Corrida/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Casamento/ })).not.toBeInTheDocument();
});

test("estado vazio", async () => {
  events([]);
  await renderRoute("/");
  expect(await screen.findByText("Nenhuma galeria publicada ainda.")).toBeInTheDocument();
});

test("erro de rede mostra Tentar de novo", async () => {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/events", () => HttpResponse.json({ detail: "banco indisponível" }, { status: 503 })),
  );
  await renderRoute("/");
  expect(await screen.findByText("banco indisponível")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
});
