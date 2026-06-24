import type { ExtractedElement, GenerateOptions, GenerateResult } from "./types.js";
import { ask, askStream } from "./llm.js";

export async function generate(
  data: ExtractedElement,
  options: GenerateOptions,
  onToken?: (token: string) => void,
): Promise<GenerateResult> {
  if (data.isCanvas) {
    return {
      code: "",
      isCanvas: true,
      explanation:
        "This element is a <canvas>. Canvas elements are usually driven by " +
        "pre-rendered image sequences or WebGL — there is no CSS animation to " +
        "extract because the motion isn't stored as code, it's stored as pixels. " +
        "CSSgrab can't reconstruct this honestly without your own frame assets.",
      canvasNote:
        "If you want to build something like this yourself: render a frame " +
        "sequence (Blender, After Effects, or even `ffmpeg -i video.mp4 frame_%04d.jpg`), " +
        "then drive it with a scroll listener that swaps canvas.drawImage() based on " +
        "scroll position. That's the real technique behind effects like Apple's product pages.",
    };
  }

  const prompt = buildPrompt(data, options);

  let raw: string;
  if (onToken) {
    raw = await askStream(prompt, onToken);
  } else {
    raw = await ask(prompt);
  }

  const { code, explanation } = splitCodeAndExplanation(raw);
  return { code, explanation, isCanvas: false };
}

function buildPrompt(data: ExtractedElement, options: GenerateOptions): string {
  const usedVars = filterRelevantVariables(data.cssVariables, data.computedStyles);

  return `Translate the following REAL extracted browser data into working ${options.stack} code.

STRICT RULES:
- Use ONLY the data below. Do not invent a different component (no generic "Card", no Lorem ipsum themes).
- This is a "${data.tag}" element with class "${data.classList.join(" ")}" — your output must be that same kind of element with these same visual properties.
- You MUST output exactly two sections in this order, no exceptions:
  1. A fenced code block containing the component (e.g. \`\`\`jsx ... \`\`\`)
  2. The EXACT line (outside and after the closing code fence): ---EXPLANATION---
  3. A 3-5 sentence plain-English explanation of what the component does visually.
- The ---EXPLANATION--- line MUST appear AFTER the code block, not before.
- NEVER put ---EXPLANATION--- or any explanation text inside the code fence.
- Do not output anything before the code block.
- NEVER use the original CSS class names from the source site (like "hds-button--primary"). Those classes only exist on that site.
- You MUST inline ALL styles as Tailwind utility classes using the exact computed values provided below.
- The output must look identical to the original without any external stylesheet.

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

function filterRelevantVariables(
  cssVariables: Record<string, string>,
  computedStyles: Record<string, string>,
): Record<string, string> {
  const computedValues = Object.values(computedStyles).join(" ");
  const relevant: Record<string, string> = {};
  for (const [key, value] of Object.entries(cssVariables)) {
    if (computedValues.includes(value) || computedValues.includes(`var(${key})`)) {
      relevant[key] = value;
    }
  }
  return relevant;
}

function splitCodeAndExplanation(raw: string): { code: string; explanation: string } {
  // Strip outer code fence if the whole response is wrapped in one
  const unwrapped = raw.replace(/^```[\w+]*\n([\s\S]*?)```\s*$/m, "$1").trim();
  
  const marker = "---EXPLANATION---";
  const idx = unwrapped.indexOf(marker);
  
  if (idx !== -1) {
    const codePart = unwrapped.slice(0, idx).trim();
    const explanationPart = unwrapped.slice(idx + marker.length).trim()
      .replace(/^EXPLANATION:\s*/i, "");
    // Strip inner code fence if present
    const codeMatch = codePart.match(/```[\w+]*\n([\s\S]*?)```/) 
      || codePart.match(/```[\w+]*\n([\s\S]*)/);
    return {
      code: codeMatch ? codeMatch[1].trim() : codePart,
      explanation: explanationPart,
    };
  }

  // No marker — try to split on --- or just return code
  const dashIdx = unwrapped.indexOf("\n---\n");
  if (dashIdx !== -1) {
    const codePart = unwrapped.slice(0, dashIdx).trim();
    const codeMatch = codePart.match(/```[\w+]*\n([\s\S]*?)```/)
      || codePart.match(/```[\w+]*\n([\s\S]*)/);
    return {
      code: codeMatch ? codeMatch[1].trim() : codePart,
      explanation: unwrapped.slice(dashIdx + 5).trim().replace(/^EXPLANATION:\s*/i, ""),
    };
  }

  // Last resort — strip any fences and return
  const codeMatch = unwrapped.match(/```[\w+]*\n([\s\S]*?)```/)
    || unwrapped.match(/```[\w+]*\n([\s\S]*)/);
  return {
    code: codeMatch ? codeMatch[1].trim() : unwrapped,
    explanation: "",
  };
}