/**
 * End-to-end check of the workflows in the brief, driven in a real browser.
 *
 * Creates a project, uploads a real PDF, adds a column, edits and reviews a cell,
 * filters, exports, reloads to confirm persistence, and checks the AI-off state.
 * Fails on any console error.
 *
 *   node scripts/flow.mjs [baseUrl]
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3127";
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

  // 1. Create a project.
  await page.getByRole("button", { name: "Create a project" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Edge action recognition");
  await page.getByLabel(/Research question/).fill("Which methods run in real time on embedded hardware?");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("heading", { name: "Edge action recognition" }).waitFor({ timeout: 10000 });
  ok("create a project with a research question");

  // 2. Upload a real PDF through the file input.
  await page.getByRole("button", { name: /Add papers/ }).click();
  await page.setInputFiles('input[type="file"]', "public/samples/demo-framelite.pdf");
  await page.getByText(/added/).first().waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Done" }).click();
  ok("upload a PDF and see it parsed");

  // 3. Add a column from scratch.
  await page.getByRole("button", { name: /Add column/ }).click();
  await page.getByLabel("Label", { exact: true }).fill("Reported accuracy");
  await page.getByLabel("Extraction instruction").fill("The headline top-1 accuracy with its conditions.");
  await page.getByRole("button", { name: "Add column", exact: true }).last().click();
  await page.getByRole("table").waitFor({ timeout: 10000 });
  ok("add a column");

  // 3b. Add a preset so the table is genuinely wider than the viewport.
  await page.getByRole("button", { name: /Add column/ }).click();
  await page.getByRole("button", { name: /Add \d+ columns/ }).last().click();
  await page.waitForTimeout(600);
  const columnCount = await page.locator("thead th").count();
  if (columnCount > 6) ok(`add a preset (${columnCount - 1} data columns)`);
  else bad("add a preset", `${columnCount} headers`);

  // 4. Select a cell; the evidence panel opens.
  await page.locator("tbody td button").first().click();
  await page.getByRole("button", { name: "Close evidence panel" }).waitFor({ timeout: 10000 });
  ok("selecting a cell opens the evidence panel");

  // 5. Edit the answer by hand and save it.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Answer", { exact: true }).fill("81.4");
  await page.getByLabel("Unit", { exact: true }).fill("% top-1");
  await page.getByLabel("Conditions", { exact: true }).fill("ED-Bench validation split");
  await page.getByRole("button", { name: "Save as my answer" }).click();
  await page.locator('[aria-label="Evidence"]').getByText("Reviewed").first().waitFor({ timeout: 20000 });
  ok("edit a cell; saving it counts as reviewed");

  // 6. Scroll the table sideways, select a visible cell, then toggle and resize the
  // panel: the scroll offset must not move. (Selecting a cell that is only partly
  // visible does scroll it into view — that is the browser, and it is wanted.)
  const scrollOf = () => page.evaluate(() => document.querySelector("table")?.closest("div")?.scrollLeft ?? -1);
  await page.evaluate(() => {
    const scroller = document.querySelector("table")?.closest("div");
    if (scroller) scroller.scrollLeft = 200;
  });
  await page.waitForTimeout(200);
  await page.locator("tbody td button").nth(3).click();
  await page.waitForTimeout(500);
  const selectedAt = await scrollOf();

  const withPanel = await page.evaluate(() => document.querySelector("table")?.closest("div")?.clientWidth ?? 0);
  await page.getByRole("button", { name: "Close evidence panel" }).click();
  await page.waitForTimeout(400);
  const withoutPanel = await page.evaluate(() => document.querySelector("table")?.closest("div")?.clientWidth ?? 0);
  const afterClose = await scrollOf();
  if (withoutPanel > withPanel) ok(`closing the panel returns width (${withPanel} → ${withoutPanel})`);
  else bad("closing the panel returns width", `${withPanel} → ${withoutPanel}`);

  // Reopen on the same cell — now fully visible, so no scroll-into-view.
  await page.locator("tbody td button").nth(3).click();
  await page.waitForTimeout(400);
  const afterReopen = await scrollOf();

  // Resize the panel with the keyboard.
  await page.getByRole("separator", { name: "Resize evidence panel" }).focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(400);
  const afterResize = await scrollOf();

  if (selectedAt > 0 && afterClose === selectedAt && afterReopen === selectedAt && afterResize === selectedAt) {
    ok(`table scroll position survives close, reopen and resize (${selectedAt}px)`);
  } else {
    bad(
      "table scroll position survives the panel",
      `selected ${selectedAt} → closed ${afterClose} → reopened ${afterReopen} → resized ${afterResize}`,
    );
  }

  // 7. Filter rows.
  await page.getByLabel("Search papers and answers").fill("nothing-matches-this");
  await page.waitForTimeout(300);
  const emptyCount = await page.locator("tbody tr").count();
  await page.getByLabel("Search papers and answers").fill("");
  await page.waitForTimeout(300);
  const fullCount = await page.locator("tbody tr").count();
  if (emptyCount === 0 && fullCount > 0) ok("filtering rows");
  else bad("filtering rows", `${emptyCount} filtered / ${fullCount} unfiltered`);

  // 8. Export the comparison CSV.
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    (async () => {
      await page.getByRole("button", { name: "Export" }).click();
      await page.getByRole("menuitem", { name: /Comparison table/ }).click();
    })(),
  ]);
  if ((await download.suggestedFilename()).endsWith(".csv")) ok(`export CSV (${await download.suggestedFilename()})`);
  else bad("export CSV");

  // 9. Reload and confirm the workspace came back.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Edge action recognition" }).waitFor({ timeout: 15000 });
  const survived = await page.getByText("81.4").first().isVisible();
  if (survived) ok("data survives a reload");
  else bad("data survives a reload");

  // 10. AI-off behaviour: the button is disabled and explains itself.
  const extract = page.getByRole("button", { name: /Extract data/ });
  const disabled = await extract.isDisabled();
  const reason = await extract.getAttribute("title");
  if (disabled && reason && /OPENAI|extraction is off|not configured/i.test(reason)) {
    ok(`"Extract data" is disabled and says why: "${reason.slice(0, 60)}…"`);
  } else {
    bad("AI-off explanation", `disabled=${disabled} title=${reason}`);
  }
  const statusChip = await page.getByRole("button", { name: /AI not connected/ }).isVisible();
  if (statusChip) ok("compact 'AI not connected' status is present instead of a banner");
  else bad("AI status chip");

  // 11. Sidebar collapse persists across a reload.
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const stillCollapsed = await page.getByRole("button", { name: "Expand sidebar" }).isVisible();
  if (stillCollapsed) ok("sidebar preference persists");
  else bad("sidebar preference persists");
} catch (error) {
  bad("unhandled", error.message.split("\n")[0]);
  await page.screenshot({ path: "/tmp/paplora-flow-failure.png" }).catch(() => {});
} finally {
  await browser.close();
}

console.log(`\n${steps.length} checks passed`);
if (problems.length) {
  console.log("PROBLEMS:");
  for (const problem of problems) console.log(" - " + problem);
  process.exit(1);
}
