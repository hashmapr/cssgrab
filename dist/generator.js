import { ask, askStream } from "./llm.js";
export async function generate(data, options, onToken) {
    if (data.isCanvas) {
        return {
            code: "",
            isCanvas: true,
            explanation: "This element is a <canvas>. Canvas elements are usually driven by " +
                "pre-rendered image sequences or WebGL — there is no CSS animation to " +
                "extract because the motion isn't stored as code, it's stored as pixels. " +
                "CSSgrab can't reconstruct this honestly without your own frame assets.",
            canvasNote: "If you want to build something like this yourself: render a frame " +
                "sequence (Blender, After Effects, or even `ffmpeg -i video.mp4 frame_%04d.jpg`), " +
                "then drive it with a scroll listener that swaps canvas.drawImage() based on " +
                "scroll position. That's the real technique behind effects like Apple's product pages.",
        };
    }
    const prompt = buildPrompt(data, options);
    let raw;
    if (onToken) {
        raw = await askStream(prompt, onToken);
    }
    else {
        raw = await ask(prompt);
    }
    const { code, explanation } = splitCodeAndExplanation(raw);
    return { code, explanation, isCanvas: false };
}
function buildPrompt(data, options) {
    const usedVars = filterRelevantVariables(data.cssVariables, data.computedStyles);
    return `Translate the following REAL extracted browser data into working ${options.stack} code.

STRICT RULES:
- Use ONLY the data below. Do not invent a different component (no generic "Card", no Lorem ipsum themes).
- This is a "${data.tag}" element with class "${data.classList.join(" ")}" — your output must be that same kind of element with these same visual properties.
- Output format is exactly two parts separated by the literal line ---EXPLANATION---
  Part 1: a single fenced code block with the component.
  Part 2: a 3-5 sentence plain-English explanation of the effect.
- Do not skip the ---EXPLANATION--- marker.

${options.context ? `Project context: ${options.context}\n` : ""}
Element HTML:
${data.outerHTMLSnippet}

Computed styles (use these exact values):
${JSON.stringify(data.computedStyles, null, 2)}

Matching source CSS rules:
${data.sourceCSSRules.join("\n") || "(none — CSS-in-JS or cross-origin, rely on computed styles above)"}

Keyframes on page:
${data.keyframes.map((k) => k.cssText).join("\n") || "(none)"}

Web Animations API data:
${JSON.stringify(data.webAnimations, null, 2) || "(none)"}

GSAP calls intercepted:
${JSON.stringify(data.gsapCalls, null, 2) || "(none)"}

Relevant CSS variables:
${JSON.stringify(usedVars, null, 2) || "(none referenced)"}

Generate ONE self-contained ${options.stack} component for this exact element. Use a placeholder for any external image/asset URL (a skeleton div), but keep all colors, spacing, typography, and motion values from the data above.`;
}
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
function splitCodeAndExplanation(raw) {
    const marker = "---EXPLANATION---";
    const idx = raw.indexOf(marker);
    if (idx === -1)
        return { code: raw.trim(), explanation: "" };
    const codePart = raw.slice(0, idx).trim();
    const explanationPart = raw.slice(idx + marker.length).trim();
    const codeMatch = codePart.match(/```[\w+]*\n([\s\S]*?)```/);
    return {
        code: codeMatch ? codeMatch[1].trim() : codePart,
        explanation: explanationPart,
    };
}
