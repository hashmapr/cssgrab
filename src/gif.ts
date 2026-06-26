import { chromium, type Browser } from "playwright";
import type { ExtractedElement } from "./types.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface GifOptions {
  fps?: number;
  durationMs?: number;
  outputPath?: string;
  scale?: number;
}

export async function renderGif(
  data: ExtractedElement,
  opts: GifOptions = {},
): Promise<string | null> {
  const fps = opts.fps ?? 20;
  const scale = opts.scale ?? 1; // 1x — 2x was causing 33MB GIFs

  let animDurationMs = 1000;
  if (data.webAnimations.length > 0) {
    const d = data.webAnimations[0].duration;
    if (typeof d === "number" && d > 0) animDurationMs = d;
  }
  // Cap at 2s max — marquee animations are infinite, don't capture forever
  const durationMs = opts.durationMs ?? Math.min(Math.max(animDurationMs * 2, 1000), 2000);
  const frameCount = Math.round((durationMs / 1000) * fps);
  const frameDelay = Math.round(1000 / fps);

  console.log(`\n🎞  Capturing ${frameCount} frames @ ${fps}fps (${(durationMs / 1000).toFixed(1)}s)...`);

  let browser: Browser | undefined;
  const frames: Buffer[] = [];

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      deviceScaleFactor: scale,
    });
    const page = await context.newPage();

    await page.goto(data.url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(300);

    await page.evaluate((sel) => {
      document.querySelector(sel)?.scrollIntoView({ block: "center" });
    }, data.selector);
    await page.waitForTimeout(100);

    await page.hover(data.selector).catch(() => {});

    const box = await page.locator(data.selector).boundingBox().catch(() => null);
    const pad = 12;

    for (let i = 0; i < frameCount; i++) {
      await page.evaluate(() => {
        document.getAnimations().forEach(a => {
          try { if (a.playState !== "running") a.play(); } catch { }
        });
      });

      let screenshot: Buffer;
      if (box) {
        screenshot = await page.screenshot({
          clip: {
            x: Math.max(0, box.x - pad),
            y: Math.max(0, box.y - pad),
            width: Math.min(box.width + pad * 2, 800), // cap width at 800px
            height: Math.min(box.height + pad * 2, 600), // cap height at 600px
          },
          type: "png",
        }) as unknown as Buffer;
      } else {
        screenshot = await page.screenshot({ type: "png" }) as unknown as Buffer;
      }

      frames.push(screenshot);
      if (i < frameCount - 1) await page.waitForTimeout(frameDelay);
    }
  } finally {
    await browser?.close().catch(() => {});
  }

  if (frames.length === 0) return null;

  console.log(`  ✓ ${frames.length} frames captured`);

  let gifBuffer: Buffer | null = null;
  try {
    gifBuffer = await encodeGif(frames, frameDelay);
    const kb = (gifBuffer.length / 1024).toFixed(1);
    console.log(`  ✓ GIF encoded (${kb} KB)`);

    // Warn if still large
    if (gifBuffer.length > 5 * 1024 * 1024) {
      console.warn(`  ⚠ GIF is large (${(gifBuffer.length / 1024 / 1024).toFixed(1)} MB) — use --gif <path> to save`);
    }
  } catch (err) {
    console.warn(`  ⚠ GIF encoding failed: ${(err as Error).message}`);
  }

  if (gifBuffer && opts.outputPath) {
    const { writeFileSync } = await import("fs");
    writeFileSync(opts.outputPath, gifBuffer);
    console.log(`  ✓ Saved → ${opts.outputPath}`);
  }

  if (gifBuffer) {
    displayInlineGif(gifBuffer);
  } else {
    displayInlinePng(frames[0]);
  }

  return opts.outputPath ?? null;
}

async function encodeGif(frames: Buffer[], frameDelayMs: number): Promise<Buffer> {
  let gifenc: any;
  try {
    gifenc = await import("gifenc");
  } catch {
    throw new Error("gifenc not installed");
  }

  const { GIFEncoder, quantize, applyPalette } = gifenc.default ?? gifenc;
  const { createCanvas, loadImage } = await importCanvas();

  const firstImg = await loadImage(frames[0]);
  const w = firstImg.width;
  const h = firstImg.height;

  const encoder = GIFEncoder();
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const delayCs = Math.round(frameDelayMs / 10);

  for (const frameBuf of frames) {
    const img = await loadImage(frameBuf);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, h);
    const palette = quantize(data, 256);
    const indexed = applyPalette(data, palette);
    encoder.writeFrame(indexed, w, h, { palette, delay: delayCs });
  }

  encoder.finish();
  return Buffer.from(encoder.bytes());
}

async function importCanvas(): Promise<{ createCanvas: any; loadImage: any }> {
  try {
    const mod = await import("canvas");
    return { createCanvas: mod.createCanvas, loadImage: mod.loadImage };
  } catch { }
  try {
    const mod = await import("@napi-rs/canvas");
    return { createCanvas: (mod as any).createCanvas, loadImage: (mod as any).loadImage };
  } catch { }
  throw new Error("No canvas implementation found. Install 'canvas' or '@napi-rs/canvas'.");
}

function displayInlineGif(gifBuffer: Buffer): void {
  // Skip inline display if over 5MB — too large for terminal
  if (gifBuffer.length > 5 * 1024 * 1024) {
    console.log(`  ℹ GIF too large for inline display — save with --gif <path>`);
    return;
  }
  const protocol = detectTerminalProtocol();
  switch (protocol) {
    case "iterm2": displayIterm2(gifBuffer, "animation.gif"); break;
    case "kitty": displayKitty(gifBuffer); break;
    default:
      console.log("  ℹ Your terminal doesn't support inline images. Use --gif <path> to save.");
  }
}

function displayInlinePng(pngBuffer: Buffer): void {
  const protocol = detectTerminalProtocol();
  if (protocol === "iterm2") displayIterm2(pngBuffer, "preview.png");
  else if (protocol === "kitty") displayKitty(pngBuffer);
  else console.log("  ℹ First frame captured but terminal doesn't support inline images.");
}

type TerminalProtocol = "iterm2" | "kitty" | "sixel" | "none";

function detectTerminalProtocol(): TerminalProtocol {
  const term = process.env.TERM_PROGRAM ?? "";
  const termEnv = process.env.TERM ?? "";
  const kittyWindow = process.env.KITTY_WINDOW_ID;
  if (term === "iTerm.app" || term.toLowerCase().includes("iterm")) return "iterm2";
  if (kittyWindow !== undefined || termEnv === "xterm-kitty") return "kitty";
  return "none";
}

function displayIterm2(buffer: Buffer, name: string): void {
  const b64 = buffer.toString("base64");
  const args = [
    `name=${Buffer.from(name).toString("base64")}`,
    `size=${buffer.length}`,
    `inline=1`,
    `width=auto`,
    `height=auto`,
    `preserveAspectRatio=1`,
  ].join(";");
  process.stdout.write(`\n\x1b]1337;File=${args}:${b64}\x07\n`);
}

function displayKitty(buffer: Buffer): void {
  const b64 = buffer.toString("base64");
  const CHUNK = 4096;
  let first = true;
  for (let i = 0; i < b64.length; i += CHUNK) {
    const chunk = b64.slice(i, i + CHUNK);
    const more = i + CHUNK < b64.length ? 1 : 0;
    if (first) {
      process.stdout.write(`\x1b_Ga=T,f=100,m=${more};${chunk}\x1b\\`);
      first = false;
    } else {
      process.stdout.write(`\x1b_Gm=${more};${chunk}\x1b\\`);
    }
  }
  process.stdout.write("\n");
}