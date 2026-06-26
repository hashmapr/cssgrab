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
  const d = data as any;
  const usedVars = filterRelevantVariables(data.cssVariables, data.computedStyles);

  const observedSection = d.observedAnimations?.length > 0
    ? `\nObserved inline style snapshots during animation (Framer Motion / GSAP inline writes — use these to reconstruct motion):\n${d.observedAnimations.join('\n')}\n`
    : "";

  const hoverSection = d.hoverStyles && Object.keys(d.hoverStyles).length > 0
    ? `\nHover state styles (apply these as hover: Tailwind variants):\n${JSON.stringify(d.hoverStyles, null, 2)}\n`
    : "";

  // ── Animation mode ─────────────────────────────────────────────────────
  if (d.isAnimationMode) {
    const mutations = d.animationMutations ?? [];
    const changes = d.styleChanges ?? [];
    const keyframeText = data.keyframes.map(k => k.cssText).join("\n") || "(none)";
    const webAnimText = JSON.stringify(d.webAnimations ?? [], null, 2);
    const gsapText = JSON.stringify(data.gsapCalls ?? [], null, 2);

    return `You are a React animation expert. Write a self-contained ${options.stack} component that recreates the animation described below.

RULES:
- Use the EXACT values from the observed data — no placeholders, no made-up values.
- Output ONLY a fenced code block, then ---EXPLANATION---, then 3-5 sentences. Nothing else.
- NEVER use source site class names.
- Start your response with \`\`\`jsx immediately — no preamble.

Element: <${data.tag}> [${data.classList.join(", ")}]

Keyframes on page:
${keyframeText}

Web Animations on subtree:
${webAnimText}

Style mutations observed during 2s window:
${JSON.stringify(mutations.slice(0, 20), null, 2) || "(none)"}

Style changes (before → after 2s):
${JSON.stringify(changes.slice(0, 20), null, 2) || "(none)"}

GSAP calls:
${gsapText}

Computed styles:
${JSON.stringify(data.computedStyles, null, 2)}

\`\`\`jsx`;
  }

  // ── Element mode ────────────────────────────────────────────────────────
  return `Translate the following REAL extracted browser data into working ${options.stack} code.

STRICT RULES:
- Use ONLY the data below. Do not invent a different component.
- This is a "${data.tag}" element — your output must be that same kind of element with these exact visual properties.
- NEVER use the original CSS class names from the source site. Those classes only work on that site.
- You MUST inline ALL styles as Tailwind utility classes using the exact computed values below.
- If a value has no direct Tailwind class, use arbitrary value syntax: bg-[rgb(65,51,203)], text-[14px], etc.
- The output must look identical to the original without any external stylesheet.
- You MUST output exactly two sections in this order:
  1. A fenced code block containing the component (\`\`\`jsx ... \`\`\`)
  2. The EXACT line (outside and after the closing code fence): ---EXPLANATION---
  3. A 3-5 sentence plain-English explanation of what the component does visually.
- The ---EXPLANATION--- line MUST appear AFTER the code block, not inside it.
- NEVER put ---EXPLANATION--- or any explanation inside the code fence.
- Do not output anything before the code block.

${options.context ? `Project context: ${options.context}\n` : ""}
Element HTML (cleaned):
${data.outerHTMLSnippet}

Computed styles (use these exact values as Tailwind arbitrary classes):
${JSON.stringify(data.computedStyles, null, 2)}

Matching source CSS rules (includes hover states marked /* HOVER */):
${data.sourceCSSRules.join("\n") || "(none — CSS-in-JS or cross-origin, rely on computed styles above)"}

Keyframes on page:
${data.keyframes.map((k) => k.cssText).join("\n") || "(none)"}

Web Animations API data:
${JSON.stringify(data.webAnimations, null, 2) || "(none)"}

GSAP calls intercepted:
${JSON.stringify(data.gsapCalls, null, 2) || "(none)"}
${observedSection}${hoverSection}
Relevant CSS variables:
${JSON.stringify(usedVars, null, 2) || "(none referenced)"}

Generate ONE self-contained ${options.stack} component for this exact element. Use a skeleton div placeholder for any external image/asset URL, but keep all colors, spacing, typography, and motion values exactly as given above.`;
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
  // The animation mode prompt ends with ```jsx so the model continues inside it.
  // Handle the case where the response starts mid-fence.
  let text = raw.trim();

  // If response doesn't start with ``` but has content, it's continuing an open fence
  // from the prompt — wrap it
  if (!text.startsWith("```") && !text.includes("```")) {
    // Pure code continuation — find ---EXPLANATION--- if present
    const markerIdx = text.indexOf("---EXPLANATION---");
    if (markerIdx !== -1) {
      return {
        code: text.slice(0, markerIdx).trim().replace(/```\s*$/, "").trim(),
        explanation: text.slice(markerIdx + "---EXPLANATION---".length).trim(),
      };
    }
    return { code: text, explanation: "" };
  }

  // Strip outer fence if whole response is wrapped
  const unwrapped = text.replace(/^```[\w+]*\n([\s\S]*?)```\s*$/m, "$1").trim();

  const marker = "---EXPLANATION---";
  const idx = unwrapped.indexOf(marker);

  if (idx !== -1) {
    const codePart = unwrapped.slice(0, idx).trim();
    const explanationPart = unwrapped.slice(idx + marker.length).trim()
      .replace(/^EXPLANATION:\s*/i, "")
      .replace(/```\s*$/, "").trim();
    const codeMatch = codePart.match(/```[\w+]*\n([\s\S]*?)```/)
      || codePart.match(/```[\w+]*\n([\s\S]*)/);
    return {
      code: codeMatch ? codeMatch[1].trim() : codePart,
      explanation: explanationPart,
    };
  }

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

  const codeMatch = unwrapped.match(/```[\w+]*\n([\s\S]*?)```/)
    || unwrapped.match(/```[\w+]*\n([\s\S]*)/);
  return {
    code: codeMatch ? codeMatch[1].trim() : unwrapped,
    explanation: "",
  };
}