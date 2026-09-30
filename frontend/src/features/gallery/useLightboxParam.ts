import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";

type Item = { photo_id: number; face_id: number };

/** Estado do visualizador na URL: `?foto=<photo_id>` (Galeria) ou `?rosto=<face_id>` (Calibração).
 *  Abrir empilha uma entrada no histórico, então o "voltar" do navegador fecha; fechar
 *  desfaz o push (se foi esta sessão que empilhou) ou só tira o parâmetro. */
export function useLightboxParam<T extends Item>(param: "foto" | "rosto", items: readonly T[] | undefined) {
  const navigate = useNavigate();
  const router = useRouter();
  const raw = (useSearch({ strict: false }) as Record<string, unknown>)[param];
  const id = typeof raw === "number" ? raw : undefined;
  const pushed = useRef(false);
  const closing = useRef(false); // duplo clique/toque não pode voltar duas vezes no histórico

  const match = useMemo(() => {
    if (id === undefined) return null;
    return items?.find((it) => (param === "foto" ? it.photo_id : it.face_id) === id) ?? null;
  }, [id, items, param]);

  const setParam = useCallback(
    (value: number | undefined, replace: boolean) =>
      navigate({
        to: ".",
        replace,
        search: ((prev: Record<string, unknown>) => ({ ...prev, [param]: value })) as never,
      }),
    [navigate, param],
  );

  const open = useCallback(
    (item: T) => {
      pushed.current = true;
      void setParam(param === "foto" ? item.photo_id : item.face_id, false);
    },
    [param, setParam],
  );

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (pushed.current) router.history.back();
    else void setParam(undefined, true);
  }, [router, setParam]);

  useEffect(() => {
    if (id === undefined) {
      closing.current = false;
      pushed.current = false; // fechou (botão, Esc ou "voltar"): a próxima abertura é um push novo
    } else if (!match) {
      // recarregou sem busca, ou o id não está nos resultados: nada para mostrar
      pushed.current = false;
      closing.current = false;
      void setParam(undefined, true);
    }
  }, [id, match, setParam]);

  return { match, open, close };
}
