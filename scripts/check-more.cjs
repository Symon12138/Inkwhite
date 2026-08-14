const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9226");
  const page = browser.contexts()[0].pages()[0];
  const info = await page.evaluate(() => {
    const btn = document.querySelector("button.header-more");
    if (!btn) return { error: "no button" };
    const cs = getComputedStyle(btn);
    const r = btn.getBoundingClientRect();
    const header = document.querySelector(".app-header");
    const ha = document.querySelector(".header-actions");
    return {
      display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
      width: cs.width, height: cs.height,
      position: cs.position, zIndex: cs.zIndex,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      headerDisplay: getComputedStyle(header).display,
      actionsDisplay: getComputedStyle(ha).display,
      actionsRect: (() => { const ar = ha.getBoundingClientRect(); return { x: Math.round(ar.x), w: Math.round(ar.width) }; })()
    };
  });
  console.log("MORE-BTN:", JSON.stringify(info));
  await browser.close();
})();