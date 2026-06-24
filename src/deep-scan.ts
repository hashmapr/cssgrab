import { chromium, type Browser, type Page } from "playwright";
import { writeFileSync } from "fs";

const PAGE_LOAD_TIMEOUT_MS = 15000;
const BLOCKED_HOST_FRAGMENTS = [
  "doubleclick.net", "adsrvr.org", "px.ads.linkedin.com", "linkedin.com/px",
  "casalemedia.com", "rlcdn.com", "google-analytics.com", "googletagmanager.com",
  "facebook.net", "facebook.com/tr", "hotjar.com", "segment.io",
  "fullstory.com", "amplitude.com",
];
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function blockRoute(route: any) {
  const type = route.request().resourceType();
  const url = route.request().url();
  if (["image", "media", "font"].includes(type)) return route.abort();
  if (BLOCKED_HOST_FRAGMENTS.some((f) => url.includes(f))) return route.abort();
  return route.continue();
}

export interface DeepScanOptions {
  maxDepth?: number;
  maxPages?: number;
  outputFile?: string;
  onPageStart?: (url: string, depth: number, index: number, total: number) => void;
  onKeyframe?: (kf: { name: string; cssText: string }, pageUrl: string) => void;
  onElement?: (el: { selector: string; triggeredByScroll: boolean }, pageUrl: string) => void;
  onMutation?: (m: { tag: string; addedClasses: string[] }, pageUrl: string) => void;
  onGsap?: (call: { method: string }, pageUrl: string) => void;
  onPageDone?: (url: string, stats: PageStats) => void;
  onDone?: (result: DeepScanResult) => void;
}

export interface PageStats {
  keyframes: number;
  animated: number;
  gsap: number;
  scrollTriggered: number;
  durationMs: number;
}

export interface DeepScanResult {
  rootUrl: string;
  pagesScanned: number;
  totalDurationMs: number;
  keyframes: { name: string; cssText: string; foundOn: string[] }[];
  animatedElements: { selector: string; triggeredByScroll: boolean; foundOn: string }[];
  gsapCalls: { method: string; foundOn: string }[];
  mutationLog: { tag: string; addedClasses: string[]; foundOn: string }[];
  pageIndex: Record<string, PageStats>;
}

async function collectLinks(page: Page, baseOrigin: string): Promise<string[]> {
  return page.evaluate((origin) => {
    const links = Array.from(document.querySelectorAll("a[href]"));
    const seen = new Set<string>();
    const results: string[] = [];
    for (const a of links) {
      try {
        const href = (a as HTMLAnchorElement).href;
        const url = new URL(href);
        if (url.origin !== origin) continue;
        if (url.hash && !url.pathname.includes("/")) continue;
        const path = url.pathname + url.search;
        if (seen.has(path)) continue;
        seen.add(path);
        const ext = url.pathname.split(".").pop()?.toLowerCase() ?? "";
        if (["pdf","zip","png","jpg","svg","ico","xml","json","txt","css","js"].includes(ext)) continue;
        results.push(url.origin + url.pathname);
      } catch { }
    }
    return results;
  }, baseOrigin);
}

async function scrollScanPage(
  page: Page,
  pageUrl: string,
  opts: DeepScanOptions,
): Promise<{
  keyframes: { name: string; cssText: string }[];
  animatedElements: { selector: string; classList: string[]; triggeredByScroll: boolean }[];
  gsapCalls: { method: string }[];
  mutationLog: { tag: string; addedClasses: string[]; removedClasses: string[]; isScrolling: boolean }[];
}> {
  await page.addInitScript(() => {
    (window as any).__gsap_calls = [];
    (window as any).__animated_elements = new Map();
    (window as any).__mutation_log = [];
    (window as any).__is_scrolling = false;

    const patchGsap = () => {
      const g = (window as any).gsap;
      if (!g || g.__cssgrabPatched) return;
      g.__cssgrabPatched = true;
      for (const method of ["to", "from", "fromTo", "set"]) {
        const original = g[method];
        if (typeof original !== "function") continue;
        g[method] = function (...args: unknown[]) {
          try { (window as any).__gsap_calls.push({ method }); } catch { }
          return original.apply(g, args);
        };
      }
    };
    patchGsap();
    const gsapInterval = setInterval(patchGsap, 50);
    setTimeout(() => clearInterval(gsapInterval), 5000);

    const origAnimate = Element.prototype.animate;
    Element.prototype.animate = function (kf: any, options: any) {
      try {
        const el = this as Element;
        const key = el.tagName + "." + Array.from(el.classList).join(".");
        if (!(window as any).__animated_elements.has(key)) {
          (window as any).__animated_elements.set(key, {
            tag: el.tagName.toLowerCase(),
            classList: Array.from(el.classList),
            triggeredByScroll: (window as any).__is_scrolling ?? false,
          });
        }
      } catch { }
      return origAnimate.call(this, kf, options);
    };

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "class") {
          const el = m.target as Element;
          const oldClasses = new Set((m.oldValue ?? "").split(" ").filter(Boolean));
          const newClasses = new Set(Array.from(el.classList));
          const added = [...newClasses].filter(c => !oldClasses.has(c));
          const removed = [...oldClasses].filter(c => !newClasses.has(c));
          if (added.length || removed.length) {
            (window as any).__mutation_log.push({
              tag: el.tagName.toLowerCase(),
              classList: Array.from(el.classList),
              addedClasses: added,
              removedClasses: removed,
              isScrolling: (window as any).__is_scrolling ?? false,
            });
          }
        }
      }
    });
    mo.observe(document.body, {
      subtree: true, attributes: true,
      attributeOldValue: true, attributeFilter: ["class"],
    });
  });

  await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_TIMEOUT_MS });
  await page.waitForTimeout(400);

  await page.evaluate(async () => {
    (window as any).__is_scrolling = true;
    const total = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    for (let pos = 0; pos <= total; pos += 80) {
      window.scrollTo({ top: pos, behavior: "instant" });
      await new Promise(r => setTimeout(r, 40));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    await new Promise(r => setTimeout(r, 200));
    (window as any).__is_scrolling = false;
  });

  await page.waitForTimeout(300);

  const keyframes = await page.evaluate(() => {
    const result: { name: string; cssText: string }[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSKeyframesRule) {
          result.push({ name: rule.name, cssText: rule.cssText });
        }
      }
    }
    return result;
  });

  for (const kf of keyframes) opts.onKeyframe?.(kf, pageUrl);

  const mutationLog = await page.evaluate(() => (window as any).__mutation_log ?? []);

  const scrollMutatedClasses = new Set(
    mutationLog
      .filter((m: any) => m.isScrolling && m.addedClasses.length > 0)
      .flatMap((m: any) => m.addedClasses as string[])
  );

  const animatedElements = await page.evaluate(() => {
    const map = (window as any).__animated_elements as Map<string, any>;
    return Array.from(map.values()).map((entry: any) => ({
      selector: entry.tag + (entry.classList.length ? "." + entry.classList.join(".") : ""),
      classList: entry.classList as string[],
      triggeredByScroll: entry.triggeredByScroll as boolean,
    }));
  });

  for (const el of animatedElements) {
    if (!el.triggeredByScroll && el.classList.some((c: string) => scrollMutatedClasses.has(c))) {
      el.triggeredByScroll = true;
    }
  }

  for (const el of animatedElements) opts.onElement?.(el, pageUrl);

  const liveAnimations = await page.evaluate(() => {
    return document.getAnimations().map((a: Animation) => {
      const el = (a.effect as KeyframeEffect)?.target;
      if (!el) return null;
      return {
        selector: el.tagName.toLowerCase() + (el.className ? "." + Array.from(el.classList).join(".") : ""),
        classList: Array.from(el.classList) as string[],
        triggeredByScroll: false,
      };
    }).filter(Boolean) as { selector: string; classList: string[]; triggeredByScroll: boolean }[];
  });

  for (const el of liveAnimations) {
    if (!animatedElements.find(e => e.selector === el.selector)) {
      if (!el.triggeredByScroll && el.classList.some((c: string) => scrollMutatedClasses.has(c))) {
        el.triggeredByScroll = true;
      }
      animatedElements.push(el);
      opts.onElement?.(el, pageUrl);
    }
  }

  const gsapCalls = await page.evaluate(() =>
    ((window as any).__gsap_calls ?? []).map((c: any) => ({ method: c.method }))
  );
  for (const call of gsapCalls) opts.onGsap?.(call, pageUrl);

  for (const m of mutationLog.filter((m: any) => m.isScrolling)) {
    opts.onMutation?.(m, pageUrl);
  }

  return { keyframes, animatedElements, gsapCalls, mutationLog };
}

export async function deepScan(
  rootUrl: string,
  opts: DeepScanOptions = {},
): Promise<DeepScanResult> {
  const maxDepth = opts.maxDepth ?? 3;
  const maxPages = opts.maxPages ?? 50;
  const startTime = Date.now();

  const normalized = rootUrl.startsWith("http") ? rootUrl : `https://${rootUrl}`;
  const baseOrigin = new URL(normalized).origin;

  const queue: [string, number][] = [[normalized, 1]];
  const visited = new Set<string>();
  const result: DeepScanResult = {
    rootUrl: normalized,
    pagesScanned: 0,
    totalDurationMs: 0,
    keyframes: [],
    animatedElements: [],
    gsapCalls: [],
    mutationLog: [],
    pageIndex: {},
  };

  const seenKeyframes = new Map<string, string[]>();
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: USER_AGENT });

    while (queue.length > 0 && visited.size < maxPages) {
      const [url, depth] = queue.shift()!;
      const norm = url.split("#")[0].replace(/\/$/, "") || url;
      if (visited.has(norm)) continue;
      visited.add(norm);

      const pageIndex = visited.size;
      opts.onPageStart?.(url, depth, pageIndex, Math.min(queue.length + pageIndex, maxPages));

      const page = await context.newPage();
      await page.route("**/*", blockRoute);

      const pageStart = Date.now();
      const pageStats: PageStats = { keyframes: 0, animated: 0, gsap: 0, scrollTriggered: 0, durationMs: 0 };

      try {
        await scrollScanPage(page, url, {
          ...opts,
          onKeyframe: (kf, pageUrl) => {
            if (seenKeyframes.has(kf.name)) {
              const pages = seenKeyframes.get(kf.name)!;
              if (!pages.includes(pageUrl)) pages.push(pageUrl);
            } else {
              seenKeyframes.set(kf.name, [pageUrl]);
              result.keyframes.push({ ...kf, foundOn: [pageUrl] });
            }
            pageStats.keyframes++;
            opts.onKeyframe?.(kf, pageUrl);
          },
          onElement: (el, pageUrl) => {
            result.animatedElements.push({ ...el, foundOn: pageUrl });
            if (el.triggeredByScroll) pageStats.scrollTriggered++;
            pageStats.animated++;
            opts.onElement?.(el, pageUrl);
          },
          onGsap: (call, pageUrl) => {
            result.gsapCalls.push({ ...call, foundOn: pageUrl });
            pageStats.gsap++;
            opts.onGsap?.(call, pageUrl);
          },
          onMutation: (m, pageUrl) => {
            result.mutationLog.push({ ...m, foundOn: pageUrl });
            opts.onMutation?.(m, pageUrl);
          },
        });

        pageStats.durationMs = Date.now() - pageStart;
        result.pageIndex[url] = pageStats;
        result.pagesScanned++;
        opts.onPageDone?.(url, pageStats);

        if (depth < maxDepth) {
          await page.waitForTimeout(1000);
          const links = await collectLinks(page, baseOrigin);
          for (const link of links) {
            const linkNorm = link.split("#")[0].replace(/\/$/, "") || link;
            if (!visited.has(linkNorm)) queue.push([link, depth + 1]);
          }
        }
      } catch {
        pageStats.durationMs = Date.now() - pageStart;
        result.pageIndex[url] = pageStats;
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser?.close().catch(() => {});
  }

  result.totalDurationMs = Date.now() - startTime;

  if (opts.outputFile) {
    writeFileSync(opts.outputFile, JSON.stringify(result, null, 2), "utf8");
  }

  opts.onDone?.(result);
  return result;
}
