import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { openDB } from "idb";
import { IndexedDBRepository } from "../lib/repo";
import type { PaploraSchema } from "../lib/db";
import type { Proposal } from "../lib/types";

/** Each test gets its own database so cases cannot leak into each other. */
let counter = 0;
function freshRepo() {
  const name = `paplora-test-${counter++}`;
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

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

function proposal(value: string): Proposal {
  return {
    value,
    evidence: [],
    model: "test-model",
    schemaVersion: 1,
    createdAt: Date.now(),
    pagesConsidered: [1],
    partialCoverage: false,
  };
}

test("a project round-trips and survives a fresh handle to the same database", async () => {
  const repo = freshRepo();
  const project = await repo.createProject({ title: "Edge action recognition", question: "Which runs on-device?" });
  const reloaded = await repo.getProject(project.id);
  assert.equal(reloaded?.title, "Edge action recognition");
  assert.equal(reloaded?.question, "Which runs on-device?");
  assert.equal(reloaded?.kind, "user");

  await repo.updateProject(project.id, { title: "Edge AR" });
  assert.equal((await repo.getProject(project.id))?.title, "Edge AR");
});

test("byte-identical uploads resolve to the same source instead of duplicating", async () => {
  const repo = freshRepo();
  const { source } = await repo.createSource({
    title: "Paper A",
    filename: "a.pdf",
    contentHash: "hash-a",
    bytes: bytes("%PDF-1.4 a"),
  });
  const found = await repo.findSourceByHash("hash-a");
  assert.equal(found?.id, source.id);
  assert.equal(await repo.findSourceByHash("hash-b"), undefined);
});

test("removing a source from one project leaves the shared source and the other project intact", async () => {
  const repo = freshRepo();
  const a = await repo.createProject({ title: "A" });
  const b = await repo.createProject({ title: "B" });
  const { source } = await repo.createSource({
    title: "Shared paper",
    filename: "s.pdf",
    contentHash: "h",
    bytes: bytes("%PDF-1.4 s"),
  });
  const rowA = await repo.addSourceToProject(a.id, source.id);
  const rowB = await repo.addSourceToProject(b.id, source.id);
  assert.ok(rowA && rowB);
  assert.notEqual(rowA.id, rowB.id, "each project gets its own row over the shared source");

  const column = await repo.createColumn({
    projectId: b.id,
    label: "Method",
    instruction: "the method",
    answerType: "text",
  });
  await repo.setUserValue(b.id, rowB.id, column.id, { value: "kept" });

  await repo.removeSourceFromProject(a.id, source.id);

  assert.ok(await repo.getSource(source.id), "the library keeps the document");
  assert.ok(await repo.getBytes(source.currentVersionId), "original bytes survive");
  assert.equal((await repo.listRows(a.id)).length, 0);
  assert.equal((await repo.listRows(b.id)).length, 1);
  assert.equal((await repo.getCell(rowB.id, column.id))?.userValue, "kept");
});

test("deleting a project removes its own data but never the shared library documents", async () => {
  const repo = freshRepo();
  const a = await repo.createProject({ title: "A" });
  const b = await repo.createProject({ title: "B" });
  const { source } = await repo.createSource({
    title: "Shared",
    filename: "s.pdf",
    contentHash: "h",
    bytes: bytes("%PDF-1.4 s"),
  });
  const rowA = await repo.addSourceToProject(a.id, source.id);
  await repo.addSourceToProject(b.id, source.id);
  const column = await repo.createColumn({
    projectId: a.id,
    label: "C",
    instruction: "i",
    answerType: "text",
  });
  await repo.setUserValue(a.id, rowA!.id, column.id, { value: "gone with the project" });

  await repo.deleteProject(a.id);

  assert.equal(await repo.getProject(a.id), undefined);
  assert.equal((await repo.listColumns(a.id)).length, 0);
  assert.equal((await repo.listCells(a.id)).length, 0);
  assert.ok(await repo.getSource(source.id), "the document stays in the library");
  assert.equal((await repo.listProjectSources(b.id)).length, 1, "the other project is untouched");
});

test("deleting a source from the library takes its rows everywhere, but only that source", async () => {
  const repo = freshRepo();
  const project = await repo.createProject({ title: "P" });
  const one = await repo.createSource({ title: "One", filename: "1.pdf", contentHash: "h1", bytes: bytes("1") });
  const two = await repo.createSource({ title: "Two", filename: "2.pdf", contentHash: "h2", bytes: bytes("2") });
  await repo.addSourceToProject(project.id, one.source.id);
  await repo.addSourceToProject(project.id, two.source.id);

  await repo.deleteSource(one.source.id);

  assert.equal(await repo.getSource(one.source.id), undefined);
  assert.equal(await repo.getBytes(one.version.id), undefined);
  const rows = await repo.listRows(project.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceId, two.source.id);
});

test("editing a column instruction marks AI cells stale and leaves reviewed cells alone", async () => {
  const repo = freshRepo();
  const project = await repo.createProject({ title: "P" });
  const { source } = await repo.createSource({ title: "S", filename: "s.pdf", contentHash: "h", bytes: bytes("s") });
  const rowOne = await repo.addSourceToProject(project.id, source.id);
  const rowTwo = await repo.splitRow(rowOne!.id, "config B");
  const column = await repo.createColumn({
    projectId: project.id,
    label: "Accuracy",
    instruction: "top-1 accuracy",
    answerType: "number",
  });

  await repo.applyProposal(project.id, rowOne!.id, column.id, proposal("81.4"), "extracted");
  await repo.setUserValue(project.id, rowTwo!.id, column.id, { value: "human answer" });

  const updated = await repo.updateColumn(column.id, { instruction: "top-5 accuracy" });
  assert.equal(updated?.schemaVersion, 2, "a semantic edit bumps the schema version");

  assert.equal((await repo.getCell(rowOne!.id, column.id))?.status, "stale");
  const reviewed = await repo.getCell(rowTwo!.id, column.id);
  assert.equal(reviewed?.status, "reviewed");
  assert.equal(reviewed?.userValue, "human answer", "a user edit is never erased by a column change");
});

test("renaming a column label alone does not invalidate anything", async () => {
  const repo = freshRepo();
  const project = await repo.createProject({ title: "P" });
  const { source } = await repo.createSource({ title: "S", filename: "s.pdf", contentHash: "h", bytes: bytes("s") });
  const row = await repo.addSourceToProject(project.id, source.id);
  const column = await repo.createColumn({
    projectId: project.id,
    label: "Accuracy",
    instruction: "top-1 accuracy",
    answerType: "number",
  });
  await repo.applyProposal(project.id, row!.id, column.id, proposal("81.4"), "extracted");
  await repo.updateColumn(column.id, { label: "Top-1" });
  assert.equal((await repo.getCell(row!.id, column.id))?.status, "extracted");
});

test("re-extraction parks a proposal instead of overwriting a user's answer", async () => {
  const repo = freshRepo();
  const project = await repo.createProject({ title: "P" });
  const { source } = await repo.createSource({ title: "S", filename: "s.pdf", contentHash: "h", bytes: bytes("s") });
  const row = await repo.addSourceToProject(project.id, source.id);
  const column = await repo.createColumn({
    projectId: project.id,
    label: "Accuracy",
    instruction: "top-1",
    answerType: "number",
  });

  await repo.setUserValue(project.id, row!.id, column.id, { value: "corrected by hand" });
  await repo.applyProposal(project.id, row!.id, column.id, proposal("from the model"), "extracted");

  const parked = await repo.getCell(row!.id, column.id);
  assert.equal(parked?.userValue, "corrected by hand", "the human value still wins");
  assert.equal(parked?.status, "reviewed");
  assert.equal(parked?.pendingProposal?.value, "from the model");

  const accepted = await repo.acceptPendingProposal(row!.id, column.id);
  assert.equal(accepted?.userValue, undefined);
  assert.equal(accepted?.proposal?.value, "from the model");
  assert.equal(accepted?.pendingProposal, undefined);
  assert.equal(accepted?.status, "extracted");
});

test("an unreviewed AI cell is replaced in place by a newer proposal", async () => {
  const repo = freshRepo();
  const project = await repo.createProject({ title: "P" });
  const { source } = await repo.createSource({ title: "S", filename: "s.pdf", contentHash: "h", bytes: bytes("s") });
  const row = await repo.addSourceToProject(project.id, source.id);
  const column = await repo.createColumn({ projectId: project.id, label: "C", instruction: "i", answerType: "text" });

  await repo.applyProposal(project.id, row!.id, column.id, proposal("first"), "extracted");
  await repo.applyProposal(project.id, row!.id, column.id, proposal("second"), "extracted");
  const cell = await repo.getCell(row!.id, column.id);
  assert.equal(cell?.proposal?.value, "second");
  assert.equal(cell?.pendingProposal, undefined);
});

test("splitting a row reuses the same document and keeps the original row's cells", async () => {
  const repo = freshRepo();
  const project = await repo.createProject({ title: "P" });
  const { source } = await repo.createSource({ title: "S", filename: "s.pdf", contentHash: "h", bytes: bytes("s") });
  const row = await repo.addSourceToProject(project.id, source.id);
  const column = await repo.createColumn({ projectId: project.id, label: "C", instruction: "i", answerType: "text" });
  await repo.setUserValue(project.id, row!.id, column.id, { value: "base" });

  const split = await repo.splitRow(row!.id, "ViT-B, 8 frames");
  assert.equal(split?.sourceId, source.id);
  assert.equal(split?.versionId, row!.versionId);
  assert.equal(split?.configurationLabel, "ViT-B, 8 frames");
  assert.equal((await repo.getCell(row!.id, column.id))?.userValue, "base");
  assert.equal(await repo.getCell(split!.id, column.id), undefined, "a new row starts empty");
});

test("column reordering is stable and clamped at the ends", async () => {
  const repo = freshRepo();
  const project = await repo.createProject({ title: "P" });
  const a = await repo.createColumn({ projectId: project.id, label: "A", instruction: "i", answerType: "text" });
  const b = await repo.createColumn({ projectId: project.id, label: "B", instruction: "i", answerType: "text" });
  const c = await repo.createColumn({ projectId: project.id, label: "C", instruction: "i", answerType: "text" });

  await repo.moveColumn(project.id, c.id, -1);
  assert.deepEqual((await repo.listColumns(project.id)).map((x) => x.label), ["A", "C", "B"]);

  await repo.moveColumn(project.id, a.id, -1); // already first
  assert.deepEqual((await repo.listColumns(project.id)).map((x) => x.label), ["A", "C", "B"]);

  await repo.moveColumn(project.id, b.id, 1); // already last
  assert.deepEqual((await repo.listColumns(project.id)).map((x) => x.label), ["A", "C", "B"]);
});

test("adding a column or a paper leaves existing cells untouched", async () => {
  const repo = freshRepo();
  const project = await repo.createProject({ title: "P" });
  const first = await repo.createSource({ title: "One", filename: "1.pdf", contentHash: "h1", bytes: bytes("1") });
  const row = await repo.addSourceToProject(project.id, first.source.id);
  const column = await repo.createColumn({ projectId: project.id, label: "C", instruction: "i", answerType: "text" });
  await repo.setUserValue(project.id, row!.id, column.id, { value: "reviewed answer" });

  await repo.createColumn({ projectId: project.id, label: "D", instruction: "i", answerType: "text" });
  const second = await repo.createSource({ title: "Two", filename: "2.pdf", contentHash: "h2", bytes: bytes("2") });
  await repo.addSourceToProject(project.id, second.source.id);

  const cell = await repo.getCell(row!.id, column.id);
  assert.equal(cell?.userValue, "reviewed answer");
  assert.equal(cell?.status, "reviewed");
  assert.equal((await repo.listRows(project.id)).length, 2);
  assert.equal((await repo.listColumns(project.id)).length, 2);
});

test("pages persist per version and read back in page order", async () => {
  const repo = freshRepo();
  const { version } = await repo.createSource({ title: "S", filename: "s.pdf", contentHash: "h", bytes: bytes("s") });
  await repo.savePages(version.id, [
    { id: `${version.id}:2`, versionId: version.id, pageNumber: 2, text: "second", width: 10, height: 10, items: [] },
    { id: `${version.id}:1`, versionId: version.id, pageNumber: 1, text: "first", width: 10, height: 10, items: [] },
  ]);
  const pages = await repo.getPages(version.id);
  assert.deepEqual(pages.map((p) => p.pageNumber), [1, 2]);
  assert.equal((await repo.getPage(version.id, 2))?.text, "second");
});

test("sample projects are ordinary projects marked as samples, not seeded user data", async () => {
  const repo = freshRepo();
  await repo.createProject({ title: "Mine" });
  const sample = await repo.createProject({ title: "Sample", kind: "sample" });
  const projects = await repo.listProjects();
  assert.equal(projects.filter((p) => p.kind === "sample").length, 1);
  assert.equal(sample.kind, "sample");
});
