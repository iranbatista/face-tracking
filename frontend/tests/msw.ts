/** Servidor MSW compartilhado. Carregado pelo setupFiles (tests/setup.ts), então
 *  TODO teste falha em requisição sem handler; os testes só importam `server`
 *  para registrar handlers com server.use(). */
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

export const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.events.removeAllListeners();
});
afterAll(() => server.close());
