/** Screenshots do app antigo (:8000, static/) e do novo (:5173) lado a lado.
 *  Uso: PARITY_EVENT=<id com fotos prontas> [PARITY_SELFIE=<caminho>] [PW_CHROMIUM=...] pnpm parity [tela...]
 *  Saída: e2e/.parity/index.html (abra no navegador). Comparação a olho. */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const OLD = process.env.PARITY_OLD ?? "http://127.0.0.1:8000";
const NEW = process.env.PARITY_NEW ?? "http://127.0.0.1:5173";
const EVENT = process.env.PARITY_EVENT;
const SELFIE = process.env.PARITY_SELFIE;
const WIDTHS = [375, 768, 1280];
const OUT = new URL("./.parity/", import.meta.url).pathname;

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
      const page = await browser.newPage({ viewport: { width: w, height: 900 } });
      await page.goto((which === "old" ? OLD : NEW) + s[which]);
      await page.waitForLoadState("networkidle");
      await s.prepare?.(page, which);
      await page.waitForTimeout(600); // animações de entrada
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
