import { HttpResponse, http } from "msw";
import { describe, expect, test } from "vitest";
import { ApiError, api, unwrap } from "@/api/client";
import { server } from "../msw";

describe("unwrap", () => {
  test("devolve o corpo em 2xx", async () => {
    server.use(http.get("*/api/features", () => HttpResponse.json({ calibration: true })));
    await expect(unwrap(api.GET("/api/features"))).resolves.toEqual({ calibration: true });
  });

  test("erro com detail em texto vira ApiError(status, detail)", async () => {
    server.use(
      http.get("*/api/events/:id", () =>
        HttpResponse.json({ detail: "evento não encontrado" }, { status: 404 }),
      ),
    );
    const err = await unwrap(api.GET("/api/events/{event_id}", { params: { path: { event_id: 9 } } })).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe("evento não encontrado");
  });

  test("422 do pydantic (detail em lista) usa o statusText", async () => {
    server.use(
      http.get("*/api/features", () =>
        HttpResponse.json({ detail: [{ msg: "x" }] }, { status: 422, statusText: "Unprocessable Entity" }),
      ),
    );
    const err = await unwrap(api.GET("/api/features")).catch((e) => e);
    expect(err.message).toBe("Unprocessable Entity");
  });
});
