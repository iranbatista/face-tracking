import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, api, searchPhotos, unwrap } from "@/api/client";
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

test("unwrap sem detail e sem statusText (HTTP/2) cai em 'Erro <status>'", async () => {
  const response = new Response(null, { status: 503 });
  const err = (await unwrap(Promise.resolve({ response })).catch((e: unknown) => e)) as ApiError;
  expect(err).toBeInstanceOf(ApiError);
  expect(err.message).toBe("Erro 503");
});

// No jsdom, FormData/File são do jsdom e o fetch do Node (undici) não os serializa;
// por isso estes testes trocam o fetch e conferem o que ele recebe.
describe("searchPhotos", () => {
  const form = () => {
    const f = new FormData();
    f.append("event_id", "1");
    f.append("selfie", new File(["x"], "s.jpg", { type: "image/jpeg" }));
    return f;
  };
  const stubFetch = (res: Response) => {
    const fn = vi.fn(async (..._args: Parameters<typeof fetch>) => res);
    vi.stubGlobal("fetch", fn);
    return fn;
  };
  afterEach(() => vi.unstubAllGlobals());

  test("envia o FormData em POST /api/search e devolve o corpo", async () => {
    const fn = stubFetch(Response.json({ matches: [] }));
    const f = form();
    await expect(searchPhotos(f)).resolves.toEqual({ matches: [] });
    const [url, init] = fn.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/api\/search$/);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(f);
  });

  test.each([410, 422])("%i vira ApiError com o status", async (status) => {
    stubFetch(Response.json({ detail: "sem rosto" }, { status }));
    const err = await searchPhotos(form()).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(status);
    expect(err.message).toBe("sem rosto");
  });

  test("sem detail nem statusText usa 'Erro <status>'", async () => {
    stubFetch(new Response(null, { status: 500 }));
    const err = await searchPhotos(form()).catch((e) => e);
    expect(err.message).toBe("Erro 500");
  });
});
