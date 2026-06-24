#!/usr/bin/env node
/// <reference types="node" />
import * as readline from "readline";
import { extract } from "./extractor.js";
import { generate } from "./generator.js";
import { scan } from "./scanner.js";
const session = {
    url: null,
    stack: "react+tailwind",
    lastScan: [],
};
// ── colours ────────────────────────────────────────────────────────────────
const c = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
};
function paint(color, text) {
    return `${c[color]}${text}${c.reset}`;
}
// ── spinner ────────────────────────────────────────────────────────────────
function spinner(label) {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let i = 0;
    const id = setInterval(() => {
        process.stdout.write(`\r  ${paint("cyan", frames[i % frames.length])} ${paint("dim", label)}`);
        i++;
    }, 80);
    return () => {
        clearInterval(id);
        process.stdout.write("\r" + " ".repeat(label.length + 6) + "\r");
    };
}
// ── prompt ─────────────────────────────────────────────────────────────────
function makePrompt() {
    const url = session.url
        ? paint("cyan", new URL(session.url).hostname)
        : paint("dim", "no url");
    const stack = paint("dim", session.stack);
    return `${url} ${paint("dim", "·")} ${stack}\n${paint("green", "›")} `;
}
// ── helpers ────────────────────────────────────────────────────────────────
function normaliseUrl(raw) {
    if (!raw.startsWith("http"))
        return `https://${raw}`;
    return raw;
}
function resolveSelector(arg) {
    const idx = parseInt(arg, 10);
    if (!isNaN(idx)) {
        const candidate = session.lastScan[idx - 1];
        if (!candidate) {
            console.log(paint("red", `  No element #${idx} in last scan. Run 'scan' first.`));
            return null;
        }
        return candidate.selector;
    }
    return arg;
}
function printScanResults(candidates) {
    if (!candidates.length) {
        console.log(paint("yellow", "  No interactive elements found."));
        return;
    }
    console.log();
    candidates.forEach((el, i) => {
        const num = paint("dim", `  ${String(i + 1).padStart(2)}.`);
        const role = paint("cyan", el.role.padEnd(6));
        const text = paint("bold", el.text.slice(0, 40).padEnd(42));
        const anim = el.hasTransition ? paint("magenta", "⚡ transition") : "";
        const kf = el.hasAnimation ? paint("blue", " ⟳ animation") : "";
        console.log(`${num} ${role} ${text} ${anim}${kf}`);
        console.log(paint("dim", `       ${el.selector}`));
    });
    console.log();
}
function printHelp() {
    const row = (cmd, desc) => `  ${paint("cyan", cmd.padEnd(30))} ${paint("dim", desc)}`;
    console.log(`
${paint("bold", "CSSgrab interactive REPL")}

${paint("yellow", "URL")}
${row("use <url>", "set active URL  (e.g. use stripe.com)")}

${paint("yellow", "SCAN")}
${row("scan", "list interactive elements on active URL")}
${row("scan <url>", "scan a different URL (also sets it as active)")}

${paint("yellow", "GRAB")}
${row("grab <n>", "grab element #n from last scan")}
${row("grab <selector>", "grab by CSS selector")}
${row("grab <selector> <url>", "grab from a specific URL")}

${paint("yellow", "SCROLL")}
${row("scroll", "scroll-scan active URL, capture all animations")}
${row("scroll <url>", "scroll-scan a specific URL")}

${paint("yellow", "SETTINGS")}
${row("stack <name>", "set output stack")}
${row("", "  react+tailwind · vue+css · html+css · next+tailwind")}
${row("url", "show active URL")}

${paint("yellow", "OTHER")}
${row("help", "show this message")}
${row("exit / quit / ctrl+c", "exit")}
`);
}
// ── command handlers ───────────────────────────────────────────────────────
async function cmdUse(args) {
    if (!args.length) {
        console.log(paint("red", "  Usage: use <url>"));
        return;
    }
    session.url = normaliseUrl(args[0]);
    console.log(paint("green", `  ✓ Active URL set to ${session.url}`));
}
async function cmdScan(args) {
    if (args.length)
        session.url = normaliseUrl(args[0]);
    if (!session.url) {
        console.log(paint("red", "  No URL set. Run: use <url>"));
        return;
    }
    const stop = spinner(`Scanning ${session.url} ...`);
    try {
        session.lastScan = await scan(session.url);
        stop();
        printScanResults(session.lastScan);
        console.log(paint("dim", `  ${session.lastScan.length} elements found. Use 'grab <n>' to extract one.`));
    }
    catch (err) {
        stop();
        console.log(paint("red", `  Scan failed: ${err.message}`));
    }
}
async function cmdGrab(args) {
    if (!args.length) {
        console.log(paint("red", "  Usage: grab <n|selector> [url]"));
        return;
    }
    if (args[1])
        session.url = normaliseUrl(args[1]);
    if (!session.url) {
        console.log(paint("red", "  No URL set. Run: use <url>"));
        return;
    }
    const selector = resolveSelector(args[0]);
    if (!selector)
        return;
    // Stage 1 — browser
    let stop = spinner(`Opening ${new URL(session.url).hostname} ...`);
    let data;
    try {
        data = await extract(session.url, selector);
        stop();
    }
    catch (err) {
        stop();
        console.log(paint("red", `  Grab failed: ${err.message}`));
        return;
    }
    // Stage 2 — element found
    console.log(`  ${paint("green", "✓")} ${paint("bold", `<${data.tag}>`)} ` +
        `${paint("dim", data.classList.join(" "))} ` +
        `${paint("dim", `· ${Object.keys(data.computedStyles).length} props`)}`);
    if (data.isCanvas) {
        console.log(paint("yellow", "\n  ⚠ Canvas element — no CSS to extract."));
        console.log(paint("dim", "  Use frame sequences + canvas.drawImage() driven by scroll position.\n"));
        return;
    }
    // Stage 3 — LLM streaming
    console.log(`  ${paint("dim", `Generating ${session.stack} component ...`)}\n`);
    console.log(paint("bold", "── CODE ──────────────────────────────────────────────────────"));
    let streamedCode = false;
    let fullOutput = "";
    try {
        const result = await generate(data, { stack: session.stack }, (token) => {
            streamedCode = true;
            process.stdout.write(token);
            fullOutput += token;
        });
        // If streaming didn't fire (non-streaming provider), print now
        if (!streamedCode) {
            process.stdout.write(result.code);
        }
        // Print explanation (split from streamed output if needed)
        const explanation = result.explanation ||
            splitExplanation(fullOutput);
        console.log("\n" + paint("bold", "\n── EXPLANATION ───────────────────────────────────────────────"));
        console.log(explanation);
        console.log(paint("bold", "──────────────────────────────────────────────────────────────\n"));
    }
    catch (err) {
        console.log("\n" + paint("red", `  Generation failed: ${err.message}`));
    }
}
function splitExplanation(raw) {
    const marker = "---EXPLANATION---";
    const idx = raw.indexOf(marker);
    if (idx === -1)
        return "";
    return raw.slice(idx + marker.length).trim();
}
async function cmdScroll(args) {
    if (args.length)
        session.url = normaliseUrl(args[0]);
    if (!session.url) {
        console.log(paint("red", "  No URL set. Run: use <url>"));
        return;
    }
    const stop = spinner(`Scroll-scanning ${new URL(session.url).hostname} ...`);
    try {
        const { extractWithScroll } = await import("./extractor.js");
        const data = await extractWithScroll(session.url);
        stop();
        console.log(paint("green", `  ✓ Scroll-scan complete`));
        console.log(`  ${paint("cyan", String(data.keyframes.length).padStart(4))} keyframes`);
        console.log(`  ${paint("cyan", String(data.animatedElements.length).padStart(4))} animated elements`);
        console.log(`  ${paint("cyan", String(data.gsapCalls.length).padStart(4))} GSAP calls`);
        console.log(`  ${paint("cyan", String(data.mutationLog.filter((m) => m.isScrolling).length).padStart(4))} scroll-triggered class mutations\n`);
        if (data.animatedElements.length) {
            console.log(paint("bold", "  Animated elements:"));
            data.animatedElements.slice(0, 20).forEach((el) => {
                const tag = el.triggeredByScroll
                    ? paint("magenta", "  [scroll] ")
                    : paint("dim", "  [page]   ");
                console.log(`${tag}${el.selector}`);
            });
            console.log(paint("dim", "\n  Use 'grab <selector>' to extract any of these.\n"));
        }
    }
    catch (err) {
        stop();
        console.log(paint("red", `  Scroll-scan failed: ${err.message}`));
    }
}
function cmdStack(args) {
    const valid = ["react+tailwind", "vue+css", "html+css", "next+tailwind"];
    if (!args.length || !valid.includes(args[0])) {
        console.log(paint("yellow", `  Valid stacks: ${valid.join(" · ")}`));
        return;
    }
    session.stack = args[0];
    console.log(paint("green", `  ✓ Stack set to ${session.stack}`));
}
// ── dispatch ───────────────────────────────────────────────────────────────
async function dispatch(line) {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    switch (cmd) {
        case "use":
            await cmdUse(args);
            break;
        case "scan":
            await cmdScan(args);
            break;
        case "grab":
            await cmdGrab(args);
            break;
        case "scroll":
            await cmdScroll(args);
            break;
        case "stack":
            cmdStack(args);
            break;
        case "url":
            console.log(session.url
                ? paint("cyan", `  ${session.url}`)
                : paint("dim", "  No URL set."));
            break;
        case "help":
            printHelp();
            break;
        case "exit":
        case "quit":
            console.log(paint("dim", "\n  bye\n"));
            process.exit(0);
        case "": break;
        default:
            console.log(paint("red", `  Unknown command: ${cmd}. Type 'help' for usage.`));
    }
}
// ── main ───────────────────────────────────────────────────────────────────
export async function main() {
    console.log(`
${paint("bold", "CSSgrab")} ${paint("dim", "v0.1.6")}
${paint("dim", "Type 'help' to see commands. ctrl+c to exit.")}
`);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        historySize: 100,
    });
    const ask = () => {
        rl.question(makePrompt(), async (line) => {
            await dispatch(line);
            ask();
        });
    };
    rl.on("close", () => {
        console.log(paint("dim", "\n  bye\n"));
        process.exit(0);
    });
    ask();
}
