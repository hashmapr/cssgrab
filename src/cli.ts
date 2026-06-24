#!/usr/bin/env node
/// <reference types="node" />
import { extract, extractWithScroll } from "./extractor.js";
import { generate } from "./generator.js";
import type { Stack } from "./types.js";

async function main() {
  const [, , command, url, selector, ...rest] = process.argv;

  if (!command || !url) {
    console.log(`
CSSgrab — grab any element's CSS/animation as code

Commands:
  grab <url> <selector> [--stack react+tailwind]
    Extract styles from a specific element

  scroll <url>
    Scroll the full page and capture all animations that fire

Examples:
  npx tsx src/cli.ts grab https://stripe.com ".btn-primary" --stack react+tailwind
  npx tsx src/cli.ts scroll https://framer.com
`);
    process.exit(0);
  }

  // ── scroll command ──────────────────────────────────────────────────────
  if (command === "scroll") {
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
    if (!selector) {
      console.error("Usage: cssgrab grab <url> <selector> [--stack react+tailwind]");
      process.exit(1);
    }

    const stackFlagIdx = rest.indexOf("--stack");
    const stack = (stackFlagIdx !== -1 ? rest[stackFlagIdx + 1] : "react+tailwind") as Stack;

    console.log(`\n🔍 Opening ${url} ...`);
    const data = await extract(url, selector);
    console.log(`✅ Extracted ${data.tag}.${data.classList.join(".")}`);
    console.log(`   computed properties: ${Object.keys(data.computedStyles).length}`);
    console.log(`   source CSS rules: ${data.sourceCSSRules.length}`);
    console.log(`   keyframes: ${data.keyframes.length}`);
    console.log(`   web animations: ${data.webAnimations.length}`);
    console.log(`   gsap calls intercepted: ${data.gsapCalls.length}`);
    console.log(`   is canvas: ${data.isCanvas}`);

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

  console.error(`Unknown command: ${command}. Use 'grab' or 'scroll'.`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});