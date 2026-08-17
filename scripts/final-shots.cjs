const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto("http://127.0.0.1:1420/#editor");
  await p.locator(".md-source").waitFor({ timeout: 15000 });
  await p.waitForTimeout(500);
  await p.screenshot({ path: "images/final-menubar.png" });
  await p.locator("[data-menubar-trigger=file]").click();
  await p.waitForTimeout(250);
  await p.screenshot({ path: "images/final-file-menu.png" });
  await b.close();
  console.log("shots done");
})();