import type { QueryClient } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import { ApiError } from "@/api/client";
import { eventQuery } from "@/api/queries";
import { positiveInt } from "@/lib/search";

/** Parâmetro `$eventId`: inteiro >= 1, senão "não encontrado". */
export const eventIdParams = {
  parse: (p: { eventId: string }) => {
    const eventId = positiveInt(p.eventId);
    if (eventId === undefined) throw notFound();
    return { eventId };
  },
  stringify: (p: { eventId: number }) => ({ eventId: String(p.eventId) }),
};

/** Padrão de dados das rotas: ensureQueryData; 404 vira notFound(), o resto sobe ao errorComponent. */
export async function loadEvent(qc: QueryClient, eventId: number) {
  try {
    return await qc.ensureQueryData(eventQuery(eventId));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw notFound();
    throw e;
  }
}
