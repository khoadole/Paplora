import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { openDB } from "idb";
import { IndexedDBRepository } from "../lib/repo";
import type { PaploraSchema } from "../lib/db";
import { startExtraction, resumeExtraction, targetKey } from "../lib/runner";
import type { ModelAnswer } from "../lib/extract/schema";

/**
 * Runner behaviour against a fixture "model". These prove sequencing, coverage,
 * cancellation, retry and that a human answer survives re-extraction. They prove
 * nothing about real model accuracy — no live call is made anywhere here.
 */

let counter = 0;
function freshRepo() {
  const name = `paplora-runner-${counter++}`;
  const open = () =>
    openDB<PaploraSchema>(name, 1, {
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
        db.createObjectStore("preferences", { keyPath: "id" });
      },
    });
  return new IndexedDBRepository(open as never);
}

const PAGES = [
  "Introduction. This demo document describes a fictional method for testing.",
  "Results. The system reaches 81.4% top-1 accuracy on the demo validation split.",
  "Limitations. Latency was not measured on embedded hardware in this fictional study.",
];

async function scaffold() {
  const repo = freshRepo();
  const project = await repo.createProject({ title: "P", question: "Which is fastest?" });
  const { source, version } = await repo.createSource({
    title: "Demo paper",
    filename: "demo.pdf",
    contentHash: `h${counter}`,
    bytes: new TextEncoder().encode("%PDF-1.4").buffer as ArrayBuffer,
  });
  await repo.savePages(
    version.id,
    PAGES.map((text, index) => ({
      id: `${version.id}:${index + 1}`,
      versionId: version.id,
      pageNumber: index + 1,
      text,
      width: 595,
      height: 842,
      items: [],
    })),
  );
  await repo.updateVersion(version.id, { pageCount: 3, parseStatus: "parsed", pagesWithText: 3 });
  const row = (await repo.addSourceToProject(project.id, source.id))!;
  const column = await repo.createColumn({
    projectId: project.id,
    label: "Accuracy",
    instruction: "top-1 accuracy",
    answerType: "number",
    unit: "%",
  });
  return { repo, project, row, column, versionId: version.id };
}

/** A fetch stand-in that answers with the given answers in order. */
function fakeFetch(answers: (ModelAnswer | { status: number; code?: string })[]) {
  const calls: { pages: number[] }[] = [];
  let index = 0;
  const impl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { pages: { pageNumber: number }[] };
    calls.push({ pages: body.pages.map((p) => p.pageNumber) });
    const next = answers[Math.min(index, answers.length - 1)];
    index += 1;
    if (next && "status" in next) {
      return new Response(JSON.stringify({ error: "boom", code: next.code ?? "retryable" }), { status: next.status });
    }
    return new Response(JSON.stringify({ answer: next, model: "fixture-model" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const answer = (a: Partial<ModelAnswer> & Pick<ModelAnswer, "outcome">): ModelAnswer => ({
  value: "",
  unit: "",
  conditions: "",
  note: "",
  evidence: [],
  ...a,
});

test("a verified answer stops the page walk and records the pages that were read", async () => {
  const { repo, project, row, column } = await scaffold();
  const { impl, calls } = fakeFetch([
    answer({ outcome: "found", value: "81.4", evidence: [{ page: 2, quote: "81.4% top-1 accuracy on the demo validation split" }] }),
  ]);

  const run = await startExtraction({
    repo,
    projectId: project.id,
    question: "",
    rows: [row],
    columns: [column],
    targets: [{ rowId: row.id, columnId: column.id }],
    onUpdate: () => {},
    fetchImpl: impl,
  });
  const finished = await run.done;

  assert.equal(finished.stage, "done");
  assert.equal(calls.length, 1, "one window sufficed; no further requests were made");
  const cell = await repo.getCell(row.id, column.id);
  assert.equal(cell?.status, "extracted");
  assert.equal(cell?.proposal?.value, "81.4");
  assert.equal(cell?.proposal?.evidence[0].pageNumber, 2);
  assert.deepEqual(cell?.proposal?.pagesConsidered, [1, 2, 3]);
});

test("a fabricated quote never becomes a value", async () => {
  const { repo, project, row, column } = await scaffold();
  const { impl } = fakeFetch([
    answer({ outcome: "found", value: "99.9", evidence: [{ page: 2, quote: "reaches 99.9% accuracy on ImageNet-21k" }] }),
  ]);
  const run = await startExtraction({
    repo,
    projectId: project.id,
    question: "",
    rows: [row],
    columns: [column],
    targets: [{ rowId: row.id, columnId: column.id }],
    onUpdate: () => {},
    fetchImpl: impl,
  });
  await run.done;
  const cell = await repo.getCell(row.id, column.id);
  assert.equal(cell?.status, "failed");
  assert.equal(cell?.proposal, undefined);
});

test("a retryable failure is retried, a fatal one is not", async () => {
  const { repo, project, row, column } = await scaffold();
  const retryable = fakeFetch([
    { status: 502, code: "retryable" },
    answer({ outcome: "found", value: "81.4", evidence: [{ page: 2, quote: "81.4% top-1 accuracy on the demo validation split" }] }),
  ]);
  const run = await startExtraction({
    repo,
    projectId: project.id,
    question: "",
    rows: [row],
    columns: [column],
    targets: [{ rowId: row.id, columnId: column.id }],
    onUpdate: () => {},
    fetchImpl: retryable.impl,
  });
  await run.done;
  assert.equal(retryable.calls.length, 2, "the retryable failure was retried once");
  assert.equal((await repo.getCell(row.id, column.id))?.status, "extracted");

  const fatal = await scaffold();
  const fatalFetch = fakeFetch([{ status: 400, code: "fatal" }]);
  const second = await startExtraction({
    repo: fatal.repo,
    projectId: fatal.project.id,
    question: "",
    rows: [fatal.row],
    columns: [fatal.column],
    targets: [{ rowId: fatal.row.id, columnId: fatal.column.id }],
    onUpdate: () => {},
    fetchImpl: fatalFetch.impl,
  });
  const finished = await second.done;
  assert.equal(fatalFetch.calls.length, 1, "a fatal error is not retried");
  assert.equal(finished.failed, 1);
  assert.equal((await fatal.repo.getCell(fatal.row.id, fatal.column.id))?.status, "failed");
});

test("cancelling stops the run and the job records it", async () => {
  const { repo, project, row, column } = await scaffold();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const impl = (async () => {
    await gate;
    return new Response(JSON.stringify({ answer: answer({ outcome: "not_found" }), model: "fixture-model" }), { status: 200 });
  }) as unknown as typeof fetch;

  const run = await startExtraction({
    repo,
    projectId: project.id,
    question: "",
    rows: [row],
    columns: [column],
    targets: [{ rowId: row.id, columnId: column.id }],
    onUpdate: () => {},
    fetchImpl: impl,
  });
  run.cancel();
  release();
  const finished = await run.done;
  assert.equal(finished.stage, "cancelled");
  assert.equal(finished.completed, 0, "a late response from a cancelled run is ignored");
});

test("a resumed job only re-runs the targets that never finished", async () => {
  const { repo, project, row, column } = await scaffold();
  const second = await repo.createColumn({
    projectId: project.id,
    label: "Runtime",
    instruction: "latency",
    answerType: "text",
  });

  const jobId = "job_manual";
  await repo.saveJob({
    id: jobId,
    projectId: project.id,
    stage: "extracting",
    total: 2,
    completed: 1,
    failed: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    targets: [
      { rowId: row.id, columnId: column.id, key: targetKey(jobId, row.id, column.id), state: "done" },
      { rowId: row.id, columnId: second.id, key: targetKey(jobId, row.id, second.id), state: "running" },
    ],
  });

  const { impl, calls } = fakeFetch([answer({ outcome: "not_found", note: "no latency reported" })]);
  const job = (await repo.getJob(jobId))!;
  const run = await resumeExtraction(job, {
    repo,
    projectId: project.id,
    question: "",
    rows: [row],
    columns: [column, second],
    onUpdate: () => {},
    fetchImpl: impl,
  });
  const finished = await run.done;

  assert.equal(finished.stage, "done");
  assert.ok(calls.length >= 1, "the unfinished target ran");
  assert.equal(await repo.getCell(row.id, column.id), undefined, "the finished target was not redone");
  assert.equal((await repo.getCell(row.id, second.id))?.status, "not_found");
});

test("re-extraction over a reviewed cell parks the proposal instead of overwriting it", async () => {
  const { repo, project, row, column } = await scaffold();
  await repo.setUserValue(project.id, row.id, column.id, { value: "81.4 (checked by hand)" });

  const { impl } = fakeFetch([
    answer({ outcome: "found", value: "81.4", evidence: [{ page: 2, quote: "81.4% top-1 accuracy on the demo validation split" }] }),
  ]);
  const run = await startExtraction({
    repo,
    projectId: project.id,
    question: "",
    rows: [row],
    columns: [column],
    targets: [{ rowId: row.id, columnId: column.id }],
    onUpdate: () => {},
    fetchImpl: impl,
  });
  await run.done;

  const cell = await repo.getCell(row.id, column.id);
  assert.equal(cell?.userValue, "81.4 (checked by hand)");
  assert.equal(cell?.status, "reviewed");
  assert.equal(cell?.pendingProposal?.value, "81.4");
});

test("a document with no text layer is reported as unreadable without calling the model", async () => {
  const { repo, project, row, column, versionId } = await scaffold();
  await repo.savePages(versionId, [
    { id: `${versionId}:1`, versionId, pageNumber: 1, text: "   ", width: 595, height: 842, items: [] },
  ]);
  await repo.updateVersion(versionId, { parseStatus: "no_text_layer", pagesWithText: 0, pageCount: 1 });

  const { impl, calls } = fakeFetch([answer({ outcome: "found", value: "should never be used" })]);
  const run = await startExtraction({
    repo,
    projectId: project.id,
    question: "",
    rows: [row],
    columns: [column],
    targets: [{ rowId: row.id, columnId: column.id }],
    onUpdate: () => {},
    fetchImpl: impl,
  });
  await run.done;

  assert.equal(calls.length, 0, "nothing is sent when there is no text to send");
  assert.equal((await repo.getCell(row.id, column.id))?.status, "unreadable");
});
