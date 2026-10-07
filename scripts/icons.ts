/**
 * Render the app icons from public/icons/icon.svg with the installed Edge
 * (playwright-core, no browser download).
 *
 *   npm run icons
 *
 * Maskable and Apple icons are full-bleed squares; Android and iOS apply their
 * own rounding, and the artwork sits inside the 80% safe zone.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const svg = readFileSync("public/icons/icon.svg", "utf8");
const fullBleed = svg.replace(/rx="112"/, 'rx="0"');

const targets: { file: string; size: number; src: string }[] = [
  { file: "public/icons/icon-192.png", size: 192, src: svg },
  { file: "public/icons/icon-512.png", size: 512, src: svg },
  { file: "public/icons/maskable-512.png", size: 512, src: fullBleed },
  { file: "public/icons/apple-touch-icon.png", size: 180, src: fullBleed },
];

const browser = await chromium.launch({ channel: process.env.SCREENSHOT_BROWSER ?? "msedge" });
for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.size, height: t.size } });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${t.src.replace("<svg ", `<svg width="${t.size}" height="${t.size}" `)}</body></html>`,
  );
  await page.screenshot({ path: t.file, omitBackground: true });
  await page.close();
  console.log(`wrote ${t.file}`);
}
await browser.close();
