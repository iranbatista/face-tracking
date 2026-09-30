import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

const events = [
  {
    id: 2,
    name: "Sem fotos",
    location: null,
    event_date: null,
    created_at: "2026-09-29T12:00:00+00:00",
    n_photos: 0,
    n_done: 0,
    n_pending: 0,
    n_faces: 0,
    cover: [],
  },
  {
    id: 3,
    name: "Corrida",
    location: null,
    event_date: null,
    created_at: "2026-09-29T12:00:00+00:00",
    n_photos: 1,
    n_done: 1,
    n_pending: 0,
    n_faces: 2,
    cover: [],
  },
];

test("sem ?e escolhe o primeiro evento com fotos", async () => {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({ calibration: true })),
    http.get("*/api/events", () => HttpResponse.json(events)),
  );
  const { router } = await renderRoute("/calibracao");
  await waitFor(() => expect(router.state.location.search).toEqual({ e: 3 }));
  expect(
    await screen.findByText(
      "Faça uma busca na Galeria ou envie uma selfie aqui para ver onde fica a fronteira.",
    ),
  ).toBeInTheDocument();
});

test("com resultado: régua, tempos e top 30", async () => {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({ calibration: true })),
    http.get("*/api/events", () => HttpResponse.json(events)),
  );
  const top = [
    {
      face_id: 1,
      photo_id: 7,
      score: 0.9,
      bbox: [0, 0, 5, 5],
      width: 10,
      height: 10,
      filename: "a.jpg",
      above: true,
    },
    {
      face_id: 2,
      photo_id: 8,
      score: 0.2,
      bbox: [0, 0, 5, 5],
      width: 10,
      height: 10,
      filename: "b.jpg",
      above: false,
    },
  ];
  await renderRoute("/calibracao?e=3", {
    search: {
      eventId: 3,
      status: "done",
      result: {
        query_token: "T",
        threshold: 0.4,
        total_photos: 1,
        indexed_faces: 2,
        matches: [],
        debug_top: top,
        timings_ms: { detection: 300, search: 2 },
        timings_from_cache: false,
      },
    },
  });
  expect(await screen.findByText("corte 0.40")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "score 0.900, a.jpg" })).toHaveClass("above");
  expect(screen.getByText("Detecção (SCRFD)")).toBeInTheDocument();
  expect(screen.getByText("302 ms")).toBeInTheDocument();
  expect(screen.getByText("1º, foto 7")).toBeInTheDocument();
});
