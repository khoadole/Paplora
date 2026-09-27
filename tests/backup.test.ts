import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { openDB } from "idb";
import { zipSync } from "fflate";
import { IndexedDBRepository } from "../lib/repo";
import type { PaploraSchema } from "../lib/db";
import { createBackup, restoreBackup } from "../lib/export/run";
import { BACKUP_VERSION } from "../lib/export/backup";
import type { Proposal } from "../lib/types";

/** A backup has to reproduce a workspace, not merely validate. This round-trips one. */

let counter = 0;
function freshRepo() {
  const name = `paplora-backup-${counter++}`;
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

/** restoreBackup only reads .size and .arrayBuffer(), so a Blob stands in for a File. */
const asFile = (blob: Blob) => blob as File;

const proposal = (value: string): Proposal => ({
  value,
  unit: "%",
  conditions: "demo validation split",
  evidence: [
    {
      versionId: "will-be-rewritten",
      pageNumber: 2,
      quote: "81.4% top-1 accuracy on the demo validation split",
      start: 10,
      end: 60,
      location: "span",
    },
  ],
  model: "fixture-model",
  schemaVersion: 1,
  createdAt: 1,
  pagesConsidered: [1, 2],
  partialCoverage: false,
});

async function seed() {
  const repo = freshRepo();
  const project = await repo.createProject({ title: "Edge action recognition", question: "Which runs on-device?" });
  const { source, version } = await repo.createSource({
    title: "Demo paper",
    filename: "demo.pdf",
    contentHash: "hash-1",
    bytes: new TextEncoder().encode("%PDF-1.4 demo bytes").buffer as ArrayBuffer,
  });
  await repo.savePages(version.id, [
    { id: `${version.id}:1`, versionId: version.id, pageNumber: 1, text: "Intro", width: 595, height: 842, items: [] },
    {
      id: `${version.id}:2`,
      versionId: version.id,
      pageNumber: 2,
      text: "The model reaches 81.4% top-1 accuracy on the demo validation split.",
      width: 595,
      height: 842,
      items: [{ start: 0, length: 5, x: 1, y: 2, w: 3, h: 4 }],
    },
  ]);
  await repo.updateVersion(version.id, { pageCount: 2, parseStatus: "parsed", pagesWithText: 2 });

  const baseRow = (await repo.addSourceToProject(project.id, source.id))!;
  const splitRow = (await repo.splitRow(baseRow.id, "ViT-L, 16 frames"))!;
  const accuracy = await repo.createColumn({
    projectId: project.id,
    label: "Accuracy",
    instruction: "top-1 accuracy",
    answerType: "number",
    unit: "%",
  });
  const runtime = await repo.createColumn({
    projectId: project.id,
    label: "Runtime",
    instruction: "latency and hardware",
    answerType: "text",
  });

  await repo.applyProposal(project.id, baseRow.id, accuracy.id, proposal("81.4"), "extracted");
  await repo.setUserValue(project.id, splitRow.id, runtime.id, {
    value: "34 ms per clip",
    conditions: "Jetson Orin NX",
  });
  return { repo, project, source, version, baseRow, splitRow, accuracy, runtime };
}

test("a backup round-trips projects, rows, reviewed answers, evidence and PDF bytes", async () => {
  const origin = await seed();
  const blob = await createBackup(origin.repo);
  assert.ok(blob.size > 0);

  const restored = freshRepo();
  const summary = await restoreBackup(restored, asFile(blob));
  assert.equal(summary.projects, 1);
  assert.equal(summary.sources, 1);
  assert.equal(summary.skippedEntries.length, 0);

  const projects = await restored.listProjects();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].title, "Edge action recognition");
  assert.equal(projects[0].question, "Which runs on-device?");

  const sources = await restored.listSources();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].contentHash, "hash-1");

  // The original bytes come back, so the PDF can still be rendered after a restore.
  const bytes = await restored.getBytes(sources[0].currentVersionId);
  assert.ok(bytes && bytes.byteLength > 0);
  assert.equal(new TextDecoder().decode(bytes).startsWith("%PDF-"), true);

  // Parsed pages come back too, so evidence can still be highlighted.
  const pages = await restored.getPages(sources[0].currentVersionId);
  assert.equal(pages.length, 2);
  assert.match(pages[1].text, /81\.4% top-1 accuracy/);

  const rows = await restored.listRows(projects[0].id);
  assert.equal(rows.length, 2, "the split configuration row survives");
  assert.ok(rows.some((r) => r.configurationLabel === "ViT-L, 16 frames"));
  // Every restored row points at the restored document, not a dangling id.
  assert.ok(rows.every((r) => r.sourceId === sources[0].id && r.versionId === sources[0].currentVersionId));

  const columns = await restored.listColumns(projects[0].id);
  assert.deepEqual(columns.map((c) => c.label), ["Accuracy", "Runtime"]);

  const cells = await restored.listCells(projects[0].id);
  const aiCell = cells.find((c) => c.proposal?.value === "81.4");
  assert.ok(aiCell, "the AI proposal survives");
  assert.equal(aiCell.proposal?.evidence[0].quote, "81.4% top-1 accuracy on the demo validation split");
  assert.equal(aiCell.proposal?.evidence[0].pageNumber, 2);
  assert.equal(aiCell.proposal?.conditions, "demo validation split");

  const humanCell = cells.find((c) => c.userValue === "34 ms per clip");
  assert.ok(humanCell, "the reviewed human answer survives");
  assert.equal(humanCell.status, "reviewed");
  assert.equal(humanCell.userConditions, "Jetson Orin NX");
});

test("restoring into a workspace that already holds the document keeps one copy of it", async () => {
  const origin = await seed();
  const blob = await createBackup(origin.repo);
  const summary = await restoreBackup(origin.repo, asFile(blob));
  assert.equal(summary.sources, 1);
  const sources = await origin.repo.listSources();
  assert.equal(sources.length, 1, "the same document is not duplicated by a restore");
  assert.equal((await origin.repo.listProjects()).length, 2, "the restore lands as a second project");
});

test("a ZIP without a manifest, or with unexpected entries, is refused or filtered", async () => {
  const repo = freshRepo();
  const noManifest = new Blob([zipSync({ "pdfs/ver_x.pdf": new TextEncoder().encode("%PDF-") }) as unknown as BlobPart]);
  await assert.rejects(() => restoreBackup(repo, asFile(noManifest)), /no manifest\.json/);

  const manifest = {
    backupVersion: BACKUP_VERSION,
    exportedAt: 1,
    projects: [],
    sources: [],
    versions: [],
    pages: [],
    projectSources: [],
    columns: [],
    rows: [],
    cells: [],
  };
  const withJunk = new Blob([
    zipSync({
      "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
      "evil.js": new TextEncoder().encode("process.exit(1)"),
      "../escape.pdf": new TextEncoder().encode("%PDF-"),
    }) as unknown as BlobPart,
  ]);
  const summary = await restoreBackup(repo, asFile(withJunk));
  assert.equal(summary.projects, 0);
  assert.deepEqual(summary.skippedEntries.sort(), ["../escape.pdf", "evil.js"]);
});

test("a corrupt manifest is rejected before anything is written", async () => {
  const repo = freshRepo();
  const bad = new Blob([
    zipSync({ "manifest.json": new TextEncoder().encode(JSON.stringify({ backupVersion: 99 })) }) as unknown as BlobPart,
  ]);
  await assert.rejects(() => restoreBackup(repo, asFile(bad)), /does not match the expected format/);
  assert.equal((await repo.listProjects()).length, 0, "nothing was written");
});
