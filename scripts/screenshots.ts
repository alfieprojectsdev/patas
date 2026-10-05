/**
 * Regenerate the README screenshots in docs/screenshots/.
 *
 *   npm run build && ROUTING_PROVIDER=estimate npx next start -p 3100
 *   SCREENSHOT_URL=http://localhost:3100 npm run screenshots
 *
 * Drives an installed Edge (SCREENSHOT_BROWSER=chrome for Chrome) through
 * playwright-core, so no browser download. Uses a production build: the dev
 * server adds its own badge to the page. Needs public/tiles (npm run fetch:tiles).
 */
import { mkdirSync } from "node:fs";
import { chromium, type Browser, type BrowserContextOptions, type Page } from "playwright-core";

const BASE = process.env.SCREENSHOT_URL ?? "http://localhost:3000";
const OUT = "docs/screenshots";

// Public landmarks only; nicknames are made up.
const GROUP = [
  { alias: "Bea", q: "sm nor", pick: "SM City North Edsa" },
  { alias: "Jun", q: "lrt kat", pick: "Katipunan station (LRT)" },
  { alias: "Kai", q: "fairview terr", pick: "Fairview Terraces" },
  { alias: "Mika", q: "cubao", pick: "Cubao station" },
];

async function pickLandmark(page: Page, row: number, q: string, pick: string) {
  await page.locator("li.member").nth(row).getByRole("combobox").fill(q);
  await page.getByRole("option").filter({ hasText: pick }).first().click();
}

/** Fill the form; leave member 1's search open if `stopAtSearch`. */
async function fillGroup(page: Page, stopAtSearch: boolean) {
  await page.goto(BASE);
  for (let i = 2; i < GROUP.length; i++) await page.getByRole("button", { name: "Add member" }).click();
  for (let i = 0; i < GROUP.length; i++) {
    await page.getByPlaceholder(`Member ${i + 1}`, { exact: true }).fill(GROUP[i].alias);
  }
  for (let i = 1; i < GROUP.length; i++) await pickLandmark(page, i, GROUP[i].q, GROUP[i].pick);
  await page.locator("li.member").first().getByRole("combobox").fill(GROUP[0].q);
  await page.getByRole("option").first().waitFor();
  if (stopAtSearch) return;
  await page.getByRole("option").filter({ hasText: GROUP[0].pick }).first().click();
  await page.getByRole("button", { name: "Find fair spots" }).click();
  await page.locator(".venue").first().waitFor();
  await waitForMap(page);
}

async function waitForMap(page: Page) {
  await page.locator(".map .leaflet-tile-loaded").first().waitFor();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500); // protomaps-leaflet paints labels after tiles load
}

/** Screenshot from the top of `from` to the bottom of `to`, page coordinates. */
async function shotBetween(page: Page, from: string, to: string, path: string, pad = 16) {
  const a = (await page.locator(from).first().boundingBox())!;
  const b = (await page.locator(to).boundingBox())!;
  const scrollY = await page.evaluate(() => window.scrollY);
  const x = Math.min(a.x, b.x) - pad;
  const y = a.y + scrollY - pad;
  await page.screenshot({
    path,
    fullPage: true,
    clip: { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x + pad, height: b.y + b.height + scrollY - y + pad },
  });
  console.log(`wrote ${path}`);
}

async function withPage(browser: Browser, opts: BrowserContextOptions, fn: (p: Page) => Promise<void>) {
  const ctx = await browser.newContext(opts);
  try {
    await fn(await ctx.newPage());
  } finally {
    await ctx.close();
  }
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.SCREENSHOT_BROWSER ?? "msedge" });
const desktop = { viewport: { width: 1000, height: 1200 }, deviceScaleFactor: 2, colorScheme: "light" } as const;

await withPage(browser, desktop, async (page) => {
  await fillGroup(page, true);
  await shotBetween(page, "header", ".primary + .hint", `${OUT}/1-pick-landmarks.png`);
});

await withPage(browser, desktop, async (page) => {
  await fillGroup(page, false);
  await shotBetween(page, ".map", ".venue >> nth=2", `${OUT}/2-fair-spots.png`);
});

await withPage(
  browser,
  { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark" },
  async (page) => {
    await fillGroup(page, false);
    await page.locator(".map").scrollIntoViewIfNeeded();
    await shotBetween(page, ".map", ".venue >> nth=0", `${OUT}/3-phone-dark.png`, 8);
  },
);

await browser.close();
