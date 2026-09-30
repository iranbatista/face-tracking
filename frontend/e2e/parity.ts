/** Screenshots do app antigo (:8000, static/) e do novo (:5173) lado a lado.
 *  Uso: PARITY_EVENT=<id com fotos prontas> [PARITY_SELFIE=<caminho>] [PW_CHROMIUM=...] pnpm parity [tela...]
 *  Saída: e2e/.parity/index.html (abra no navegador). Comparação a olho. */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";

const OLD = process.env.PARITY_OLD ?? "http://127.0.0.1:8000";
const NEW = process.env.PARITY_NEW ?? "http://127.0.0.1:5173";
const EVENT = process.env.PARITY_EVENT;
const SELFIE = process.env.PARITY_SELFIE;
const WIDTHS = [375, 768, 1280];
const OUT = fileURLToPath(new URL("./.parity/", import.meta.url));

type Which = "old" | "new";
type Screen = {
  name: string;
  old: string;
  new: string;
  needsEvent?: boolean;
  prepare?: (page: Page, which: Which) => Promise<void>;
  /** larguras x altura extras só desta tela (ex.: celular deitado) */
  extra?: { width: number; height: number }[];
};

const selfie = async (page: Page, which: Which) => {
  if (!SELFIE) return;
  const input = which === "old" ? "#selfie-input" : 'input[type="file"][accept="image/*"]';
  await page.setInputFiles(input, SELFIE);
  await page.waitForTimeout(2500);
};

const openFirstPhoto = async (page: Page, which: Which) => {
  await selfie(page, which);
  const card =
    which === "old" ? page.locator(".shot").first() : page.getByRole("button", { name: /^Abrir / }).first();
  await card.click();
  await page.waitForTimeout(800);
};

const SCREENS: Screen[] = [
  { name: "galerias", old: "/#galeria", new: "/" },
  { name: "galeria", old: `/#galeria?e=${EVENT}`, new: `/galeria/${EVENT}`, needsEvent: true },
  {
    name: "galeria-resultado",
    old: `/#galeria?e=${EVENT}`,
    new: `/galeria/${EVENT}`,
    needsEvent: true,
    prepare: selfie,
  },
  {
    name: "galeria-foto",
    old: `/#galeria?e=${EVENT}`,
    new: `/galeria/${EVENT}`,
    needsEvent: true,
    prepare: openFirstPhoto,
    extra: [{ width: 740, height: 360 }],
  },
  { name: "estudio", old: "/#estudio", new: "/estudio" },
  {
    name: "estudio-dialogo",
    old: "/#estudio",
    new: "/estudio",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Novo evento" }).click();
      await page.waitForTimeout(400);
    },
  },
  { name: "estudio-evento", old: `/#estudio?e=${EVENT}`, new: `/estudio/${EVENT}`, needsEvent: true },
  {
    name: "calibracao",
    old: `/#calibracao?e=${EVENT}`,
    new: `/calibracao?e=${EVENT}`,
    needsEvent: true,
    prepare: selfie,
  },
  { name: "backoffice", old: "/#backoffice", new: "/backoffice" },
  {
    // precisa de PARITY_ADMIN_PASSWORD (a senha do .env do servidor); nunca é impressa
    name: "backoffice-painel",
    old: "/#backoffice",
    new: "/backoffice",
    prepare: async (page) => {
      const password = process.env.PARITY_ADMIN_PASSWORD;
      if (!password) throw new Error("backoffice-painel precisa de PARITY_ADMIN_PASSWORD");
      await page.locator('input[type="password"]:visible').fill(password);
      await page.getByRole("button", { name: "Entrar" }).click();
      await page.getByRole("switch").first().waitFor();
    },
  },
];

const only = process.argv.slice(2);
const unknown = only.filter((n) => !SCREENS.some((x) => x.name === n));
if (unknown.length) {
  console.error(
    `Tela desconhecida: ${unknown.join(", ")}. Disponíveis: ${SCREENS.map((x) => x.name).join(", ")}`,
  );
  process.exit(1);
}
const selected = SCREENS.filter((x) => !only.length || only.includes(x.name));
for (const s of selected) {
  if (s.needsEvent && !EVENT) {
    console.error(`A tela "${s.name}" precisa de PARITY_EVENT=<id>`);
    process.exit(1);
  }
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
mkdirSync(OUT, { recursive: true });
const rows: string[] = [];
for (const s of selected) {
  const sizes = [...WIDTHS.map((width) => ({ width, height: 900 })), ...(s.extra ?? [])];
  for (const { width: w, height } of sizes) {
    const cells: string[] = [];
    for (const which of ["old", "new"] as const) {
      const page = await browser.newPage({ viewport: { width: w, height }, reducedMotion: "reduce" });
      await page.goto((which === "old" ? OLD : NEW) + s[which]);
      // networkidle nunca chega com polling: espera curta, depois o conteúdo do <main>
      await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
      await page.locator("main").first().waitFor();
      await page.waitForFunction(() => (document.querySelector("main")?.textContent ?? "").trim().length > 0);
      await s.prepare?.(page, which);
      await page.waitForTimeout(600); // animações de entrada
      // rola até o fim e volta: força os decodes assíncronos antes da captura de página inteira
      await page.evaluate(async () => {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise((r) => setTimeout(r, 400));
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(300);
      const file = `${s.name}-${w}${height === 900 ? "" : `x${height}`}-${which}.png`;
      await page.screenshot({ path: OUT + file, fullPage: true });
      await page.close();
      cells.push(
        `<td><div>${which} ${w}${height === 900 ? "" : `x${height}`}px</div><img src="${file}"></td>`,
      );
    }
    rows.push(`<tr><th>${s.name}</th>${cells.join("")}</tr>`);
  }
}
await browser.close();
writeFileSync(
  `${OUT}index.html`,
  `<!doctype html><meta charset="utf-8"><title>Paridade</title><style>img{width:100%;border:1px solid #ccc}td{vertical-align:top;width:50%}</style><table>${rows.join("")}</table>`,
);
console.log(`abra ${OUT}index.html`);
