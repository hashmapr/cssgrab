import { chromium } from "playwright";
const PAGE_LOAD_TIMEOUT_MS = 15000;
const SELECTOR_TIMEOUT_MS = 10000;
const WATCHDOG_TIMEOUT_MS = 40000;
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
/**
 * Extract computed styles, source CSS, keyframes, Web Animations API data,
 * and intercepted GSAP calls for a single element on a page.
 */
export async function extract(url, selector) {
    let browser;
    const watchdog = setTimeout(() => {
        browser?.close().catch(() => { });
    }, WATCHDOG_TIMEOUT_MS);
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ userAgent: USER_AGENT });
        const page = await context.newPage();
        await page.route("**/*", blockRoute);
        // Intercept GSAP before any page script runs.
        await page.addInitScript(() => {
            window.__gsap_calls = [];
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
                            window.__gsap_calls.push({ method, args });
                        }
                        catch { }
                        return original.apply(g, args);
                    };
                }
            };
            patchGsap();
            const interval = setInterval(patchGsap, 50);
            setTimeout(() => clearInterval(interval), 5000);
        });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_TIMEOUT_MS });
        await page.waitForTimeout(300);
        const cssgrabDebug = Boolean(globalThis?.process?.env?.CSSGRAB_DEBUG);
        if (cssgrabDebug) {
            console.log("DEBUG url:", page.url());
            console.log("DEBUG selector exists:", (await page.$(selector)) !== null);
        }
        const found = await page
            .waitForSelector(selector, { timeout: SELECTOR_TIMEOUT_MS, state: "attached" })
            .catch(() => null);
        if (!found)
            throw new Error(`Selector "${selector}" not found on ${url}`);
        await page.hover(selector).catch(() => { });
        await page.waitForTimeout(150);
        const result = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el)
                return null;
            const computed = window.getComputedStyle(el);
            const computedStyles = {};
            const interesting = [
                "transform", "transition", "transition-property", "transition-duration",
                "transition-timing-function", "transition-delay", "animation", "animation-name",
                "animation-duration", "animation-timing-function", "animation-iteration-count",
                "opacity", "background-color", "background", "color", "font-family",
                "font-size", "font-weight", "line-height", "letter-spacing",
                "padding", "margin", "border-radius", "box-shadow", "backdrop-filter",
                "display", "gap", "width", "height",
            ];
            for (const prop of interesting) {
                const value = computed.getPropertyValue(prop);
                if (value)
                    computedStyles[prop] = value;
            }
            const sourceCSSRules = [];
            const keyframes = [];
            for (const sheet of Array.from(document.styleSheets)) {
                let rules;
                try {
                    rules = sheet.cssRules;
                }
                catch {
                    continue;
                }
                for (const rule of Array.from(rules)) {
                    if (rule instanceof CSSStyleRule) {
                        try {
                            if (el.matches(rule.selectorText))
                                sourceCSSRules.push(rule.cssText);
                        }
                        catch { }
                    }
                    else if (rule instanceof CSSKeyframesRule) {
                        keyframes.push({ name: rule.name, cssText: rule.cssText });
                    }
                }
            }
            const webAnimations = el.getAnimations
                ? el.getAnimations().map((a) => {
                    const timing = a.effect?.getTiming?.() ?? {};
                    const kf = a.effect?.getKeyframes?.() ?? [];
                    return {
                        animationName: a.animationName ?? null,
                        duration: timing.duration ?? "auto",
                        easing: timing.easing ?? "linear",
                        delay: timing.delay ?? 0,
                        iterations: timing.iterations ?? 1,
                        keyframes: kf,
                    };
                })
                : [];
            const rootStyles = window.getComputedStyle(document.documentElement);
            const cssVariables = {};
            for (let i = 0; i < rootStyles.length; i++) {
                const prop = rootStyles[i];
                if (prop.startsWith("--"))
                    cssVariables[prop] = rootStyles.getPropertyValue(prop).trim();
            }
            const isCanvas = el.tagName.toLowerCase() === "canvas" || !!el.querySelector("canvas");
            return {
                tag: el.tagName.toLowerCase(),
                classList: Array.from(el.classList),
                outerHTMLSnippet: el.outerHTML.slice(0, 800),
                computedStyles,
                sourceCSSRules: sourceCSSRules.slice(0, 20),
                keyframes,
                webAnimations,
                cssVariables,
                isCanvas,
                gsapCalls: window.__gsap_calls ?? [],
            };
        }, selector);
        if (!result)
            throw new Error(`Could not read element "${selector}" on ${url}`);
        return { url, selector, ...result };
    }
    finally {
        clearTimeout(watchdog);
        await browser?.close().catch(() => { });
    }
}
/**
 * Scroll the full page top-to-bottom while recording every animation that fires.
 * Returns all keyframes, Web Animations, GSAP calls, and class mutations captured
 * during the scroll — including scroll-triggered animations that would be invisible
 * to a static grab.
 */
export async function extractWithScroll(url) {
    let browser;
    const watchdog = setTimeout(() => {
        browser?.close().catch(() => { });
    }, 90000);
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ userAgent: USER_AGENT });
        const page = await context.newPage();
        await page.route("**/*", blockRoute);
        await page.addInitScript(() => {
            window.__gsap_calls = [];
            window.__animated_elements = new Map();
            window.__mutation_log = [];
            window.__is_scrolling = false;
            // ── GSAP patch ─────────────────────────────────────────────────────
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
                            window.__gsap_calls.push({ method, args });
                        }
                        catch { }
                        return original.apply(g, args);
                    };
                }
            };
            patchGsap();
            const gsapInterval = setInterval(patchGsap, 50);
            setTimeout(() => clearInterval(gsapInterval), 5000);
            // ── Web Animations API intercept ───────────────────────────────────
            const origAnimate = Element.prototype.animate;
            Element.prototype.animate = function (keyframes, options) {
                try {
                    const el = this;
                    const key = el.tagName + '.' + Array.from(el.classList).join('.');
                    if (!window.__animated_elements.has(key)) {
                        window.__animated_elements.set(key, {
                            tag: el.tagName.toLowerCase(),
                            classList: Array.from(el.classList),
                            keyframes,
                            options,
                            triggeredByScroll: window.__is_scrolling ?? false,
                        });
                    }
                }
                catch { }
                return origAnimate.call(this, keyframes, options);
            };
            // ── MutationObserver — class AND style changes ─────────────────────
            const mutationObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    const el = mutation.target;
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        const oldClasses = new Set((mutation.oldValue ?? '').split(' ').filter(Boolean));
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
                    if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                        const oldStyle = mutation.oldValue ?? '';
                        const newStyle = el.style?.cssText ?? '';
                        if (newStyle !== oldStyle && window.__is_scrolling) {
                            // Only care about transform/opacity/filter — skip layout-only changes
                            const animProps = ['transform', 'opacity', 'translate', 'scale', 'rotate', 'clip-path', 'filter', 'will-change'];
                            const isAnimChange = animProps.some(p => newStyle.includes(p) || oldStyle.includes(p));
                            if (isAnimChange) {
                                window.__mutation_log.push({
                                    tag: el.tagName.toLowerCase(),
                                    classList: Array.from(el.classList),
                                    addedClasses: [],
                                    removedClasses: [],
                                    isScrolling: true,
                                    styleChange: { from: oldStyle, to: newStyle },
                                });
                            }
                        }
                    }
                }
            });
            mutationObserver.observe(document.body, {
                subtree: true,
                attributes: true,
                attributeOldValue: true,
                attributeFilter: ['class', 'style'],
            });
        });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_TIMEOUT_MS });
        await page.waitForTimeout(600);
        // Slow scroll — pause long enough for IntersectionObserver to fire
        // and for Framer Motion / GSAP to respond
        await page.evaluate(async () => {
            window.__is_scrolling = true;
            const totalHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
            const step = 40; // smaller steps
            const delay = 80; // longer pause per step — gives IO time to fire
            for (let pos = 0; pos <= totalHeight; pos += step) {
                window.scrollTo({ top: pos, behavior: 'instant' });
                await new Promise(r => setTimeout(r, delay));
            }
            // Pause at bottom — let any final animations trigger
            await new Promise(r => setTimeout(r, 500));
            // Scroll back to top
            window.scrollTo({ top: 0, behavior: 'instant' });
            await new Promise(r => setTimeout(r, 300));
            window.__is_scrolling = false;
        });
        await page.waitForTimeout(500);
        // Collect keyframes from stylesheets
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
        // Collect scroll-driven animation elements (CSS animation-timeline)
        const scrollDrivenElements = await page.evaluate(() => {
            const results = [];
            const all = document.querySelectorAll('*');
            for (const el of Array.from(all)) {
                const computed = window.getComputedStyle(el);
                const timeline = computed.getPropertyValue('animation-timeline');
                if (timeline && timeline !== 'none' && timeline !== 'auto') {
                    const tag = el.tagName.toLowerCase();
                    const classes = Array.from(el.classList).slice(0, 3).join('.');
                    results.push({
                        selector: el.id ? `#${el.id}` : tag + (classes ? '.' + classes : ''),
                        tag,
                        animationTimeline: timeline,
                    });
                }
            }
            return results.slice(0, 30);
        });
        // Collect Web Animations API animated elements
        const animatedElements = await page.evaluate(() => {
            const map = window.__animated_elements;
            return Array.from(map.values()).map((entry) => ({
                selector: entry.tag + (entry.classList.length ? '.' + entry.classList.join('.') : ''),
                tag: entry.tag,
                classList: entry.classList,
                animations: [{ keyframes: entry.keyframes, options: entry.options }],
                triggeredByScroll: entry.triggeredByScroll,
            }));
        });
        // Collect live animations
        const liveAnimations = await page.evaluate(() => {
            return document.getAnimations().map((a) => {
                const el = a.effect?.target;
                if (!el)
                    return null;
                const timing = a.effect?.getTiming?.() ?? {};
                return {
                    selector: el.tagName.toLowerCase() + (el.className ? '.' + Array.from(el.classList).join('.') : ''),
                    tag: el.tagName.toLowerCase(),
                    classList: Array.from(el.classList),
                    animations: [{
                            animationName: a.animationName ?? null,
                            duration: timing.duration,
                            easing: timing.easing,
                            keyframes: a.effect?.getKeyframes?.() ?? [],
                        }],
                    triggeredByScroll: false,
                };
            }).filter(Boolean);
        });
        const gsapCalls = await page.evaluate(() => window.__gsap_calls ?? []);
        const mutationLog = await page.evaluate(() => window.__mutation_log ?? []);
        // Merge animated elements — deduplicate by selector
        const allAnimated = [...animatedElements];
        for (const live of liveAnimations) {
            if (!allAnimated.find(a => a.selector === live.selector)) {
                allAnimated.push(live);
            }
        }
        // Tag elements as scroll-triggered based on class/style mutations during scroll
        const scrollMutatedClasses = new Set(mutationLog
            .filter((m) => m.isScrolling && m.addedClasses?.length > 0)
            .flatMap((m) => m.addedClasses));
        for (const el of allAnimated) {
            if (!el.triggeredByScroll && el.classList.some((c) => scrollMutatedClasses.has(c))) {
                el.triggeredByScroll = true;
            }
        }
        // Add style-mutation elements (GSAP/Framer Motion) as scroll-triggered animated elements
        const styleMutations = mutationLog.filter((m) => m.isScrolling && m.styleChange);
        for (const m of styleMutations) {
            const selector = m.tag + (m.classList.length ? '.' + m.classList.slice(0, 3).join('.') : '');
            if (!allAnimated.find(a => a.selector === selector)) {
                allAnimated.push({
                    selector,
                    tag: m.tag,
                    classList: m.classList,
                    animations: [{ styleChange: m.styleChange }],
                    triggeredByScroll: true,
                });
            }
        }
        return {
            url,
            keyframes,
            animatedElements: allAnimated,
            gsapCalls,
            mutationLog,
            scrollDrivenElements,
        };
    }
    finally {
        clearTimeout(watchdog);
        await browser?.close().catch(() => { });
    }
}
