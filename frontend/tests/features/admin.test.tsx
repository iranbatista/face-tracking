import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

const flag = { key: "calibration", label: "Calibração", description: "Top 30...", enabled: false };

test("backoffice desativado", async () => {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/admin/session", () => HttpResponse.json({ enabled: false, logged_in: false })),
  );
  await renderRoute("/backoffice");
  expect(await screen.findByText(/Backoffice desativado: defina/)).toBeInTheDocument();
});

test("senha errada mostra o erro e mantém o login", async () => {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/admin/session", () => HttpResponse.json({ enabled: true, logged_in: false })),
    http.post("*/api/admin/login", () => HttpResponse.json({ detail: "Senha incorreta." }, { status: 401 })),
  );
  await renderRoute("/backoffice");
  await userEvent.type(await screen.findByLabelText("Senha de admin"), "x");
  await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Senha incorreta.");
});

test("ligar a flag atualiza a nav; recusa volta o switch", async () => {
  let calls = 0;
  server.use(
    http.get("*/api/features", () => HttpResponse.json({ calibration: false })),
    http.get("*/api/admin/session", () => HttpResponse.json({ enabled: true, logged_in: true })),
    http.get("*/api/admin/features", () => HttpResponse.json([flag])),
    http.put("*/api/admin/features/calibration", () => {
      calls += 1;
      return calls === 1
        ? HttpResponse.json({ ...flag, enabled: true })
        : HttpResponse.json({ detail: "falhou" }, { status: 500 });
    }),
  );
  await renderRoute("/backoffice");
  const sw = await screen.findByRole("switch", { name: "Calibração" });
  await userEvent.click(sw);
  expect(await screen.findByRole("link", { name: "Calibração" })).toBeInTheDocument();
  await userEvent.click(sw);
  expect(await screen.findByText("falhou")).toBeInTheDocument();
  await waitFor(() => expect(sw).toBeChecked());
});

test("sessão expirada volta ao login", async () => {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/admin/session", () => HttpResponse.json({ enabled: true, logged_in: true })),
    http.get("*/api/admin/features", () => HttpResponse.json([flag])),
    http.put("*/api/admin/features/calibration", () =>
      HttpResponse.json({ detail: "Entre no backoffice." }, { status: 401 }),
    ),
  );
  await renderRoute("/backoffice");
  await userEvent.click(await screen.findByRole("switch", { name: "Calibração" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Sessão expirada. Entre de novo.");
});
