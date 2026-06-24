import { chromium } from "playwright";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
/**
 * Render the extracted element's animation as a GIF.
 * Captures frames via Playwright screenshots, encodes with gifenc (pure JS, no native deps).
 * Outputs inline to terminal via iTerm2 / Kitty / Sixel protocol if supported.
 */
export async function renderGif(data, opts = {}) {
    const fps = opts.fps ?? 24;
    const scale = opts.scale ?? 2;
    // Determine capture duration from animation data
    let animDurationMs = 1000;
    if (data.webAnimations.length > 0) {
        const d = data.webAnimations[0].duration;
        if (typeof d === "number" && d > 0)
            animDurationMs = d;
    }
    const durationMs = opts.durationMs ?? Math.min(Math.max(animDurationMs * 2, 1000), 5000);
    const frameCount = Math.round((durationMs / 1000) * fps);
    const frameDelay = Math.round(1000 / fps);
    console.log(`\n🎞  Capturing ${frameCount} frames @ ${fps}fps (${(durationMs / 1000).toFixed(1)}s)...`);
    let browser;
    const frames = [];
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: USER_AGENT,
            deviceScaleFactor: scale,
        });
        const page = await context.newPage();
        await page.goto(data.url, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(300);
        // Scroll element into view
        await page.evaluate((sel) => {
            document.querySelector(sel)?.scrollIntoView({ block: "center" });
        }, data.selector);
        await page.waitForTimeout(100);
        // Hover to trigger hover animations
        await page.hover(data.selector).catch(() => { });
        // Get bounding box for cropped screenshots
        const box = await page.locator(data.selector).boundingBox().catch(() => null);
        const pad = 16; // px padding around element
        for (let i = 0; i < frameCount; i++) {
            const t = i / (frameCount - 1); // 0..1
            // For CSS transitions/animations: advance time via requestAnimationFrame trick
            await page.evaluate((_t) => {
                // Force any CSS animation to a specific playback position
                document.getAnimations().forEach(a => {
                    try {
                        if (a.playState !== "running")
                            a.play();
                    }
                    catch { /* some animations don't allow seeking */ }
                });
            }, t);
            let screenshot;
            if (box) {
                screenshot = await page.screenshot({
                    clip: {
                        x: Math.max(0, box.x - pad),
                        y: Math.max(0, box.y - pad),
                        width: box.width + pad * 2,
                        height: box.height + pad * 2,
                    },
                    type: "png",
                });
            }
            else {
                screenshot = await page.screenshot({ type: "png" });
            }
            frames.push(screenshot);
            if (i < frameCount - 1) {
                await page.waitForTimeout(frameDelay);
            }
        }
    }
    finally {
        await browser?.close().catch(() => { });
    }
    if (frames.length === 0)
        return null;
    console.log(`  ✓ ${frames.length} frames captured`);
    // Encode GIF using gifenc (pure JS)
    let gifBuffer = null;
    try {
        gifBuffer = await encodeGif(frames, frameDelay, scale);
        console.log(`  ✓ GIF encoded (${(gifBuffer.length / 1024).toFixed(1)} KB)`);
    }
    catch (err) {
        console.warn(`  ⚠ GIF encoding failed: ${err.message}`);
        console.warn(`    Install gifenc: npm i gifenc`);
    }
    // Save to file if requested
    if (gifBuffer && opts.outputPath) {
        const { writeFileSync } = await import("fs");
        writeFileSync(opts.outputPath, gifBuffer);
        console.log(`  ✓ Saved → ${opts.outputPath}`);
    }
    // Inline terminal preview
    if (gifBuffer) {
        displayInlineGif(gifBuffer);
    }
    else {
        // Fallback: show first frame as PNG inline
        displayInlinePng(frames[0]);
    }
    return opts.outputPath ?? null;
}
/**
 * Encode PNG frame buffers to an animated GIF.
 * Uses gifenc if available, otherwise throws so caller can fallback.
 */
async function encodeGif(frames, frameDelayMs, scale) {
    // Dynamic import — gifenc is optional
    let gifenc;
    try {
        gifenc = await import("gifenc");
    }
    catch {
        throw new Error("gifenc not installed");
    }
    const { GIFEncoder, quantize, applyPalette } = gifenc;
    // Decode first frame to get dimensions
    const { createCanvas, loadImage } = await importCanvas();
    const firstImg = await loadImage(frames[0]);
    const w = firstImg.width;
    const h = firstImg.height;
    const encoder = GIFEncoder();
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    // Centiseconds delay (GIF spec)
    const delayCs = Math.round(frameDelayMs / 10);
    for (const frameBuf of frames) {
        const img = await loadImage(frameBuf);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, w, h);
        const { data } = imageData;
        const palette = quantize(data, 256);
        const indexed = applyPalette(data, palette);
        encoder.writeFrame(indexed, w, h, { palette, delay: delayCs });
    }
    encoder.finish();
    return Buffer.from(encoder.bytes());
}
/**
 * Try to import canvas — supports both 'canvas' and '@napi-rs/canvas'.
 */
async function importCanvas() {
    try {
        const mod = await import("canvas");
        return { createCanvas: mod.createCanvas, loadImage: mod.loadImage };
    }
    catch { /* try next */ }
    try {
        const mod = await import("@napi-rs/canvas");
        return { createCanvas: mod.createCanvas, loadImage: mod.loadImage };
    }
    catch { /* try next */ }
    throw new Error("No canvas implementation found. Install 'canvas' or '@napi-rs/canvas'.");
}
/**
 * Display a GIF inline using the best available terminal protocol.
 */
function displayInlineGif(gifBuffer) {
    const protocol = detectTerminalProtocol();
    switch (protocol) {
        case "iterm2":
            displayIterm2(gifBuffer, "animation.gif");
            break;
        case "kitty":
            displayKitty(gifBuffer);
            break;
        case "sixel":
            console.log("  ℹ Sixel protocol detected but GIF preview requires sixel encoder — save to file with --gif <path>");
            break;
        default:
            console.log("  ℹ Your terminal doesn't support inline images.");
            console.log("    Use --gif <path> to save the GIF file, or use iTerm2/Kitty for inline preview.");
    }
}
function displayInlinePng(pngBuffer) {
    const protocol = detectTerminalProtocol();
    if (protocol === "iterm2") {
        displayIterm2(pngBuffer, "preview.png");
    }
    else if (protocol === "kitty") {
        displayKitty(pngBuffer);
    }
    else {
        console.log("  ℹ First frame captured but terminal doesn't support inline images.");
    }
}
function detectTerminalProtocol() {
    const term = process.env.TERM_PROGRAM ?? "";
    const termEnv = process.env.TERM ?? "";
    const kittyWindow = process.env.KITTY_WINDOW_ID;
    if (term === "iTerm.app" || term.toLowerCase().includes("iterm"))
        return "iterm2";
    if (kittyWindow !== undefined || termEnv === "xterm-kitty")
        return "kitty";
    if (termEnv.includes("sixel") || process.env.COLORTERM === "truecolor")
        return "sixel";
    return "none";
}
/**
 * iTerm2 inline image protocol.
 * https://iterm2.com/documentation-images.html
 */
function displayIterm2(buffer, name) {
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
/**
 * Kitty graphics protocol (chunked base64 transfer).
 * https://sw.kovidgoyal.net/kitty/graphics-protocol/
 */
function displayKitty(buffer) {
    const b64 = buffer.toString("base64");
    const CHUNK = 4096;
    let first = true;
    for (let i = 0; i < b64.length; i += CHUNK) {
        const chunk = b64.slice(i, i + CHUNK);
        const more = i + CHUNK < b64.length ? 1 : 0;
        if (first) {
            // a=T: transmit and display, f=100: PNG/GIF format auto-detect, m=more
            process.stdout.write(`\x1b_Ga=T,f=100,m=${more};${chunk}\x1b\\`);
            first = false;
        }
        else {
            process.stdout.write(`\x1b_Gm=${more};${chunk}\x1b\\`);
        }
    }
    process.stdout.write("\n");
}
