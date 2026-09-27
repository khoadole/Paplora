import assert from "node:assert/strict";
import test from "node:test";
import { findQuote, normalize, resolveEvidence } from "../lib/extract/match";
import { describeCoverage, planExtraction } from "../lib/extract/plan";
import { answerSchema, extractRequestSchema } from "../lib/extract/schema";
import { verifyAnswer } from "../lib/extract/verify";
import { readAiConfig, selectModel } from "../lib/extract/model";

const PAGE_ONE = `Demo document — not a scientific publication

3. Results
On the ED-Bench validation split the model reaches 81.4% top-1 accuracy at
16 frames per clip. Latency was measured on a single Jetson Orin NX at 34 ms
per clip.`;

const PAGE_TWO = `4. Limitations
The authors note that results on the held-out test split were not measured,
and that the ﬁgures above assume an input resolution of 224×224.`;

const pages = [
  { pageNumber: 1, text: PAGE_ONE },
  { pageNumber: 2, text: PAGE_TWO },
];

test("normalization folds ligatures, dashes and whitespace but keeps offsets on the original", () => {
  const { normalized, map } = normalize("the ­ﬁgures  above—here");
  assert.ok(normalized.includes("figures above-here"), normalized);
  // Every normalized character points at a real index in the source string.
  assert.equal(map.length, normalized.length);
  assert.ok(map.every((index) => index >= 0));
});

test("findQuote locates a quote across line breaks and returns verbatim original text", () => {
  const hit = findQuote(PAGE_ONE, "the model reaches 81.4% top-1 accuracy at 16 frames per clip");
  assert.ok(hit, "expected the quote to resolve");
  assert.equal(PAGE_ONE.slice(hit.start, hit.end), hit.text);
  assert.ok(hit.text.includes("81.4%"));
  // The stored quote is the document's own text, newline included, not the model's flattened copy.
  assert.ok(hit.text.includes("\n"));
});

test("findQuote matches through a ligature in the source", () => {
  const hit = findQuote(PAGE_TWO, "the figures above assume an input resolution");
  assert.ok(hit, "ligature 'ﬁ' should still match 'fi'");
  assert.ok(hit.text.includes("ﬁgures"));
});

test("findQuote rejects fabricated and too-short quotes", () => {
  assert.equal(findQuote(PAGE_ONE, "the model reaches 99.9% top-1 accuracy on ImageNet"), null);
  assert.equal(findQuote(PAGE_ONE, "results"), null, "short quotes are not evidence");
});

test("resolveEvidence falls back to the page that actually holds the quote", () => {
  const resolved = resolveEvidence(pages, 1, "an input resolution of 224×224");
  assert.ok(resolved);
  assert.equal(resolved.pageNumber, 2, "model claimed page 1; the text lives on page 2");
  assert.equal(resolved.location, "span");
});

test("verifyAnswer keeps a grounded answer and records what it read", () => {
  const answer = answerSchema.parse({
    outcome: "found",
    value: "81.4",
    unit: "% top-1",
    conditions: "ED-Bench validation split, 16 frames",
    evidence: [{ page: 1, quote: "81.4% top-1 accuracy at 16 frames per clip" }],
  });
  const result = verifyAnswer(answer, {
    versionId: "ver_1",
    pages,
    consideredPages: [1, 2],
    partialCoverage: false,
    noTextLayer: false,
    model: "test-model",
    schemaVersion: 1,
    now: 1,
  });
  assert.equal(result.status, "extracted");
  assert.equal(result.proposal?.evidence.length, 1);
  assert.equal(result.proposal?.evidence[0].location, "span");
  assert.equal(result.proposal?.conditions, "ED-Bench validation split, 16 frames");
  assert.deepEqual(result.rejectedQuotes, []);
});

test("verifyAnswer rejects an answer whose quote is not in the document", () => {
  const answer = answerSchema.parse({
    outcome: "found",
    value: "92.0",
    evidence: [{ page: 1, quote: "the model reaches 92.0% top-1 accuracy on Kinetics-400" }],
  });
  const result = verifyAnswer(answer, {
    versionId: "ver_1",
    pages,
    consideredPages: [1, 2],
    partialCoverage: false,
    noTextLayer: false,
    model: "test-model",
    schemaVersion: 1,
  });
  assert.equal(result.status, "failed", "an unverifiable claim must never become a value");
  assert.equal(result.proposal, undefined);
  assert.equal(result.rejectedQuotes.length, 1);
});

test("verifyAnswer drops only the bad span when some evidence resolves", () => {
  const answer = answerSchema.parse({
    outcome: "found",
    value: "34 ms",
    evidence: [
      { page: 1, quote: "Latency was measured on a single Jetson Orin NX at 34 ms" },
      { page: 1, quote: "measured on eight A100 GPUs" },
    ],
  });
  const result = verifyAnswer(answer, {
    versionId: "ver_1",
    pages,
    consideredPages: [1],
    partialCoverage: true,
    noTextLayer: false,
    model: "test-model",
    schemaVersion: 1,
  });
  assert.equal(result.status, "extracted");
  assert.equal(result.proposal?.evidence.length, 1);
  assert.equal(result.rejectedQuotes.length, 1);
  assert.equal(result.proposal?.partialCoverage, true);
});

test("verifyAnswer separates not-found from unreadable", () => {
  const notFound = verifyAnswer(answerSchema.parse({ outcome: "not_found", note: "no runtime reported" }), {
    versionId: "ver_1",
    pages,
    consideredPages: [1, 2],
    partialCoverage: false,
    noTextLayer: false,
    model: "m",
    schemaVersion: 1,
  });
  assert.equal(notFound.status, "not_found");

  const unreadable = verifyAnswer(answerSchema.parse({ outcome: "found", value: "x" }), {
    versionId: "ver_1",
    pages: [],
    consideredPages: [],
    partialCoverage: true,
    noTextLayer: true,
    model: "m",
    schemaVersion: 1,
  });
  assert.equal(unreadable.status, "unreadable");
});

test("planExtraction bounds each request and reports uncovered pages honestly", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    pageNumber: i + 1,
    text: i === 3 ? "" : "x".repeat(5000),
  }));
  const plan = planExtraction(many, { maxWindows: 2, maxChars: 10000, maxPages: 8 });
  assert.equal(plan.windows.length, 2);
  assert.ok(plan.consideredPages.length > 0);
  assert.ok(plan.skippedPages.length > 0, "pages past the budget are reported, not silently dropped");
  assert.deepEqual(plan.emptyPages, [4]);
  assert.equal(plan.partialCoverage, true);
  assert.match(describeCoverage(plan, 12), /Read \d+ of 12 pages/);
});

test("planExtraction reports full coverage for a short document", () => {
  const plan = planExtraction(pages);
  assert.equal(plan.partialCoverage, false);
  assert.deepEqual(plan.consideredPages, [1, 2]);
  assert.equal(describeCoverage(plan, 2), "Read all 2 pages.");
});

test("extract request validation rejects oversized and empty payloads", () => {
  assert.equal(extractRequestSchema.safeParse({}).success, false);
  const tooManyPages = {
    instruction: "find it",
    columnLabel: "Result",
    answerType: "text",
    documentTitle: "doc",
    pages: Array.from({ length: 41 }, (_, i) => ({ pageNumber: i + 1, text: "t" })),
  };
  assert.equal(extractRequestSchema.safeParse(tooManyPages).success, false);
});

test("model precedence: OPENAI_MODEL wins, alias is the fallback, no silent default", () => {
  assert.equal(selectModel({ OPENAI_MODEL: "a", OPENAI_LESSON_MODEL: "b" } as unknown as NodeJS.ProcessEnv), "a");
  assert.equal(selectModel({ OPENAI_MODEL: "  ", OPENAI_LESSON_MODEL: "b" } as unknown as NodeJS.ProcessEnv), "b");
  assert.equal(selectModel({} as unknown as NodeJS.ProcessEnv), null);

  assert.equal(readAiConfig({} as unknown as NodeJS.ProcessEnv).configured, false);
  assert.equal(
    readAiConfig({ OPENAI_API_KEY: "k" } as unknown as NodeJS.ProcessEnv).configured,
    false,
    "a key without a model must not fall back to a guessed model",
  );
  assert.equal(
    readAiConfig({ OPENAI_API_KEY: "k", OPENAI_MODEL: "m" } as unknown as NodeJS.ProcessEnv).configured,
    true,
  );
});
