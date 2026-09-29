import { discoverPapers } from "./lib/server/discover";

async function main() {
const question =
  "Find action recognition methods suitable for edge devices. Prioritize realtime inference and available code.";
const started = Date.now();
const result = await discoverPapers(question, {
  onEvent: (e) => console.log(`  [${e.type}] ${e.message}`),
});
console.log("\nscope:", JSON.stringify(result.scope, null, 1));
console.log("searchSkipped:", result.searchSkipped, "| dropped:", result.unresolved, "| usage:", result.usage, `| ${Math.round((Date.now() - started) / 1000)}s`);
console.log("\noverview:", result.overview.slice(0, 300));
console.log(`\n${result.papers.length} papers:`);
for (const p of result.papers) {
  console.log(`- ${p.title.slice(0, 72)}`);
  console.log(`  ${p.url}`);
  console.log(
    `  meta=${p.metadataSource} year=${p.year ?? "-"} doi=${p.doi ?? "-"} authors=${(p.authors ?? "-").slice(0, 40)} coverage=${p.coverage} pdf=${p.pdfUrl ? "yes" : "no"} code=${p.codeUrl ?? "-"}`,
  );
}
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
