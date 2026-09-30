import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import type { FaceHit } from "@/api/types";
import { ResultsBar } from "@/features/gallery/ResultsBar";
import { ResultsGrid } from "@/features/gallery/ResultsGrid";
import { server } from "../msw";
import { renderRoute } from "../render";

const m = (photo_id: number, extra = {}) => ({
  face_id: photo_id,
  photo_id,
  score: 0.7,
  bbox: [0, 0, 1, 1],
  width: 100,
  height: 80,
  filename: `${photo_id}.jpg`,
  ...extra,
});

test("contagem e link do zip", () => {
  render(<ResultsBar matches={[m(3), m(5)]} totalPhotos={10} threshold={0.4} onThreshold={() => {}} />);
  expect(screen.getByText("2 fotos com você")).toBeInTheDocument();
  expect(screen.getByText("de 10 no evento")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Baixar todas/ })).toHaveAttribute("href", "/api/zip?ids=3,5");
  expect(screen.getByText("Equilibrada")).toBeInTheDocument();
});

test("uma foto no singular", () => {
  render(<ResultsBar matches={[m(3)]} totalPhotos={1} threshold={0.4} onThreshold={() => {}} />);
  expect(screen.getByText("1 foto com você")).toBeInTheDocument();
});

test("sem resultados", () => {
  render(<ResultsBar matches={[]} totalPhotos={10} threshold={0.7} onThreshold={() => {}} />);
  expect(screen.getByText("Nenhuma foto encontrada")).toBeInTheDocument();
  expect(screen.getByText("Rigorosa")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Baixar todas/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Baixar todas/ })).toBeDisabled();
});

test("precisão: o slider avisa o novo corte pelo teclado", async () => {
  const onThreshold = vi.fn();
  render(<ResultsBar matches={[m(3)]} totalPhotos={10} threshold={0.4} onThreshold={onThreshold} />);
  const slider = screen.getByRole("slider", { name: /Precisão/ });
  expect(slider).toHaveAttribute("aria-valuemin", "0.15");
  expect(slider).toHaveAttribute("aria-valuemax", "0.8");
  slider.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(onThreshold).toHaveBeenCalledWith(0.41);
  expect(screen.getByText("mais fotos")).toBeInTheDocument();
  expect(screen.getByText("mais certeza")).toBeInTheDocument();
});

test("grade: um botão por foto, com a pontuação e o clique", async () => {
  const onOpen = vi.fn();
  render(<ResultsGrid matches={[m(3, { score: 0.694 }), m(5, { score: 0.5 })]} onOpen={onOpen} />);
  const card = screen.getByRole("button", { name: "Abrir 3.jpg" });
  expect(within(card).getByText("69%")).toBeInTheDocument();
  const img = card.querySelector("img");
  expect(img).toHaveAttribute("src", "/api/photos/3/thumb");
  expect(img).toHaveAttribute("srcset", "/api/photos/3/thumb 400w, /api/photos/3/medium 1600w");
  expect(img).toHaveAttribute("sizes", "(max-width: 600px) 50vw, 25vw");
  expect(img).toHaveAttribute("width", "100");
  expect(img).toHaveAttribute("height", "80");
  await userEvent.click(card);
  expect(onOpen).toHaveBeenCalledWith(3);
});

test("grade: cada foto vai para a coluna mais baixa, em ordem", () => {
  // jsdom sem largura: cai em window.innerWidth (1024 -> 3 colunas)
  const tall = { width: 100, height: 200 };
  render(<ResultsGrid matches={[m(1, tall), m(2), m(3), m(4)]} onOpen={() => {}} />);
  const cols = [...document.querySelectorAll("[data-cols] > div")].map((c) =>
    [...c.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")),
  );
  expect(cols).toEqual([["Abrir 1.jpg"], ["Abrir 2.jpg", "Abrir 4.jpg"], ["Abrir 3.jpg"]]);
});

test("grade vazia: orienta a mexer na precisão", () => {
  render(<ResultsGrid matches={[]} onOpen={() => {}} />);
  expect(
    screen.getByText(
      'Nenhuma foto passou do nível de precisão atual. Mova a precisão para "mais fotos" ou tente uma selfie de frente, com boa luz.',
    ),
  ).toBeInTheDocument();
});

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
  cover: [{ id: 7, fx: 0.5, fy: 0.3 }],
};
const selfie = {
  bbox: [0, 0, 10, 10],
  det_score: 0.9,
  n_faces: 1,
  all_bboxes: [[0, 0, 10, 10]],
  width: 100,
  height: 100,
  warning: null,
};
const found = (matches: FaceHit[]) => ({
  eventId: 4,
  selfieUrl: "blob:x",
  queryToken: "T",
  status: "done" as const,
  threshold: 0.4,
  result: { query_token: "T", threshold: 0.4, total_photos: 2, indexed_faces: 3, matches, selfie },
});
function mock() {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/events/:id", () => HttpResponse.json(event)),
  );
}

test("rota: sem busca não há resultados", async () => {
  mock();
  await renderRoute("/galeria/4");
  await screen.findByRole("heading", { level: 2, name: "Encontre suas fotos" });
  expect(screen.queryByText(/com você/)).not.toBeInTheDocument();
  expect(screen.queryByText("Nenhuma foto encontrada")).not.toBeInTheDocument();
});

test("rota: initialSearch mostra a barra e a grade; clicar na foto põe ?foto= na URL", async () => {
  mock();
  const { router } = await renderRoute("/galeria/4", { search: found([m(7), m(8)]) });
  expect(await screen.findByText("2 fotos com você")).toBeInTheDocument();
  expect(screen.getByText("de 2 no evento")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Abrir 8.jpg" }));
  await waitFor(() => expect(router.state.location.search).toMatchObject({ foto: 8 }));
});

test("rota: busca sem acertos", async () => {
  mock();
  await renderRoute("/galeria/4", { search: found([]) });
  expect(await screen.findByText("Nenhuma foto encontrada")).toBeInTheDocument();
  expect(screen.getByText(/Nenhuma foto passou do nível de precisão atual/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Baixar todas/ })).toBeDisabled();
});
