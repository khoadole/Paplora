"use client";

import { parsePdf } from "../pdf/parse";
import { sha256 } from "../ids";
import type { Repository } from "../repo";
import { verifyAnswer } from "../extract/verify";
import { SAMPLE_DOCS } from "./documents";
import { SAMPLE_COLUMNS, SAMPLE_FIXTURES, SAMPLE_MODEL, SAMPLE_PROJECT } from "./data";
import type { Project } from "../types";

/**
 * Builds the sample project on demand.
 *
 * The PDFs are real files parsed by the real parser, and the fixture answers go
 * through the same verification as live extraction — so the demo cannot show a
 * quote that is not in its document. Nothing here touches existing projects, and
 * this only ever runs when the user asks for it.
 */
export async function createSampleProject(
  repo: Repository,
  onProgress?: (message: string) => void,
): Promise<Project> {
  const existing = (await repo.listProjects()).find((p) => p.kind === "sample");
  if (existing) return existing;

  const project = await repo.createProject({
    title: SAMPLE_PROJECT.title,
    question: SAMPLE_PROJECT.question,
    kind: "sample",
  });

  const columns = [];
  for (const spec of SAMPLE_COLUMNS) {
    columns.push({
      key: spec.key,
      column: await repo.createColumn({
        projectId: project.id,
        label: spec.label,
        instruction: spec.instruction,
        answerType: spec.answerType,
        unit: spec.unit,
        options: spec.options,
      }),
    });
  }

  for (const doc of SAMPLE_DOCS) {
    onProgress?.(`Reading ${doc.filename}…`);
    const response = await fetch(`/samples/${doc.filename}`);
    if (!response.ok) throw new Error(`Could not load the demo document ${doc.filename}.`);
    const bytes = await response.arrayBuffer();
    const hash = await sha256(bytes);

    const reused = await repo.findSourceByHash(hash);
    const created = reused
      ? { source: reused, version: (await repo.getVersion(reused.currentVersionId))! }
      : await repo.createSource({ title: doc.title, filename: doc.filename, contentHash: hash, bytes });

    if (!reused) {
      const parsed = await parsePdf(bytes, created.version.id);
      await repo.savePages(created.version.id, parsed.pages);
      await repo.updateVersion(created.version.id, {
        pageCount: parsed.pageCount,
        parseStatus: parsed.status,
        parseMessage: parsed.message,
        pagesWithText: parsed.pagesWithText,
      });
    }

    const row = await repo.addSourceToProject(project.id, created.source.id);
    if (!row) continue;

    const pages = (await repo.getPages(created.version.id)).map((p) => ({
      pageNumber: p.pageNumber,
      text: p.text,
    }));
    const fixtures = SAMPLE_FIXTURES[doc.slug];

    for (const { key, column } of columns) {
      const answer = fixtures?.[key];
      if (!answer) continue;
      const verified = verifyAnswer(answer, {
        versionId: created.version.id,
        pages,
        consideredPages: pages.map((p) => p.pageNumber),
        partialCoverage: false,
        noTextLayer: pages.every((p) => !p.text.trim()),
        model: SAMPLE_MODEL,
        schemaVersion: column.schemaVersion,
      });
      if (verified.proposal) {
        await repo.applyProposal(project.id, row.id, column.id, verified.proposal, verified.status);
      } else {
        await repo.setCellStatus(project.id, row.id, column.id, verified.status);
      }
    }
  }

  // One cell is left in the reviewed state so the demo shows what a checked
  // answer looks like next to unreviewed ones.
  const rows = await repo.listRows(project.id);
  const accuracy = columns.find((c) => c.key === "accuracy");
  const firstRow = rows[0];
  if (accuracy && firstRow) {
    const cell = await repo.getCell(firstRow.id, accuracy.column.id);
    if (cell?.proposal) {
      await repo.setUserValue(project.id, firstRow.id, accuracy.column.id, {
        value: cell.proposal.value,
        unit: cell.proposal.unit,
        conditions: cell.proposal.conditions,
      });
    }
  }

  return project;
}

/** Removes the sample project and the demo documents it brought with it. */
export async function resetSampleProject(repo: Repository) {
  const sample = (await repo.listProjects()).find((p) => p.kind === "sample");
  if (!sample) return;
  const sources = await repo.listProjectSources(sample.id);
  await repo.deleteProject(sample.id);
  for (const source of sources) {
    const stillUsed = await repo.listProjectsForSource(source.id);
    const isDemo = SAMPLE_DOCS.some((d) => d.filename === source.filename);
    if (isDemo && stillUsed.length === 0) await repo.deleteSource(source.id);
  }
}
