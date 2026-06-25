import { ask } from "./llm.js";
export async function matchElement(description, candidates) {
    if (candidates.length === 0)
        return null;
    // Fast path — text match without LLM
    const stopWords = new Set(["button", "link", "element", "the", "a", "an"]);
    const words = description.toLowerCase().split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));
    const textMatch = candidates.find(c => words.every(w => c.text.toLowerCase().includes(w)));
    if (textMatch)
        return textMatch.selector;
    // LLM fallback
    const candidateList = candidates
        .map((c, i) => `${i + 1}. [${c.role}] "${c.text}" | selector: ${c.selector} | transition: ${c.hasTransition} | animation: ${c.hasAnimation}`)
        .join("\n");
    const prompt = `You are a UI element matcher. Given a description and a list of page elements, return ONLY the selector of the best match.

Description: "${description}"

Elements:
${candidateList}

Rules:
- Return ONLY the selector string, nothing else. No explanation, no punctuation.
- Match based on visible text, role, and description keywords.
- If nothing matches, return: NO_MATCH

Selector:`;
    const result = await ask(prompt);
    const selector = result.trim().replace(/^["']|["']$/g, "");
    if (!selector || selector === "NO_MATCH" || selector.length === 0)
        return null;
    const match = candidates.find(c => c.selector === selector);
    if (!match) {
        const numMatch = selector.match(/^(\d+)\./);
        if (numMatch) {
            const idx = parseInt(numMatch[1], 10) - 1;
            return candidates[idx]?.selector ?? null;
        }
        const fallback = candidates.find(c => words.some(w => c.text.toLowerCase().includes(w)));
        return fallback?.selector ?? null;
    }
    return match.selector;
}
