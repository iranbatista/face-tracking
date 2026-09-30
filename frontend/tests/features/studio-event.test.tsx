import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import { UploadBatch } from "@/features/studio/UploadBatch";
import type { Batch, Phase, UploadItem } from "@/features/studio/UploadQueueProvider";
import { server } from "../msw";
import { renderRoute } from "../render";
import { sheetRenders } from "../sheetSpy";

vi.mock("@/features/studio/ContactSheet", async (orig) => {
  const m = await orig<typeof import("@/features/studio/ContactSheet")>();
  const { sheetRenders } = await import("../sheetSpy");
  return {
    ...m,
    // conta as renderizações feitas pelo pai: memo do original não conta aqui, o pai sim
    ContactSheet: (props: { eventId: number }) => {
      sheetRenders.n += 1;
      return <m.ContactSheet {...props} />;
    },
  };
});

const ev = {
  id: 4,
  name: "Corrida",
  location: null,
  event_date: null,
  created_at: "2026-09-29T12:00:00+00:00",
  n_photos: 2,
  n_done: 1,
  n_pending: 1,
  n_faces: 3,
  cover: [],
};

function api(photos?: unknown[]) {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/events/:id", () => HttpResponse.json(ev)),
    http.get("*/api/stats", () =>
      HttpResponse.json({
        events: 1,
        photos: 2,
        done: 1,
        pending: 1,
        errors: 0,
        faces: 3,
        avg_ms_per_photo: 3624.5,
      }),
    ),
    http.get("*/api/events/:id/photos", () =>
      HttpResponse.json(
        photos ?? [
          {
            id: 2,
            filename: "b.jpg",
            status: "processing",
            n_faces: 0,
            proc_ms: null,
            error: null,
            width: 10,
            height: 10,
            fx: 0.5,
            fy: 0.3,
          },
          {
            id: 1,
            filename: "a.jpg",
            status: "done",
            n_faces: 3,
            proc_ms: 900,
            error: null,
            width: 10,
            height: 10,
            fx: 0.5,
            fy: 0.3,
          },
        ],
      ),
    ),
  );
}

test("cabeçalho, figuras e folha de contato", async () => {
  api();
  await renderRoute("/estudio/4");
  expect(await screen.findByRole("heading", { level: 1, name: "Corrida" })).toBeInTheDocument();
  expect(screen.getByText("Criado em 29 de setembro de 2026")).toBeInTheDocument();
  expect(await screen.findByText("3,6 s")).toBeInTheDocument();
  expect(screen.getByText("Detectando")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Ver galeria/ })).toHaveAttribute("href", "/galeria/4");
  expect(screen.getByRole("link", { name: "Eventos" })).toHaveAttribute("href", "/estudio");
  expect(document.title).toBe("Corrida, Estúdio, Foco");
});

test("folha de contato: pronta com rostos e vazia", async () => {
  api();
  const { unmount } = await renderRoute("/estudio/4");
  const img = await screen.findByAltText("a.jpg");
  expect(img.closest("div")).toHaveTextContent("3");
  unmount();
  api([]);
  await renderRoute("/estudio/4");
  expect(
    await screen.findByText(
      "As fotos enviadas aparecem aqui, com o número de rostos encontrados em cada uma.",
    ),
  ).toBeInTheDocument();
});

test("copiar link da galeria", async () => {
  api();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  await renderRoute("/estudio/4");
  await userEvent.click(await screen.findByRole("button", { name: /Copiar link/ }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${location.origin}/galeria/4`));
});

test("copiar link sem clipboard cai no prompt", async () => {
  api();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) } });
  const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
  await renderRoute("/estudio/4");
  await userEvent.click(await screen.findByRole("button", { name: /Copiar link/ }));
  await waitFor(() =>
    expect(prompt).toHaveBeenCalledWith("Copie o link da galeria:", `${location.origin}/galeria/4`),
  );
  prompt.mockRestore();
});

test("editar abre o diálogo com o evento", async () => {
  api();
  await renderRoute("/estudio/4");
  await userEvent.click(await screen.findByRole("button", { name: /Editar/ }));
  expect(await screen.findByDisplayValue("Corrida")).toBeInTheDocument();
});

test("evento inexistente", async () => {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/events/:id", () => HttpResponse.json({ detail: "x" }, { status: 404 })),
  );
  await renderRoute("/estudio/99");
  expect(await screen.findByText("Evento não encontrado")).toBeInTheDocument();
});

test("dropzone: soltar filtra imagens e envia ao evento", async () => {
  api();
  let sent = 0;
  server.use(
    http.post("*/api/events/:id/photos", () => {
      sent += 1;
      return HttpResponse.json([
        { id: 9, status: "done", filename: "a.png", n_faces: 1, proc_ms: 500, duplicate: false },
      ]);
    }),
  );
  await renderRoute("/estudio/4");
  const zone = (await screen.findByText(/Arraste as fotos do evento/)).closest("label") as HTMLElement;
  fireEvent.dragOver(zone);
  expect(zone).toHaveAttribute("data-over", "true");
  const png = new File(["x"], "a.png", { type: "image/png" });
  const txt = new File(["x"], "n.txt", { type: "text/plain" });
  fireEvent.drop(zone, { dataTransfer: { files: [png, txt] } });
  expect(zone).not.toHaveAttribute("data-over", "true");
  await waitFor(() => expect(sent).toBe(1));
  expect(await screen.findByText("1 de 1 foto")).toBeInTheDocument();
  expect(screen.getByText("Pronto")).toBeInTheDocument();
});

test("dropzone: Enter abre o seletor", async () => {
  api();
  await renderRoute("/estudio/4");
  const zone = (await screen.findByText(/Arraste as fotos do evento/)).closest("label") as HTMLElement;
  const input = zone.querySelector("input") as HTMLInputElement;
  expect(input).toHaveAttribute("multiple");
  const click = vi.spyOn(input, "click");
  fireEvent.keyDown(zone, { key: "Enter" });
  fireEvent.keyDown(zone, { key: " " });
  expect(click).toHaveBeenCalledTimes(2);
});

// ---- UploadBatch a partir de um lote pronto

let n = 0;
const item = (phase: Phase, over: Partial<UploadItem> = {}): UploadItem => ({
  key: `k${++n}`,
  file: new File(["x"], over.file?.name ?? `f${n}.jpg`, { type: "image/jpeg" }),
  phase,
  sent: 0,
  n_faces: 0,
  proc_ms: null,
  id: null,
  error: null,
  ...over,
});
const named = (name: string) => new File(["x"], name, { type: "image/jpeg" });
const batch = (items: UploadItem[]): Batch => ({ eventId: 4, items });

test("resumo em andamento: rótulo, contagem, extra, ETA, fases e barra", () => {
  const items = [
    item("done", { n_faces: 2, proc_ms: 2000, file: named("a.jpg") }),
    item("done", { n_faces: 1, proc_ms: 4000, file: named("b.jpg") }),
    item("processing", { file: named("c.jpg") }),
    item("queued", { file: named("d.jpg") }),
    item("uploading", { sent: 0.5, file: named("e.jpg") }),
    item("waiting", { file: named("f.jpg") }),
    item("dup", { n_faces: 1, file: named("g.jpg") }),
  ];
  const { container } = render(
    <UploadBatch batch={batch(items)} open={false} onToggle={() => {}} onClose={() => {}} />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Enviando3 de 7 fotos");
  // 4 restantes x média 3000 ms = 12 s
  expect(screen.getByText("3 rostos encontrados, cerca de 12 s restantes")).toBeInTheDocument();
  const tally = container.querySelector(".tally, [data-tally]") as HTMLElement;
  expect(tally.textContent).toBe("2 prontas1 detectando1 na fila2 enviando1 já enviada");
  // (1+1+.75+.5+.25+0+1)/7
  const bar = container.querySelector("[data-batch-bar]") as HTMLElement;
  expect(parseFloat(bar.style.width)).toBeCloseTo((4.5 / 7) * 100, 1);
  expect(bar).not.toHaveAttribute("data-done", "true");
  expect(screen.queryByRole("button", { name: "Fechar resumo do envio" })).not.toBeInTheDocument();
  // rótulo por linha
  const list = document.getElementById("upload-list") as HTMLElement;
  expect(list).toHaveAttribute("hidden");
  const rows = within(list).getAllByRole("listitem", { hidden: true });
  const texts = rows.map((r) => r.textContent);
  expect(texts[0]).toBe("a.jpg2 rostos, 2,0 s");
  expect(texts[2]).toBe("c.jpgDetectando rostos");
  expect(texts[3]).toBe("d.jpgNa fila");
  expect(texts[4]).toBe("e.jpgEnviando 50%");
  expect(texts[5]).toBe("f.jpgAguardando");
  expect(texts[6]).toBe("g.jpgJá enviada, 1 rosto");
});

test("resumo: indexando quando nada mais está sendo enviado; ETA em minutos", () => {
  const items = [
    item("done", { n_faces: 1, proc_ms: 60000 }),
    item("queued"),
    item("queued"),
    item("queued"),
  ];
  render(<UploadBatch batch={batch(items)} open={false} onToggle={() => {}} onClose={() => {}} />);
  expect(screen.getByText("Indexando")).toBeInTheDocument();
  expect(screen.getByText("1 rosto encontrado, cerca de 3 min restantes")).toBeInTheDocument();
});

test("resumo pronto: sem erros mostra Fechar e barra concluída", async () => {
  const onClose = vi.fn();
  const items = [item("done", { n_faces: 1, proc_ms: 900 }), item("dup", { n_faces: 0 })];
  const { container } = render(
    <UploadBatch batch={batch(items)} open={false} onToggle={() => {}} onClose={onClose} />,
  );
  expect(screen.getByText("Pronto")).toBeInTheDocument();
  expect(screen.getByText("2 de 2 fotos")).toBeInTheDocument();
  expect((container.querySelector("[data-batch-bar]") as HTMLElement).dataset.done).toBe("true");
  await userEvent.click(screen.getByRole("button", { name: "Fechar resumo do envio" }));
  expect(onClose).toHaveBeenCalled();
});

test("resumo com erros: abre a lista com os erros no topo", () => {
  const items = [
    item("done", { n_faces: 1, proc_ms: 900, file: named("ok.jpg") }),
    item("error", { error: "Arquivo grande demais", file: named("big.jpg") }),
    item("error", { file: named("bad.jpg") }),
  ];
  const { container } = render(
    <UploadBatch batch={batch(items)} open onToggle={() => {}} onClose={() => {}} />,
  );
  expect(screen.getByText("Pronto, 2 fotos com erro")).toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: /Ocultar fotos/ });
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  const list = document.getElementById("upload-list") as HTMLElement;
  expect(list).not.toHaveAttribute("hidden");
  const rows = within(list).getAllByRole("listitem");
  expect(rows.map((r) => r.textContent)).toEqual([
    "big.jpgArquivo grande demais",
    "bad.jpgErro",
    "ok.jpg1 rosto, 900 ms",
  ]);
  expect((container.querySelector("[data-batch-bar]") as HTMLElement).dataset.done).not.toBe("true");
  expect(screen.getByRole("button", { name: "Fechar resumo do envio" })).toBeInTheDocument();
});

test("alternar a lista de fotos", async () => {
  const onToggle = vi.fn();
  const { rerender } = render(
    <UploadBatch batch={batch([item("queued")])} open={false} onToggle={onToggle} onClose={() => {}} />,
  );
  const toggle = screen.getByRole("button", { name: /Ver fotos/ });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(document.getElementById("upload-list")).toHaveAttribute("hidden");
  await userEvent.click(toggle);
  expect(onToggle).toHaveBeenCalled();
  rerender(<UploadBatch batch={batch([item("queued")])} open onToggle={onToggle} onClose={() => {}} />);
  expect(screen.getByRole("button", { name: /Ocultar fotos/ })).toHaveAttribute("aria-expanded", "true");
  expect(document.getElementById("upload-list")).not.toHaveAttribute("hidden");
});

test("breadcrumb: só o nome do evento é a página atual", async () => {
  api();
  await renderRoute("/estudio/4");
  const link = await screen.findByRole("link", { name: "Eventos" });
  expect(link).not.toHaveAttribute("aria-current");
  expect(document.querySelectorAll('[aria-current="page"]').length).toBe(2); // nav do topo (Estúdio) + nome
  expect(screen.getByText("Corrida", { selector: "span" })).toHaveAttribute("aria-current", "page");
});

test("dropzone: textos de mouse e de toque nas variantes certas", async () => {
  api();
  await renderRoute("/estudio/4");
  expect((await screen.findByText("Arraste as fotos do evento para cá")).className).toContain("touch:hidden");
  expect(screen.getByText("Escolher fotos do evento").className).toContain("touch:inline");
});

const uploadOk = () =>
  server.use(
    http.post("*/api/events/:id/photos", () =>
      HttpResponse.json([
        { id: 9, status: "done", filename: "a.png", n_faces: 1, proc_ms: 500, duplicate: false },
      ]),
    ),
  );
const drop = async () => {
  const zone = (await screen.findByText(/Arraste as fotos do evento/)).closest("label") as HTMLElement;
  fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
};

test("o resumo só aparece no evento que recebeu as fotos", async () => {
  api();
  uploadOk();
  const { router } = await renderRoute("/estudio/4");
  await drop();
  expect(await screen.findByText("1 de 1 foto")).toBeInTheDocument();
  await act(() => router.navigate({ to: "/estudio/$eventId", params: { eventId: 5 } }));
  await waitFor(() => expect(screen.queryByText("1 de 1 foto")).not.toBeInTheDocument());
  await act(() => router.navigate({ to: "/estudio/$eventId", params: { eventId: 4 } }));
  expect(await screen.findByText("1 de 1 foto")).toBeInTheDocument();
});

test("andamento do envio não re-renderiza o resto da página", async () => {
  api();
  uploadOk();
  await renderRoute("/estudio/4");
  await screen.findByAltText("a.jpg");
  const before = sheetRenders.n;
  await drop();
  expect(await screen.findByText("Pronto")).toBeInTheDocument();
  expect(sheetRenders.n).toBe(before);
});
