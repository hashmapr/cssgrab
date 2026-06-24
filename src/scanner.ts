import { chromium, type Browser } from "playwright";

const PAGE_LOAD_TIMEOUT_MS = 15000;
const WATCHDOG_TIMEOUT_MS = 30000;

const BLOCKED_HOST_FRAGMENTS = [
  "doubleclick.net",
  "adsrvr.org",
  "px.ads.linkedin.com",
  "linkedin.com/px",
  "casalemedia.com",
  "rlcdn.com",
  "google-analytics.com",
  "googletagmanager.com",
  "facebook.net",
  "facebook.com/tr",
  "hotjar.com",
  "segment.io",
  "fullstory.com",
  "amplitude.com",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface ScanCandidate {
  selector: string;
  tag: string;
  text: string;
  href?: string;
  hasTransition: boolean;
  hasAnimation: boolean;
  role: "button" | "link" | "other";
}

/**
 * Scan a page for candidate interactive elements (buttons, links, anything
 * with a CSS transition/animation) and return a small list with stable,
 * unique selectors. This exists because grabbing "the right" element blind
 * by selector-guessing burns enormous tool-call budget — this gives the
 * caller (Claude Code or a human) something concrete to pick from.
 */
export async function scan(url: string): Promise<ScanCandidate[]> {
  let browser: Browser | undefined;

  const watchdog = setTimeout(() => {
    browser?.close().catch(() => {});
  }, WATCHDOG_TIMEOUT_MS);

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();

    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      const reqUrl = route.request().url();
      if (["image", "media", "font"].includes(type)) return route.abort();
      if (BLOCKED_HOST_FRAGMENTS.some((fragment) => reqUrl.includes(fragment))) {
        return route.abort();
      }
      return route.continue();
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    await page.waitForTimeout(300);

    const candidates = await page.evaluate(() => {
      const seen = new Set<string>();
      const results: {
        selector: string;
        tag: string;
        text: string;
        href?: string;
        hasTransition: boolean;
        hasAnimation: boolean;
        role: "button" | "link" | "other";
      }[] = [];

      const allCandidates = document.querySelectorAll(
        'a, button, [role="button"], [class*="btn"], [class*="button"]',
      );

      for (const el of Array.from(allCandidates)) {
        if (results.length >= 30) break;

        const text = (el.textContent || "").trim().slice(0, 60);
        if (!text) continue;

        const computed = window.getComputedStyle(el);
        const hasTransition =
          computed.transitionDuration !== "0s" && computed.transitionProperty !== "none";
        const hasAnimation = computed.animationName !== "none";

        // Build a unique selector inline (no separate named function — esbuild's
        // __name() wrapping on named inner functions breaks when Playwright
        // stringifies this callback to run inside the page).
        let selector: string;
        if (el.id) {
          selector = `#${CSS.escape(el.id)}`;
        } else {
          const parts: string[] = [];
          let current: Element | null = el;
          let depth = 0;
          let found = "";

          while (current && current !== document.body && depth < 5) {
            let part = current.tagName.toLowerCase();
            const classes = Array.from(current.classList).filter(
              (c) => !/^(active|hover|focus|selected|open|is-|js-)/.test(c),
            );
            if (classes.length > 0) {
              part += "." + classes.slice(0, 2).map((c) => CSS.escape(c)).join(".");
            }
            const parent = current.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(
                (sib) => sib.tagName === current!.tagName,
              );
              if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                part += `:nth-of-type(${index})`;
              }
            }
            parts.unshift(part);

            const candidateSelector = parts.join(" > ");
            if (document.querySelectorAll(candidateSelector).length === 1) {
              found = candidateSelector;
              break;
            }

            current = current.parentElement;
            depth++;
          }
          selector = found || parts.join(" > ");
        }

        if (seen.has(selector)) continue;
        seen.add(selector);

        const tag = el.tagName.toLowerCase();
        results.push({
          selector,
          tag,
          text,
          href: el.getAttribute("href") || undefined,
          hasTransition,
          hasAnimation,
          role: tag === "a" ? "link" : tag === "button" ? "button" : "other",
        });
      }

      return results;
    });

    return candidates;
  } finally {
    clearTimeout(watchdog);
    await browser?.close().catch(() => {});
  }
}

