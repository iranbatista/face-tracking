import { screen } from "@testing-library/react";
import { HttpResponse, http, type JsonBodyType } from "msw";
import { expect, test } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

const base = {
  location: "SP",
  event_date: "2026-09-13",
  created_at: "2026-09-29T12:00:00+00:00",
  n_pending: 0,
  n_faces: 3,
};

function event(body: JsonBodyType, status = 200) {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/events/:id", () => HttpResponse.json(body, { status })),
  );
}

test("evento com fotos mostra capa, fatos e a busca", async () => {
  event({
    ...base,
    id: 4,
    name: "Corrida",
    n_photos: 2,
    n_done: 2,
    cover: [
      { id: 7, fx: 0.5, fy: 0.3 },
      { id: 8, fx: 0.5, fy: 0.3 },
    ],
  });
  await renderRoute("/galeria/4");
  expect(await screen.findByRole("heading", { level: 1, name: "Corrida" })).toBeInTheDocument();
  expect(screen.getByText("13 de setembro de 2026")).toBeInTheDocument();
  expect(screen.getByText("2 fotos")).toBeInTheDocument();
  expect(document.title).toBe("Corrida, Foco");
  expect(document.querySelector('.collage[data-n="2"]')).not.toBeNull();
  expect(document.querySelector('[data-slot="finder"]')).not.toBeNull();
});

test("evento sem fotos publicadas", async () => {
  event({ ...base, id: 5, name: "Em breve", n_photos: 0, n_done: 0, cover: [] });
  await renderRoute("/galeria/5");
  expect(
    await screen.findByText("As fotos deste evento ainda não foram publicadas. Volte mais tarde."),
  ).toBeInTheDocument();
  expect(document.querySelector('[data-slot="finder"]')).toBeNull();
});

test("evento inexistente", async () => {
  event({ detail: "evento não encontrado" }, 404);
  await renderRoute("/galeria/999");
  expect(await screen.findByText("Galeria não encontrada")).toBeInTheDocument();
});

test("id inválido na URL é 404 sem chamar a API", async () => {
  event({});
  await renderRoute("/galeria/abc");
  expect(await screen.findByText("Galeria não encontrada")).toBeInTheDocument();
});
