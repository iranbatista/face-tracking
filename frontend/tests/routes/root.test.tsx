import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

function flags(calibration: boolean) {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({ calibration })),
    http.get("*/api/events", () => HttpResponse.json([])),
  );
}

const event = { id: 4, name: "Casamento", n_done: 0, n_pending: 0 };

test("Calibração some da nav com a flag desligada", async () => {
  flags(false);
  await renderRoute("/");
  expect(screen.getByRole("link", { name: "Galerias" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Calibração" })).not.toBeInTheDocument();
});

test("Calibração aparece com a flag ligada", async () => {
  flags(true);
  await renderRoute("/");
  expect(await screen.findByRole("link", { name: "Calibração" })).toBeInTheDocument();
});

test("/calibracao com a flag desligada volta para /", async () => {
  flags(false);
  const { router } = await renderRoute("/calibracao");
  expect(router.state.location.pathname).toBe("/");
});

test("link antigo com # redireciona", async () => {
  flags(false);
  const { router } = await renderRoute("/#estudio?e=4");
  expect(router.state.location.pathname).toBe("/estudio/4");
  expect(router.state.location.hash).toBe("");
});

test("link ativo tem aria-current", async () => {
  flags(false);
  await renderRoute("/estudio");
  expect(screen.getByRole("link", { name: "Estúdio" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Galerias" })).not.toHaveAttribute("aria-current");
});

test("Galerias fica ativa em /galeria/:id", async () => {
  flags(false);
  server.use(http.get("*/api/events/:id", () => HttpResponse.json(event)));
  await renderRoute("/galeria/4");
  expect(await screen.findByRole("heading", { name: "Casamento" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Galerias" })).toHaveAttribute("aria-current", "page");
  expect(document.title).toBe("Casamento, Foco");
});

test("id inválido ou evento inexistente vira 'não encontrado'", async () => {
  flags(false);
  await renderRoute("/galeria/abc");
  expect(await screen.findByText("Evento não encontrado")).toBeInTheDocument();
});

test("404 do evento vira 'não encontrado' no estúdio", async () => {
  flags(false);
  server.use(http.get("*/api/events/:id", () => HttpResponse.json({ detail: "x" }, { status: 404 })));
  await renderRoute("/estudio/9");
  expect(await screen.findByText("Evento não encontrado")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Voltar para o estúdio" })).toBeInTheDocument();
});

test("outros erros caem no errorComponent com 'Tentar de novo'", async () => {
  flags(false);
  server.use(http.get("*/api/events/:id", () => HttpResponse.json({ detail: "quebrou" }, { status: 500 })));
  await renderRoute("/estudio/9");
  expect(await screen.findByText("quebrou")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
});

test("search da galeria: foto numérica, valor inválido é descartado", async () => {
  flags(false);
  server.use(http.get("*/api/events/:id", () => HttpResponse.json(event)));
  const a = await renderRoute("/galeria/4?foto=7");
  expect(a.router.state.matches.at(-1)?.search).toEqual({ foto: 7 });
  const b = await renderRoute("/galeria/4?foto=abc");
  expect(b.router.state.matches.at(-1)?.search).toEqual({});
});

test("initialSearch do contexto chega ao SelfieSearchProvider", async () => {
  flags(false);
  const { router } = await renderRoute("/", { search: { eventId: 4 } });
  expect(router.options.context.initialSearch).toEqual({ eventId: 4 });
});
