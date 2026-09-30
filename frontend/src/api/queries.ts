import { type QueryClient, queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { EventIn, FeatureInfo } from "./types";

export const qk = {
  events: ["events"] as const,
  event: (id: number) => ["events", id] as const,
  photos: (id: number) => ["events", id, "photos"] as const,
  stats: (id: number) => ["stats", id] as const,
  features: ["features"] as const,
  adminSession: ["admin", "session"] as const,
  adminFeatures: ["admin", "features"] as const,
};

/** 4xx não adianta repetir (404 de evento, 401...); 5xx e rede, até 2 vezes. */
export function shouldRetry(count: number, error: unknown): boolean {
  const status = (error as { status?: number } | null | undefined)?.status;
  return !(status && status < 500) && count < 2;
}

export const fetchEvent = (id: number, signal?: AbortSignal) =>
  unwrap(api.GET("/api/events/{event_id}", { params: { path: { event_id: id } }, signal }));

// erro: tudo desligado, como no app antigo
export const fetchFeatures = (signal?: AbortSignal) =>
  unwrap(api.GET("/api/features", { signal })).catch(() => ({}) as Record<string, boolean>);

/** Opções das leituras. Os hooks e os loaders das rotas (ensureQueryData) usam as mesmas. */
export const eventsQuery = queryOptions({
  queryKey: qk.events,
  queryFn: ({ signal }) => unwrap(api.GET("/api/events", { signal })),
});

export const eventQuery = (id: number) =>
  queryOptions({ queryKey: qk.event(id), queryFn: ({ signal }) => fetchEvent(id, signal) });

export const photosQuery = (id: number) =>
  queryOptions({
    queryKey: qk.photos(id),
    queryFn: ({ signal }) =>
      unwrap(api.GET("/api/events/{event_id}/photos", { params: { path: { event_id: id } }, signal })),
  });

export const statsQuery = (id: number) =>
  queryOptions({
    queryKey: qk.stats(id),
    queryFn: ({ signal }) => unwrap(api.GET("/api/stats", { params: { query: { event_id: id } }, signal })),
  });

export const featuresQuery = queryOptions({
  queryKey: qk.features,
  queryFn: ({ signal }) => fetchFeatures(signal),
  staleTime: 30_000,
});

export function useEvents(opts: { pollWhilePending?: boolean } = {}) {
  return useQuery({
    ...eventsQuery,
    // Estúdio: atualiza a cada 3 s só enquanto algum evento indexa
    refetchInterval: opts.pollWhilePending
      ? (q) => (q.state.data?.some((e) => e.n_pending > 0) ? 3000 : false)
      : false,
  });
}

export const useEvent = (id: number) => useQuery(eventQuery(id));
export const usePhotos = (id: number) => useQuery(photosQuery(id));
export const useStats = (id: number) => useQuery(statsQuery(id));
export const useFeatures = () => useQuery(featuresQuery);

export function invalidateEvent(qc: QueryClient, id: number) {
  // ["events"] é prefixo das outras chaves: a lista é exata; event(id) já cobre as fotos.
  qc.invalidateQueries({ queryKey: qk.events, exact: true });
  qc.invalidateQueries({ queryKey: qk.event(id) });
  qc.invalidateQueries({ queryKey: qk.stats(id) });
}

export function useSaveEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: EventIn }) =>
      id
        ? unwrap(api.PATCH("/api/events/{event_id}", { params: { path: { event_id: id } }, body }))
        : unwrap(api.POST("/api/events", { body })),
    onSuccess: (ev) => invalidateEvent(qc, ev.id),
  });
}

/** Esquece o evento apagado. Chamar só depois de sair da tela dele: com observadores ainda
 *  montados, remover as consultas dispararia um GET que volta 404. */
export function forgetEvent(qc: QueryClient, id: number) {
  qc.removeQueries({ queryKey: qk.event(id) });
  qc.removeQueries({ queryKey: qk.stats(id) });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.DELETE("/api/events/{event_id}", { params: { path: { event_id: id } } })),
    // a lista atualiza já; as consultas do evento saem com forgetEvent, depois da navegação
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.events, exact: true }),
  });
}

export const useAdminSession = () =>
  useQuery({
    queryKey: qk.adminSession,
    queryFn: ({ signal }) => unwrap(api.GET("/api/admin/session", { signal })),
    retry: false,
  });

export const useAdminFeatures = (enabled: boolean) =>
  useQuery({
    queryKey: qk.adminFeatures,
    queryFn: ({ signal }) => unwrap(api.GET("/api/admin/features", { signal })),
    enabled,
    retry: false,
  });

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => unwrap(api.POST("/api/admin/login", { body: { password } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/api/admin/logout")),
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });
}

export function useSetFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      unwrap(api.PUT("/api/admin/features/{key}", { params: { path: { key } }, body: { enabled } })),
    onSuccess: (f) => {
      qc.setQueryData<Record<string, boolean>>(qk.features, (old) => ({ ...old, [f.key]: f.enabled }));
      qc.setQueryData<FeatureInfo[]>(qk.adminFeatures, (l) => l?.map((x) => (x.key === f.key ? f : x)));
      qc.invalidateQueries({ queryKey: qk.adminFeatures });
    },
  });
}
