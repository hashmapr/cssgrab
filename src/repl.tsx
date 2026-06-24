#!/usr/bin/env node
/// <reference types="node" />
import React, { useState, useEffect, useRef } from "react";
import { render, Box, Text, useInput, useApp, Static } from "ink";
import { extract } from "./extractor.js";
import { generate } from "./generator.js";
import type { Stack } from "./types.js";
import type { ScanCandidate } from "./scanner.js";
import { scan } from "./scanner.js";

// ── Types ──────────────────────────────────────────────────────────────────
type Phase =
  | { kind: "idle" }
  | { kind: "scanning"; url: string; elapsed: number }
  | { kind: "scan-done"; candidates: ScanCandidate[] }
  | { kind: "extracting"; selector: string; elapsed: number }
  | { kind: "generating"; tag: string; elapsed: number; tokens: string }
  | { kind: "done"; code: string; explanation: string }
  | { kind: "error"; message: string }
  | { kind: "scroll-scanning"; url: string; elapsed: number }
  | { kind: "scroll-done"; summary: ScrollSummary };

interface ScrollSummary {
  keyframes: number;
  animated: number;
  gsap: number;
  scrollTriggered: number;
  elements: { selector: string; triggeredByScroll: boolean }[];
}

interface Session {
  url: string | null;
  stack: Stack;
  lastScan: ScanCandidate[];
}

// ── Spinner frames ─────────────────────────────────────────────────────────
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ── Welcome screen ─────────────────────────────────────────────────────────
function Welcome() {
  return (
    <Box flexDirection="column" alignItems="center" marginBottom={1}>
      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={4}
        paddingY={1}
        flexDirection="row"
        gap={4}
      >
        {/* Left panel */}
        <Box flexDirection="column" alignItems="center" minWidth={28}>
          <Text color="cyan" bold>{"  ╔═══╗ ╔═══╗ ╔═══╗  "}</Text>
          <Text color="cyan">  {"║ C ║ ║ S ║ ║ S ║  "}</Text>
          <Text color="cyan">{"  ╚═══╝ ╚═══╝ ╚═══╝  "}</Text>
          <Text> </Text>
          <Text bold color="white">CSSgrab</Text>
          <Text color="gray" dimColor>v0.1.6</Text>
          <Text> </Text>
          <Text color="gray" dimColor>Grab any element's CSS</Text>
          <Text color="gray" dimColor>and animations as code</Text>
        </Box>

        {/* Divider */}
        <Box flexDirection="column">
          {Array.from({ length: 10 }).map((_, i) => (
            <Text key={i} color="gray" dimColor>│</Text>
          ))}
        </Box>

        {/* Right panel */}
        <Box flexDirection="column" minWidth={36}>
          <Text color="yellow" bold>Getting started</Text>
          <Text> </Text>
          <Text color="gray">  <Text color="cyan">use</Text> stripe.com</Text>
          <Text color="gray" dimColor>  set active URL</Text>
          <Text> </Text>
          <Text color="gray">  <Text color="cyan">scan</Text></Text>
          <Text color="gray" dimColor>  list interactive elements</Text>
          <Text> </Text>
          <Text color="gray">  <Text color="cyan">grab</Text> 3</Text>
          <Text color="gray" dimColor>  extract element by index</Text>
          <Text> </Text>
          <Text color="gray">  <Text color="cyan">scroll</Text></Text>
          <Text color="gray" dimColor>  capture scroll animations</Text>
        </Box>
      </Box>
      <Text color="gray" dimColor>Type <Text color="white">help</Text> for all commands · ctrl+c to exit</Text>
    </Box>
  );
}

// ── Prompt line ────────────────────────────────────────────────────────────
function Prompt({ session, input }: { session: Session; input: string }) {
  const host = session.url ? new URL(session.url).hostname : null;
  return (
    <Box>
      {host
        ? <Text color="cyan" bold>{host}</Text>
        : <Text color="gray" dimColor>no url</Text>
      }
      <Text color="gray" dimColor> · </Text>
      <Text color="gray" dimColor>{session.stack}</Text>
      <Text>{"\n"}</Text>
      <Text color="green" bold>› </Text>
      <Text>{input}</Text>
      <Text color="green">▌</Text>
    </Box>
  );
}

// ── Thinking indicator ─────────────────────────────────────────────────────
function Thinking({ label, elapsed }: { label: string; elapsed: number }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(id);
  }, []);

  const secs = (elapsed / 1000).toFixed(1);
  return (
    <Box gap={1}>
      <Text color="cyan">{SPINNER[frame]}</Text>
      <Text color="gray" dimColor>{label}</Text>
      <Text color="gray" dimColor>·</Text>
      <Text color="yellow">{secs}s</Text>
    </Box>
  );
}

// ── Scan results ───────────────────────────────────────────────────────────
function ScanResults({ candidates }: { candidates: ScanCandidate[] }) {
  if (!candidates.length) {
    return <Text color="yellow">  No interactive elements found.</Text>;
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {candidates.map((el, i) => (
          <Box key={i} flexDirection="column" marginBottom={i < candidates.length - 1 ? 1 : 0}>
            <Box gap={2}>
              <Text color="gray" dimColor>{String(i + 1).padStart(2)}.</Text>
              <Text color={el.role === "button" ? "magenta" : "cyan"} bold>
                {el.role.padEnd(6)}
              </Text>
              <Text bold>{el.text.slice(0, 38)}</Text>
              {el.hasTransition && <Text color="magenta">⚡</Text>}
              {el.hasAnimation && <Text color="blue">⟳</Text>}
            </Box>
            <Box>
              <Text color="gray" dimColor>{"     "}{el.selector.slice(0, 60)}{el.selector.length > 60 ? "…" : ""}</Text>
            </Box>
          </Box>
        ))}
      </Box>
      <Text color="gray" dimColor>  {candidates.length} elements · grab &lt;n&gt; to extract</Text>
    </Box>
  );
}

// ── Grab result ────────────────────────────────────────────────────────────
function GrabResult({ code, explanation }: { code: string; explanation: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
        <Text color="cyan" bold>CODE</Text>
        <Text> </Text>
        <Text>{code}</Text>
      </Box>
      {explanation ? (
        <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1} marginTop={1}>
          <Text color="gray" bold>EXPLANATION</Text>
          <Text> </Text>
          <Text color="gray">{explanation}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// ── Streaming tokens ───────────────────────────────────────────────────────
function StreamingCode({ tokens, elapsed }: { tokens: string; elapsed: number }) {
  const secs = (elapsed / 1000).toFixed(1);
  const markerIdx = tokens.indexOf("---EXPLANATION---");
  const visible = markerIdx !== -1 ? tokens.slice(0, markerIdx) : tokens;
  return (
    <Box flexDirection="column">
      <Box gap={1} marginBottom={1}>
        <Text color="cyan" bold>── CODE</Text>
        <Text color="gray" dimColor>streaming</Text>
        <Text color="yellow">{secs}s</Text>
      </Box>
      <Text>{visible}</Text>
      <Text color="green">▌</Text>
    </Box>
  );
}

// ── Scroll results ─────────────────────────────────────────────────────────
function ScrollResults({ summary }: { summary: ScrollSummary }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} paddingY={0}>
        <Text color="cyan" bold>Scroll-scan complete</Text>
        <Text> </Text>
        <Box gap={3}>
          <Box flexDirection="column" alignItems="center">
            <Text color="cyan" bold>{summary.keyframes}</Text>
            <Text color="gray" dimColor>keyframes</Text>
          </Box>
          <Box flexDirection="column" alignItems="center">
            <Text color="cyan" bold>{summary.animated}</Text>
            <Text color="gray" dimColor>animated</Text>
          </Box>
          <Box flexDirection="column" alignItems="center">
            <Text color="cyan" bold>{summary.gsap}</Text>
            <Text color="gray" dimColor>gsap calls</Text>
          </Box>
          <Box flexDirection="column" alignItems="center">
            <Text color="magenta" bold>{summary.scrollTriggered}</Text>
            <Text color="gray" dimColor>scroll-triggered</Text>
          </Box>
        </Box>
        {summary.elements.length > 0 && (
          <>
            <Text> </Text>
            <Text color="gray" dimColor bold>Animated elements:</Text>
            {summary.elements.slice(0, 15).map((el, i) => (
              <Box key={i} gap={1}>
                <Text color={el.triggeredByScroll ? "magenta" : "gray"} dimColor>
                  {el.triggeredByScroll ? "[scroll]" : "[page]  "}
                </Text>
                <Text color="gray" dimColor>{el.selector.slice(0, 55)}</Text>
              </Box>
            ))}
          </>
        )}
      </Box>
      <Text color="gray" dimColor>  grab &lt;selector&gt; to extract any element</Text>
    </Box>
  );
}

// ── Help ───────────────────────────────────────────────────────────────────
function Help() {
  const row = (cmd: string, desc: string) => (
    <Box key={cmd} gap={2}>
      <Text color="cyan">{cmd.padEnd(28)}</Text>
      <Text color="gray" dimColor>{desc}</Text>
    </Box>
  );
  return (
    <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1} marginBottom={1}>
      <Text color="yellow" bold>URL</Text>
      {row("use <url>", "set active URL")}
      <Text> </Text>
      <Text color="yellow" bold>SCAN</Text>
      {row("scan", "list interactive elements")}
      {row("scan <url>", "scan a different URL")}
      <Text> </Text>
      <Text color="yellow" bold>GRAB</Text>
      {row("grab <n>", "grab by index from last scan")}
      {row("grab <selector>", "grab by CSS selector")}
      {row("grab <selector> <url>", "grab from specific URL")}
      <Text> </Text>
      <Text color="yellow" bold>SCROLL</Text>
      {row("scroll", "scroll-scan active URL")}
      {row("scroll <url>", "scroll-scan specific URL")}
      <Text> </Text>
      <Text color="yellow" bold>SETTINGS</Text>
      {row("stack <name>", "react+tailwind · vue+css · html+css · next+tailwind")}
      {row("url", "show active URL")}
      <Text> </Text>
      <Text color="yellow" bold>OTHER</Text>
      {row("help", "show this message")}
      {row("exit / quit / ctrl+c", "exit")}
    </Box>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
function App() {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [history, setHistory] = useState<React.ReactNode[]>([<Welcome key="welcome" />]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const session = useRef<Session>({
    url: null,
    stack: "react+tailwind",
    lastScan: [],
  });

  function startTimer() {
    setElapsed(0);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    elapsedRef.current = setInterval(() => setElapsed(e => e + 100), 100);
  }

  function stopTimer() {
    if (elapsedRef.current) {
      clearInterval(elapsedRef.current);
      elapsedRef.current = null;
    }
  }

  function pushHistory(node: React.ReactNode) {
    setHistory(h => [...h, node]);
  }

  function normaliseUrl(raw: string): string {
    if (!raw.startsWith("http")) return `https://${raw}`;
    return raw;
  }

  function resolveSelector(arg: string): string | null {
    const idx = parseInt(arg, 10);
    if (!isNaN(idx)) {
      const candidate = session.current.lastScan[idx - 1];
      if (!candidate) return null;
      return candidate.selector;
    }
    return arg;
  }

  async function runCommand(line: string) {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    setCmdHistory(h => [line, ...h]);
    setHistoryIndex(-1);

    switch (cmd) {
      case "use": {
        if (!args.length) { pushHistory(<Text key={Date.now()} color="red">  Usage: use &lt;url&gt;</Text>); break; }
        session.current.url = normaliseUrl(args[0]);
        pushHistory(<Text key={Date.now()} color="green">  ✓ Active URL → {session.current.url}</Text>);
        break;
      }

      case "scan": {
        if (args.length) session.current.url = normaliseUrl(args[0]);
        if (!session.current.url) { pushHistory(<Text key={Date.now()} color="red">  No URL set. Run: use &lt;url&gt;</Text>); break; }
        startTimer();
        setPhase({ kind: "scanning", url: session.current.url, elapsed: 0 });
        try {
          const candidates = await scan(session.current.url);
          session.current.lastScan = candidates;
          stopTimer();
          setPhase({ kind: "idle" });
          pushHistory(<ScanResults key={Date.now()} candidates={candidates} />);
        } catch (err) {
          stopTimer();
          setPhase({ kind: "idle" });
          pushHistory(<Text key={Date.now()} color="red">  Scan failed: {(err as Error).message}</Text>);
        }
        break;
      }

      case "grab": {
        if (!args.length) { pushHistory(<Text key={Date.now()} color="red">  Usage: grab &lt;n|selector&gt; [url]</Text>); break; }
        if (args[1]) session.current.url = normaliseUrl(args[1]);
        if (!session.current.url) { pushHistory(<Text key={Date.now()} color="red">  No URL set. Run: use &lt;url&gt;</Text>); break; }
        const selector = resolveSelector(args[0]);
        if (!selector) { pushHistory(<Text key={Date.now()} color="red">  No element #{args[0]} in last scan.</Text>); break; }

        startTimer();
        setPhase({ kind: "extracting", selector, elapsed: 0 });
        let data: Awaited<ReturnType<typeof extract>>;
        try {
          data = await extract(session.current.url, selector);
        } catch (err) {
          stopTimer();
          setPhase({ kind: "idle" });
          pushHistory(<Text key={Date.now()} color="red">  Extract failed: {(err as Error).message}</Text>);
          break;
        }

        if (data.isCanvas) {
          stopTimer();
          setPhase({ kind: "idle" });
          pushHistory(<Text key={Date.now()} color="yellow">  ⚠ Canvas element — no CSS to extract.</Text>);
          break;
        }

        startTimer();
        let streamedTokens = "";
        setPhase({ kind: "generating", tag: data.tag, elapsed: 0, tokens: "" });

        try {
          const result = await generate(data, { stack: session.current.stack }, (token: string) => {
            streamedTokens += token;
            setPhase({ kind: "generating", tag: data.tag, elapsed, tokens: streamedTokens });
          });
          stopTimer();
          setPhase({ kind: "idle" });
          pushHistory(<GrabResult key={Date.now()} code={result.code} explanation={result.explanation} />);
        } catch (err) {
          stopTimer();
          setPhase({ kind: "idle" });
          pushHistory(<Text key={Date.now()} color="red">  Generation failed: {(err as Error).message}</Text>);
        }
        break;
      }

      case "scroll": {
        if (args.length) session.current.url = normaliseUrl(args[0]);
        if (!session.current.url) { pushHistory(<Text key={Date.now()} color="red">  No URL set. Run: use &lt;url&gt;</Text>); break; }
        startTimer();
        setPhase({ kind: "scroll-scanning", url: session.current.url, elapsed: 0 });
        try {
          const { extractWithScroll } = await import("./extractor.js");
          const data = await extractWithScroll(session.current.url);
          stopTimer();
          setPhase({ kind: "idle" });
          const summary: ScrollSummary = {
            keyframes: data.keyframes.length,
            animated: data.animatedElements.length,
            gsap: data.gsapCalls.length,
            scrollTriggered: data.mutationLog.filter((m: any) => m.isScrolling).length,
            elements: data.animatedElements.slice(0, 15).map((el: any) => ({
              selector: el.selector,
              triggeredByScroll: el.triggeredByScroll,
            })),
          };
          pushHistory(<ScrollResults key={Date.now()} summary={summary} />);
        } catch (err) {
          stopTimer();
          setPhase({ kind: "idle" });
          pushHistory(<Text key={Date.now()} color="red">  Scroll-scan failed: {(err as Error).message}</Text>);
        }
        break;
      }

      case "stack": {
        const valid: Stack[] = ["react+tailwind", "vue+css", "html+css", "next+tailwind"];
        if (!args.length || !valid.includes(args[0] as Stack)) {
          pushHistory(<Text key={Date.now()} color="yellow">  Valid stacks: {valid.join(" · ")}</Text>);
          break;
        }
        session.current.stack = args[0] as Stack;
        pushHistory(<Text key={Date.now()} color="green">  ✓ Stack → {session.current.stack}</Text>);
        break;
      }

      case "url":
        pushHistory(
          session.current.url
            ? <Text key={Date.now()} color="cyan">  {session.current.url}</Text>
            : <Text key={Date.now()} color="gray" dimColor>  No URL set.</Text>
        );
        break;

      case "help":
        pushHistory(<Help key={Date.now()} />);
        break;

      case "exit":
      case "quit":
        exit();
        break;

      case "":
        break;

      default:
        pushHistory(<Text key={Date.now()} color="red">  Unknown command: {cmd}. Type 'help' for usage.</Text>);
    }
  }

  useInput((char, key) => {
    if (phase.kind !== "idle") return;

    if (key.return) {
      const line = input.trim();
      setInput("");
      if (line) runCommand(line);
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

    if (!key.ctrl && !key.meta && char) {
      setInput(i => i + char);
    }
  });

  const busy = phase.kind !== "idle";

  return (
    <Box flexDirection="column">
      <Static items={history}>
        {(item, i) => <Box key={i}>{item as React.ReactElement}</Box>}
      </Static>

      {phase.kind === "scanning" && (
        <Thinking label={`Scanning ${new URL(phase.url).hostname} ...`} elapsed={elapsed} />
      )}
      {phase.kind === "scroll-scanning" && (
        <Thinking label={`Scroll-scanning ${new URL(phase.url).hostname} ...`} elapsed={elapsed} />
      )}
      {phase.kind === "extracting" && (
        <Thinking label={`Extracting ${phase.selector} ...`} elapsed={elapsed} />
      )}
      {phase.kind === "generating" && (
        <StreamingCode tokens={phase.tokens} elapsed={elapsed} />
      )}

      {!busy && (
        <Prompt session={session.current} input={input} />
      )}
    </Box>
  );
}

// ── Entry ──────────────────────────────────────────────────────────────────
export async function main() {
  render(<App />, { exitOnCtrlC: true });
}