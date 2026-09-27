import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SAMPLE_DOCS } from "../lib/sample/documents";
import { SAMPLE_COLUMNS, SAMPLE_FIXTURES } from "../lib/sample/data";
import { verifyAnswer } from "../lib/extract/verify";

/**
 * The sample project must be honest about itself: every fixture quote has to be
 * present in the document it points at. If a demo document is edited without
 * updating the fixtures, this fails here rather than shipping a demo that shows
 * evidence which does not exist.
 */

const pagesFor = (slug: string) => {
  const doc = SAMPLE_DOCS.find((d) => d.slug === slug);
  assert.ok(doc, `unknown sample document ${slug}`);
  return doc.pages.map((lines, index) => ({ pageNumber: index + 1, text: lines.join("\n") }));
};

test("every sample fixture quote resolves inside its own demo document", () => {
  for (const [slug, columns] of Object.entries(SAMPLE_FIXTURES)) {
    const pages = pagesFor(slug);
    for (const [columnKey, answer] of Object.entries(columns)) {
      const result = verifyAnswer(answer, {
        versionId: `ver_${slug}`,
        pages,
        consideredPages: pages.map((p) => p.pageNumber),
        partialCoverage: false,
        noTextLayer: false,
        model: "sample fixture",
        schemaVersion: 1,
        now: 0,
      });
      assert.deepEqual(
        result.rejectedQuotes,
        [],
        `${slug}.${columnKey} quotes must exist in the document`,
      );
      assert.notEqual(result.status, "failed", `${slug}.${columnKey} must verify`);
    }
  }
});

test("the sample covers a genuinely found, an ambiguous and a not-found cell", () => {
  const statuses = new Set<string>();
  for (const [slug, columns] of Object.entries(SAMPLE_FIXTURES)) {
    const pages = pagesFor(slug);
    for (const answer of Object.values(columns)) {
      statuses.add(
        verifyAnswer(answer, {
          versionId: `ver_${slug}`,
          pages,
          consideredPages: pages.map((p) => p.pageNumber),
          partialCoverage: false,
          noTextLayer: false,
          model: "sample fixture",
          schemaVersion: 1,
        }).status,
      );
    }
  }
  for (const expected of ["extracted", "ambiguous", "not_found"]) {
    assert.ok(statuses.has(expected), `sample should demonstrate a ${expected} cell`);
  }
});

test("the sample shows conditions that are not comparable across papers", () => {
  const evaluation = Object.entries(SAMPLE_FIXTURES).map(([slug, columns]) => ({
    slug,
    value: columns.evaluation.value,
  }));
  const splits = new Set(evaluation.map((e) => (e.value.includes("test") ? "test" : "validation")));
  assert.equal(splits.size, 2, "papers must disagree on the split so the demo shows the trap");

  const runtimes = Object.entries(SAMPLE_FIXTURES)
    .map(([, columns]) => columns.runtime.conditions)
    .filter(Boolean);
  assert.ok(
    runtimes.some((c) => /A100|datacentre/i.test(c)) && runtimes.some((c) => /Jetson|embedded/i.test(c)),
    "runtime numbers must come from different hardware classes",
  );
});

test("every sample fixture column exists in the sample column set", () => {
  const keys = new Set(SAMPLE_COLUMNS.map((c) => c.key));
  for (const [slug, columns] of Object.entries(SAMPLE_FIXTURES)) {
    for (const key of Object.keys(columns)) {
      assert.ok(keys.has(key), `${slug} refers to unknown column ${key}`);
    }
    assert.equal(Object.keys(columns).length, keys.size, `${slug} should fill every sample column`);
  }
});

test("the generated demo PDFs exist and are labelled as demos", () => {
  for (const doc of SAMPLE_DOCS) {
    const bytes = readFileSync(`public/samples/${doc.filename}`);
    assert.ok(bytes.length > 500, `${doc.filename} looks empty — run npm run samples`);
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    // Every page of every demo document carries the banner.
    for (const page of doc.pages) {
      assert.equal(page[0], "Demo document — not a scientific publication");
    }
  }
});
