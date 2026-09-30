import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

test("search da galeria: foto numérica é mantida", async () => {
  flags(false);
  server.use(http.get("*/api/events/:id", () => HttpResponse.json(event)));
  const { router } = await renderRoute("/galeria/4?foto=7");
  expect(router.state.matches.at(-1)?.search).toEqual({ foto: 7 });
});

test("search da galeria: valor inválido é descartado", async () => {
  flags(false);
  server.use(http.get("*/api/events/:id", () => HttpResponse.json(event)));
  const { router } = await renderRoute("/galeria/4?foto=abc");
  expect(router.state.matches.at(-1)?.search).toEqual({});
});

test("entrar na rota busca o evento uma única vez", async () => {
  flags(false);
  let n = 0;
  server.use(
    http.get("*/api/events/:id", () => {
      n++;
      return HttpResponse.json(event);
    }),
  );
  await renderRoute("/galeria/2");
  expect(await screen.findByRole("heading", { name: "Casamento" })).toBeInTheDocument();
  await new Promise((r) => setTimeout(r, 50));
  expect(n).toBe(1);
});

test("a marca do cabeçalho nunca tem aria-current", async () => {
  flags(false);
  await renderRoute("/");
  expect(screen.getByRole("link", { name: "Foco, todas as galerias" })).not.toHaveAttribute("aria-current");
});

test("link # fora da raiz não redireciona", async () => {
  flags(false);
  server.use(http.get("*/api/events/:id", () => HttpResponse.json(event)));
  const { router } = await renderRoute("/galeria/4#estudio?e=4");
  expect(router.state.location.pathname).toBe("/galeria/4");
});

test("Tentar de novo refaz o carregamento e mostra o conteúdo", async () => {
  flags(false);
  let fail = true;
  server.use(
    http.get("*/api/events/:id", () =>
      fail ? HttpResponse.json({ detail: "quebrou" }, { status: 500 }) : HttpResponse.json(event),
    ),
  );
  await renderRoute("/galeria/4");
  const retry = await screen.findByRole("button", { name: "Tentar de novo" });
  fail = false;
  await userEvent.click(retry);
  expect(await screen.findByRole("heading", { name: "Casamento" })).toBeInTheDocument();
});

test("id inválido não chama a API de eventos", async () => {
  flags(false);
  const seen: string[] = [];
  server.events.on("request:start", ({ request }) => seen.push(new URL(request.url).pathname));
  await renderRoute("/galeria/abc");
  expect(await screen.findByText("Evento não encontrado")).toBeInTheDocument();
  expect(seen.filter((p) => p.startsWith("/api/events"))).toEqual([]);
});

test("NotFoundEvent ajusta o título por área", async () => {
  flags(false);
  await renderRoute("/galeria/abc");
  await screen.findByText("Evento não encontrado");
  expect(document.title).toBe("Foco");
});
