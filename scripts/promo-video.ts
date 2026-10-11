/**
 * Build 9:16 promo videos for Patas: scripted runs through the real site,
 * framed with title cards, captions and a music bed.
 *
 *   npm run promo                    # build every cut, or do nothing if nothing changed
 *   npm run promo -- --cut=60s       # build one cut (comma-separate for several)
 *   npm run promo -- --rerecord      # re-drive the site even if it hasn't changed
 *   npm run promo -- --force         # rebuild every stage
 *
 * Needs ffmpeg on PATH and an installed Chrome (PROMO_BROWSER=msedge for Edge,
 * or PROMO_CHROMIUM=/path/to/chrome). No browser download.
 *
 * Content lives in scripts/promo/storyboard.json. A cut is a list of scenes:
 * cards (hook, bridge, call to action) and demos (a recorded flow through the
 * site with captions). The 30s cut shows the single-phone planner; the 60s cut
 * adds the group link. Both share the planner recording.
 *
 * Defaults to the live site; PROMO_URL=http://localhost:3100 records a local
 * production build instead (`PATAS_LOCAL_DB=1 npx next start -p 3100`, see the
 * header of scripts/screenshots.ts).
 *
 * Idempotent: the work is split into stages under out/promo/.build/. Each stage
 * stores a hash of its inputs and is skipped when that hash matches. Recordings
 * key on the storyboard and the site's Next.js build id, so a redeploy triggers
 * fresh recordings and a re-run with no changes is a no-op. Stages write to a
 * temp folder and rename it into place, so an interrupted run never leaves a
 * half-written stage that looks finished. Stage folders the storyboard no
 * longer produces are removed at the end.
 *
 * What a recording does to the site: the planner flow makes a few landmark
 * searches and one ranking request. The group flow also creates one real group
 * and joins four members (rate limits: 10 groups and 30 joins per IP per hour;
 * the group and its sealed cells are purged 48 h later like any other).
 * GoatCounter is blocked so recordings never count as visits.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";
import { cellCenter } from "../src/lib/h3.ts";

// ---------- Config ----------

type Caption = { from: string; to: string; title: string; sub?: string };
type CardScene = { type: "card"; seconds: number; title: string; subtitle: string; motif?: "meet" | "link" };
type CtaScene = { type: "cta"; seconds: number; name: string; tagline: string; url: string; footnote: string };
/** pickOnMap: in the group flow, the first member finds their landmark with the map instead of typing it. */
type DemoScene = { type: "demo"; flow: Flow; captions: Caption[]; pickOnMap?: boolean };
type Scene = CardScene | CtaScene | DemoScene;
type Flow = "planner" | "group";
type Member = { alias: string; q: string; pick: string };
type Storyboard = {
  url: string;
  outputDir: string;
  cuts: Record<string, string[]>;
  canvas: { width: number; height: number; fps: number; background: string };
  phone: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    colorScheme: "light" | "dark";
    frame: { x: number; y: number; width: number; radius: number };
  };
  group: Member[];
  mode: string;
  pacing: {
    typeDelayMs: number; beforeStartMs: number; afterPickMs: number;
    mapHoldMs: number; listHoldMs: number; qrHoldMs: number; rosterStepMs: number;
  };
  scenes: Record<string, Scene>;
  music: { file: string; volume: number };
};

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}
const FORCE = argv.includes("--force");
const RERECORD = FORCE || argv.includes("--rerecord");

const SB_PATH = process.env.PROMO_STORYBOARD ?? "scripts/promo/storyboard.json";
const sb: Storyboard = JSON.parse(readFileSync(SB_PATH, "utf8"));
const BASE = (process.env.PROMO_URL ?? sb.url).replace(/\/$/, "");
const OUT_DIR = resolve(sb.outputDir);
const BUILD = join(OUT_DIR, ".build");

const cutArg = argv.find((a) => a.startsWith("--cut="))?.slice(6);
const CUTS = cutArg ? cutArg.split(",") : Object.keys(sb.cuts);
for (const c of CUTS) {
  if (!sb.cuts[c]) throw new Error(`No cut "${c}" in ${SB_PATH}. Cuts: ${Object.keys(sb.cuts).join(", ")}`);
  for (const s of sb.cuts[c]) if (!sb.scenes[s]) throw new Error(`Cut "${c}" names scene "${s}", which isn't in "scenes"`);
}

const { width: W, height: H, fps: FPS, background: BG } = sb.canvas;
const even = (n: number) => 2 * Math.round(n / 2);
const FRAME = {
  x: sb.phone.frame.x,
  y: sb.phone.frame.y,
  w: even(sb.phone.frame.width),
  h: even((sb.phone.frame.width * sb.phone.viewport.height) / sb.phone.viewport.width),
  r: sb.phone.frame.radius,
};
const XFADE = 0.4; // seconds of crossfade between scenes
const CTA_URL = Object.values(sb.scenes).find((s): s is CtaScene => s.type === "cta")?.url ?? new URL(BASE).host;

// Bump CAPTURE_VERSION when a flow below changes in a way that should force new
// recordings. Every other stage keys on this file's contents, so it re-renders
// whenever the script changes.
const CAPTURE_VERSION = "5";
const SCRIPT_HASH = hash(readFileSync(fileURLToPath(import.meta.url)));

// ---------- Small helpers ----------

function hash(...parts: (string | Buffer)[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p).update("\0");
  return h.digest("hex").slice(0, 16);
}
const log = (msg: string) => console.log(`[promo] ${msg}`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const initial = (alias: string) => alias.trim()[0]?.toUpperCase() ?? "?";

function ffmpeg(args: string[]) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.error) throw new Error(`ffmpeg not found on PATH (${r.error.message})`);
  if (r.status !== 0) throw new Error(`ffmpeg exited with ${r.status}`);
}

/**
 * Run `fn` into a temp folder unless the stage's stamp matches `key`, then
 * swap the folder into place. Returns the stage folder.
 */
async function stage(name: string, key: string, outputs: string[], fn: (dir: string) => Promise<void>, force = FORCE) {
  const dir = join(BUILD, name);
  const stamp = join(dir, ".stamp");
  const fresh = existsSync(stamp) && readFileSync(stamp, "utf8") === key && outputs.every((o) => existsSync(join(dir, o)));
  if (fresh && !force) {
    log(`✓ ${name} (up to date)`);
    return dir;
  }
  const tmp = `${dir}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  log(`▸ ${name}…`);
  const t0 = Date.now();
  await fn(tmp);
  writeFileSync(join(tmp, ".stamp"), key);
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
  log(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return dir;
}

let browser: Browser | undefined;
async function getBrowser() {
  const exe = process.env.PROMO_CHROMIUM;
  browser ??= await chromium.launch(exe ? { executablePath: exe } : { channel: process.env.PROMO_BROWSER ?? "chrome" });
  return browser;
}

/** The Next.js build id from the page's leading HTML comment, so a redeploy re-records. */
async function siteBuildId(): Promise<string> {
  let html: string;
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    throw new Error(`Can't reach ${BASE}: ${(e as Error).message}`);
  }
  return html.match(/<!--([A-Za-z0-9_-]{8,})-->/)?.[1] ?? "unknown";
}

// ---------- Stage: cards (title cards, captions, background, mask) ----------

const FONT_LINK = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&display=block">`;
const C = { accent: "#5fbf94", ink: "#0d1a13", text: "#ecede8", muted: "#a3a89f", surface: "#1d201d", line: "#353a34" };
// Dark-theme member colours from src/app/member-colors.tsx, so the cards match the map.
const MEMBER = ["#5a8ef0", "#f5a050", "#d9508f", "#46c9b9", "#a88520"];

function html(body: string, opaque: boolean) {
  return `<!doctype html><html><head><meta charset="utf-8">${FONT_LINK}<style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${opaque ? BG : "transparent"}}
body{position:relative;color:${C.text};font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.d{font-family:"Bricolage Grotesque","Inter Display",Inter,system-ui,sans-serif;letter-spacing:-0.02em}
.abs{position:absolute}
.glow{position:absolute;inset:0;background:radial-gradient(900px 700px at 85% 8%,rgba(95,191,148,.16),transparent 70%),radial-gradient(700px 600px at 5% 100%,rgba(95,191,148,.08),transparent 70%)}
</style></head><body>${body}</body></html>`;
}

/** A big faint hexagon, the app icon's shape, for texture. */
const hexTexture = `<svg class="abs" style="left:-260px;top:${H - 900}px" width="1000" height="1000" viewBox="0 0 512 512">
<polygon points="256,40 443,148 443,364 256,472 69,364 69,148" fill="none" stroke="rgba(95,191,148,.07)" stroke-width="6"/></svg>`;

/** Everyone's dot, joined to a hexagon in the middle: the fair spot. */
function meetMotif() {
  const cx = 540, cy = 1330;
  const spots = [[200, 1070], [880, 1120], [230, 1590], [850, 1560], [540, 1040]].slice(0, sb.group.length);
  const hex = [0, 1, 2, 3, 4, 5].map((k) => {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    return `${cx + 120 * Math.cos(a)},${cy + 120 * Math.sin(a)}`;
  });
  return `<svg class="abs" style="left:0;top:0" width="${W}" height="${H}">
${spots.map(([x, y]) => `<line x1="${x}" y1="${y}" x2="${cx}" y2="${cy}" stroke="rgba(236,237,232,.3)" stroke-width="5" stroke-dasharray="14 14"/>`).join("")}
<polygon points="${hex.join(" ")}" fill="rgba(95,191,148,.14)" stroke="${C.accent}" stroke-width="10" stroke-linejoin="round"/>
<circle cx="${cx}" cy="${cy}" r="20" fill="${C.accent}"/>
${spots.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="38" fill="${MEMBER[i % MEMBER.length]}"/>
<text x="${x}" y="${y + 14}" text-anchor="middle" font-size="40" font-weight="800" fill="#141614" font-family="Inter,system-ui,sans-serif">${esc(initial(sb.group[i].alias))}</text>`).join("")}
</svg>`;
}

/** A group-chat bubble holding the link, and everyone checked in below it. */
function linkMotif() {
  const y0 = 1040;
  const check = `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="${C.ink}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `<div class="abs" style="left:120px;right:120px;top:${y0}px;background:${C.surface};border:2px solid ${C.line};border-radius:44px 44px 44px 12px;padding:38px 44px">
<div style="font-size:32px;color:${C.muted}">Group chat</div>
<div class="d" style="margin-top:12px;font-size:46px;font-weight:700;color:${C.accent};text-decoration:underline;text-underline-offset:10px">${esc(CTA_URL)}/g/…</div></div>
<div class="abs" style="left:0;right:0;top:${y0 + 320}px;display:flex;justify-content:center;gap:44px">
${sb.group.map((m, i) => `<div style="position:relative;width:100px;height:100px;border-radius:50%;background:${MEMBER[i % MEMBER.length]};display:flex;align-items:center;justify-content:center;font-size:46px;font-weight:800;color:#141614">${esc(initial(m.alias))}
<span style="position:absolute;right:-8px;bottom:-8px;width:44px;height:44px;border-radius:50%;background:${C.accent};border:5px solid ${BG};display:flex;align-items:center;justify-content:center">${check}</span></div>`).join("")}
</div>`;
}

const layers: Record<string, { body: string; opaque: boolean }> = {};
function addLayers() {
  const icon = readFileSync("public/icons/icon.svg", "utf8").replace(/<!--[\s\S]*?-->/g, "");

  // Background behind the phone recording: glow, texture, a bezel and the URL.
  layers["bg"] = {
    opaque: true,
    body: `<div class="glow"></div>${hexTexture}
<div class="abs" style="left:${FRAME.x - 10}px;top:${FRAME.y - 10}px;width:${FRAME.w + 20}px;height:${FRAME.h + 20}px;border-radius:${FRAME.r + 10}px;background:#0b0d0b;box-shadow:0 0 0 2px rgba(236,237,232,.09),0 30px 80px rgba(0,0,0,.5)"></div>
<div class="abs d" style="left:0;right:0;top:${FRAME.y + FRAME.h + 34}px;text-align:center;font-size:32px;font-weight:700;color:${C.muted}">${esc(CTA_URL)}</div>`,
  };
  // Rounded-corner mask for the recording (white = visible).
  layers["mask"] = {
    opaque: true,
    body: `<style>html,body{width:${FRAME.w}px;height:${FRAME.h}px;background:#000}</style>
<div class="abs" style="inset:0;border-radius:${FRAME.r}px;background:#fff"></div>`,
  };

  for (const [name, s] of Object.entries(sb.scenes)) {
    if (s.type === "card") {
      // Background, then the title, then the subtitle with its motif; each layer fades and rises in.
      layers[`${name}-bg`] = { opaque: true, body: `<div class="glow"></div>${hexTexture}` };
      layers[`${name}-1`] = {
        opaque: false,
        body: `<div class="abs d" style="left:90px;right:90px;top:430px;font-size:132px;line-height:1.02;font-weight:800">${esc(s.title)}</div>`,
      };
      layers[`${name}-2`] = {
        opaque: false,
        body: `<div class="abs" style="left:90px;right:90px;top:760px;font-size:54px;line-height:1.25;color:${C.muted}">${esc(s.subtitle)}</div>
${s.motif === "meet" ? meetMotif() : s.motif === "link" ? linkMotif() : ""}`,
      };
    } else if (s.type === "cta") {
      layers[`${name}-bg`] = { opaque: true, body: `<div class="glow"></div>${hexTexture}` };
      layers[`${name}-1`] = {
        opaque: false,
        body: `<div class="abs" style="left:0;right:0;top:470px;display:flex;flex-direction:column;align-items:center;text-align:center">
<div style="width:230px;height:230px">${icon.replace("<svg", '<svg width="230" height="230"')}</div>
<div class="d" style="margin-top:44px;font-size:170px;line-height:1;font-weight:800">${esc(s.name)}</div>
<div style="margin-top:26px;font-size:54px;color:${C.muted}">${esc(s.tagline)}</div></div>`,
      };
      layers[`${name}-2`] = {
        opaque: false,
        body: `<div class="abs" style="left:0;right:0;top:1190px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:34px">
<div class="d" style="background:${C.accent};color:${C.ink};font-size:50px;font-weight:800;padding:26px 52px;border-radius:999px">${esc(s.url)}</div>
<div style="font-size:38px;color:${C.muted}">${esc(s.footnote)}</div></div>`,
      };
    } else {
      // Captions sit in the band above the phone.
      s.captions.forEach((c, i) => {
        layers[`cap-${name}-${i}`] = {
          opaque: false,
          body: `<div class="abs" style="left:60px;right:60px;top:56px;height:${FRAME.y - 76}px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:10px">
<div class="d" style="font-size:60px;line-height:1.08;font-weight:800">${esc(c.title)}</div>
${c.sub ? `<div style="font-size:34px;line-height:1.25;color:${C.muted}">${esc(c.sub)}</div>` : ""}</div>`,
        };
      });
    }
  }
}

async function renderCards(dir: string) {
  const b = await getBrowser();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  // If Google Fonts can't be reached, fall back to system fonts rather than hang.
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.continue().catch(() => r.abort()));
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  for (const [name, { body, opaque }] of Object.entries(layers)) {
    await page.setContent(html(body, opaque), { waitUntil: "load" }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    const size = name === "mask" ? { width: FRAME.w, height: FRAME.h } : { width: W, height: H };
    await page.screenshot({ path: join(dir, `${name}.png`), omitBackground: !opaque, clip: { x: 0, y: 0, ...size } });
  }
  await ctx.close();
}

// ---------- Stage: capture (drive the site, record frames) ----------

type Timeline = { frames: { file: string; t: number }[]; marks: Record<string, number>; duration: number };

/**
 * Collects frames on a clock that can skip dead time. `squeeze` cuts network
 * waits down to a short beat, so the video never shows a spinner for longer
 * than it needs to, and the cut lands mid-wait, not mid-gesture.
 */
class Recorder {
  frames: { file: string; t: number }[] = [];
  marks: Record<string, number> = {};
  private t0 = 0;
  private skipped = 0;
  private n = 0;
  private running = false;
  private loop: Promise<void> = Promise.resolve();
  private page: Page;
  private dir: string;
  constructor(page: Page, dir: string) {
    this.page = page;
    this.dir = dir;
  }

  private now() {
    return performance.now() / 1000 - this.t0 - this.skipped;
  }
  async start() {
    this.t0 = performance.now() / 1000;
    this.running = true;
    // Back-to-back Playwright screenshots rather than a CDP screencast: the
    // screencast sends CSS-pixel frames, these honour deviceScaleFactor. Identical
    // frames are skipped; the previous one just stays on screen longer.
    this.loop = (async () => {
      let prev = "";
      while (this.running) {
        const shot = await this.page.screenshot({ type: "jpeg", quality: 90, scale: "device", caret: "initial", timeout: 0 }).catch(() => null);
        if (!shot) {
          await new Promise((r) => setTimeout(r, 50)); // navigating or crashed: don't spin
          continue;
        }
        const t = this.now();
        const h = hash(shot);
        if (h === prev) continue;
        prev = h;
        const file = `f${String(++this.n).padStart(5, "0")}.jpg`;
        writeFileSync(join(this.dir, file), shot);
        this.frames.push({ file, t });
      }
    })();
  }
  mark(name: string) {
    this.marks[name] = this.now();
  }
  async squeeze<T>(p: Promise<T>, keep: number): Promise<T> {
    const a = this.now();
    const result = await p;
    const cut = this.now() - a - keep;
    if (cut > 0) {
      const c0 = a + keep / 2, c1 = c0 + cut;
      let last: { file: string; t: number } | undefined;
      const kept: typeof this.frames = [];
      for (const f of this.frames) {
        if (f.t < c0) kept.push(f);
        else if (f.t < c1) last = f; // dropped, but the newest one stands in at the cut
        else kept.push({ ...f, t: f.t - cut });
      }
      if (last) kept.push({ ...last, t: c0 });
      this.frames = kept.sort((x, y) => x.t - y.t);
      for (const k in this.marks) if (this.marks[k] >= c0) this.marks[k] = Math.max(c0, this.marks[k] - cut);
      this.skipped += cut;
    }
    return result;
  }
  async stop(): Promise<Timeline> {
    this.mark("end");
    this.running = false;
    await this.loop;
    if (this.frames.length) this.frames[0].t = 0;
    return { frames: this.frames, marks: this.marks, duration: this.marks.end };
  }
}

/**
 * Headless recordings have no cursor, so show touches: a ripple where each tap
 * lands, and a fingertip that follows a drag.
 */
const TOUCH_MARKS = `{
let finger = null, sx = 0, sy = 0;
addEventListener("pointerdown", (e) => {
  sx = e.clientX; sy = e.clientY; finger = null;
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;left:" + (e.clientX - 24) + "px;top:" + (e.clientY - 24) + "px;width:48px;height:48px;border-radius:50%;" +
    "background:rgba(95,191,148,.35);border:3px solid rgba(95,191,148,.95);pointer-events:none;z-index:2147483647;" +
    "transform:scale(.35);opacity:1;transition:transform .5s ease-out,opacity .5s ease-out";
  document.documentElement.appendChild(d);
  requestAnimationFrame(() => requestAnimationFrame(() => { d.style.transform = "scale(1.5)"; d.style.opacity = "0"; }));
  setTimeout(() => d.remove(), 700);
}, true);
addEventListener("pointermove", (e) => {
  if (!e.buttons) return;
  if (!finger) {
    if (Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
    finger = document.createElement("div");
    finger.style.cssText = "position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(236,237,232,.32);" +
      "border:3px solid rgba(236,237,232,.9);box-shadow:0 4px 14px rgba(0,0,0,.35);pointer-events:none;z-index:2147483647;transition:opacity .3s";
    document.documentElement.appendChild(finger);
  }
  finger.style.left = e.clientX + "px";
  finger.style.top = e.clientY + "px";
}, true);
const lift = () => { const f = finger; finger = null; if (f) { f.style.opacity = "0"; setTimeout(() => f.remove(), 350); } };
addEventListener("pointerup", lift, true);
addEventListener("pointercancel", lift, true);
}`;

/**
 * Recording only: the group page polls who's in every 15 s. Poll every second
 * instead, so the roster fills within a beat of each friend joining. Nothing
 * else in the app uses a 15 s interval.
 */
const FAST_GROUP_POLL = `{
  const si = window.setInterval;
  window.setInterval = function (fn, ms, ...rest) { return si.call(this, fn, ms === 15000 ? 1000 : ms, ...rest); };
}`;

type Ctx = {
  scene: DemoScene;
  page: Page;
  rec: Recorder;
  wait: (ms: number) => Promise<void>;
  bring: (loc: Locator, block?: ScrollLogicalPosition) => Promise<void>;
};

async function typeLandmark({ page, rec, wait }: Ctx, box: Locator, m: Member) {
  await box.click();
  await box.pressSequentially(m.q, { delay: sb.pacing.typeDelayMs });
  const option = page.getByRole("option").filter({ hasText: m.pick }).first();
  await rec.squeeze(option.waitFor(), 0.25);
  await wait(220);
  await option.click();
  await wait(sb.pacing.afterPickMs);
}

/** Web Mercator pixels at zoom z, the projection Leaflet uses. */
function project(lat: number, lng: number, z: number) {
  const scale = 256 * 2 ** z, phi = (lat * Math.PI) / 180;
  return { x: (scale * (lng + 180)) / 360, y: (scale * (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI)) / 2 };
}

/**
 * "Can't find it? Look on the map": open the pin finder, zoom in, drag the map
 * until the circle sits on the member's own landmark area, then pick that
 * landmark from the nearby list (or the nearest one if it isn't listed).
 * Marks: pin.
 */
async function pickOnMap({ page, rec, wait, bring }: Ctx, mapBtn: Locator, m: Member) {
  // The pin finder opens at [14.65, 121.05], zoom 13 (src/app/pin-map.tsx) and
  // lists landmarks from PIN_MIN_ZOOM = 14. Update these if that file changes.
  const START = { lat: 14.65, lng: 121.05 }, ZOOM = 14;
  const cell: string = await page.evaluate(async (m) => {
    const res = await fetch("/api/landmarks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: m.q }) });
    if (!res.ok) throw new Error(`/api/landmarks answered ${res.status}`);
    const { results } = await res.json();
    const hit = results.find((r: { name: string }) => r.name === m.pick) ?? results[0];
    if (!hit) throw new Error(`No landmarks for "${m.q}"`);
    return hit.cell;
  }, m);
  const target = cellCenter(cell);

  rec.mark("pin");
  await bring(mapBtn);
  await mapBtn.click();
  const sheet = page.locator("dialog.pin-finder");
  const zoomIn = sheet.locator(".leaflet-control-zoom-in");
  await rec.squeeze(zoomIn.waitFor({ timeout: 15_000 }), 0.3);
  await wait(1100); // long enough to read "Don't put the circle on your home"
  const mapEl = sheet.locator(".pin-map");
  await bring(mapEl);
  await zoomIn.click();
  await wait(600);

  // Drag the map so the target comes under the circle, in strokes short enough
  // to stay on the map, easing to a stop so Leaflet adds no inertia.
  const a = project(START.lat, START.lng, ZOOM), b = project(target.lat, target.lng, ZOOM);
  const dx = a.x - b.x, dy = a.y - b.y;
  const box = (await mapEl.boundingBox())!;
  const strokes = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (0.55 * Math.min(box.width, box.height))));
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (let s = 0; s < strokes; s++) {
    const sx = dx / strokes, sy = dy / strokes;
    const x0 = cx - sx / 2, y0 = cy - sy / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    const steps = 28;
    for (let i = 1; i <= steps; i++) {
      const e = 0.5 - Math.cos((Math.PI * i) / steps) / 2; // ease in and out
      await page.mouse.move(x0 + sx * e, y0 + sy * e);
      await wait(16);
    }
    await wait(140);
    await page.mouse.up();
    await wait(250);
  }

  const mine = sheet.locator(".nearby button").filter({ hasText: m.pick }).first();
  await rec.squeeze(mine.waitFor({ timeout: 8_000 }).catch(() => sheet.locator(".nearby button").first().waitFor()), 0.3);
  const choice = (await mine.count()) ? mine : sheet.locator(".nearby button").first();
  await wait(300);
  await bring(choice);
  await wait(500);
  await choice.click();
  await wait(sb.pacing.afterPickMs + 300);
}

/** Shared ending: press Find fair spots, hold on the map, then the ranked list. */
async function findAndShowResults({ page, rec, wait, bring }: Ctx) {
  const p = sb.pacing;
  const find = page.getByRole("button", { name: "Find fair spots" });
  await bring(find);
  rec.mark("find");
  await wait(900); // the squeeze below only caps the wait, so give the caption its beat here
  await find.click();
  // Keep a beat of "Finding spots…", cut the rest of the wait.
  await rec.squeeze(page.locator(".venues li").first().waitFor({ timeout: 90_000 }), 0.8);
  await page.evaluate(() => window.scrollTo(0, 0));
  rec.mark("results");
  // Tiles and labels paint after the list; cut that too. No tiles (offline build) is fine.
  await rec.squeeze(
    (async () => {
      await page.locator(".map .leaflet-tile-loaded").first().waitFor({ timeout: 15_000 }).catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await wait(1200);
    })(),
    0.2,
  );
  await wait(p.mapHoldMs);
  rec.mark("list");
  await page.locator(".results-head").evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  await wait(p.listHoldMs);
}

const FLOWS: Record<Flow, (c: Ctx) => Promise<void>> = {
  /** One phone, everyone's landmarks. Marks: start, find, results, list, end. */
  async planner(c) {
    const { page, wait, bring } = c;
    const p = sb.pacing;
    await wait(p.beforeStartMs);
    for (let i = 0; i < sb.group.length; i++) {
      const m = sb.group[i];
      if (i >= 2) {
        const add = page.getByRole("button", { name: "+ Add member" });
        await bring(add);
        await add.click();
        await wait(250);
      }
      const name = page.getByPlaceholder(`Member ${i + 1}`, { exact: true });
      await bring(name);
      await name.click();
      await name.pressSequentially(m.alias, { delay: Math.round(p.typeDelayMs * 0.6) });
      await typeLandmark(c, page.locator("li.member").nth(i).getByRole("combobox"), m);
    }
    const mode = page.locator(".segmented label", { hasText: sb.mode });
    await bring(mode);
    await mode.click();
    await wait(400);
    await findAndShowResults(c);
  },

  /**
   * Group link: the first member makes the link, shows the QR, joins; the rest
   * join through the API as if from their own phones and the roster fills.
   * Marks: start, share, join, (pin,) roster, find, results, list, end.
   */
  async group(c) {
    const { page, rec, wait, bring } = c;
    const p = sb.pacing;
    const [me, ...others] = sb.group;
    await wait(p.beforeStartMs);
    await page.locator("label.choice", { hasText: "Each person, on their own phone" }).click();
    await wait(1100);
    const create = page.getByRole("button", { name: "Create a group link" });
    await bring(create);
    await wait(300);
    await create.click();
    await rec.squeeze(
      (async () => {
        await page.waitForURL(/\/g\/[^#]+#k=/, { timeout: 30_000 });
        await page.getByRole("heading", { name: "Add yourself" }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        await wait(300);
      })(),
      0.3,
    );

    rec.mark("share");
    await bring(page.getByRole("heading", { name: "Invite the rest of your group" }), "start");
    await wait(600);
    await page.getByRole("button", { name: /Show QR code/ }).click();
    const qr = page.locator(".qr-img");
    await qr.waitFor({ timeout: 5_000 }).catch(() => {});
    await wait(250);
    await bring(qr);
    await wait(p.qrHoldMs);

    rec.mark("join");
    const nick = page.getByPlaceholder("e.g. Bea");
    await bring(nick);
    await nick.click();
    await nick.pressSequentially(me.alias, { delay: Math.round(p.typeDelayMs * 0.6) });
    await wait(700);
    if (c.scene.pickOnMap) await pickOnMap(c, page.locator(".join .map-btn"), me);
    else await typeLandmark(c, page.locator(".join").getByRole("combobox"), me);
    const join = page.getByRole("button", { name: "Join", exact: true });
    await bring(join);
    await join.click();
    await rec.squeeze(page.getByText("You're in as").waitFor(), 0.4);

    rec.mark("roster");
    await bring(page.locator(".roster"));
    for (let i = 0; i < others.length; i++) {
      await rec.squeeze(
        (async () => {
          await page.evaluate(async (m) => {
            const k = new URLSearchParams(location.hash.slice(1)).get("k");
            const id = location.pathname.split("/")[2];
            const post = async (url: string, body: unknown) => {
              const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
              if (!r.ok) throw new Error(`${url.replace(/\/groups\/[^/]+/, "/groups/<id>")} answered ${r.status}${r.status === 429 ? " (rate limited)" : ""}`);
              return r.json();
            };
            const { results } = await post("/api/landmarks", { q: m.q });
            const cell = results.find((r: { name: string }) => r.name === m.pick)?.cell;
            if (!cell) throw new Error(`No landmark "${m.pick}" for "${m.q}"`);
            await post(`/api/groups/${id}/join`, { k, alias: m.alias, cell });
          }, others[i]);
          await page.locator(".roster li").nth(i + 1).waitFor({ timeout: 10_000 });
        })(),
        0.4,
      );
      await wait(p.rosterStepMs);
    }
    await findAndShowResults(c);
  },
};

async function capture(scene: DemoScene, dir: string) {
  const { flow } = scene;
  const b = await getBrowser();
  const { viewport, deviceScaleFactor, colorScheme } = sb.phone;
  const ctx = await b.newContext({
    viewport, deviceScaleFactor, colorScheme, isMobile: true, hasTouch: true, locale: "en-PH", timezoneId: "Asia/Manila",
  });
  await ctx.route(/gc\.zgo\.at|goatcounter\.com/, (r) => r.abort());
  await ctx.addInitScript(TOUCH_MARKS);
  if (flow === "group") await ctx.addInitScript(FAST_GROUP_POLL);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  const wait = (ms: number) => page.waitForTimeout(ms);
  const bring = async (loc: Locator, block: ScrollLogicalPosition = "center") => {
    await loc.evaluate((el, block) => el.scrollIntoView({ behavior: "smooth", block }), block);
    await wait(450);
  };

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const rec = new Recorder(page, dir);
  await rec.start();
  rec.mark("start");
  try {
    await FLOWS[flow]({ scene, page, rec, wait, bring });
  } catch (e) {
    await rec.stop().catch(() => {});
    await page.screenshot({ path: join(BUILD, `failed-${flow}.png`) }).catch(() => {});
    throw new Error(`The ${flow} flow failed (screenshot: ${join(BUILD, `failed-${flow}.png`)}): ${(e as Error).message}`);
  }
  const timeline = await rec.stop();
  writeFileSync(join(dir, "timeline.json"), JSON.stringify(timeline, null, 1));
  await ctx.close();
  log(`  recorded ${timeline.frames.length} frames, ${timeline.duration.toFixed(1)}s after cuts`);
}

// ---------- Stage: demo (frames -> constant-frame-rate clip) ----------

function assembleDemo(captureDir: string, dir: string) {
  const tl: Timeline = JSON.parse(readFileSync(join(captureDir, "timeline.json"), "utf8"));
  const lines = ["ffconcat version 1.0"];
  tl.frames.forEach((f, i) => {
    const next = tl.frames[i + 1]?.t ?? tl.duration;
    const d = next - f.t;
    if (d <= 0.0005) return;
    lines.push(`file '${join(captureDir, f.file)}'`, `duration ${d.toFixed(4)}`);
  });
  lines.push(`file '${join(captureDir, tl.frames.at(-1)!.file)}'`); // concat demuxer needs the last file twice
  writeFileSync(join(dir, "frames.ffconcat"), lines.join("\n"));
  ffmpeg([
    "-f", "concat", "-safe", "0", "-i", join(dir, "frames.ffconcat"),
    "-vf", `scale=${FRAME.w}:${FRAME.h}:flags=lanczos,fps=${FPS},format=yuv420p`,
    "-t", tl.duration.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "14",
    "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact",
    join(dir, "demo.mp4"),
  ]);
  copyFileSync(join(captureDir, "timeline.json"), join(dir, "timeline.json"));
}

// ---------- Stage: music ----------

/** A quiet, deterministic placeholder bed (arpeggio, pad, bass) for when no track is supplied. */
function synthBed(path: string, seconds: number) {
  const rate = 48000, n = Math.ceil(seconds * rate);
  const L = new Float32Array(n), R = new Float32Array(n);
  const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
  const bar = 2.5; // seconds per chord, 96 BPM in 4/4
  const chords = [[48, 60, 64, 67, 71, 74], [45, 57, 60, 64, 67, 72], [41, 57, 60, 65, 69, 72], [43, 59, 62, 67, 71, 74]];
  const arp = [1, 3, 2, 4, 3, 5, 4, 2];
  for (let s = 0; s < n; s++) {
    const t = s / rate;
    const ch = chords[Math.floor(t / bar) % chords.length], tb = t % bar;
    // Pad: soft sines that swell in each bar.
    const swell = Math.min(1, tb / 0.6) * Math.min(1, (bar - tb) / 0.4 + 0.3);
    let pad = 0;
    for (let k = 1; k < ch.length; k++) pad += Math.sin(2 * Math.PI * hz(ch[k]) * t);
    pad *= 0.022 * swell;
    // Arpeggio: eighth-note plucks an octave up.
    const step = 0.3125, si = Math.floor(tb / step), ts = tb - si * step;
    const f = hz(ch[arp[si % arp.length]] + 12);
    const pluck = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-ts * 7) * 0.11;
    // Bass on beats 1 and 3.
    const bass = Math.sin(2 * Math.PI * hz(ch[0] - 12) * t) * Math.exp(-(tb % (bar / 2)) * 2.2) * 0.2;
    const pan = si % 2 ? 0.35 : -0.35;
    L[s] = pad + bass + pluck * (1 - pan);
    R[s] = pad + bass + pluck * (1 + pan);
  }
  // One-pole low-pass to round off the edges, then normalise.
  let pl = 0, pr = 0, peak = 0;
  for (let s = 0; s < n; s++) {
    pl += 0.35 * (L[s] - pl); pr += 0.35 * (R[s] - pr);
    L[s] = pl; R[s] = pr;
    peak = Math.max(peak, Math.abs(pl), Math.abs(pr));
  }
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  const g = 0.8 / (peak || 1);
  for (let s = 0; s < n; s++) {
    buf.writeInt16LE(Math.round(L[s] * g * 32767), 44 + s * 4);
    buf.writeInt16LE(Math.round(R[s] * g * 32767), 46 + s * 4);
  }
  writeFileSync(path, buf);
}

// ---------- Stage: compose (one per cut) ----------

const sceneSeconds = (name: string, demoDirs: Record<string, string>) => {
  const s = sb.scenes[name];
  return s.type === "demo" ? readTimeline(demoDirs[name]).duration : s.seconds;
};
const readTimeline = (dir: string): Timeline => JSON.parse(readFileSync(join(dir, "timeline.json"), "utf8"));
const cutSeconds = (cut: string, demoDirs: Record<string, string>) =>
  sb.cuts[cut].reduce((sum, n) => sum + sceneSeconds(n, demoDirs), 0) - XFADE * (sb.cuts[cut].length - 1);

function compose(cut: string, cardsDir: string, demoDirs: Record<string, string>, musicDir: string, dir: string) {
  const inputs: string[] = [];
  let nIn = 0;
  const input = (...args: string[]) => (inputs.push(...args), nIn++);
  const still = (layer: string, secs: number) =>
    input("-framerate", String(FPS), "-loop", "1", "-t", secs.toFixed(3), "-i", join(cardsDir, `${layer}.png`));

  const fade = (st: number, end: number | null, d = 0.25) =>
    `fade=t=in:st=${st.toFixed(3)}:d=${d}:alpha=1` + (end === null ? "" : `,fade=t=out:st=${(end - d).toFixed(3)}:d=${d}:alpha=1`);
  // Element rises 60px into place as it fades in.
  const rise = (st: number) => `y='if(lt(t,${st}),60,max(0,60-(t-${st})*200))':eval=frame`;
  const seg = `fps=${FPS},format=yuv444p,setsar=1`;

  const f: string[] = [];
  const segs: { label: string; secs: number }[] = [];
  sb.cuts[cut].forEach((name, si) => {
    const s = sb.scenes[name];
    const L = `s${si}`;
    if (s.type === "demo") {
      const tl = readTimeline(demoDirs[name]);
      const D = tl.duration;
      const bg = still("bg", D), dv = input("-i", join(demoDirs[name], "demo.mp4")), mk = still("mask", D);
      // Recording with rounded corners on the background, then captions.
      f.push(`[${dv}:v]format=rgba[${L}dv]`, `[${mk}:v]format=gray[${L}mk]`, `[${L}dv][${L}mk]alphamerge[${L}dm]`);
      f.push(`[${bg}:v]format=rgba[${L}bg]`, `[${L}bg][${L}dm]overlay=${FRAME.x}:${FRAME.y}:eof_action=repeat[${L}c]`);
      let last = `${L}c`;
      s.captions.forEach((c, i) => {
        if (!(c.from in tl.marks) || !(c.to in tl.marks)) log(`  warning: ${name} caption "${c.title}" uses a mark the ${s.flow} flow doesn't set (${Object.keys(tl.marks).join(", ")})`);
        const a = Math.max(0, tl.marks[c.from] ?? 0);
        const b = Math.min(D, tl.marks[c.to] ?? D);
        if (b - a < 0.8) log(`  warning: ${name} caption "${c.title}" is only on screen ${(b - a).toFixed(1)}s`);
        const cap = still(`cap-${name}-${i}`, D);
        f.push(`[${cap}:v]format=rgba,${fade(a, b)}[${L}k${i}]`, `[${last}][${L}k${i}]overlay=0:0[${L}c${i}]`);
        last = `${L}c${i}`;
      });
      f.push(`[${last}]${seg}[${L}]`);
      segs.push({ label: L, secs: D });
    } else {
      const t1 = s.type === "cta" ? 0.2 : 0.15, t2 = s.type === "cta" ? 0.75 : 0.8;
      const bg = still(`${name}-bg`, s.seconds), l1 = still(`${name}-1`, s.seconds), l2 = still(`${name}-2`, s.seconds);
      f.push(`[${l1}:v]format=rgba,${fade(t1, null, 0.45)}[${L}a]`, `[${l2}:v]format=rgba,${fade(t2, null, 0.45)}[${L}b]`);
      f.push(`[${bg}:v][${L}a]overlay=x=0:${rise(t1)}[${L}ab]`, `[${L}ab][${L}b]overlay=x=0:${rise(t2)},${seg}[${L}]`);
      segs.push({ label: L, secs: s.seconds });
    }
  });

  // Join scenes with crossfades.
  let acc = segs[0].label, T = segs[0].secs;
  for (let i = 1; i < segs.length; i++) {
    f.push(`[${acc}][${segs[i].label}]xfade=transition=fade:duration=${XFADE}:offset=${(T - XFADE).toFixed(3)}[x${i}]`);
    acc = `x${i}`;
    T += segs[i].secs - XFADE;
  }
  f.push(`[${acc}]format=yuv420p[vout]`);
  const music = input("-stream_loop", "-1", "-i", join(musicDir, "music.wav"));
  f.push(`[${music}:a]atrim=0:${T.toFixed(3)},asetpts=N/SR/TB,afade=t=in:d=0.4,afade=t=out:st=${(T - 1.6).toFixed(3)}:d=1.6,volume=${sb.music.volume}[aout]`);

  ffmpeg([
    ...inputs,
    "-filter_complex", f.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-t", T.toFixed(3), "-r", String(FPS),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact",
    join(dir, "promo.mp4"),
  ]);
  // Cover image: the end of the first scene, everything faded in.
  ffmpeg(["-ss", (segs[0].secs - XFADE - 0.15).toFixed(3), "-i", join(dir, "promo.mp4"), "-frames:v", "1", "-q:v", "2", join(dir, "poster.jpg")]);
}

// ---------- Main ----------

/** Copy into place only if the bytes differ, so an unchanged run doesn't touch the output's mtime. */
function publish(src: string, dest: string) {
  if (existsSync(dest) && hash(readFileSync(dest)) === hash(readFileSync(src))) return false;
  copyFileSync(src, `${dest}.tmp`);
  try {
    renameSync(`${dest}.tmp`, dest);
  } catch (e) {
    rmSync(`${dest}.tmp`, { force: true });
    throw new Error(`Can't replace ${dest} (${(e as Error).message}). Close it in any video player and run again; the build is cached.`);
  }
  return true;
}

/** Remove stage folders (and interrupted .tmp folders) that no cut in the storyboard produces any more. */
function prune() {
  const scenes = new Set(Object.values(sb.cuts).flat());
  const keep = new Set(["cards", "music", ...Object.keys(sb.cuts).map((c) => `compose-${c}`)]);
  for (const s of scenes) if (sb.scenes[s]?.type === "demo") keep.add(`capture-${s}`).add(`demo-${s}`);
  for (const e of readdirSync(BUILD, { withFileTypes: true })) {
    if (e.isDirectory() && !keep.has(e.name)) rmSync(join(BUILD, e.name), { recursive: true, force: true });
  }
  // Outputs of cuts that were renamed or removed; only this script's own file names.
  for (const f of readdirSync(OUT_DIR)) {
    const cut = f.match(/^patas-promo-(.+?)(-poster\.jpg|\.mp4)$/)?.[1];
    if (cut && !sb.cuts[cut]) rmSync(join(OUT_DIR, f), { force: true });
  }
}

try {
  mkdirSync(BUILD, { recursive: true });
  log(`site: ${BASE}`);
  log(`cuts: ${CUTS.join(", ")}`);

  addLayers();
  const cardsKey = hash(SCRIPT_HASH, JSON.stringify(layers), String(W), String(H));
  const cardsDir = await stage("cards", cardsKey, ["bg.png", "mask.png"], renderCards);

  const demoScenes = [...new Set(CUTS.flatMap((c) => sb.cuts[c]))].filter((n) => sb.scenes[n].type === "demo");
  const buildId = demoScenes.length ? await siteBuildId() : "";
  const demoDirs: Record<string, string> = {};
  const demoKeys: Record<string, string> = {};
  for (const name of demoScenes) {
    const { flow } = sb.scenes[name] as DemoScene;
    if (!FLOWS[flow]) throw new Error(`Scene "${name}" uses flow "${flow}"; flows are ${Object.keys(FLOWS).join(", ")}`);
    // Captions don't change what gets recorded, so they stay out of this key.
    const { captions: _c, ...options } = sb.scenes[name] as DemoScene;
    const captureKey = hash(CAPTURE_VERSION, BASE, buildId, JSON.stringify([options, sb.phone, sb.group, sb.mode, sb.pacing]));
    const captureDir = await stage(`capture-${name}`, captureKey, ["timeline.json"], (d) => capture(sb.scenes[name] as DemoScene, d), RERECORD);
    demoKeys[name] = hash(SCRIPT_HASH, captureKey, JSON.stringify(FRAME), String(FPS));
    demoDirs[name] = await stage(`demo-${name}`, demoKeys[name], ["demo.mp4", "timeline.json"], async (d) => assembleDemo(captureDir, d));
  }

  const track = existsSync(sb.music.file) ? sb.music.file : null;
  const musicKey = hash(SCRIPT_HASH, track ? readFileSync(track) : "synth");
  const musicDir = await stage("music", musicKey, ["music.wav"], async (d) => {
    if (track) ffmpeg(["-i", track, "-ac", "2", "-ar", "48000", "-map_metadata", "-1", join(d, "music.wav")]);
    else synthBed(join(d, "music.wav"), 60);
  });
  if (!track) log(`  using the generated placeholder bed; drop a track at ${sb.music.file} to replace it`);

  for (const cut of CUTS) {
    const scenes = sb.cuts[cut];
    const key = hash(
      SCRIPT_HASH, cardsKey, musicKey, JSON.stringify([scenes, scenes.map((n) => sb.scenes[n]), sb.music, sb.canvas]),
      ...scenes.filter((n) => demoKeys[n]).map((n) => demoKeys[n]),
    );
    const dir = await stage(`compose-${cut}`, key, ["promo.mp4", "poster.jpg"], async (d) => compose(cut, cardsDir, demoDirs, musicDir, d));
    const out = join(OUT_DIR, `patas-promo-${cut}.mp4`);
    const changed = publish(join(dir, "promo.mp4"), out);
    publish(join(dir, "poster.jpg"), out.replace(/\.mp4$/, "-poster.jpg"));
    log(`${changed ? "wrote" : "unchanged"}: ${out} (${cutSeconds(cut, demoDirs).toFixed(1)}s)`);
  }
  prune();
} finally {
  await browser?.close();
}
