/** Fluxo completo contra o backend real (make api + make worker + make web) e o modelo de verdade.
 *  SMOKE_PHOTO=<foto do evento> SMOKE_SELFIE=<selfie da mesma pessoa> ADMIN_PASSWORD=<do .env> PW_CHROMIUM=... pnpm --dir frontend e2e
 *  Cria o próprio evento e o exclui no fim; a flag Calibração volta ao valor de antes. */
import { expect, test } from "@playwright/test";

const BASE = process.env.BASE ?? "http://127.0.0.1:5173";
const { SMOKE_PHOTO, SMOKE_SELFIE, ADMIN_PASSWORD } = process.env;

test("evento de ponta a ponta", async ({ page, request }) => {
  test.skip(!SMOKE_PHOTO || !SMOKE_SELFIE, "defina SMOKE_PHOTO e SMOKE_SELFIE");
  test.setTimeout(240_000);
  const photo = SMOKE_PHOTO as string;
  const selfie = SMOKE_SELFIE as string;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const features = async () =>
    (await (await request.get(`${BASE}/api/features`)).json()) as { calibration: boolean };
  const initialCalibration = (await features()).calibration;
  let loggedIn = false;

  try {
    // 1. criar evento pela UI
    await page.goto(`${BASE}/estudio`);
    await page
      .getByRole("button", { name: /Novo evento|Criar o primeiro evento/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nome").fill(`Smoke ${Date.now()}`);
    await dialog.getByRole("button", { name: "Criar evento" }).click();
    await page.waitForURL(/\/estudio\/\d+$/);
    const eventId = Number(page.url().split("/").pop());

    // 2. upload + indexação (o modelo roda em CPU)
    await page.locator('input[type="file"][multiple]').setInputFiles(photo);
    await expect(page.getByRole("status").filter({ hasText: /^Pronto/ })).toBeVisible({ timeout: 150_000 });

    // 3. selfie na galeria + slider via token
    await page.goto(`${BASE}/galeria/${eventId}`);
    await page.locator('input[type="file"]:not([multiple])').first().setInputFiles(selfie);
    const count = page.getByText(/fotos? com você/).first();
    await expect(count).toBeVisible({ timeout: 60_000 });
    const viaToken = page.waitForRequest(
      (r) => r.url().endsWith("/api/search") && (r.postData() ?? "").includes("query_token"),
    );
    await page.getByRole("slider").first().press("ArrowLeft");
    await viaToken;
    await expect(count).toBeVisible();

    // 4. visualizador + voltar do navegador
    await page
      .getByRole("button", { name: /^Abrir / })
      .first()
      .click();
    await expect(page).toHaveURL(/\?foto=\d+/);
    await page.goBack();
    await expect(page).not.toHaveURL(/foto=/);
    await expect(count).toBeVisible();

    // 5. zip: o botão navega para /api/zip?ids=...; conferimos a URL pedida e buscamos o arquivo
    const zipRequest = page.waitForRequest((r) => r.url().includes("/api/zip?ids="));
    await page.getByRole("button", { name: "Baixar todas" }).click();
    const zipUrl = (await zipRequest).url();
    expect(zipUrl).toMatch(/ids=\d+(,\d+)*$/);
    const zip = await request.get(zipUrl);
    expect(zip.status()).toBe(200);
    expect(zip.headers()["content-type"]).toContain("zip");

    // 6. backoffice + calibração
    if (ADMIN_PASSWORD) {
      await page.goto(`${BASE}/backoffice`);
      const pw = page.getByLabel("Senha de admin");
      const sw = page.getByRole("switch", { name: "Calibração" });
      await expect(pw.or(sw)).toBeVisible();
      if (await pw.isVisible()) {
        await pw.fill(ADMIN_PASSWORD);
        await page.getByRole("button", { name: "Entrar" }).click();
      }
      loggedIn = true;
      await expect(sw).toBeVisible();
      if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", "true");
      await expect.poll(async () => (await features()).calibration).toBe(true);

      await page.goto(`${BASE}/calibracao?e=${eventId}`);
      await page.locator('input[type="file"]').first().setInputFiles(selfie);
      await expect(page.getByText(/^corte /).first()).toBeVisible({ timeout: 60_000 });
    }

    // 7. excluir o evento pelo diálogo (duas etapas)
    await page.goto(`${BASE}/estudio/${eventId}`);
    await page.getByRole("button", { name: "Editar" }).click();
    const edit = page.getByRole("dialog");
    await edit.getByRole("button", { name: "Excluir evento" }).click();
    await expect(edit.getByRole("heading", { name: "Excluir evento?" })).toBeVisible();
    await edit.getByRole("button", { name: "Excluir evento" }).click();
    await page.waitForURL(`${BASE}/estudio`);
    await expect(page.getByText("Evento excluído")).toBeVisible();
    expect((await request.get(`${BASE}/api/events/${eventId}`)).status()).toBe(404);

    // 8. link antigo
    await page.goto(`${BASE}/#estudio`);
    await expect(page).toHaveURL(`${BASE}/estudio`);

    expect(errors).toEqual([]);
  } finally {
    // devolve a flag ao valor de antes, qualquer que seja o ponto em que o teste parou
    if (ADMIN_PASSWORD) {
      if (!loggedIn) {
        const res = await page.request.post(`${BASE}/api/admin/login`, {
          data: { password: ADMIN_PASSWORD },
        });
        loggedIn = res.ok();
      }
      if (loggedIn && (await features()).calibration !== initialCalibration) {
        await page.request.put(`${BASE}/api/admin/features/calibration`, {
          data: { enabled: initialCalibration },
        });
      }
      expect((await features()).calibration).toBe(initialCalibration);
    }
  }
});
