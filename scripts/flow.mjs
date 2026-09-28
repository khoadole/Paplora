/**
 * End-to-end check of the workflows, driven in a real browser against the running
 * app. Verification aid, not part of the product. Fails on any console error.
 *
 *   node scripts/flow.mjs [baseUrl]
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3141";
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

const scrollOf = () => page.evaluate(() => document.querySelector("table")?.closest("div")?.scrollLeft ?? -1);
const tableWidth = () => page.evaluate(() => document.querySelector("table")?.closest("div")?.clientWidth ?? 0);

try {
  // 1. The home screen creates a project from a research question.
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByText("What are you researching?").waitFor({ timeout: 15000 });
  await page.getByLabel("Research question").fill("How do these methods differ in runtime and accuracy?");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/p\//, { timeout: 15000 });
  await page.getByRole("tab", { name: /Papers/ }).waitFor({ timeout: 15000 });
  ok("home creates a project from a question and opens it on Papers");

  // 2. Empty project explains the next step.
  if (await page.getByText("Add papers to start your comparison.").isVisible()) {
    ok("empty project states the next step");
  } else {
    bad("empty project copy");
  }

  // 3. Upload real PDFs.
  await page.getByRole("button", { name: /Upload PDFs/ }).click();
  await page.setInputFiles('input[type="file"]', [
    "public/samples/demo-framelite.pdf",
    "public/samples/demo-motiontiny.pdf",
  ]);
  await page.getByRole("link", { name: /FrameLite/ }).waitFor({ timeout: 90000 });
  ok("upload PDFs and see them listed as papers");

  // 4. The paper title opens the reader, which offers a way back.
  await page.getByRole("link", { name: /FrameLite/ }).click();
  await page.waitForURL(/\/paper\//, { timeout: 15000 });
  await page.getByRole("link", { name: "Back to the project" }).click();
  await page.waitForURL(/\/p\/[^/]+(\?|$)/, { timeout: 15000 });
  ok("paper title opens the reader and returns");

  // 5. Compare tab, then a column from the Columns menu.
  await page.getByRole("tab", { name: /Compare/ }).click();
  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("menuitem", { name: /New column/ }).click();
  await page.getByLabel("Label", { exact: true }).fill("Reported accuracy");
  await page.getByLabel("Extraction instruction").fill("The headline accuracy with its conditions.");
  await page.getByRole("button", { name: "Add column", exact: true }).last().click();
  await page.getByRole("table").waitFor({ timeout: 15000 });
  ok("add a column from the Columns menu");

  // 6. Selecting a cell opens evidence and puts the cell in the URL.
  await page.locator("tbody td button").first().click();
  await page.getByRole("button", { name: "Close evidence panel" }).waitFor({ timeout: 10000 });
  if (page.url().includes("cell=")) ok("selected cell is addressable in the URL");
  else bad("cell deep link", page.url());

  // 7. Edit an answer; saving counts as reviewed.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Answer", { exact: true }).fill("81.4");
  await page.getByLabel("Unit", { exact: true }).fill("% top-1");
  await page.getByLabel("Conditions", { exact: true }).fill("ED-Bench validation split");
  await page.getByRole("button", { name: "Save as my answer" }).click();
  await page.locator('[aria-label="Evidence"]').getByText("Reviewed").first().waitFor({ timeout: 20000 });
  ok("edit a cell; saving it counts as reviewed");

  // 8. Scroll, close the panel: the table keeps its position and gets its width back.
  await page.evaluate(() => {
    const scroller = document.querySelector("table")?.closest("div");
    if (scroller) scroller.scrollLeft = 150;
  });
  await page.waitForTimeout(200);
  const selectedAt = await scrollOf();
  const withPanel = await tableWidth();
  await page.getByRole("button", { name: "Close evidence panel" }).click();
  await page.waitForTimeout(400);
  const withoutPanel = await tableWidth();
  const afterClose = await scrollOf();
  if (withoutPanel > withPanel) ok(`closing the panel returns width (${withPanel} → ${withoutPanel})`);
  else bad("closing the panel returns width", `${withPanel} → ${withoutPanel}`);
  if (afterClose === selectedAt) ok(`table scroll position survives the panel (${selectedAt}px)`);
  else bad("table scroll survives the panel", `${selectedAt} → ${afterClose}`);

  // 9. Filter.
  await page.getByLabel("Search papers and answers").fill("zzz-no-match");
  await page.waitForTimeout(300);
  const filtered = await page.locator("tbody tr").count();
  await page.getByLabel("Search papers and answers").fill("");
  await page.waitForTimeout(300);
  const unfiltered = await page.locator("tbody tr").count();
  if (filtered === 0 && unfiltered > 0) ok("filtering rows");
  else bad("filtering rows", `${filtered} / ${unfiltered}`);

  // 10. Export from the secondary menu.
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    (async () => {
      await page.getByRole("button", { name: "More table actions" }).click();
      await page.getByRole("menuitem", { name: /Export comparison/ }).click();
    })(),
  ]);
  if ((await download.suggestedFilename()).endsWith(".csv")) ok(`export CSV (${await download.suggestedFilename()})`);
  else bad("export CSV");

  // 11. Reload the project route; the work is still there.
  const projectUrl = page.url().split("?")[0];
  await page.goto(`${projectUrl}?tab=compare`, { waitUntil: "networkidle" });
  await page.getByRole("table").waitFor({ timeout: 15000 });
  if (await page.getByText("81.4").first().isVisible()) ok("data survives a reload");
  else bad("data survives a reload");

  // 12. Extraction is off and says why, next to the action.
  const disabled = await page.getByRole("button", { name: /Extract answers/ }).isDisabled();
  const reason = await page.getByText(/Automatic extraction is off/).first().isVisible();
  if (disabled && reason) ok("extraction is disabled and explained beside the action");
  else bad("AI-off explanation", `disabled=${disabled} reasonVisible=${reason}`);

  // 13. Escape closes a dialog.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog").waitFor({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  if ((await page.getByRole("dialog").count()) === 0) ok("Escape closes dialogs");
  else bad("Escape closes dialogs");

  // 14. Sidebar preference persists.
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  if (await page.getByRole("button", { name: "Expand sidebar" }).isVisible()) ok("sidebar preference persists");
  else bad("sidebar preference persists");
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
