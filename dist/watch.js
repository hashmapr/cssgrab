import { chromium } from "playwright";
import * as readline from "readline";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BLOCKED_HOST_FRAGMENTS = [
    "doubleclick.net", "adsrvr.org", "google-analytics.com",
    "googletagmanager.com", "facebook.net", "hotjar.com",
    "segment.io", "fullstory.com", "amplitude.com",
];
// Injected into the page — adds hover ring + click-to-select overlay
const OVERLAY_SCRIPT = `
(function() {
  if (window.__cssgrab_watch) return;
  window.__cssgrab_watch = true;
  window.__cssgrab_selected = null;

  const style = document.createElement('style');
  style.textContent = \`
    .__cssgrab_hover {
      outline: 2px solid #00e5ff !important;
      outline-offset: 2px !important;
      cursor: crosshair !important;
    }
    .__cssgrab_selected {
      outline: 2px solid #ff4081 !important;
      outline-offset: 2px !important;
    }
    #__cssgrab_badge {
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.85);
      color: #00e5ff;
      font: 12px/1.4 monospace;
      padding: 6px 14px;
      border-radius: 6px;
      z-index: 2147483647;
      pointer-events: none;
      white-space: nowrap;
      max-width: 90vw;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #__cssgrab_badge span.sel { color: #ff4081; }
  \`;
  document.head.appendChild(style);

  const badge = document.createElement('div');
  badge.id = '__cssgrab_badge';
  badge.textContent = 'hover an element · click to select · Enter in terminal to grab';
  document.body.appendChild(badge);

  let hovered = null;
  let selected = null;

  function getSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur !== document.body && depth < 5) {
      let part = cur.tagName.toLowerCase();
      const classes = Array.from(cur.classList)
        .filter(c => !/^(active|hover|focus|selected|open|is-|js-)/.test(c))
        .slice(0, 2);
      if (classes.length) part += '.' + classes.map(c => CSS.escape(c)).join('.');
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === cur.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      if (document.querySelectorAll(parts.join(' > ')).length === 1) break;
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  function updateBadge() {
    const selPart = selected
      ? '<span class="sel">selected: ' + selected + '</span> · Enter to grab'
      : 'hover an element · click to select · Enter in terminal to grab';
    badge.innerHTML = selPart;
  }

  document.addEventListener('mouseover', e => {
    if (e.target === badge || e.target.__cssgrab_skip) return;
    if (hovered && hovered !== selected) hovered.classList.remove('__cssgrab_hover');
    hovered = e.target;
    if (hovered !== selected) hovered.classList.add('__cssgrab_hover');
  }, true);

  document.addEventListener('mouseout', e => {
    if (hovered && hovered !== selected) hovered.classList.remove('__cssgrab_hover');
  }, true);

  document.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    if (selected) selected.classList.remove('__cssgrab_selected');
    selected = e.target;
    selected.classList.remove('__cssgrab_hover');
    selected.classList.add('__cssgrab_selected');
    const sel = getSelector(selected);
    window.__cssgrab_selected = sel;
    updateBadge();
    // Signal to Playwright via title mutation
    document.title = '__CSSGRAB__' + sel;
  }, true);
})();
`;
export async function watch(url) {
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    console.log(`\n🔭 Opening browser — hover to highlight, click to select`);
    console.log(`   Press \x1b[32mEnter\x1b[0m in this terminal to grab the selected element\n`);
    let browser;
    let currentSelector = null;
    const browser_ = await chromium.launch({
        headless: false,
        args: ["--start-maximized"],
    });
    browser = browser_;
    const context = await browser.newContext({
        userAgent: USER_AGENT,
        viewport: null,
    });
    const page = await context.newPage();
    await page.route("**/*", (route) => {
        const type = route.request().resourceType();
        const reqUrl = route.request().url();
        if (["image", "media", "font"].includes(type))
            return route.continue(); // keep images for visual accuracy
        if (BLOCKED_HOST_FRAGMENTS.some(f => reqUrl.includes(f)))
            return route.abort();
        return route.continue();
    });
    await page.goto(normalized, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(400);
    // Inject overlay
    await page.evaluate(OVERLAY_SCRIPT);
    // Re-inject on navigation
    page.on("framenavigated", async (frame) => {
        if (frame === page.mainFrame()) {
            await page.waitForTimeout(400);
            await page.evaluate(OVERLAY_SCRIPT).catch(() => { });
        }
    });
    // Poll for selector changes via title
    let pollInterval = setInterval(async () => {
        try {
            const title = await page.title();
            if (title.startsWith("__CSSGRAB__")) {
                const sel = title.slice("__CSSGRAB__".length);
                if (sel !== currentSelector) {
                    currentSelector = sel;
                    process.stdout.write(`\r  \x1b[36m◈\x1b[0m Selected: \x1b[35m${sel}\x1b[0m                    \n`);
                    process.stdout.write(`  Press \x1b[32mEnter\x1b[0m to grab, or keep clicking\n`);
                }
            }
        }
        catch { /* page may have closed */ }
    }, 200);
    // Wait for Enter key
    await new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin });
        rl.once("line", () => {
            rl.close();
            resolve();
        });
        // Handle page close
        browser_.on("disconnected", () => {
            rl.close();
            resolve();
        });
    });
    if (pollInterval)
        clearInterval(pollInterval);
    // Final read of selector from page before closing
    try {
        const finalSel = await page.evaluate(() => window.__cssgrab_selected);
        if (finalSel)
            currentSelector = finalSel;
    }
    catch { /* page may have been closed */ }
    await browser.close().catch(() => { });
    if (!currentSelector) {
        throw new Error("No element selected — click an element in the browser before pressing Enter");
    }
    return { selector: currentSelector, url: normalized };
}
