import { chromium } from "playwright";
import { writeFileSync } from "fs";
const PAGE_LOAD_TIMEOUT_MS = 15000;
const BLOCKED_HOST_FRAGMENTS = [
    "doubleclick.net", "adsrvr.org", "px.ads.linkedin.com", "linkedin.com/px",
    "casalemedia.com", "rlcdn.com", "google-analytics.com", "googletagmanager.com",
    "facebook.net", "facebook.com/tr", "hotjar.com", "segment.io",
    "fullstory.com", "amplitude.com",
];
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
function blockRoute(route) {
    const type = route.request().resourceType();
    const url = route.request().url();
    if (["image", "media", "font"].includes(type))
        return route.abort();
    if (BLOCKED_HOST_FRAGMENTS.some((f) => url.includes(f)))
        return route.abort();
    return route.continue();
}
async function collectLinks(page, baseOrigin) {
    return page.evaluate((origin) => {
        const links = Array.from(document.querySelectorAll("a[href]"));
        const seen = new Set();
        const results = [];
        for (const a of links) {
            try {
                const href = a.href;
                const url = new URL(href);
                if (url.origin !== origin)
                    continue;
                if (url.hash && !url.pathname.includes("/"))
                    continue;
                const path = url.pathname + url.search;
                if (seen.has(path))
                    continue;
                seen.add(path);
                const ext = url.pathname.split(".").pop()?.toLowerCase() ?? "";
                if (["pdf", "zip", "png", "jpg", "svg", "ico", "xml", "json", "txt", "css", "js"].includes(ext))
                    continue;
                results.push(url.origin + url.pathname);
            }
            catch { }
        }
        return results;
    }, baseOrigin);
}
async function scrollScanPage(page, pageUrl, opts) {
    await page.addInitScript(() => {
        window.__gsap_calls = [];
        window.__animated_elements = new Map();
        window.__mutation_log = [];
        window.__is_scrolling = false;
        const patchGsap = () => {
            const g = window.gsap;
            if (!g || g.__cssgrabPatched)
                return;
            g.__cssgrabPatched = true;
            for (const method of ["to", "from", "fromTo", "set"]) {
                const original = g[method];
                if (typeof original !== "function")
                    continue;
                g[method] = function (...args) {
                    try {
                        window.__gsap_calls.push({ method });
                    }
                    catch { }
                    return original.apply(g, args);
                };
            }
        };
        patchGsap();
        const gsapInterval = setInterval(patchGsap, 50);
        setTimeout(() => clearInterval(gsapInterval), 5000);
        const origAnimate = Element.prototype.animate;
        Element.prototype.animate = function (kf, options) {
            try {
                const el = this;
                const key = el.tagName + "." + Array.from(el.classList).join(".");
                if (!window.__animated_elements.has(key)) {
                    window.__animated_elements.set(key, {
                        tag: el.tagName.toLowerCase(),
                        classList: Array.from(el.classList),
                        triggeredByScroll: window.__is_scrolling ?? false,
                    });
                }
            }
            catch { }
            return origAnimate.call(this, kf, options);
        };
        const mo = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === "attributes" && m.attributeName === "class") {
                    const el = m.target;
                    const oldClasses = new Set((m.oldValue ?? "").split(" ").filter(Boolean));
                    const newClasses = new Set(Array.from(el.classList));
                    const added = [...newClasses].filter(c => !oldClasses.has(c));
                    const removed = [...oldClasses].filter(c => !newClasses.has(c));
                    if (added.length || removed.length) {
                        window.__mutation_log.push({
                            tag: el.tagName.toLowerCase(),
                            classList: Array.from(el.classList),
                            addedClasses: added,
                            removedClasses: removed,
                            isScrolling: window.__is_scrolling ?? false,
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
        window.__is_scrolling = true;
        const total = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        for (let pos = 0; pos <= total; pos += 80) {
            window.scrollTo({ top: pos, behavior: "instant" });
            await new Promise(r => setTimeout(r, 40));
        }
        window.scrollTo({ top: 0, behavior: "instant" });
        await new Promise(r => setTimeout(r, 200));
        window.__is_scrolling = false;
    });
    await page.waitForTimeout(300);
    const keyframes = await page.evaluate(() => {
        const result = [];
        for (const sheet of Array.from(document.styleSheets)) {
            let rules;
            try {
                rules = sheet.cssRules;
            }
            catch {
                continue;
            }
            for (const rule of Array.from(rules)) {
                if (rule instanceof CSSKeyframesRule) {
                    result.push({ name: rule.name, cssText: rule.cssText });
                }
            }
        }
        return result;
    });
    for (const kf of keyframes)
        opts.onKeyframe?.(kf, pageUrl);
    const mutationLog = await page.evaluate(() => window.__mutation_log ?? []);
    const scrollMutatedClasses = new Set(mutationLog
        .filter((m) => m.isScrolling && m.addedClasses.length > 0)
        .flatMap((m) => m.addedClasses));
    const animatedElements = await page.evaluate(() => {
        const map = window.__animated_elements;
        return Array.from(map.values()).map((entry) => ({
            selector: entry.tag + (entry.classList.length ? "." + entry.classList.join(".") : ""),
            classList: entry.classList,
            triggeredByScroll: entry.triggeredByScroll,
        }));
    });
    for (const el of animatedElements) {
        if (!el.triggeredByScroll && el.classList.some((c) => scrollMutatedClasses.has(c))) {
            el.triggeredByScroll = true;
        }
    }
    for (const el of animatedElements)
        opts.onElement?.(el, pageUrl);
    const liveAnimations = await page.evaluate(() => {
        return document.getAnimations().map((a) => {
            const el = a.effect?.target;
            if (!el)
                return null;
            return {
                selector: el.tagName.toLowerCase() + (el.className ? "." + Array.from(el.classList).join(".") : ""),
                classList: Array.from(el.classList),
                triggeredByScroll: false,
            };
        }).filter(Boolean);
    });
    for (const el of liveAnimations) {
        if (!animatedElements.find(e => e.selector === el.selector)) {
            if (!el.triggeredByScroll && el.classList.some((c) => scrollMutatedClasses.has(c))) {
                el.triggeredByScroll = true;
            }
            animatedElements.push(el);
            opts.onElement?.(el, pageUrl);
        }
    }
    const gsapCalls = await page.evaluate(() => (window.__gsap_calls ?? []).map((c) => ({ method: c.method })));
    for (const call of gsapCalls)
        opts.onGsap?.(call, pageUrl);
    for (const m of mutationLog.filter((m) => m.isScrolling)) {
        opts.onMutation?.(m, pageUrl);
    }
    return { keyframes, animatedElements, gsapCalls, mutationLog };
}
export async function deepScan(rootUrl, opts = {}) {
    const maxDepth = opts.maxDepth ?? 3;
    const maxPages = opts.maxPages ?? 50;
    const startTime = Date.now();
    const normalized = rootUrl.startsWith("http") ? rootUrl : `https://${rootUrl}`;
    const baseOrigin = new URL(normalized).origin;
    const queue = [[normalized, 1]];
    const visited = new Set();
    const result = {
        rootUrl: normalized,
        pagesScanned: 0,
        totalDurationMs: 0,
        keyframes: [],
        animatedElements: [],
        gsapCalls: [],
        mutationLog: [],
        pageIndex: {},
    };
    const seenKeyframes = new Map();
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ userAgent: USER_AGENT });
        while (queue.length > 0 && visited.size < maxPages) {
            const [url, depth] = queue.shift();
            const norm = url.split("#")[0].replace(/\/$/, "") || url;
            if (visited.has(norm))
                continue;
            visited.add(norm);
            const pageIndex = visited.size;
            opts.onPageStart?.(url, depth, pageIndex, Math.min(queue.length + pageIndex, maxPages));
            const page = await context.newPage();
            await page.route("**/*", blockRoute);
            const pageStart = Date.now();
            const pageStats = { keyframes: 0, animated: 0, gsap: 0, scrollTriggered: 0, durationMs: 0 };
            try {
                await scrollScanPage(page, url, {
                    ...opts,
                    onKeyframe: (kf, pageUrl) => {
                        if (seenKeyframes.has(kf.name)) {
                            const pages = seenKeyframes.get(kf.name);
                            if (!pages.includes(pageUrl))
                                pages.push(pageUrl);
                        }
                        else {
                            seenKeyframes.set(kf.name, [pageUrl]);
                            result.keyframes.push({ ...kf, foundOn: [pageUrl] });
                        }
                        pageStats.keyframes++;
                        opts.onKeyframe?.(kf, pageUrl);
                    },
                    onElement: (el, pageUrl) => {
                        result.animatedElements.push({ ...el, foundOn: pageUrl });
                        if (el.triggeredByScroll)
                            pageStats.scrollTriggered++;
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
                        if (!visited.has(linkNorm))
                            queue.push([link, depth + 1]);
                    }
                }
            }
            catch {
                pageStats.durationMs = Date.now() - pageStart;
                result.pageIndex[url] = pageStats;
            }
            finally {
                await page.close().catch(() => { });
            }
        }
    }
    finally {
        await browser?.close().catch(() => { });
    }
    result.totalDurationMs = Date.now() - startTime;
    if (opts.outputFile) {
        writeFileSync(opts.outputFile, JSON.stringify(result, null, 2), "utf8");
    }
    opts.onDone?.(result);
    return result;
}
