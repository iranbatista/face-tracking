import { defineConfig } from "@playwright/test";

// PW_CHROMIUM: caminho de um chrome-headless-shell já em cache (o download do Playwright não
// suporta este Ubuntu). Ex.: find ~/.cache/ms-playwright -name chrome-headless-shell -type f | head -1
export default defineConfig({
  testDir: ".",
  outputDir: "../test-results",
  use: {
    headless: true,
    launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined },
  },
});
