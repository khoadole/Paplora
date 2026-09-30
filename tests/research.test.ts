import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { openDB } from "idb";
import { IndexedDBRepository } from "../lib/repo";
import type { PaploraSchema } from "../lib/db";
import { abstractFromIndex, titlesMatch, doiFromUrl, arxivIdFromUrl } from "../lib/server/openalex";
import { sectionsFromHtml } from "../lib/research";
import { verifyAnswer } from "../lib/extract/verify";
import { answerSchema } from "../lib/extract/schema";
import { parsePublicUrl, isPublicAddress } from "../lib/server/safe-fetch";
import type { PaperCandidate } from "../lib/types";

/** Research-pipeline behaviour: grounding, identity, coverage and fetch safety. */

let counter = 0;
function freshRepo() {
  const name = `paplora-research-${counter++}`;
  const open = () =>
    openDB<PaploraSchema>(name, 2, {
      upgrade(db) {
        db.createObjectStore("projects", { keyPath: "id" });
        const sources = db.createObjectStore("sources", { keyPath: "id" });
        sources.createIndex("contentHash", "contentHash");
        const versions = db.createObjectStore("versions", { keyPath: "id" });
        versions.createIndex("sourceId", "sourceId");
        const pages = db.createObjectStore("pages", { keyPath: "id" });
        pages.createIndex("versionId", "versionId");
        db.createObjectStore("blobs", { keyPath: "id" });
        const ps = db.createObjectStore("projectSources", { keyPath: ["projectId", "sourceId"] });
        ps.createIndex("projectId", "projectId");
        ps.createIndex("sourceId", "sourceId");
        const columns = db.createObjectStore("columns", { keyPath: "id" });
        columns.createIndex("projectId", "projectId");
        const rows = db.createObjectStore("rows", { keyPath: "id" });
        rows.createIndex("projectId", "projectId");
        rows.createIndex("sourceId", "sourceId");
        const cells = db.createObjectStore("cells", { keyPath: "id" });
        cells.createIndex("projectId", "projectId");
        cells.createIndex("rowId", "rowId");
        cells.createIndex("columnId", "columnId");
        const jobs = db.createObjectStore("jobs", { keyPath: "id" });
        jobs.createIndex("projectId", "projectId");
        const candidates = db.createObjectStore("candidates", { keyPath: "id" });
        candidates.createIndex("projectId", "projectId");
        db.createObjectStore("preferences", { keyPath: "id" });
      },
    });
  return new IndexedDBRepository(open as never);
}

const candidate = (over: Partial<PaperCandidate> = {}): Omit<PaperCandidate, "id" | "projectId" | "createdAt"> => ({
  title: "EdgeOAR: Real-Time Online Action Recognition on Edge Devices",
  url: "https://doi.org/10.1109/tmc.2025.3591188",
  coverage: "metadata",
  doi: "10.1109/tmc.2025.3591188",
  ...over,
});

test("the same paper from two URLs becomes one document and one row", async () => {
  const repo = freshRepo();
  const project = await repo.createProject({ title: "P" });
  const bytes = new TextEncoder().encode("%PDF-1.4 paper").buffer as ArrayBuffer;

  const first = await repo.createSource({
    title: "EdgeOAR",
    filename: "a.pdf",
    contentHash: "hash-a",
    bytes,
    kind: "web",
    url: "https://doi.org/10.1109/tmc.2025.3591188",
    doi: "10.1109/tmc.2025.3591188",
  });
  await repo.addSourceToProject(project.id, first.source.id);

  // The same DOI arriving from a different URL must resolve to the document already held.
  const existing = await repo.findSourceByIdentity({
    doi: "10.1109/TMC.2025.3591188",
    url: "https://ieeexplore.ieee.org/document/11091234",
  });
  assert.equal(existing?.id, first.source.id, "identity is the DOI, not the URL it arrived on");

  await repo.addSourceToProject(project.id, existing!.id);
  assert.equal((await repo.listRows(project.id)).length, 1, "no duplicate row for the same paper");
  assert.equal((await repo.listSources()).length, 1);
});

test("discovery results are saved once, even when a later run repeats them", async () => {
  const repo = freshRepo();
  const project = await repo.createProject({ title: "P" });
  const saved = await repo.saveCandidates(project.id, [candidate(), candidate({ title: "Another paper", doi: "10.1/x" })]);
  assert.equal(saved.length, 2);

  const again = await repo.saveCandidates(project.id, [
    candidate({ url: "https://ieeexplore.ieee.org/document/11091234" }),
    candidate({ title: "Third", doi: "10.1/y" }),
  ]);
  assert.equal(again.length, 1, "the repeated DOI is not stored twice");
  assert.equal((await repo.listCandidates(project.id)).length, 3);
});

test("evidence from a web source resolves to its section, not a page number", () => {
  const pages = [
    { pageNumber: 1, label: "Abstract", text: "We present a streaming recogniser for embedded hardware." },
    {
      pageNumber: 2,
      label: "Results",
      text: "On the benchmark the model reaches 81.4% accuracy at 34 ms per clip on a Jetson Orin NX.",
    },
  ];
  const result = verifyAnswer(
    answerSchema.parse({
      outcome: "found",
      value: "34 ms per clip",
      conditions: "Jetson Orin NX",
      evidence: [{ page: 1, quote: "reaches 81.4% accuracy at 34 ms per clip on a Jetson Orin NX" }],
    }),
    {
      versionId: "ver_web",
      pages,
      consideredPages: [1, 2],
      partialCoverage: false,
      noTextLayer: false,
      coverage: "fulltext",
      model: "test",
      schemaVersion: 1,
    },
  );
  assert.equal(result.status, "extracted");
  const span = result.proposal!.evidence[0];
  assert.equal(span.pageNumber, 2, "the quote lives in the second section, whatever page the model claimed");
  assert.equal(span.location, "section");
  assert.equal(span.sectionLabel, "Results");
});

test("an answer read only from an abstract carries that coverage into the proposal", () => {
  const result = verifyAnswer(
    answerSchema.parse({
      outcome: "found",
      value: "streaming recognition",
      evidence: [{ page: 1, quote: "a streaming recogniser for embedded hardware" }],
    }),
    {
      versionId: "ver_abs",
      pages: [{ pageNumber: 1, label: "Abstract", text: "We present a streaming recogniser for embedded hardware." }],
      consideredPages: [1],
      partialCoverage: false,
      noTextLayer: false,
      coverage: "abstract",
      model: "test",
      schemaVersion: 1,
    },
  );
  assert.equal(result.proposal?.coverage, "abstract");
});

test("HTML is split into sections that keep their headings", () => {
  const sections = sectionsFromHtml(`
    <html><body>
      <nav>skip me</nav>
      <h1>A paper title</h1><p>${"Intro text. ".repeat(20)}</p>
      <h2>Results</h2><p>${"We report 81.4% accuracy. ".repeat(10)}</p>
      <script>console.log("ignored")</script>
    </body></html>
  `);
  assert.ok(sections.length >= 2);
  const results = sections.find((s) => s.label === "Results");
  assert.ok(results, "section headings are preserved");
  assert.match(results!.text, /81\.4% accuracy/);
  assert.ok(!sections.some((s) => /console\.log|skip me/.test(s.text)), "scripts and navigation are dropped");
});

test("identifiers are read from URLs rather than guessed", () => {
  assert.equal(doiFromUrl("https://doi.org/10.1016/j.patrec.2021.02.001"), "10.1016/j.patrec.2021.02.001");
  assert.equal(doiFromUrl("https://example.com/paper"), undefined);
  assert.equal(arxivIdFromUrl("https://arxiv.org/abs/2412.01267"), "2412.01267");
  assert.equal(arxivIdFromUrl("https://arxiv.org/pdf/2412.01267"), "2412.01267");
});

test("title matching accepts the same paper and rejects a different one", () => {
  assert.equal(
    titlesMatch("EdgeOAR: Real-Time Online Action Recognition on Edge Devices", "EdgeOAR: Real-time Online Action Recognition On Edge Devices"),
    true,
  );
  assert.equal(titlesMatch("A Survey on Causal Inference", "EdgeOAR: Real-Time Online Action Recognition"), false);
  assert.equal(titlesMatch("Short", "Short"), true);
  assert.equal(titlesMatch("Deep learning", "Deep learning for radiology"), false, "a prefix is not a match");
});

test("a paper still matches its own title when cited with an acronym label", () => {
  // The prefix comparison this replaced rejected exactly this pair, so a paper
  // the model named correctly was dropped as "not in the index".
  assert.equal(
    titlesMatch(
      "ST-GCN: Spatial Temporal Graph Convolutional Networks for Skeleton-Based Action Recognition",
      "Spatial Temporal Graph Convolutional Networks for Skeleton-Based Action Recognition",
    ),
    true,
  );
  assert.equal(
    titlesMatch(
      "Channel-wise Topology Refinement Graph Convolution for Skeleton-Based Action Recognition",
      "Channel-Wise Topology Refinement Graph Convolution for Skeleton-based Action Recognition",
    ),
    true,
  );
  // A paper is not its own survey, and a shared topic is not a shared identity.
  assert.equal(
    titlesMatch(
      "Spatial Temporal Graph Convolutional Networks for Skeleton-Based Action Recognition",
      "A Survey of Graph Convolutional Networks for Skeleton-Based Action Recognition in Video Understanding",
    ),
    false,
  );
  assert.equal(titlesMatch("Deep learning", "Deep learning for radiology"), false);
});

test("abstracts are rebuilt from the inverted index in word order", () => {
  const text = abstractFromIndex({ We: [0], present: [1], a: [2], streaming: [3], recogniser: [4], "for embedded hardware.": [5] });
  assert.equal(text, "We present a streaming recogniser for embedded hardware.");
  assert.equal(abstractFromIndex(null), undefined);
  assert.equal(abstractFromIndex({ short: [0] }), undefined, "a fragment is not an abstract");
});

test("source fetching refuses anything that is not a public website", () => {
  for (const bad of [
    "http://127.0.0.1/admin",
    "http://localhost:3000/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/internal",
    "file:///etc/passwd",
    "http://user:pass@example.com/",
    "http://example.com:8080/",
  ]) {
    assert.throws(() => parsePublicUrl(bad), new RegExp("."), `${bad} must be refused`);
  }
  assert.equal(parsePublicUrl("https://arxiv.org/abs/2412.01267").host, "arxiv.org");
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("169.254.169.254"), false);
  assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
});
