import type { ReactNode } from "react";

/** Estado da busca por selfie. Definido de verdade na Task 12. */
export type SelfieSearchState = Record<string, unknown>;

// STUB: implementado na Task 12. `initialState` (só para testes) é ignorado por enquanto.
export function SelfieSearchProvider({
  children,
}: {
  children: ReactNode;
  initialState?: Partial<SelfieSearchState>;
}) {
  return children;
}
