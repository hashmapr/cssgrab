#!/usr/bin/env node
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/// <reference types="node" />
import { useState, useEffect, useRef } from "react";
import { render, Box, Text, useInput, useApp, Static } from "ink";
import { extract } from "./extractor.js";
import { generate } from "./generator.js";
import { scan } from "./scanner.js";
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// ── Welcome ────────────────────────────────────────────────────────────────
function Welcome() {
    return (_jsxs(Box, { flexDirection: "column", alignItems: "center", marginBottom: 1, children: [_jsxs(Box, { borderStyle: "round", borderColor: "cyan", paddingX: 4, paddingY: 1, flexDirection: "row", gap: 4, children: [_jsxs(Box, { flexDirection: "column", alignItems: "center", minWidth: 28, children: [_jsx(Text, { color: "cyan", bold: true, children: "  ╔═══╗ ╔═══╗ ╔═══╗  " }), _jsxs(Text, { color: "cyan", children: ["  ", "║ C ║ ║ S ║ ║ S ║  "] }), _jsx(Text, { color: "cyan", children: "  ╚═══╝ ╚═══╝ ╚═══╝  " }), _jsx(Text, { children: " " }), _jsx(Text, { bold: true, color: "white", children: "CSSgrab" }), _jsx(Text, { color: "gray", dimColor: true, children: "v0.1.10" }), _jsx(Text, { children: " " }), _jsx(Text, { color: "gray", dimColor: true, children: "Grab any element's CSS" }), _jsx(Text, { color: "gray", dimColor: true, children: "and animations as code" })] }), _jsx(Box, { flexDirection: "column", children: Array.from({ length: 10 }).map((_, i) => (_jsx(Text, { color: "gray", dimColor: true, children: "\u2502" }, i))) }), _jsxs(Box, { flexDirection: "column", minWidth: 36, children: [_jsx(Text, { color: "yellow", bold: true, children: "Getting started" }), _jsx(Text, { children: " " }), _jsxs(Text, { color: "gray", children: ["  ", _jsx(Text, { color: "cyan", children: "use" }), " stripe.com"] }), _jsx(Text, { color: "gray", dimColor: true, children: "  set active URL" }), _jsx(Text, { children: " " }), _jsxs(Text, { color: "gray", children: ["  ", _jsx(Text, { color: "cyan", children: "grab" }), " \"purple CTA button\""] }), _jsx(Text, { color: "gray", dimColor: true, children: "  natural language grab" }), _jsx(Text, { children: " " }), _jsxs(Text, { color: "gray", children: ["  ", _jsx(Text, { color: "cyan", children: "watch" }), " framer.com"] }), _jsx(Text, { color: "gray", dimColor: true, children: "  click-to-pick \u00B7 Tab for anim mode" })] })] }), _jsxs(Text, { color: "gray", dimColor: true, children: ["Type ", _jsx(Text, { color: "white", children: "help" }), " for all commands \u00B7 ctrl+c to exit"] })] }));
}
// ── Prompt ─────────────────────────────────────────────────────────────────
function Prompt({ session, input }) {
    const host = session.url ? new URL(session.url).hostname : null;
    return (_jsxs(Box, { children: [host ? _jsx(Text, { color: "cyan", bold: true, children: host }) : _jsx(Text, { color: "gray", dimColor: true, children: "no url" }), _jsx(Text, { color: "gray", dimColor: true, children: " \u00B7 " }), _jsx(Text, { color: "gray", dimColor: true, children: session.stack }), _jsx(Text, { children: "\n" }), _jsx(Text, { color: "green", bold: true, children: "\u203A " }), _jsx(Text, { children: input }), _jsx(Text, { color: "green", children: "\u258C" })] }));
}
// ── Thinking ───────────────────────────────────────────────────────────────
function Thinking({ label, elapsed }) {
    const [frame, setFrame] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setFrame(f => (f + 1) % SPINNER.length), 80);
        return () => clearInterval(id);
    }, []);
    const secs = (elapsed / 1000).toFixed(1);
    return (_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: "cyan", children: SPINNER[frame] }), _jsx(Text, { color: "gray", dimColor: true, children: label }), _jsx(Text, { color: "gray", dimColor: true, children: "\u00B7" }), _jsxs(Text, { color: "yellow", children: [secs, "s"] })] }));
}
// ── Scan results ───────────────────────────────────────────────────────────
function ScanResults({ candidates }) {
    if (!candidates.length)
        return _jsx(Text, { color: "yellow", children: "  No interactive elements found." });
    return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsx(Box, { flexDirection: "column", borderStyle: "round", borderColor: "gray", paddingX: 1, children: candidates.map((el, i) => (_jsxs(Box, { flexDirection: "column", marginBottom: i < candidates.length - 1 ? 1 : 0, children: [_jsxs(Box, { gap: 2, children: [_jsxs(Text, { color: "gray", dimColor: true, children: [String(i + 1).padStart(2), "."] }), _jsx(Text, { color: el.role === "button" ? "magenta" : "cyan", bold: true, children: el.role.padEnd(6) }), _jsx(Text, { bold: true, children: el.text.slice(0, 38) }), el.hasTransition && _jsx(Text, { color: "magenta", children: "\u26A1" }), el.hasAnimation && _jsx(Text, { color: "blue", children: "\u27F3" })] }), _jsx(Box, { children: _jsxs(Text, { color: "gray", dimColor: true, children: ["     ", el.selector.slice(0, 60), el.selector.length > 60 ? "…" : ""] }) })] }, i))) }), _jsxs(Text, { color: "gray", dimColor: true, children: ["  ", candidates.length, " elements \u00B7 grab <n> to extract"] })] }));
}
// ── Grab result ────────────────────────────────────────────────────────────
function GrabResult({ code, explanation, mode }) {
    return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Box, { borderStyle: "round", borderColor: mode === 'animation' ? "magenta" : "cyan", flexDirection: "column", paddingX: 1, children: [_jsx(Text, { color: mode === 'animation' ? "magenta" : "cyan", bold: true, children: mode === 'animation' ? '◎ ANIMATION' : 'CODE' }), _jsx(Text, { children: " " }), _jsx(Text, { children: code })] }), explanation ? (_jsxs(Box, { borderStyle: "round", borderColor: "gray", flexDirection: "column", paddingX: 1, marginTop: 1, children: [_jsx(Text, { color: "gray", bold: true, children: "EXPLANATION" }), _jsx(Text, { children: " " }), _jsx(Text, { color: "gray", children: explanation })] })) : null] }));
}
// ── Streaming ──────────────────────────────────────────────────────────────
function StreamingCode({ tokens, elapsed }) {
    const secs = (elapsed / 1000).toFixed(1);
    const markerIdx = tokens.indexOf("---EXPLANATION---");
    const visible = markerIdx !== -1 ? tokens.slice(0, markerIdx) : tokens;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { gap: 1, marginBottom: 1, children: [_jsx(Text, { color: "cyan", bold: true, children: "\u2500\u2500 CODE" }), _jsx(Text, { color: "gray", dimColor: true, children: "streaming" }), _jsxs(Text, { color: "yellow", children: [secs, "s"] })] }), _jsx(Text, { children: visible }), _jsx(Text, { color: "green", children: "\u258C" })] }));
}
// ── Scroll results ─────────────────────────────────────────────────────────
function ScrollResults({ summary }) {
    return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Box, { borderStyle: "round", borderColor: "cyan", flexDirection: "column", paddingX: 1, paddingY: 0, children: [_jsx(Text, { color: "cyan", bold: true, children: "Scroll-scan complete" }), _jsx(Text, { children: " " }), _jsxs(Box, { gap: 3, children: [_jsxs(Box, { flexDirection: "column", alignItems: "center", children: [_jsx(Text, { color: "cyan", bold: true, children: summary.keyframes }), _jsx(Text, { color: "gray", dimColor: true, children: "keyframes" })] }), _jsxs(Box, { flexDirection: "column", alignItems: "center", children: [_jsx(Text, { color: "cyan", bold: true, children: summary.animated }), _jsx(Text, { color: "gray", dimColor: true, children: "animated" })] }), _jsxs(Box, { flexDirection: "column", alignItems: "center", children: [_jsx(Text, { color: "cyan", bold: true, children: summary.gsap }), _jsx(Text, { color: "gray", dimColor: true, children: "gsap calls" })] }), _jsxs(Box, { flexDirection: "column", alignItems: "center", children: [_jsx(Text, { color: "magenta", bold: true, children: summary.scrollTriggered }), _jsx(Text, { color: "gray", dimColor: true, children: "scroll-triggered" })] })] }), summary.elements.length > 0 && (_jsxs(_Fragment, { children: [_jsx(Text, { children: " " }), _jsx(Text, { color: "gray", dimColor: true, bold: true, children: "Animated elements:" }), summary.elements.slice(0, 15).map((el, i) => (_jsxs(Box, { gap: 1, children: [_jsx(Text, { color: el.triggeredByScroll ? "magenta" : "gray", dimColor: true, children: el.triggeredByScroll ? "[scroll]" : "[page]  " }), _jsx(Text, { color: "gray", dimColor: true, children: el.selector.slice(0, 55) })] }, i)))] }))] }), _jsx(Text, { color: "gray", dimColor: true, children: "  grab <selector> to extract any element" })] }));
}
// ── Help ───────────────────────────────────────────────────────────────────
function Help() {
    const row = (cmd, desc) => (_jsxs(Box, { gap: 2, children: [_jsx(Text, { color: "cyan", children: cmd.padEnd(32) }), _jsx(Text, { color: "gray", dimColor: true, children: desc })] }, cmd));
    return (_jsxs(Box, { borderStyle: "round", borderColor: "gray", flexDirection: "column", paddingX: 1, marginBottom: 1, children: [_jsx(Text, { color: "yellow", bold: true, children: "URL" }), row("use <url>", "set active URL"), _jsx(Text, { children: " " }), _jsx(Text, { color: "yellow", bold: true, children: "SCAN" }), row("scan", "list interactive elements"), row("scan <url>", "scan a different URL"), _jsx(Text, { children: " " }), _jsx(Text, { color: "yellow", bold: true, children: "GRAB" }), row("grab <n>", "grab by index from last scan"), row('grab "description"', "grab by natural language"), row("grab <selector>", "grab by CSS selector"), _jsx(Text, { children: " " }), _jsx(Text, { color: "yellow", bold: true, children: "WATCH" }), row("watch", "open browser · ⇧+click to select"), row("watch <url>", "watch a specific URL"), row("", "Tab = toggle Element/Animation mode"), _jsx(Text, { children: " " }), _jsx(Text, { color: "yellow", bold: true, children: "SCROLL" }), row("scroll", "scroll-scan active URL"), row("scroll <url>", "scroll-scan specific URL"), _jsx(Text, { children: " " }), _jsx(Text, { color: "yellow", bold: true, children: "SETTINGS" }), row("stack <name>", "react+tailwind · vue+css · html+css · next+tailwind"), row("url", "show active URL"), _jsx(Text, { children: " " }), _jsx(Text, { color: "yellow", bold: true, children: "OTHER" }), row("help", "show this message"), row("exit / quit / ctrl+c", "exit")] }));
}
// ── Main App ───────────────────────────────────────────────────────────────
function App() {
    const { exit } = useApp();
    const [input, setInput] = useState("");
    const [phase, setPhase] = useState({ kind: "idle" });
    const [history, setHistory] = useState([_jsx(Welcome, {}, "welcome")]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [cmdHistory, setCmdHistory] = useState([]);
    const elapsedRef = useRef(null);
    const [elapsed, setElapsed] = useState(0);
    const session = useRef({
        url: null,
        stack: "react+tailwind",
        lastScan: [],
    });
    function startTimer() {
        setElapsed(0);
        if (elapsedRef.current)
            clearInterval(elapsedRef.current);
        elapsedRef.current = setInterval(() => setElapsed(e => e + 100), 100);
    }
    function stopTimer() {
        if (elapsedRef.current) {
            clearInterval(elapsedRef.current);
            elapsedRef.current = null;
        }
    }
    function pushHistory(node) {
        setHistory(h => [...h, node]);
    }
    function normaliseUrl(raw) {
        if (!raw.startsWith("http"))
            return `https://${raw}`;
        return raw;
    }
    function resolveSelector(arg) {
        const idx = parseInt(arg, 10);
        if (!isNaN(idx)) {
            const candidate = session.current.lastScan[idx - 1];
            if (!candidate)
                return null;
            return candidate.selector;
        }
        return arg;
    }
    async function runCommand(line) {
        const parts = line.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
        const cmd = parts[0]?.toLowerCase() ?? "";
        const args = parts.slice(1).map(a => a.replace(/^["']|["']$/g, ""));
        setCmdHistory(h => [line, ...h]);
        setHistoryIndex(-1);
        switch (cmd) {
            case "use": {
                if (!args.length) {
                    pushHistory(_jsx(Text, { color: "red", children: "  Usage: use <url>" }, Date.now()));
                    break;
                }
                session.current.url = normaliseUrl(args[0]);
                pushHistory(_jsxs(Text, { color: "green", children: ["  \u2713 Active URL \u2192 ", session.current.url] }, Date.now()));
                break;
            }
            case "scan": {
                if (args.length)
                    session.current.url = normaliseUrl(args[0]);
                if (!session.current.url) {
                    pushHistory(_jsx(Text, { color: "red", children: "  No URL set. Run: use <url>" }, Date.now()));
                    break;
                }
                startTimer();
                setPhase({ kind: "scanning", url: session.current.url, elapsed: 0 });
                try {
                    const candidates = await scan(session.current.url);
                    session.current.lastScan = candidates;
                    stopTimer();
                    setPhase({ kind: "idle" });
                    pushHistory(_jsx(ScanResults, { candidates: candidates }, Date.now()));
                }
                catch (err) {
                    stopTimer();
                    setPhase({ kind: "idle" });
                    pushHistory(_jsxs(Text, { color: "red", children: ["  Scan failed: ", err.message] }, Date.now()));
                }
                break;
            }
            case "grab": {
                if (!args.length) {
                    pushHistory(_jsx(Text, { color: "red", children: "  Usage: grab <n|selector|\"description\"> [url]" }, Date.now()));
                    break;
                }
                if (args[1])
                    session.current.url = normaliseUrl(args[1]);
                if (!session.current.url) {
                    pushHistory(_jsx(Text, { color: "red", children: "  No URL set. Run: use <url>" }, Date.now()));
                    break;
                }
                const rawArg = args[0];
                const isIndex = !isNaN(parseInt(rawArg, 10));
                const isCSSSelector = /[.#\[\]>:()]/.test(rawArg);
                const isNaturalLanguage = !isIndex && !isCSSSelector;
                let selector = null;
                if (isIndex) {
                    selector = resolveSelector(rawArg);
                    if (!selector) {
                        pushHistory(_jsxs(Text, { color: "red", children: ["  No element #", rawArg, " in last scan."] }, Date.now()));
                        break;
                    }
                }
                else if (isCSSSelector) {
                    selector = rawArg;
                }
                else if (isNaturalLanguage) {
                    startTimer();
                    setPhase({ kind: "scanning", url: session.current.url, elapsed: 0 });
                    pushHistory(_jsxs(Text, { color: "cyan", children: ["  \uD83D\uDD0D Scanning for \"", rawArg, "\"..."] }, Date.now()));
                    try {
                        const { scan: scanFn } = await import("./scanner.js");
                        const { matchElement } = await import("./matcher.js");
                        const candidates = await scanFn(session.current.url);
                        session.current.lastScan = candidates;
                        stopTimer();
                        setPhase({ kind: "idle" });
                        selector = await matchElement(rawArg, candidates);
                        if (!selector) {
                            pushHistory(_jsxs(Text, { color: "red", children: ["  No element found matching \"", rawArg, "\""] }, Date.now()));
                            break;
                        }
                        pushHistory(_jsxs(Text, { color: "green", children: ["  \u2713 Matched: ", _jsx(Text, { color: "magenta", children: selector })] }, Date.now()));
                    }
                    catch (err) {
                        stopTimer();
                        setPhase({ kind: "idle" });
                        pushHistory(_jsxs(Text, { color: "red", children: ["  Scan failed: ", err.message] }, Date.now()));
                        break;
                    }
                }
                if (!selector)
                    break;
                startTimer();
                setPhase({ kind: "extracting", selector, elapsed: 0 });
                let data;
                try {
                    data = await extract(session.current.url, selector);
                }
                catch (err) {
                    stopTimer();
                    setPhase({ kind: "idle" });
                    pushHistory(_jsxs(Text, { color: "red", children: ["  Extract failed: ", err.message] }, Date.now()));
                    break;
                }
                if (data.isCanvas) {
                    stopTimer();
                    setPhase({ kind: "idle" });
                    pushHistory(_jsx(Text, { color: "yellow", children: "  \u26A0 Canvas element \u2014 no CSS to extract." }, Date.now()));
                    break;
                }
                startTimer();
                let streamedTokens = "";
                setPhase({ kind: "generating", tag: data.tag, elapsed: 0, tokens: "" });
                try {
                    const result = await generate(data, { stack: session.current.stack }, (token) => {
                        streamedTokens += token;
                        setPhase({ kind: "generating", tag: data.tag, elapsed, tokens: streamedTokens });
                    });
                    stopTimer();
                    setPhase({ kind: "idle" });
                    pushHistory(_jsx(GrabResult, { code: result.code, explanation: result.explanation }, Date.now()));
                }
                catch (err) {
                    stopTimer();
                    setPhase({ kind: "idle" });
                    pushHistory(_jsxs(Text, { color: "red", children: ["  Generation failed: ", err.message] }, Date.now()));
                }
                break;
            }
            case "watch": {
                const watchUrl = args.length ? normaliseUrl(args[0]) : session.current.url;
                if (!watchUrl) {
                    pushHistory(_jsx(Text, { color: "red", children: "  No URL set. Run: use <url> or watch <url>" }, Date.now()));
                    break;
                }
                pushHistory(_jsx(Text, { color: "cyan", children: "  Opening browser \u2014 \u21E7+click to select \u00B7 Tab for animation mode" }, Date.now()));
                startTimer();
                setPhase({ kind: "watching", url: watchUrl, elapsed: 0 });
                try {
                    const { watch } = await import("./watch.js");
                    const result = await watch(watchUrl);
                    const { selector: pickedSelector, url: resolvedUrl, extractedData, mode } = result;
                    session.current.url = resolvedUrl;
                    stopTimer();
                    setPhase({ kind: "idle" });
                    const modeTag = mode === 'animation' ? ' [animation mode]' : '';
                    pushHistory(_jsxs(Text, { color: "green", children: ["  ✓ Selected: ", _jsxs(Text, { color: mode === 'animation' ? "magenta" : "cyan", children: [pickedSelector, modeTag] })] }, Date.now()));
                    startTimer();
                    setPhase({ kind: "extracting", selector: pickedSelector, elapsed: 0 });
                    const data = extractedData
                        ? { url: resolvedUrl, selector: pickedSelector, ...extractedData }
                        : await extract(resolvedUrl, pickedSelector);
                    session.current.lastScan = [{
                            selector: pickedSelector,
                            tag: data.tag ?? 'div',
                            text: "",
                            hasTransition: false,
                            hasAnimation: (data.webAnimations?.length ?? 0) > 0,
                            role: "other",
                        }];
                    if (data.isCanvas) {
                        stopTimer();
                        setPhase({ kind: "idle" });
                        pushHistory(_jsx(Text, { color: "yellow", children: "  \u26A0 Canvas element \u2014 no CSS to extract." }, Date.now()));
                        break;
                    }
                    // Skip GIF in animation mode — not useful
                    if (mode !== 'animation') {
                        const hasAnim = (data.webAnimations?.length ?? 0) > 0 ||
                            (data.keyframes?.length ?? 0) > 0 ||
                            (data.computedStyles?.["animation-name"] ?? "none") !== "none" ||
                            (data.computedStyles?.["transition-duration"] ?? "0s") !== "0s";
                        if (hasAnim) {
                            stopTimer();
                            setPhase({ kind: "idle" });
                            pushHistory(_jsx(Text, { color: "cyan", children: "  \uD83C\uDF9E  Rendering GIF preview..." }, Date.now()));
                            const { renderGif } = await import("./gif.js");
                            await renderGif(data, {}).catch((err) => {
                                pushHistory(_jsxs(Text, { color: "yellow", children: ["  \u26A0 GIF skipped: ", err.message] }, Date.now()));
                            });
                        }
                        else {
                            stopTimer();
                            setPhase({ kind: "idle" });
                        }
                    }
                    else {
                        stopTimer();
                        setPhase({ kind: "idle" });
                        pushHistory(_jsx(Text, { color: "magenta", children: "  \u25CE Animation mode \u2014 observing subtree mutations..." }, Date.now()));
                    }
                    let streamedTokens = "";
                    startTimer();
                    setPhase({ kind: "generating", tag: data.tag ?? 'div', elapsed: 0, tokens: "" });
                    const result2 = await generate(data, { stack: session.current.stack }, (token) => {
                        streamedTokens += token;
                        setPhase({ kind: "generating", tag: data.tag ?? 'div', elapsed, tokens: streamedTokens });
                    });
                    stopTimer();
                    setPhase({ kind: "idle" });
                    pushHistory(_jsx(GrabResult, { code: result2.code, explanation: result2.explanation, mode: mode }, Date.now()));
                }
                catch (err) {
                    stopTimer();
                    setPhase({ kind: "idle" });
                    pushHistory(_jsxs(Text, { color: "red", children: ["  Watch failed: ", err.message] }, Date.now()));
                }
                break;
            }
            case "gif": {
                if (!args.length) {
                    pushHistory(_jsx(Text, { color: "red", children: "  Usage: gif <n|selector> [url]" }, Date.now()));
                    break;
                }
                if (args[1])
                    session.current.url = normaliseUrl(args[1]);
                if (!session.current.url) {
                    pushHistory(_jsx(Text, { color: "red", children: "  No URL set. Run: use <url>" }, Date.now()));
                    break;
                }
                const gifSelector = resolveSelector(args[0]);
                if (!gifSelector) {
                    pushHistory(_jsxs(Text, { color: "red", children: ["  No element #", args[0], " in last scan."] }, Date.now()));
                    break;
                }
                startTimer();
                setPhase({ kind: "extracting", selector: gifSelector, elapsed: 0 });
                try {
                    const data = await extract(session.current.url, gifSelector);
                    stopTimer();
                    setPhase({ kind: "idle" });
                    pushHistory(_jsx(Text, { color: "cyan", children: "  \uD83C\uDF9E  Rendering GIF preview..." }, Date.now()));
                    const { renderGif } = await import("./gif.js");
                    await renderGif(data, {});
                    pushHistory(_jsx(Text, { color: "green", children: "  \u2713 GIF rendered" }, Date.now()));
                }
                catch (err) {
                    stopTimer();
                    setPhase({ kind: "idle" });
                    pushHistory(_jsxs(Text, { color: "red", children: ["  GIF failed: ", err.message] }, Date.now()));
                }
                break;
            }
            case "scroll": {
                if (args.length)
                    session.current.url = normaliseUrl(args[0]);
                if (!session.current.url) {
                    pushHistory(_jsx(Text, { color: "red", children: "  No URL set. Run: use <url>" }, Date.now()));
                    break;
                }
                startTimer();
                setPhase({ kind: "scroll-scanning", url: session.current.url, elapsed: 0 });
                try {
                    const { extractWithScroll } = await import("./extractor.js");
                    const data = await extractWithScroll(session.current.url);
                    stopTimer();
                    setPhase({ kind: "idle" });
                    const summary = {
                        keyframes: data.keyframes.length,
                        animated: data.animatedElements.length,
                        gsap: data.gsapCalls.length,
                        scrollTriggered: data.mutationLog.filter((m) => m.isScrolling).length,
                        elements: data.animatedElements.slice(0, 15).map((el) => ({
                            selector: el.selector,
                            triggeredByScroll: el.triggeredByScroll,
                        })),
                    };
                    pushHistory(_jsx(ScrollResults, { summary: summary }, Date.now()));
                }
                catch (err) {
                    stopTimer();
                    setPhase({ kind: "idle" });
                    pushHistory(_jsxs(Text, { color: "red", children: ["  Scroll-scan failed: ", err.message] }, Date.now()));
                }
                break;
            }
            case "stack": {
                const valid = ["react+tailwind", "vue+css", "html+css", "next+tailwind"];
                if (!args.length || !valid.includes(args[0])) {
                    pushHistory(_jsxs(Text, { color: "yellow", children: ["  Valid stacks: ", valid.join(" · ")] }, Date.now()));
                    break;
                }
                session.current.stack = args[0];
                pushHistory(_jsxs(Text, { color: "green", children: ["  \u2713 Stack \u2192 ", session.current.stack] }, Date.now()));
                break;
            }
            case "url":
                pushHistory(session.current.url
                    ? _jsxs(Text, { color: "cyan", children: ["  ", session.current.url] }, Date.now())
                    : _jsx(Text, { color: "gray", dimColor: true, children: "  No URL set." }, Date.now()));
                break;
            case "help":
                pushHistory(_jsx(Help, {}, Date.now()));
                break;
            case "exit":
            case "quit":
                exit();
                break;
            case "":
                break;
            default:
                pushHistory(_jsxs(Text, { color: "red", children: ["  Unknown command: ", cmd, ". Type 'help' for usage."] }, Date.now()));
        }
    }
    useInput((char, key) => {
        if (phase.kind !== "idle")
            return;
        if (key.return) {
            const line = input.trim();
            setInput("");
            if (line)
                runCommand(line);
            return;
        }
        if (key.backspace || key.delete) {
            setInput(i => i.slice(0, -1));
            return;
        }
        if (key.upArrow) {
            const next = Math.min(historyIndex + 1, cmdHistory.length - 1);
            setHistoryIndex(next);
            setInput(cmdHistory[next] ?? "");
            return;
        }
        if (key.downArrow) {
            const next = Math.max(historyIndex - 1, -1);
            setHistoryIndex(next);
            setInput(next === -1 ? "" : cmdHistory[next] ?? "");
            return;
        }
        if (key.ctrl && char === "c") {
            exit();
            return;
        }
        if (!key.ctrl && !key.meta && char)
            setInput(i => i + char);
    });
    const busy = phase.kind !== "idle";
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Static, { items: history, children: (item, i) => _jsx(Box, { children: item }, i) }), phase.kind === "watching" && (_jsx(Thinking, { label: `Browser open — ⇧+click · Tab=mode · ${new URL(phase.url).hostname}`, elapsed: elapsed })), phase.kind === "scanning" && (_jsx(Thinking, { label: `Scanning ${new URL(phase.url).hostname} ...`, elapsed: elapsed })), phase.kind === "scroll-scanning" && (_jsx(Thinking, { label: `Scroll-scanning ${new URL(phase.url).hostname} ...`, elapsed: elapsed })), phase.kind === "extracting" && (_jsx(Thinking, { label: `Extracting ${phase.selector} ...`, elapsed: elapsed })), phase.kind === "generating" && (_jsx(StreamingCode, { tokens: phase.tokens, elapsed: elapsed })), !busy && _jsx(Prompt, { session: session.current, input: input })] }));
}
export async function main() {
    render(_jsx(App, {}), { exitOnCtrlC: true });
}
