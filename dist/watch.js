import { chromium } from "playwright";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BLOCKED_HOST_FRAGMENTS = [
    "doubleclick.net", "adsrvr.org", "google-analytics.com",
    "googletagmanager.com", "facebook.net", "hotjar.com",
    "segment.io", "fullstory.com", "amplitude.com",
];
const OVERLAY_SCRIPT = `
(function() {
  if (window.__cssgrab_watch) return;
  window.__cssgrab_watch = true;
  window.__cssgrab_selected = null;
  window.__cssgrab_mode = 'element';
  window.__cssgrab_selecting = false;

  window.__gsap_calls = [];
  const patchGsap = () => {
    const g = window.gsap;
    if (!g || g.__cssgrabPatched) return;
    g.__cssgrabPatched = true;
    for (const method of ['to','from','fromTo','set']) {
      const orig = g[method];
      if (typeof orig !== 'function') continue;
      g[method] = function(...args) {
        try { window.__gsap_calls.push({ method, args }); } catch {}
        return orig.apply(g, args);
      };
    }
  };
  patchGsap();
  const gsapInterval = setInterval(patchGsap, 50);
  setTimeout(() => clearInterval(gsapInterval), 10000);

  // Block navigation while in select mode
  window.addEventListener('beforeunload', e => {
    if (window.__cssgrab_selecting) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  const style = document.createElement('style');
  style.textContent = \`
    .__cssgrab_hover {
      outline: 2px solid rgba(99,102,241,0.8) !important;
      outline-offset: 2px !important;
    }
    .__cssgrab_selected_element {
      outline: 2px solid #ffffff !important;
      outline-offset: 2px !important;
    }
    .__cssgrab_selected_animation {
      outline: 2px solid #a855f7 !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(168,85,247,0.15) !important;
    }
    #__cssgrab_badge {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(10,10,10,0.92);
      color: #ffffff;
      font: 500 13px/1 -apple-system, "Inter", "SF Pro Display", sans-serif;
      padding: 8px 8px 8px 16px;
      border-radius: 9999px;
      z-index: 2147483647;
      pointer-events: none;
      white-space: nowrap;
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06);
      letter-spacing: -0.012em;
      display: flex;
      align-items: center;
      gap: 10px;
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    #__cssgrab_badge.selecting {
      border-color: rgba(99,102,241,0.6);
      box-shadow: 0 8px 32px rgba(99,102,241,0.25), inset 0 1px 0 rgba(255,255,255,0.06);
    }
    #__cssgrab_badge.anim-mode {
      border-color: rgba(168,85,247,0.4);
    }
    #__cssgrab_badge .dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: rgba(255,255,255,0.3); flex-shrink: 0;
      transition: background 0.15s ease, box-shadow 0.15s ease;
    }
    #__cssgrab_badge .dot.idle { background: rgba(255,255,255,0.25); }
    #__cssgrab_badge .dot.selecting {
      background: #6366f1;
      box-shadow: 0 0 6px rgba(99,102,241,0.8);
    }
    #__cssgrab_badge .dot.active-element {
      background: #22c55e;
      box-shadow: 0 0 6px rgba(34,197,94,0.6);
    }
    #__cssgrab_badge .dot.active-animation {
      background: #a855f7;
      box-shadow: 0 0 6px rgba(168,85,247,0.7);
    }
    #__cssgrab_badge .sel {
      color: rgba(255,255,255,0.45); font-size: 12px;
      max-width: 200px; overflow: hidden; text-overflow: ellipsis;
    }
    #__cssgrab_badge .divider {
      width: 1px; height: 12px;
      background: rgba(255,255,255,0.12); flex-shrink: 0;
    }
    #__cssgrab_badge .key {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 5px; padding: 2px 7px;
      font-size: 11px; color: rgba(255,255,255,0.6); flex-shrink: 0;
    }
    .cssgrab-btn {
      pointer-events: all !important;
      cursor: pointer !important;
      display: inline-flex; align-items: center; gap: 5px;
      border-radius: 9999px;
      padding: 5px 10px;
      font-size: 11px; font-weight: 600;
      transition: all 0.15s ease;
      user-select: none;
      white-space: nowrap;
      flex-shrink: 0;
    }
    #__cssgrab_select_btn {
      background: rgba(99,102,241,0.15);
      border: 1px solid rgba(99,102,241,0.35);
      color: #a5b4fc;
    }
    #__cssgrab_select_btn:hover { background: rgba(99,102,241,0.25); color: #c7d2fe; }
    #__cssgrab_select_btn.active {
      background: rgba(99,102,241,0.3);
      border-color: rgba(99,102,241,0.7);
      color: #e0e7ff;
      box-shadow: 0 0 12px rgba(99,102,241,0.4);
    }
    #__cssgrab_mode_btn {
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.12);
      color: rgba(255,255,255,0.6);
    }
    #__cssgrab_mode_btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
    #__cssgrab_mode_btn.anim {
      background: rgba(168,85,247,0.15);
      border-color: rgba(168,85,247,0.4);
      color: #c084fc;
    }
    #__cssgrab_flash {
      position: fixed; inset: 0;
      background: rgba(255,255,255,0.06);
      z-index: 2147483646; pointer-events: none;
      opacity: 0; transition: opacity 0.08s ease;
    }
    #__cssgrab_flash.show { opacity: 1; }
    body.__cssgrab_selecting { cursor: crosshair !important; }
    body.__cssgrab_selecting * { cursor: crosshair !important; }
  \`;
  document.head.appendChild(style);

  const badge = document.createElement('div');
  badge.id = '__cssgrab_badge';
  document.body.appendChild(badge);

  const flash = document.createElement('div');
  flash.id = '__cssgrab_flash';
  document.body.appendChild(flash);

  let hovered = null;
  let selected = null;
  let lastShiftTime = 0;

  function getSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur !== document.body && depth < 5) {
      let part = cur.tagName.toLowerCase();
      const classes = Array.from(cur.classList)
        .filter(c => !/^(active|hover|focus|selected|open|is-|js-|__cssgrab|cssgrab)/.test(c))
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

  function clearSelected() {
    if (selected) {
      selected.classList.remove('__cssgrab_selected_element', '__cssgrab_selected_animation');
      selected = null;
    }
  }

  function applySelectedClass(el) {
    el.classList.remove('__cssgrab_selected_element', '__cssgrab_selected_animation');
    el.classList.add(window.__cssgrab_mode === 'animation' ? '__cssgrab_selected_animation' : '__cssgrab_selected_element');
  }

  function setSelecting(val) {
    window.__cssgrab_selecting = val;
    document.body.classList.toggle('__cssgrab_selecting', val);
    if (!val && hovered && hovered !== selected) {
      hovered.classList.remove('__cssgrab_hover');
      hovered = null;
    }
    updateBadge();
    document.title = val ? '__CSSGRAB__SELECTMODE__ON' : '__CSSGRAB__SELECTMODE__OFF';
    setTimeout(() => {
      if (window.__cssgrab_selected) document.title = '__CSSGRAB__' + window.__cssgrab_selected;
    }, 50);
  }

  function updateBadge() {
    const isAnim = window.__cssgrab_mode === 'animation';
    const isSel = window.__cssgrab_selecting;
    badge.classList.toggle('selecting', isSel && !selected);
    badge.classList.toggle('anim-mode', isAnim && !isSel);

    let dotClass = 'dot idle';
    if (isSel && !selected) dotClass = 'dot selecting';
    else if (selected && isAnim) dotClass = 'dot active-animation';
    else if (selected) dotClass = 'dot active-element';

    let middle = '';
    if (!selected && !isSel) {
      middle = 'browse · <span class="key">⇧⇧</span> or click Select';
    } else if (isSel && !selected) {
      middle = '<span style="color:#a5b4fc">click any element</span> &nbsp;·&nbsp; <span class="key">esc</span> cancel';
    } else if (selected) {
      const sel = window.__cssgrab_selected || '';
      middle = '<span class="sel">' + sel + '</span><span class="divider"></span><span class="key">↵ grab</span>&nbsp;<span class="key">esc reset</span>';
    }

    badge.innerHTML =
      '<span class="' + dotClass + '"></span>' +
      middle +
      '<button id="__cssgrab_select_btn" class="cssgrab-btn' + (isSel ? ' active' : '') + '">' +
        (isSel ? '✕ Cancel' : '⊹ Select') +
      '</button>' +
      '<button id="__cssgrab_mode_btn" class="cssgrab-btn' + (isAnim ? ' anim' : '') + '">' +
        (isAnim ? '◎ Anim' : '✦ Elem') +
      '</button>';

    document.getElementById('__cssgrab_select_btn')?.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      setSelecting(!window.__cssgrab_selecting);
    }, { once: true });

    document.getElementById('__cssgrab_mode_btn')?.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      window.__cssgrab_mode = window.__cssgrab_mode === 'animation' ? 'element' : 'animation';
      if (selected) applySelectedClass(selected);
      updateBadge();
      document.title = '__CSSGRAB__MODE__' + window.__cssgrab_mode;
      setTimeout(() => {
        if (window.__cssgrab_selected) document.title = '__CSSGRAB__' + window.__cssgrab_selected;
      }, 100);
    }, { once: true });
  }

  function triggerFlash() {
    flash.classList.add('show');
    setTimeout(() => flash.classList.remove('show'), 120);
  }

  updateBadge();

  document.addEventListener('keydown', e => {
    if (e.key === 'Shift') {
      const now = Date.now();
      if (now - lastShiftTime < 400) {
        setSelecting(!window.__cssgrab_selecting);
        lastShiftTime = 0;
      } else {
        lastShiftTime = now;
      }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      window.__cssgrab_mode = window.__cssgrab_mode === 'animation' ? 'element' : 'animation';
      if (selected) applySelectedClass(selected);
      updateBadge();
    }
    if (e.key === 'Enter' && selected) {
      triggerFlash();
      setTimeout(() => {
        document.title = '__CSSGRAB__CONFIRM__' + window.__cssgrab_mode + '__' + window.__cssgrab_selected;
      }, 100);
    }
    if (e.key === 'Escape') {
      if (window.__cssgrab_selecting) {
        setSelecting(false);
      } else if (selected) {
        clearSelected();
        selected = null;
        window.__cssgrab_selected = null;
        updateBadge();
        document.title = '__CSSGRAB__RESET__';
      }
    }
  }, true);

  document.addEventListener('mouseover', e => {
    if (!window.__cssgrab_selecting) return;
    const t = e.target;
    if (badge.contains(t)) return;
    if (hovered && hovered !== selected) hovered.classList.remove('__cssgrab_hover');
    hovered = t;
    if (hovered !== selected) hovered.classList.add('__cssgrab_hover');
  }, true);

  document.addEventListener('mouseout', e => {
    if (!window.__cssgrab_selecting) return;
    if (hovered && hovered !== selected) hovered.classList.remove('__cssgrab_hover');
  }, true);

  document.addEventListener('click', e => {
    if (badge.contains(e.target)) return;
    if (!window.__cssgrab_selecting) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    clearSelected();
    selected = e.target;
    selected.classList.remove('__cssgrab_hover');
    applySelectedClass(selected);
    const sel = getSelector(selected);
    window.__cssgrab_selected = sel;
    setSelecting(false);
    updateBadge();
    document.title = '__CSSGRAB__' + sel;
  }, true);
})();
`;
export async function watch(url) {
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    console.log(`\n🔭 Opening browser — double-tap \x1b[33mShift\x1b[0m or click \x1b[36m⊹ Select\x1b[0m to pick an element`);
    console.log(`   Tab to toggle Element / Animation mode`);
    console.log(`   Press \x1b[32mEnter\x1b[0m in browser or terminal to grab\n`);
    let currentSelector = null;
    let currentMode = 'element';
    let resolved = false;
    const browser_ = await chromium.launch({
        headless: false,
        args: ["--start-maximized", "--no-first-run"],
    });
    const context = await browser_.newContext({
        userAgent: USER_AGENT,
        viewport: null,
        acceptDownloads: false,
    });
    context.on('download', async (download) => {
        try {
            await download.cancel();
        }
        catch { }
    });
    const page = await context.newPage();
    page.on('popup', async (popup) => { try {
        await popup.close();
    }
    catch { } });
    // Auto-dismiss the beforeunload dialog so navigation silently fails in select mode
    page.on('dialog', async (dialog) => { try {
        await dialog.dismiss();
    }
    catch { } });
    await page.route("**/*", (route) => {
        const reqUrl = route.request().url();
        if (BLOCKED_HOST_FRAGMENTS.some(f => reqUrl.includes(f)))
            return route.abort();
        return route.continue();
    });
    await page.goto(normalized, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(400);
    await page.evaluate(OVERLAY_SCRIPT);
    page.on("framenavigated", async (frame) => {
        if (frame === page.mainFrame()) {
            await page.waitForLoadState("domcontentloaded").catch(() => { });
            await page.waitForTimeout(300);
            await page.evaluate(OVERLAY_SCRIPT).catch(() => { });
        }
    });
    const resolvePromise = new Promise((resolve) => {
        let pollInterval = setInterval(async () => {
            if (resolved)
                return;
            try {
                const title = await page.title();
                if (title === '__CSSGRAB__SELECTMODE__ON') {
                    process.stdout.write(`\r  \x1b[36m⊹\x1b[0m Select mode — click any element\x1b[K\n`);
                    return;
                }
                if (title === '__CSSGRAB__SELECTMODE__OFF')
                    return;
                if (title.startsWith("__CSSGRAB__CONFIRM__")) {
                    const rest = title.slice("__CSSGRAB__CONFIRM__".length);
                    if (rest.startsWith("animation__")) {
                        currentMode = 'animation';
                        currentSelector = rest.slice("animation__".length);
                    }
                    else if (rest.startsWith("element__")) {
                        currentMode = 'element';
                        currentSelector = rest.slice("element__".length);
                    }
                    else {
                        currentSelector = rest;
                    }
                    if (pollInterval)
                        clearInterval(pollInterval);
                    pollInterval = null;
                    resolved = true;
                    resolve();
                    return;
                }
                if (title.startsWith("__CSSGRAB__MODE__")) {
                    currentMode = title.slice("__CSSGRAB__MODE__".length) === 'animation' ? 'animation' : 'element';
                    process.stdout.write(`\r  Mode: ${currentMode === 'animation' ? '\x1b[35mAnimation ◎' : '\x1b[37mElement ✦'}\x1b[0m\x1b[K\n`);
                    return;
                }
                if (title.startsWith("__CSSGRAB__") &&
                    !title.startsWith("__CSSGRAB__RESET__") &&
                    !title.startsWith("__CSSGRAB__MODE__") &&
                    !title.startsWith("__CSSGRAB__CONFIRM__") &&
                    !title.startsWith("__CSSGRAB__SELECTMODE__")) {
                    const sel = title.slice("__CSSGRAB__".length);
                    if (sel && sel !== currentSelector) {
                        currentSelector = sel;
                        const modeTag = currentMode === 'animation' ? '\x1b[35m[animation]\x1b[0m ' : '';
                        process.stdout.write(`\r  \x1b[36m◈\x1b[0m ${modeTag}Selected: \x1b[35m${sel}\x1b[0m\x1b[K\n`);
                        process.stdout.write(`  Press \x1b[32mEnter\x1b[0m to grab · Tab to toggle mode\n`);
                    }
                }
                if (title === "__CSSGRAB__RESET__") {
                    currentSelector = null;
                    process.stdout.write(`\r  \x1b[33m○\x1b[0m Deselected\x1b[K\n`);
                }
            }
            catch { }
        }, 100);
        const onData = (data) => {
            if (resolved)
                return;
            const str = data.toString();
            if (str === '\r' || str === '\n') {
                if (!currentSelector) {
                    process.stdout.write(`\r  \x1b[31m✗\x1b[0m Nothing selected — double-tap Shift or click ⊹ Select\x1b[K\n`);
                    return;
                }
                if (pollInterval)
                    clearInterval(pollInterval);
                pollInterval = null;
                resolved = true;
                try {
                    process.stdin.setRawMode?.(false);
                    process.stdin.removeListener('data', onData);
                }
                catch { }
                resolve();
            }
        };
        try {
            process.stdin.setRawMode?.(true);
            process.stdin.resume();
            process.stdin.on('data', onData);
        }
        catch { }
        browser_.on("disconnected", () => {
            if (resolved)
                return;
            if (pollInterval)
                clearInterval(pollInterval);
            resolved = true;
            try {
                process.stdin.setRawMode?.(false);
                process.stdin.removeListener('data', onData);
            }
            catch { }
            resolve();
        });
    });
    await resolvePromise;
    try {
        const finalSel = await page.evaluate(() => window.__cssgrab_selected);
        if (finalSel)
            currentSelector = finalSel;
        const finalMode = await page.evaluate(() => window.__cssgrab_mode);
        if (finalMode)
            currentMode = finalMode;
    }
    catch { }
    if (!currentSelector) {
        await browser_.close().catch(() => { });
        throw new Error("No element selected");
    }
    process.stdout.write(`\r  \x1b[36m⟳\x1b[0m Capturing from live page...\x1b[K\n`);
    let extractedData = null;
    try {
        if (currentMode === 'animation') {
            process.stdout.write(`  \x1b[35m◎\x1b[0m Observing animations for 2s...\n`);
            extractedData = await page.evaluate(async (sel) => {
                const root = document.querySelector(sel);
                if (!root)
                    return null;
                root.scrollIntoView({ behavior: 'instant', block: 'center' });
                const mutations = [];
                const snapshots = new Map();
                const mo = new MutationObserver((records) => {
                    for (const r of records) {
                        if (r.type === 'attributes' && r.attributeName === 'style') {
                            const el = r.target;
                            const prev = r.oldValue ?? '';
                            const curr = el.style.cssText;
                            if (curr !== prev) {
                                const animProps = ['transform', 'opacity', 'filter', 'clip-path', 'translate', 'scale', 'rotate'];
                                if (animProps.some(p => curr.includes(p) || prev.includes(p))) {
                                    let s = el.tagName.toLowerCase();
                                    if (el.className)
                                        s += '.' + Array.from(el.classList).slice(0, 2).join('.');
                                    mutations.push({ selector: s, from: prev, to: curr });
                                }
                            }
                        }
                    }
                });
                mo.observe(root, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['style'] });
                for (const child of Array.from(root.querySelectorAll('*')).slice(0, 50)) {
                    const s = child.style.cssText;
                    if (s)
                        snapshots.set(child, s);
                }
                await new Promise(r => setTimeout(r, 2000));
                mo.disconnect();
                const changes = [];
                for (const [child, before] of snapshots.entries()) {
                    const after = child.style.cssText;
                    if (after !== before) {
                        let s = child.tagName.toLowerCase();
                        if (child.className)
                            s += '.' + Array.from(child.classList).slice(0, 2).join('.');
                        changes.push({ selector: s, before, after });
                    }
                }
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
                        if (rule instanceof CSSKeyframesRule)
                            keyframes.push({ name: rule.name, cssText: rule.cssText });
                    }
                }
                const webAnimations = document.getAnimations()
                    .filter(a => root.contains(a.effect?.target))
                    .map((a) => {
                    const el = a.effect?.target;
                    const timing = a.effect?.getTiming?.() ?? {};
                    return {
                        animationName: a.animationName ?? null,
                        targetSelector: el ? el.tagName.toLowerCase() + (el.className ? '.' + Array.from(el.classList).slice(0, 2).join('.') : '') : '',
                        duration: timing.duration,
                        easing: timing.easing,
                        keyframes: a.effect?.getKeyframes?.() ?? [],
                    };
                });
                const computed = window.getComputedStyle(root);
                const computedStyles = {};
                for (const prop of ['transform', 'opacity', 'animation', 'transition', 'animation-timeline', 'display', 'width', 'height']) {
                    const v = computed.getPropertyValue(prop);
                    if (v)
                        computedStyles[prop] = v;
                }
                return {
                    tag: root.tagName.toLowerCase(),
                    classList: Array.from(root.classList).filter(c => !c.startsWith('__cssgrab') && !c.startsWith('cssgrab')),
                    outerHTMLSnippet: root.outerHTML.replace(/\s*(?:__cssgrab|cssgrab)-?\w*/g, '').slice(0, 800),
                    computedStyles,
                    sourceCSSRules: [],
                    keyframes,
                    webAnimations,
                    cssVariables: {},
                    isCanvas: false,
                    gsapCalls: window.__gsap_calls ?? [],
                    animationMutations: mutations.slice(0, 50),
                    styleChanges: changes.slice(0, 30),
                    isAnimationMode: true,
                };
            }, currentSelector);
        }
        else {
            const [observedAnimations] = await Promise.all([
                page.evaluate(async (sel) => {
                    const el = document.querySelector(sel);
                    if (!el)
                        return [];
                    el.scrollIntoView({ behavior: 'instant', block: 'center' });
                    const snapshots = [];
                    const seen = new Set();
                    for (let i = 0; i < 4; i++) {
                        await new Promise(r => setTimeout(r, 100));
                        const s = el.style.cssText;
                        if (s && !seen.has(s)) {
                            seen.add(s);
                            snapshots.push(s);
                        }
                    }
                    return snapshots;
                }, currentSelector),
                page.hover(currentSelector).catch(() => { }),
            ]);
            await page.waitForTimeout(150);
            extractedData = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (!el)
                    return null;
                const computed = window.getComputedStyle(el);
                const interesting = [
                    'transform', 'transition', 'transition-property', 'transition-duration',
                    'transition-timing-function', 'transition-delay', 'animation', 'animation-name',
                    'animation-duration', 'animation-timing-function', 'animation-iteration-count',
                    'animation-timeline', 'opacity', 'background-color', 'background', 'color',
                    'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
                    'padding', 'margin', 'border-radius', 'box-shadow', 'backdrop-filter',
                    'display', 'gap', 'width', 'height',
                ];
                const computedStyles = {};
                for (const prop of interesting) {
                    const val = computed.getPropertyValue(prop);
                    if (val)
                        computedStyles[prop] = val;
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
                            try {
                                if (rule.selectorText?.includes(':hover') &&
                                    el.matches(rule.selectorText.replace(/:hover/g, ''))) {
                                    sourceCSSRules.push('/* HOVER */ ' + rule.cssText);
                                }
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
                            duration: timing.duration ?? 'auto',
                            easing: timing.easing ?? 'linear',
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
                    if (prop.startsWith('--'))
                        cssVariables[prop] = rootStyles.getPropertyValue(prop).trim();
                }
                return {
                    tag: el.tagName.toLowerCase(),
                    classList: Array.from(el.classList).filter((c) => !c.startsWith('__cssgrab') && !c.startsWith('cssgrab')),
                    outerHTMLSnippet: el.outerHTML.replace(/\s*(?:__cssgrab|cssgrab)-?\w*/g, '').slice(0, 800),
                    computedStyles,
                    sourceCSSRules: sourceCSSRules.slice(0, 25),
                    keyframes,
                    webAnimations,
                    cssVariables,
                    isCanvas: el.tagName.toLowerCase() === 'canvas' || !!el.querySelector('canvas'),
                    gsapCalls: window.__gsap_calls ?? [],
                };
            }, currentSelector);
            if (extractedData && observedAnimations.length > 0) {
                extractedData.observedAnimations = observedAnimations;
            }
        }
    }
    catch (err) {
        console.warn(`\n  ⚠ Live extraction failed: ${err.message}`);
    }
    const finalUrl = page.url();
    await browser_.close().catch(() => { });
    return {
        selector: currentSelector,
        url: finalUrl || normalized,
        mode: currentMode,
        extractedData,
    };
}
