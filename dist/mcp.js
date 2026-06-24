/// <reference types="node" />
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { extract, extractWithScroll } from "./extractor.js";
import { scan } from "./scanner.js";
const server = new McpServer({
    name: "cssgrab",
    version: "0.1.0",
});
server.registerTool("scan", {
    title: "List candidate buttons/links on a page",
    description: "Lists buttons, links, and other interactive elements on a webpage, " +
        "each with a ready-to-use CSS selector, visible text, and whether it " +
        "has a CSS transition/animation. ALWAYS call this FIRST when the user " +
        "describes an element by appearance or text (e.g. 'the invite button', " +
        "'the pricing card') rather than guessing selectors blind — pick the " +
        "matching entry from the results, then call 'grab' with its exact " +
        "selector. This is much faster and more reliable than trial-and-error " +
        "selector guessing. " +
        "Elements with isCanvas: true cannot be grabbed as code — tell the user immediately instead " +
        "of attempting to grab them.",
    inputSchema: {
        url: z.string().describe("Full URL of the page to scan, e.g. https://stripe.com"),
    },
}, async ({ url }) => {
    try {
        const candidates = await scan(url);
        return {
            content: [{ type: "text", text: JSON.stringify(candidates, null, 2) }],
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            content: [{ type: "text", text: `CSSgrab scan failed: ${message}` }],
            isError: true,
        };
    }
});
server.registerTool("grab", {
    title: "Grab CSS/animation from a website element",
    description: "Extracts computed styles, source CSS, keyframes, Web Animations API " +
        "data, and intercepted GSAP calls for a specific element on a live " +
        "webpage. Returns a clean structured summary — NOT raw code — so the " +
        "calling AI can generate a component using its own model and full " +
        "project context. Use this when the user wants to copy a button, card, " +
        "animation, or other UI element's appearance/motion from a real website " +
        "into their own project. " +
        "NOTE: If the target element appears to be a canvas, WebGL, or animated gradient background, " +
        "do NOT attempt multiple selector guesses. Instead, immediately tell the user that this is a " +
        "canvas/WebGL effect that cannot be extracted as CSS code, and explain the technique instead.",
    inputSchema: {
        url: z.string().describe("Full URL of the page to extract from, e.g. https://stripe.com"),
        selector: z.string().describe("CSS selector for the target element, e.g. '.btn-primary' or 'nav a:first-child'. " +
            "If unsure, call scan first to get the exact selector."),
    },
}, async ({ url, selector }) => {
    try {
        const data = await extract(url, selector);
        if (data.isCanvas) {
            return {
                content: [{
                        type: "text",
                        text: `This element (<${data.tag}> class="${data.classList.join(" ")}") is a ` +
                            `<canvas>. Canvas elements are typically driven by pre-rendered image ` +
                            `sequences or WebGL — there's no CSS animation to extract because the ` +
                            `motion isn't stored as code, it's stored as pixels. ` +
                            `To build something similar yourself: render a frame sequence ` +
                            `(Blender, After Effects, or \`ffmpeg -i video.mp4 frame_%04d.jpg\`), ` +
                            `then drive it with a scroll listener that swaps canvas.drawImage() ` +
                            `based on scroll position.`,
                    }],
            };
        }
        const truncate = (s, max) => s.length > max ? s.slice(0, max) + "…" : s;
        const summary = {
            element: `<${data.tag}> class="${data.classList.join(" ")}"`,
            sourceUrl: data.url,
            key_properties: data.computedStyles,
            source_css_rules: data.sourceCSSRules.slice(0, 5).map((r) => truncate(r, 300)),
            keyframes: data.keyframes.slice(0, 3).map((k) => truncate(k.cssText, 400)),
            web_animations: data.webAnimations.slice(0, 5).map((a) => ({
                ...a,
                keyframes: a.keyframes.slice(0, 8),
            })),
            gsap_calls: data.gsapCalls.slice(0, 10),
            relevant_css_variables: filterRelevantVariables(data.cssVariables, data.computedStyles),
            html_snippet: truncate(data.outerHTMLSnippet, 400),
        };
        return {
            content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            content: [{ type: "text", text: `CSSgrab extraction failed: ${message}` }],
            isError: true,
        };
    }
});
server.registerTool("scroll-scan", {
    title: "Scroll the full page and capture all animations",
    description: "Scrolls the entire page from top to bottom while recording every animation " +
        "that fires — including scroll-triggered animations, IntersectionObserver reveals, " +
        "GSAP scroll effects, and Web Animations API calls. Use this when the user wants " +
        "to find animations that only appear when scrolling (entrance animations, parallax, " +
        "scroll-triggered keyframes) that a normal 'scan' would miss because they aren't " +
        "present in the initial DOM. Returns all keyframes found in the stylesheet, every " +
        "element that animated during the scroll, GSAP calls, and class mutations. " +
        "After getting results, you can call 'grab' with a specific selector to get full " +
        "computed styles for any element that caught your attention.",
    inputSchema: {
        url: z.string().describe("Full URL of the page to scroll-scan, e.g. https://framer.com"),
    },
}, async ({ url }) => {
    try {
        const data = await extractWithScroll(url);
        const truncate = (s, max) => s.length > max ? s.slice(0, max) + "…" : s;
        const summary = {
            url: data.url,
            keyframes_found: data.keyframes.length,
            keyframes: data.keyframes.slice(0, 10).map((k) => ({
                name: k.name,
                cssText: truncate(k.cssText, 400),
            })),
            animated_elements: data.animatedElements.slice(0, 20).map((el) => ({
                selector: el.selector,
                tag: el.tag,
                classList: el.classList.slice(0, 5),
                triggered_by_scroll: el.triggeredByScroll,
                animation_count: el.animations.length,
            })),
            gsap_calls: data.gsapCalls.slice(0, 10),
            scroll_triggered_class_mutations: data.mutationLog
                .filter((m) => m.isScrolling)
                .slice(0, 20)
                .map((m) => ({
                tag: m.tag,
                added_classes: m.addedClasses,
                removed_classes: m.removedClasses,
            })),
        };
        return {
            content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            content: [{ type: "text", text: `CSSgrab scroll-scan failed: ${message}` }],
            isError: true,
        };
    }
});
function filterRelevantVariables(cssVariables, computedStyles) {
    const computedValues = Object.values(computedStyles).join(" ");
    const relevant = {};
    for (const [key, value] of Object.entries(cssVariables)) {
        if (computedValues.includes(value) || computedValues.includes(`var(${key})`)) {
            relevant[key] = value;
        }
    }
    return relevant;
}
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("CSSgrab MCP server running on stdio");
}
main().catch((err) => {
    console.error("Fatal error starting CSSgrab MCP server:", err);
    globalThis.process?.exit?.(1);
});
