#!/usr/bin/env node
/// <reference types="node" />
import { extract, extractWithScroll } from "./extractor.js";
import { generate } from "./generator.js";
import type { Stack } from "./types.js";
import { main as startRepl } from "./repl.js";

async function main() {
  const [, , command, url, selector, ...rest] = process.argv;

  if (!command || command === "repl") {
    await startRepl();
    return;
  }

  // ── watch command ─────────────────────────────────────────────────────
  if (command === "watch") {
    if (!url) {
      console.error("Usage: cssgrab watch <url> [--stack react+tailwind] [--gif <path>]");
      process.exit(1);
    }

    const stackFlagIdx = rest.indexOf("--stack");
    const stack = (stackFlagIdx !== -1 ? rest[stackFlagIdx + 1] : "react+tailwind") as Stack;
    const gifFlagIdx = rest.indexOf("--gif");
    const gifPath = gifFlagIdx !== -1 ? rest[gifFlagIdx + 1] : undefined;

    const { watch } = await import("./watch.js");
    const { selector: pickedSelector, url: resolvedUrl, extractedData } = await watch(url);

    console.log(`\n  ✓ Grabbed selector: \x1b[35m${pickedSelector}\x1b[0m`);
    console.log(`\n🔍 Extracting...`);

    const data = extractedData
      ? { url: resolvedUrl, selector: pickedSelector, ...extractedData } as any
      : await extract(resolvedUrl, pickedSelector);
    console.log(`  ✓ Extracted <${data.tag}>.${data.classList.join(".")}`);
    console.log(`    ${Object.keys(data.computedStyles).length} props · ${data.keyframes.length} keyframes · ${data.webAnimations.length} web-animations`);

    // Render GIF if animations found or --gif flag passed
    const hasAnimation = data.webAnimations.length > 0 || data.keyframes.length > 0 ||
      data.computedStyles["animation-name"] !== "none" ||
      (data.computedStyles["transition-duration"] && data.computedStyles["transition-duration"] !== "0s");

    if (hasAnimation || gifPath) {
      const { renderGif } = await import("./gif.js");
      await renderGif(data, { outputPath: gifPath }).catch((err: Error) => {
        console.warn(`\n  ⚠ GIF preview skipped: ${err.message}`);
        if (err.message.includes("gifenc")) {
          console.warn(`    Run: npm i gifenc canvas\n`);
        }
      });
    } else {
      console.log(`\n  ℹ No animation detected — skipping GIF (use --gif <path> to force)`);
    }

    if (data.isCanvas) {
      const result = await generate(data, { stack });
      console.log(`\n⚠️  ${result.explanation}\n`);
      console.log(result.canvasNote);
      return;
    }

    console.log(`\n🤖 Generating ${stack} code...`);
    const result = await generate(data, { stack });
    console.log("\n--- CODE ---\n");
    console.log(result.code);
    console.log("\n--- EXPLANATION ---\n");
    console.log(result.explanation);
    return;
  }

  // ── deep-scan command ───────────────────────────────────────────────────
  if (command === "deep-scan") {
    if (!url) {
      console.error("Usage: cssgrab deep-scan <url> [--max <n>] [--depth <n>] [--output <file.json>]");
      process.exit(1);
    }

    const maxFlag    = rest.indexOf("--max");
    const depthFlag  = rest.indexOf("--depth");
    const outFlag    = rest.indexOf("--output");

    const maxPages   = maxFlag   !== -1 ? parseInt(rest[maxFlag + 1],   10) : 50;
    const maxDepth   = depthFlag !== -1 ? parseInt(rest[depthFlag + 1], 10) : 3;
    const outputFile = outFlag   !== -1 ? rest[outFlag + 1] : undefined;

    const { deepScan } = await import("./deep-scan.js");

    console.log(`\n🕷  Deep-scanning ${url}`);
    console.log(`   max depth: ${maxDepth} · max pages: ${maxPages}${outputFile ? ` · output: ${outputFile}` : ""}\n`);

    await deepScan(url, {
      maxDepth,
      maxPages,
      outputFile,

      onPageStart(pageUrl, depth, index) {
        process.stdout.write(`\n[${index}] ${"  ".repeat(depth - 1)}${pageUrl}\n`);
      },
      onKeyframe(kf) {
        process.stdout.write(`  ⟳ keyframe  ${kf.name}\n`);
      },
      onElement(el) {
        const tag = el.triggeredByScroll ? " [scroll]" : "";
        process.stdout.write(`  ◈ element   ${el.selector}${tag}\n`);
      },
      onGsap(call) {
        process.stdout.write(`  ↯ gsap.${call.method}()\n`);
      },
      onMutation(m) {
        process.stdout.write(`  ± mutation  <${m.tag}> +[${m.addedClasses.join(", ")}]\n`);
      },
      onPageDone(_pageUrl, stats) {
        process.stdout.write(
          `  ✓ done  ${stats.keyframes} kf · ${stats.animated} els · ${(stats.durationMs / 1000).toFixed(1)}s\n`
        );
      },
      onDone(result) {
        console.log(`\n${"─".repeat(60)}`);
        console.log(`✅ Deep-scan complete`);
        console.log(`   pages scanned    : ${result.pagesScanned}`);
        console.log(`   keyframes        : ${result.keyframes.length} unique`);
        console.log(`   animated els     : ${result.animatedElements.length}`);
        console.log(`   gsap calls       : ${result.gsapCalls.length}`);
        console.log(`   scroll-triggered : ${result.animatedElements.filter(e => e.triggeredByScroll).length}`);
        console.log(`   total time       : ${(result.totalDurationMs / 1000).toFixed(1)}s`);
        if (outputFile) console.log(`   saved to         : ${outputFile}`);
      },
    });

    return;
  }

  // ── scroll command ──────────────────────────────────────────────────────
  if (command === "scroll") {
    if (!url) {
      console.error("Usage: cssgrab scroll <url>");
      process.exit(1);
    }

    console.log(`\n🔍 Scrolling ${url} and capturing animations...`);
    const data = await extractWithScroll(url);

    console.log(`\n✅ Scroll-scan complete`);
    console.log(`   keyframes found: ${data.keyframes.length}`);
    console.log(`   elements that animated: ${data.animatedElements.length}`);
    console.log(`   gsap calls: ${data.gsapCalls.length}`);
    console.log(`   class mutations during scroll: ${data.mutationLog.filter((m: any) => m.isScrolling).length}`);

    if (data.keyframes.length > 0) {
      console.log(`\n── Keyframes ──`);
      for (const kf of data.keyframes.slice(0, 10)) {
        console.log(`\n@keyframes ${kf.name}`);
        console.log(kf.cssText.slice(0, 300));
      }
    }

    if (data.animatedElements.length > 0) {
      console.log(`\n── Animated Elements ──`);
      for (const el of data.animatedElements.slice(0, 15)) {
        const scrollTag = el.triggeredByScroll ? " [scroll-triggered]" : "";
        console.log(`  ${el.selector}${scrollTag}`);
      }
    }

    if (data.mutationLog.filter((m: any) => m.isScrolling).length > 0) {
      console.log(`\n── Scroll-triggered class changes ──`);
      for (const m of data.mutationLog.filter((m: any) => m.isScrolling).slice(0, 15)) {
        console.log(`  <${m.tag}> +[${m.addedClasses.join(", ")}] -[${m.removedClasses.join(", ")}]`);
      }
    }

    if (data.gsapCalls.length > 0) {
      console.log(`\n── GSAP calls ──`);
      for (const call of data.gsapCalls.slice(0, 10)) {
        console.log(`  gsap.${call.method}(...)`);
      }
    }

    return;
  }

  // ── grab command ──────────────────────────────────────────────────────
  if (command === "grab") {
    if (!url || !selector) {
      console.error("Usage: cssgrab grab <url> <selector> [--stack react+tailwind] [--gif <path>]");
      process.exit(1);
    }

    const stackFlagIdx = rest.indexOf("--stack");
    const stack = (stackFlagIdx !== -1 ? rest[stackFlagIdx + 1] : "react+tailwind") as Stack;
    const gifFlagIdx = rest.indexOf("--gif");
    const gifPath = gifFlagIdx !== -1 ? rest[gifFlagIdx + 1] : undefined;

    console.log(`\n🔍 Opening ${url} ...`);
    const data = await extract(url, selector);
    console.log(`✅ Extracted ${data.tag}.${data.classList.join(".")}`);
    console.log(`   computed properties: ${Object.keys(data.computedStyles).length}`);
    console.log(`   source CSS rules: ${data.sourceCSSRules.length}`);
    console.log(`   keyframes: ${data.keyframes.length}`);
    console.log(`   web animations: ${data.webAnimations.length}`);
    console.log(`   gsap calls intercepted: ${data.gsapCalls.length}`);
    console.log(`   is canvas: ${data.isCanvas}`);

    // Render GIF if --gif flag or animations detected
    if (gifPath || data.webAnimations.length > 0 || data.keyframes.length > 0) {
      const { renderGif } = await import("./gif.js");
      await renderGif(data, { outputPath: gifPath }).catch((err: Error) => {
        console.warn(`\n  ⚠ GIF preview skipped: ${err.message}`);
        if (err.message.includes("gifenc") || err.message.includes("canvas")) {
          console.warn(`    Run: npm i gifenc canvas\n`);
        }
      });
    }

    if (data.isCanvas) {
      const result = await generate(data, { stack });
      console.log(`\n⚠️  ${result.explanation}\n`);
      console.log(result.canvasNote);
      return;
    }

    console.log(`\n🤖 Generating ${stack} code (provider: ${process.env.LLM_PROVIDER || "ollama"}) ...`);
    const result = await generate(data, { stack });
    console.log("\n--- CODE ---\n");
    console.log(result.code);
    console.log("\n--- EXPLANATION ---\n");
    console.log(result.explanation);
    return;
  }

  // ── mcp command ───────────────────────────────────────────────────────
  if (command === "mcp") {
    await import("./mcp.js");
    return;
  }

  console.error(`Unknown command: ${command}. Use 'watch', 'grab', 'scroll', 'deep-scan', 'repl', or 'mcp'.`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});