const PROVIDER = process.env.LLM_PROVIDER || "ollama";
export async function ask(prompt) {
    switch (PROVIDER) {
        case "ollama": return askOllama(prompt);
        case "anthropic": return askAnthropic(prompt);
        case "gemini": return askGemini(prompt);
        case "openrouter": return askOpenRouter(prompt);
        default: throw new Error(`Unknown LLM_PROVIDER: ${PROVIDER}`);
    }
}
/**
 * Streaming version — calls onToken for each chunk as it arrives.
 * Falls back to non-streaming for providers that don't support it yet.
 */
export async function askStream(prompt, onToken) {
    switch (PROVIDER) {
        case "ollama": return askOllamaStream(prompt, onToken);
        case "anthropic": return askAnthropicStream(prompt, onToken);
        // Gemini / OpenRouter streaming not implemented — fall back to batch
        default: {
            const result = await ask(prompt);
            onToken(result);
            return result;
        }
    }
}
// ── Ollama ─────────────────────────────────────────────────────────────────
async function askOllama(prompt) {
    const model = process.env.OLLAMA_MODEL || "qwen2.5-coder";
    const host = process.env.OLLAMA_HOST || "http://localhost:11434";
    const res = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            stream: false,
            messages: [
                {
                    role: "system",
                    content: "You are a precise code translator. You only use the data given " +
                        "to you by the user. You never invent unrelated components, " +
                        "placeholder content themes, or styles not derivable from the " +
                        "supplied data. You always follow the exact output format requested.",
                },
                { role: "user", content: prompt },
            ],
        }),
    });
    if (!res.ok)
        throw new Error(`Ollama request failed (${res.status}). Is Ollama running locally?`);
    const data = (await res.json());
    return data.message.content;
}
async function askOllamaStream(prompt, onToken) {
    const model = process.env.OLLAMA_MODEL || "qwen2.5-coder";
    const host = process.env.OLLAMA_HOST || "http://localhost:11434";
    const res = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            stream: true,
            messages: [
                {
                    role: "system",
                    content: "You are a precise code translator. You only use the data given " +
                        "to you by the user. You never invent unrelated components, " +
                        "placeholder content themes, or styles not derivable from the " +
                        "supplied data. You always follow the exact output format requested.",
                },
                { role: "user", content: prompt },
            ],
        }),
    });
    if (!res.ok)
        throw new Error(`Ollama request failed (${res.status}). Is Ollama running locally?`);
    if (!res.body)
        throw new Error("Ollama returned no response body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        // Ollama streams NDJSON — one JSON object per line
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            try {
                const parsed = JSON.parse(trimmed);
                const token = parsed.message?.content ?? "";
                if (token) {
                    onToken(token);
                    full += token;
                }
            }
            catch {
                // malformed chunk — skip
            }
        }
    }
    return full;
}
// ── Anthropic ──────────────────────────────────────────────────────────────
async function askAnthropic(prompt) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey)
        throw new Error("ANTHROPIC_API_KEY not set");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 2000,
            messages: [{ role: "user", content: prompt }],
        }),
    });
    if (!res.ok)
        throw new Error(`Anthropic request failed (${res.status})`);
    const data = (await res.json());
    return data.content.find((c) => c.type === "text")?.text ?? "";
}
async function askAnthropicStream(prompt, onToken) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey)
        throw new Error("ANTHROPIC_API_KEY not set");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 2000,
            stream: true,
            messages: [{ role: "user", content: prompt }],
        }),
    });
    if (!res.ok)
        throw new Error(`Anthropic request failed (${res.status})`);
    if (!res.body)
        throw new Error("Anthropic returned no response body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: "))
                continue;
            const json = line.slice(6).trim();
            if (json === "[DONE]")
                break;
            try {
                const parsed = JSON.parse(json);
                if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                    onToken(parsed.delta.text);
                    full += parsed.delta.text;
                }
            }
            catch {
                // skip
            }
        }
    }
    return full;
}
// ── Gemini ─────────────────────────────────────────────────────────────────
async function askGemini(prompt) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
        throw new Error("GEMINI_API_KEY not set");
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok)
        throw new Error(`Gemini request failed (${res.status})`);
    const data = (await res.json());
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
// ── OpenRouter ─────────────────────────────────────────────────────────────
async function askOpenRouter(prompt) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey)
        throw new Error("OPENROUTER_API_KEY not set");
    const model = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free";
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
        }),
    });
    if (!res.ok)
        throw new Error(`OpenRouter request failed (${res.status})`);
    const data = (await res.json());
    return data.choices?.[0]?.message?.content ?? "";
}
