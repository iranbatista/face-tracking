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
};

const selfie = async (page: Page, which: Which) => {
  if (!SELFIE) return;
  const input = which === "old" ? "#selfie-input" : 'input[type="file"][accept="image/*"]';
  await page.setInputFiles(input, SELFIE);
  await page.waitForTimeout(2500);
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
  { name: "estudio", old: "/#estudio", new: "/estudio" },
  { name: "estudio-evento", old: `/#estudio?e=${EVENT}`, new: `/estudio/${EVENT}`, needsEvent: true },
  {
    name: "calibracao",
    old: `/#calibracao?e=${EVENT}`,
    new: `/calibracao?e=${EVENT}`,
    needsEvent: true,
    prepare: selfie,
  },
  { name: "backoffice", old: "/#backoffice", new: "/backoffice" },
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
  for (const w of WIDTHS) {
    const cells: string[] = [];
    for (const which of ["old", "new"] as const) {
      const page = await browser.newPage({ viewport: { width: w, height: 900 }, reducedMotion: "reduce" });
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
      const file = `${s.name}-${w}-${which}.png`;
      await page.screenshot({ path: OUT + file, fullPage: true });
      await page.close();
      cells.push(`<td><div>${which} ${w}px</div><img src="${file}"></td>`);
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
