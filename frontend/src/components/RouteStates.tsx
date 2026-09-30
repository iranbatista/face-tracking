import { type ErrorComponentProps, Link, useRouter } from "@tanstack/react-router";
import { ApiError } from "@/api/client";
import { Prints } from "@/components/Illustration";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Estados de rota. Visual dos estados vazios: static/style.css:299-302. */
const emptyState = "flex max-w-[52ch] flex-col items-start gap-4 py-12 text-chumbo";

export function RoutePending() {
  return (
    <div className="pt-7" role="status" aria-label="Carregando">
      <Skeleton className="mb-8 h-14 w-2/3 max-w-[480px]" />
      <div className="grid gap-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className={emptyState} role="alert">
      <p>{error instanceof ApiError && error.message ? error.message : "Não foi possível carregar."}</p>
      <Button
        onClick={() => {
          reset();
          router.invalidate();
        }}
      >
        Tentar de novo
      </Button>
    </div>
  );
}

export function NotFoundEvent({ area = "gallery" }: { area?: "gallery" | "studio" }) {
  return (
    <div className={emptyState}>
      <Prints />
      <h1 className="display text-t-lg text-grafite">Evento não encontrado</h1>
      {area === "studio" ? (
        <Link to="/estudio" className="underline underline-offset-[3px]">
          Voltar para o estúdio
        </Link>
      ) : (
        <Link to="/" className="underline underline-offset-[3px]">
          Voltar para as galerias
        </Link>
      )}
    </div>
  );
}
