/**
 * Drives the running app in headless Chromium and writes screenshots.
 *
 * This is a verification aid, not part of the product: it exercises the sample
 * project, the evidence panel and the review actions at four viewports, and
 * fails loudly on console errors so a broken layout cannot pass quietly.
 *
 *   node scripts/shots.mjs [baseUrl] [outDir]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3123";
const out = process.argv[3] ?? "/tmp/paplora-shots";
mkdirSync(out, { recursive: true });

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "390x844", width: 390, height: 844 },
];

const errors = [];

async function shot(page, name) {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  shot ${name}`);
}

const browser = await chromium.launch();
try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`[${viewport.name}] ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`[${viewport.name}] pageerror: ${error.message}`));

    console.log(`\n== ${viewport.name}`);
    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Explore sample project/i }).waitFor({ timeout: 15000 });
    await shot(page, `${viewport.name}-01-empty`);

    // Build the sample project: real PDFs, real parsing, real verification.
    await page.getByRole("button", { name: /Explore sample project/i }).click();
    await page.getByRole("table").waitFor({ timeout: 90000 });
    await page.waitForTimeout(1200);
    await shot(page, `${viewport.name}-02-table`);

    // How many comparison columns are actually visible without scrolling?
    const metrics = await page.evaluate(() => {
      const table = document.querySelector("table");
      const scroller = table?.closest("div");
      if (!table || !scroller) return null;
      const box = scroller.getBoundingClientRect();
      const heads = Array.from(table.querySelectorAll("thead th"));
      const visible = heads.filter((th) => {
        const r = th.getBoundingClientRect();
        return r.left >= box.left - 1 && r.right <= box.right + 1;
      });
      return {
        headers: heads.length,
        fullyVisible: visible.length,
        labels: visible.map((th) => th.textContent.trim().slice(0, 24)),
        pageScrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    console.log(`  columns fully visible: ${metrics?.fullyVisible}/${metrics?.headers}`, metrics?.labels);
    if (metrics?.pageScrollsX) errors.push(`[${viewport.name}] the PAGE scrolls horizontally; only the table should`);
    if (viewport.width >= 1440 && (metrics?.fullyVisible ?? 0) < 4) {
      errors.push(`[${viewport.name}] only ${metrics?.fullyVisible} columns visible (want paper + 3 data columns)`);
    }

    // Open evidence for a cell that has citations.
    const cells = page.locator("tbody td button");
    await cells.first().click();
    await page.waitForTimeout(900);
    await shot(page, `${viewport.name}-03-evidence`);

    // Close it and confirm the table takes the width back.
    const widthWithPanel = await page.evaluate(() => document.querySelector("table")?.closest("div")?.clientWidth ?? 0);
    await page.getByRole("button", { name: /Close evidence panel/i }).click();
    await page.waitForTimeout(500);
    const widthWithoutPanel = await page.evaluate(
      () => document.querySelector("table")?.closest("div")?.clientWidth ?? 0,
    );
    if (viewport.width >= 1024 && widthWithoutPanel <= widthWithPanel) {
      errors.push(`[${viewport.name}] closing the panel did not give width back (${widthWithPanel} → ${widthWithoutPanel})`);
    }
    await shot(page, `${viewport.name}-04-closed`);

    if (viewport.width >= 1440) {
      // Review flow: open a cell, mark it reviewed, confirm the badge changes.
      await cells.first().click();
      await page.waitForTimeout(600);
      const review = page.getByRole("button", { name: /^Mark reviewed$/ });
      if (await review.isEnabled()) {
        await review.click();
        await page.waitForTimeout(700);
      }
      await shot(page, `${viewport.name}-05-reviewed`);

      // Settings, where the AI configuration explanation lives.
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /Close evidence panel/i }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.waitForTimeout(500);
      await shot(page, `${viewport.name}-06-settings`);
      await page.keyboard.press("Escape");
    }

    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\nscreenshots in ${out}`);
if (errors.length) {
  console.log("\nPROBLEMS:");
  for (const error of errors) console.log(" - " + error);
  process.exit(1);
}
console.log("no console errors, no layout problems detected");
