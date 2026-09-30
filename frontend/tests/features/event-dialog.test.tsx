import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { useState } from "react";
import { expect, test } from "vitest";
import { useEvent } from "@/api/queries";
import { EventDialog } from "@/features/studio/EventDialog";
import { getLastEvent, setLastEvent } from "@/lib/storage";
import { server } from "../msw";
import { newQueryClient } from "../render";

const event = { id: 5, name: "Corrida", event_date: "2026-09-29", location: "Recife", n_photos: 3 };

async function setup(n_photos = 3) {
  const root = createRootRoute();
  const dlg = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <EventDialog open onOpenChange={() => {}} event={{ ...event, n_photos }} />,
  });
  const studio = createRoute({ getParentRoute: () => root, path: "/estudio", component: () => <p>lista</p> });
  const router = createRouter({
    routeTree: root.addChildren([dlg, studio]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={newQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await act(async () => {
    await router.load();
  });
  return router;
}

test("editar preenche os campos e salva", async () => {
  let body: unknown;
  server.use(
    http.patch("*/api/events/:id", async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ id: 5, name: "Corrida 2", event_date: "2026-09-29", location: "Recife" });
    }),
  );
  await setup();
  const dialog = await screen.findByRole("dialog", { name: "Editar evento" });
  const name = within(dialog).getByLabelText("Nome");
  expect(name).toHaveValue("Corrida");
  await userEvent.type(name, " 2");
  await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
  await waitFor(() =>
    expect(body).toEqual({ name: "Corrida 2", event_date: "2026-09-29", location: "Recife" }),
  );
});

test("excluir pede confirmação com a contagem de fotos, e Cancelar volta aos campos", async () => {
  await setup();
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Excluir evento" }));
  expect(within(dialog).getByText("Excluir evento?")).toBeInTheDocument();
  expect(dialog).toHaveTextContent(
    "As 3 fotos de “Corrida” e os rostos encontrados nelas serão apagados deste servidor, e o link da galeria deixa de funcionar. Isso não pode ser desfeito.",
  );
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(within(dialog).getByLabelText("Nome")).toHaveValue("Corrida");
});

test("sem fotos o texto é curto; excluir limpa o último evento e volta à lista", async () => {
  setLastEvent(5);
  server.use(http.delete("*/api/events/:id", () => HttpResponse.json({ ok: true })));
  const router = await setup(0);
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Excluir evento" }));
  expect(dialog).toHaveTextContent("“Corrida” será apagado. Isso não pode ser desfeito.");
  await userEvent.click(within(dialog).getByRole("button", { name: "Excluir evento" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/estudio"));
  expect(getLastEvent()).toBeNull();
});

test("excluir não dispara GET do evento apagado (sem flash de 404)", async () => {
  let gets = 0;
  server.use(
    http.get("*/api/events/:id", () => {
      gets += 1;
      return HttpResponse.json({
        id: 5,
        name: "Corrida",
        event_date: null,
        location: null,
        n_photos: 0,
        n_done: 0,
        n_pending: 0,
        n_faces: 0,
        cover: [],
        created_at: "2026-09-29T12:00:00+00:00",
      });
    }),
    http.get("*/api/events", () => HttpResponse.json([])),
    http.delete("*/api/events/:id", () => HttpResponse.json({ ok: true })),
  );
  const root = createRootRoute();
  function Page() {
    useEvent(5);
    const [, bump] = useState(0); // o pai re-renderiza ao fechar, como a tela do evento
    return <EventDialog open onOpenChange={() => bump((n) => n + 1)} event={{ ...event, n_photos: 0 }} />;
  }
  const page = createRoute({ getParentRoute: () => root, path: "/", component: Page });
  const studio = createRoute({ getParentRoute: () => root, path: "/estudio", component: () => <p>lista</p> });
  const router = createRouter({
    routeTree: root.addChildren([page, studio]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={newQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(gets).toBe(1));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Excluir evento" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Excluir evento" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/estudio"));
  await new Promise((r) => setTimeout(r, 100));
  expect(gets).toBe(1);
});

test("o painel tem um só título e o texto de confirmação é a descrição", async () => {
  await setup();
  const dialog = await screen.findByRole("dialog", { name: "Editar evento" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Excluir evento" }));
  expect(screen.getByRole("dialog", { name: "Excluir evento?" })).toHaveAccessibleDescription(
    /Isso não pode ser desfeito/,
  );
});
