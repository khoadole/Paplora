/**
 * Live end-to-end check of the research journey, in a real browser against a
 * running server with real credentials. Bounded: one discovery run, two papers
 * imported, one extraction pass.
 *
 *   node scripts/research-flow.mjs [baseUrl]
 *
 * Verification aid, not part of the product. It spends a small amount of money.
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3150";
const problems = [];
const steps = [];
const ok = (label) => {
  steps.push(label);
  console.log(`  ok  ${label}`);
};
const bad = (label, detail) => {
  problems.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

try {
  await page.goto(base, { waitUntil: "networkidle" });

  // 1. Ask a research question from the home screen.
  await page.getByLabel("Research question").fill(
    "Find action recognition methods suitable for edge devices. Prioritize realtime inference and available code.",
  );
  await page.getByRole("button", { name: "Research" }).click();
  await page.waitForURL(/\/p\//, { timeout: 20000 });
  ok("home starts a research session");

  // 2. Real progress, then real candidates.
  await page.locator('input[type="checkbox"][aria-label^="Select"]').first().waitFor({ timeout: 240000 });
  const found = await page.locator('input[type="checkbox"][aria-label^="Select"]').count();
  if (found >= 3) ok(`discovery returned ${found} papers`);
  else bad("discovery returned too few papers", String(found));

  const firstTitle = (await page.locator("li a[target=_blank]").first().innerText()).slice(0, 60);
  const metaLine = await page.locator("li a[target=_blank]").first().locator("xpath=../p[1]").innerText();
  if (/\d{4}/.test(metaLine)) ok(`candidates carry indexed metadata (${metaLine.slice(0, 60)})`);
  else bad("candidate metadata missing", metaLine);

  // 3. Import two papers into the comparison.
  const boxes = page.locator('input[type="checkbox"][aria-label^="Select"]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole("button", { name: /Compare selected/ }).click();
  await page.getByRole("tab", { name: /Compare/ }).waitFor({ timeout: 180000 });
  await page.waitForTimeout(3000);
  ok("selected papers import into the session");

  // 4. Suggest comparison criteria.
  await page.getByRole("tab", { name: /Papers/ }).click();
  await page.getByLabel("Refine this research").fill("add comparison criteria");
  await page.getByRole("button", { name: "Run" }).click();
  await page.waitForTimeout(25000);
  await page.getByRole("tab", { name: /Compare/ }).click();
  const headers = await page.locator("thead th").count();
  if (headers >= 3) ok(`comparison criteria suggested (${headers - 1} columns)`);
  else bad("no criteria suggested", String(headers));

  // 5. Extract, and watch real progress.
  const extract = page.getByRole("button", { name: /Extract answers/ });
  if (await extract.isEnabled()) {
    await extract.click();
    await page.getByText(/of \d+ cells/).waitFor({ timeout: 60000 });
    ok("extraction reports real progress");
    await page.waitForFunction(() => !document.body.innerText.includes("Extracting…"), undefined, { timeout: 420000 });
    ok("extraction finishes");
  } else {
    bad("extract button disabled", await extract.getAttribute("title"));
  }

  // 6. Answers, and evidence that resolves.
  const answered = await page.evaluate(() =>
    Array.from(document.querySelectorAll("tbody td button")).filter((b) => {
      const t = b.innerText.trim();
      return t && !t.startsWith("Needs extraction") && !t.startsWith("—");
    }).length,
  );
  if (answered > 0) ok(`${answered} cells have answers`);
  else bad("no cells were answered");

  await page.locator("tbody td button").first().click();
  await page.getByRole("button", { name: "Close evidence panel" }).waitFor({ timeout: 15000 });
  const panel = await page.locator('[aria-label="Evidence"]').first().innerText();
  if (/evidence \d of \d|no passage is attached/i.test(panel)) ok("evidence panel shows the answer and its sources");
  else bad("evidence panel content", panel.slice(0, 120));

  // 7. A summary written from the stored answers.
  await page.getByRole("button", { name: "Close evidence panel" }).click();
  await page.getByRole("button", { name: "More table actions" }).click();
  await page.getByRole("menuitem", { name: /Summarise comparison/ }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Summarising…"), undefined, { timeout: 90000 });
  const summaryText = await page.getByText(/Written from the stored answers/).isVisible();
  if (summaryText) ok("comparison summary is generated");
  else bad("no summary rendered");

  // 8. Return later: everything is restored and nothing re-runs.
  const url = page.url();
  let aiCalls = 0;
  page.on("request", (r) => r.url().includes("/api/research/") && (aiCalls += 1));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  const restored = await page.locator("tbody tr").count();
  if (restored >= 2) ok(`reload restores the comparison (${restored} rows)`);
  else bad("reload lost the comparison", String(restored));
  if (aiCalls === 0) ok("reload does not re-run any AI request");
  else bad("AI re-ran on reload", `${aiCalls} calls`);

  console.log(`\n  first paper: ${firstTitle}`);
} catch (error) {
  bad("unhandled", error.message.split("\n")[0]);
} finally {
  await browser.close();
}

console.log(`\n${steps.length} checks passed`);
if (problems.length) {
  console.log("PROBLEMS:");
  for (const problem of problems) console.log(" - " + problem);
  process.exit(1);
}
