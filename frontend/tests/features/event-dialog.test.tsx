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
import { expect, test } from "vitest";
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
