import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 150)));
await page.goto('http://127.0.0.1:1420/#editor');
await page.waitForTimeout(1500);
// 切到编辑视图让源码工具栏（含 ⋯）出现
await page.locator('[data-menubar-trigger="view"]').click();
await page.getByRole('menuitem', { name: '编辑视图' }).click();
await page.waitForTimeout(400);
const btn = page.locator('.more-tools-toggle');
console.log('btn count:', await btn.count());
console.log('btn visible:', await btn.isVisible());
if (await btn.count()) {
  const bb = await btn.boundingBox();
  console.log('btn box:', JSON.stringify(bb));
  await btn.click();
  await page.waitForTimeout(300);
  const open = await page.evaluate(() => {
    const m = document.querySelector('.more-tools');
    if (!m) return { exists: false };
    const r = m.getBoundingClientRect();
    const cs = getComputedStyle(m);
    // 找裁剪祖先
    let clippedBy = null;
    let p = m.parentElement;
    while (p && p !== document.body) {
      const pcs = getComputedStyle(p);
      if (/(hidden|clip|auto|scroll)/.test(pcs.overflow + pcs.overflowX + pcs.overflowY)) {
        const pr = p.getBoundingClientRect();
        if (r.right > pr.right + 1 || r.bottom > pr.bottom + 1 || r.left < pr.left - 1) { clippedBy = p.className.slice(0, 50); break; }
      }
      p = p.parentElement;
    }
    const hit = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + 10));
    const hitOk = !!(hit && m.contains(hit));
    return { exists: true, isOpen: m.classList.contains('is-open'), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, display: cs.display, zIndex: cs.zIndex, items: m.querySelectorAll('.header-menu-item').length, clippedBy, hitOk };
  });
  console.log('menu state:', JSON.stringify(open));
}
await browser.close();
