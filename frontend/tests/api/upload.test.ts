import { HttpResponse, http } from "msw";
import { describe, expect, test } from "vitest";
import { xhrUpload } from "@/api/upload";
import { server } from "../msw";

const file = () => new File(["x"], "a.jpg", { type: "image/jpeg" });

describe("xhrUpload", () => {
  test("200 devolve o primeiro item", async () => {
    server.use(
      http.post("*/api/events/:id/photos", () =>
        HttpResponse.json([
          { status: "ok", photo_id: 7 },
          { status: "ok", photo_id: 8 },
        ]),
      ),
    );
    await expect(xhrUpload(1, file(), () => {})).resolves.toMatchObject({ status: "ok", photo_id: 7 });
  });

  test("413 vira 'Arquivo grande demais'", async () => {
    server.use(http.post("*/api/events/:id/photos", () => new HttpResponse(null, { status: 413 })));
    await expect(xhrUpload(1, file(), () => {})).resolves.toEqual({
      status: "error",
      error: "Arquivo grande demais",
    });
  });

  test("500 vira 'Erro 500'", async () => {
    server.use(http.post("*/api/events/:id/photos", () => new HttpResponse(null, { status: 500 })));
    await expect(xhrUpload(1, file(), () => {})).resolves.toEqual({ status: "error", error: "Erro 500" });
  });

  test("falha de rede vira 'Falha de conexão'", async () => {
    server.use(http.post("*/api/events/:id/photos", () => HttpResponse.error()));
    await expect(xhrUpload(1, file(), () => {})).resolves.toEqual({
      status: "error",
      error: "Falha de conexão",
    });
  });
});
