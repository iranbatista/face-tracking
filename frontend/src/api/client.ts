/** Único ponto de acesso HTTP à API (fora daqui só o upload com progresso, em upload.ts). */
import createClient from "openapi-fetch";
import type { paths } from "./schema";
import type { SearchOut } from "./types";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// origem explícita: em testes (jsdom) fetch não aceita URL relativa.
// `fetch` é resolvido a cada chamada (o openapi-fetch guardaria a referência do momento da criação),
// para que o MSW, que troca o fetch global ao ligar o servidor, intercepte também o cliente.
export const api = createClient<paths>({
  baseUrl: globalThis.location?.origin ?? "",
  fetch: (request) => globalThis.fetch(request),
});

function detailOf(error: unknown): string | null {
  const d = (error as { detail?: unknown } | undefined)?.detail;
  return typeof d === "string" && d ? d : null; // 422 do pydantic vem como lista
}

/** Resposta do openapi-fetch -> dado, ou ApiError com o `detail` do backend. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p;
  if (!response.ok)
    throw new ApiError(response.status, detailOf(error) || response.statusText || `Erro ${response.status}`);
  return data as T;
}

/** Busca por selfie (multipart). O openapi-fetch não serializa FormData com tipos do form, então vai por fetch. */
export async function searchPhotos(form: FormData): Promise<SearchOut> {
  const response = await fetch(`${globalThis.location?.origin ?? ""}/api/search`, {
    method: "POST",
    body: form,
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok)
    throw new ApiError(response.status, detailOf(body) || response.statusText || `Erro ${response.status}`);
  return body as SearchOut;
}

export type PhotoSize = "thumb" | "medium" | "full";
export const photoUrl = (id: number, size: PhotoSize) => `/api/photos/${id}/${size}`;
export const thumbUrl = (id: number) => photoUrl(id, "thumb");
export const mediumUrl = (id: number) => photoUrl(id, "medium");
export const downloadUrl = (id: number) => `/api/photos/${id}/full?download=1`;
export const zipUrl = (ids: number[]) => `/api/zip?ids=${ids.join(",")}`;
export const progressUrl = (eventId: number, ids: number[]) =>
  `/api/events/${eventId}/progress?ids=${ids.join(",")}`;
