"use client";

import { unzipSync, zipSync } from "fflate";
import type { Repository } from "../repo";
import type { Cell, Column, Project, Row, SourceDocument } from "../types";
import { csvBlob, toCsv } from "./csv";
import {
  BACKUP_VERSION,
  isAllowedEntry,
  MAX_BACKUP_BYTES,
  parseManifest,
  versionIdFromEntry,
} from "./backup";

/** What the table shows for a cell: the human answer if there is one, else the proposal. */
export function displayValue(cell: Cell | undefined): { value: string; unit?: string; conditions?: string } {
  if (!cell) return { value: "" };
  if (cell.userValue !== undefined) {
    return { value: cell.userValue, unit: cell.userUnit, conditions: cell.userConditions };
  }
  if (cell.proposal) {
    return { value: cell.proposal.value, unit: cell.proposal.unit, conditions: cell.proposal.conditions };
  }
  return { value: "" };
}

export function rowLabel(row: Row, source: SourceDocument | undefined) {
  const base = source?.title ?? "Unknown document";
  return row.configurationLabel ? `${base} — ${row.configurationLabel}` : base;
}

interface ExportInput {
  project: Project;
  rows: Row[];
  columns: Column[];
  cells: Cell[];
  sources: SourceDocument[];
}

/** The visible comparison, one row per table row, with review status per cell. */
export function comparisonCsv(input: ExportInput): string {
  const header = [
    "Row",
    "Document",
    "Configuration",
    "Source id",
    ...input.columns.flatMap((c) => [c.label, `${c.label} — unit`, `${c.label} — conditions`, `${c.label} — status`]),
  ];
  const lines = input.rows.map((row) => {
    const source = input.sources.find((s) => s.id === row.sourceId);
    const cells = input.columns.flatMap((column) => {
      const cell = input.cells.find((c) => c.rowId === row.id && c.columnId === column.id);
      const shown = displayValue(cell);
      return [shown.value, shown.unit ?? column.unit ?? "", shown.conditions ?? "", cell?.status ?? "empty"];
    });
    return [rowLabel(row, source), source?.title ?? "", row.configurationLabel ?? "", row.sourceId, ...cells];
  });
  return toCsv([header, ...lines]);
}

/** Evidence as its own table: one line per quote, with page and document version. */
export function evidenceCsv(input: ExportInput): string {
  const header = [
    "Row",
    "Column",
    "Answer shown",
    "Answered by",
    "Status",
    "Quote (verbatim from the document)",
    "Page",
    "Location",
    "Document",
    "Document version",
    "Model",
    "Pages read",
    "Coverage",
  ];
  const lines: unknown[][] = [];
  for (const row of input.rows) {
    const source = input.sources.find((s) => s.id === row.sourceId);
    for (const column of input.columns) {
      const cell = input.cells.find((c) => c.rowId === row.id && c.columnId === column.id);
      if (!cell) continue;
      const shown = displayValue(cell);
      const answeredBy = cell.userValue !== undefined ? "user" : cell.proposal ? "ai" : "";
      const spans = cell.proposal?.evidence ?? [];
      if (!spans.length) {
        lines.push([
          rowLabel(row, source),
          column.label,
          shown.value,
          answeredBy,
          cell.status,
          "",
          "",
          "",
          source?.title ?? "",
          row.versionId,
          cell.proposal?.model ?? "",
          (cell.proposal?.pagesConsidered ?? []).join(" "),
          cell.proposal?.partialCoverage ? "partial" : "full",
        ]);
        continue;
      }
      for (const span of spans) {
        lines.push([
          rowLabel(row, source),
          column.label,
          shown.value,
          answeredBy,
          cell.status,
          span.quote,
          span.pageNumber,
          span.location === "span" ? "exact passage" : "page only",
          source?.title ?? "",
          span.versionId,
          cell.proposal?.model ?? "",
          (cell.proposal?.pagesConsidered ?? []).join(" "),
          cell.proposal?.partialCoverage ? "partial" : "full",
        ]);
      }
    }
  }
  return toCsv([header, ...lines]);
}

export function evidenceJson(input: ExportInput): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      project: { id: input.project.id, title: input.project.title, question: input.project.question },
      note:
        "A quote proves the text exists in the document. It does not prove the text supports the answer — check the review status.",
      rows: input.rows.map((row) => {
        const source = input.sources.find((s) => s.id === row.sourceId);
        return {
          rowId: row.id,
          document: source?.title,
          filename: source?.filename,
          contentHash: source?.contentHash,
          documentVersion: row.versionId,
          configuration: row.configurationLabel ?? null,
          cells: input.columns.map((column) => {
            const cell = input.cells.find((c) => c.rowId === row.id && c.columnId === column.id);
            return {
              column: column.label,
              instruction: column.instruction,
              columnSchemaVersion: column.schemaVersion,
              status: cell?.status ?? "empty",
              shown: displayValue(cell),
              answeredBy: cell?.userValue !== undefined ? "user" : cell?.proposal ? "ai" : null,
              reviewedAt: cell?.reviewedAt ?? null,
              flagNote: cell?.flagNote ?? null,
              proposal: cell?.proposal
                ? {
                    value: cell.proposal.value,
                    unit: cell.proposal.unit ?? null,
                    conditions: cell.proposal.conditions ?? null,
                    note: cell.proposal.note ?? null,
                    model: cell.proposal.model,
                    schemaVersion: cell.proposal.schemaVersion,
                    pagesConsidered: cell.proposal.pagesConsidered,
                    coverage: cell.proposal.partialCoverage ? "partial" : "full",
                    evidence: cell.proposal.evidence,
                  }
                : null,
            };
          }),
        };
      }),
    },
    null,
    2,
  );
}

export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(name: string, csv: string) {
  download(name, csvBlob(csv));
}

// -- backup ----------------------------------------------------------------

/** Whole-workspace backup: a ZIP holding manifest.json and the original PDFs. */
export async function createBackup(repo: Repository): Promise<Blob> {
  const projects = await repo.listProjects();
  const sources = await repo.listSources();
  const files: Record<string, Uint8Array> = {};

  const versions = [];
  const pages = [];
  for (const source of sources) {
    const version = await repo.getVersion(source.currentVersionId);
    if (!version) continue;
    versions.push(version);
    pages.push(...(await repo.getPages(version.id)));
    const bytes = await repo.getBytes(version.id);
    if (bytes) files[`pdfs/${version.id}.pdf`] = new Uint8Array(bytes);
  }

  const columns = [];
  const rows = [];
  const cells = [];
  const projectSources = [];
  for (const project of projects) {
    columns.push(...(await repo.listColumns(project.id)));
    rows.push(...(await repo.listRows(project.id)));
    cells.push(...(await repo.listCells(project.id)));
    for (const source of await repo.listProjectSources(project.id)) {
      projectSources.push({ projectId: project.id, sourceId: source.id, addedAt: Date.now() });
    }
  }

  const manifest = {
    backupVersion: BACKUP_VERSION,
    exportedAt: Date.now(),
    projects,
    sources,
    versions,
    pages,
    projectSources,
    columns,
    rows,
    cells,
  };
  files["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest));
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
}

export interface RestoreSummary {
  projects: number;
  sources: number;
  cells: number;
  skippedEntries: string[];
}

/**
 * Restores a backup. Nothing is written until the manifest validates; unknown
 * entries are skipped by name, and only JSON is ever parsed.
 */
export async function restoreBackup(repo: Repository, file: File): Promise<RestoreSummary> {
  if (file.size > MAX_BACKUP_BYTES) {
    throw new Error(`That backup is larger than the ${Math.round(MAX_BACKUP_BYTES / 1024 / 1024)} MB limit.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(bytes);

  const skipped: string[] = [];
  const pdfs = new Map<string, Uint8Array>();
  let manifestBytes: Uint8Array | undefined;

  for (const [name, content] of Object.entries(entries)) {
    if (!isAllowedEntry(name)) {
      skipped.push(name);
      continue;
    }
    if (name === "manifest.json") manifestBytes = content;
    else {
      const versionId = versionIdFromEntry(name);
      if (versionId) pdfs.set(versionId, content);
    }
  }

  if (!manifestBytes) throw new Error("This ZIP has no manifest.json, so it is not a Paplora backup.");
  const manifest = parseManifest(manifestBytes);

  const db = repo as unknown as { open?: () => Promise<unknown> };
  void db;

  for (const source of manifest.sources) {
    const existing = await repo.getSource(source.id);
    if (existing) continue;
    const version = manifest.versions.find((v) => v.id === source.currentVersionId);
    const pdf = pdfs.get(source.currentVersionId);
    const created = await repo.createSource({
      title: source.title,
      filename: source.filename,
      contentHash: source.contentHash,
      bytes: (pdf?.slice().buffer ?? new ArrayBuffer(0)) as ArrayBuffer,
    });
    // Keep the ids the manifest refers to by rewriting them into the restored rows.
    manifest.rows
      .filter((r) => r.sourceId === source.id)
      .forEach((r) => {
        r.sourceId = created.source.id;
        r.versionId = created.version.id;
      });
    manifest.projectSources
      .filter((ps) => ps.sourceId === source.id)
      .forEach((ps) => {
        ps.sourceId = created.source.id;
      });
    const restoredPages = manifest.pages.filter((p) => p.versionId === source.currentVersionId);
    if (restoredPages.length) {
      await repo.savePages(
        created.version.id,
        restoredPages.map((p) => ({ ...p, id: `${created.version.id}:${p.pageNumber}`, versionId: created.version.id })),
      );
    }
    if (version) {
      await repo.updateVersion(created.version.id, {
        pageCount: version.pageCount,
        parseStatus: version.parseStatus,
        parseMessage: version.parseMessage,
        pagesWithText: version.pagesWithText,
      });
    }
  }

  let restoredCells = 0;
  for (const project of manifest.projects) {
    const created = await repo.createProject({
      title: project.title,
      question: project.question,
      kind: project.kind,
    });
    const columnMap = new Map<string, string>();
    for (const column of manifest.columns.filter((c) => c.projectId === project.id)) {
      const madeColumn = await repo.createColumn({
        projectId: created.id,
        label: column.label,
        instruction: column.instruction,
        answerType: column.answerType,
        unit: column.unit,
        options: column.options,
        position: column.position,
      });
      columnMap.set(column.id, madeColumn.id);
    }
    const rowMap = new Map<string, string>();
    for (const link of manifest.projectSources.filter((ps) => ps.projectId === project.id)) {
      await repo.addSourceToProject(created.id, link.sourceId);
    }
    const madeRows = await repo.listRows(created.id);
    for (const row of manifest.rows.filter((r) => r.projectId === project.id)) {
      const match = madeRows.find((r) => r.sourceId === row.sourceId && !rowMap.has(row.id));
      if (match && !row.configurationLabel) {
        rowMap.set(row.id, match.id);
      } else if (match) {
        const split = await repo.splitRow(match.id, row.configurationLabel ?? "configuration");
        if (split) rowMap.set(row.id, split.id);
      }
    }
    for (const cell of manifest.cells.filter((c) => c.projectId === project.id)) {
      const rowId = rowMap.get(cell.rowId);
      const columnId = columnMap.get(cell.columnId);
      if (!rowId || !columnId) continue;
      if (cell.proposal) {
        await repo.applyProposal(created.id, rowId, columnId, cell.proposal, cell.status as never);
      }
      if (cell.userValue !== undefined) {
        await repo.setUserValue(created.id, rowId, columnId, {
          value: cell.userValue,
          unit: cell.userUnit,
          conditions: cell.userConditions,
        });
      }
      restoredCells += 1;
    }
  }

  return {
    projects: manifest.projects.length,
    sources: manifest.sources.length,
    cells: restoredCells,
    skippedEntries: skipped,
  };
}
