import { getDB, type PaploraDB } from "./db";
import { cellId, newId } from "./ids";
import type {
  Cell,
  CellStatus,
  Column,
  DocumentVersion,
  EvidenceSpan,
  ExtractionJob,
  Id,
  ParsedPage,
  Preferences,
  Project,
  PaperCandidate,
  Proposal,
  Row,
  SourceDocument,
} from "./types";

/**
 * The persistence seam. Everything the UI needs is here, and nothing here knows
 * about IndexedDB beyond the implementation below. A Supabase repository would
 * implement this same interface; see README "Adding Supabase later".
 */
export interface Repository {
  listProjects(): Promise<Project[]>;
  getProject(id: Id): Promise<Project | undefined>;
  createProject(input: { title: string; question?: string; kind?: Project["kind"] }): Promise<Project>;
  updateProject(id: Id, patch: Partial<Omit<Project, "id" | "createdAt">>): Promise<void>;
  deleteProject(id: Id): Promise<void>;

  listSources(): Promise<SourceDocument[]>;
  getSource(id: Id): Promise<SourceDocument | undefined>;
  findSourceByHash(hash: string): Promise<SourceDocument | undefined>;
  createSource(
    input: {
      title: string;
      filename: string;
      contentHash: string;
      bytes: ArrayBuffer;
    } & Partial<Pick<SourceDocument, "kind" | "url" | "doi" | "arxivId" | "venue" | "abstract" | "codeUrl" | "authors" | "year" | "metadataSource" | "coverage">>,
  ): Promise<{ source: SourceDocument; version: DocumentVersion }>;
  /** Finds an existing document by DOI, arXiv id or canonical URL. */
  findSourceByIdentity(identity: { doi?: string; arxivId?: string; url?: string }): Promise<SourceDocument | undefined>;
  updateSource(id: Id, patch: Partial<SourceDocument>): Promise<void>;
  deleteSource(id: Id): Promise<void>;
  getVersion(id: Id): Promise<DocumentVersion | undefined>;
  updateVersion(id: Id, patch: Partial<DocumentVersion>): Promise<void>;
  getBytes(versionId: Id): Promise<ArrayBuffer | undefined>;
  savePages(versionId: Id, pages: ParsedPage[]): Promise<void>;
  getPages(versionId: Id): Promise<ParsedPage[]>;
  getPage(versionId: Id, pageNumber: number): Promise<ParsedPage | undefined>;

  listProjectSources(projectId: Id): Promise<SourceDocument[]>;
  listProjectsForSource(sourceId: Id): Promise<Project[]>;
  addSourceToProject(projectId: Id, sourceId: Id): Promise<Row | undefined>;
  removeSourceFromProject(projectId: Id, sourceId: Id): Promise<void>;

  listColumns(projectId: Id): Promise<Column[]>;
  createColumn(input: Omit<Column, "id" | "position" | "schemaVersion"> & { position?: number }): Promise<Column>;
  updateColumn(id: Id, patch: Partial<Column>): Promise<Column | undefined>;
  moveColumn(projectId: Id, columnId: Id, delta: number): Promise<void>;
  deleteColumn(id: Id): Promise<void>;

  listRows(projectId: Id): Promise<Row[]>;
  splitRow(rowId: Id, label: string): Promise<Row | undefined>;
  updateRow(id: Id, patch: Partial<Pick<Row, "configurationLabel">>): Promise<void>;
  deleteRow(id: Id): Promise<void>;

  listCells(projectId: Id): Promise<Cell[]>;
  getCell(rowId: Id, columnId: Id): Promise<Cell | undefined>;
  setUserValue(
    projectId: Id,
    rowId: Id,
    columnId: Id,
    patch: { value?: string; unit?: string; conditions?: string; reviewed?: boolean },
  ): Promise<Cell>;
  setCellStatus(projectId: Id, rowId: Id, columnId: Id, status: CellStatus, flagNote?: string): Promise<Cell>;
  applyProposal(projectId: Id, rowId: Id, columnId: Id, proposal: Proposal, status: CellStatus): Promise<Cell>;
  acceptPendingProposal(rowId: Id, columnId: Id): Promise<Cell | undefined>;
  dismissPendingProposal(rowId: Id, columnId: Id): Promise<Cell | undefined>;

  listCandidates(projectId: Id): Promise<PaperCandidate[]>;
  saveCandidates(projectId: Id, candidates: Omit<PaperCandidate, "id" | "projectId" | "createdAt">[]): Promise<PaperCandidate[]>;
  updateCandidate(id: Id, patch: Partial<PaperCandidate>): Promise<void>;
  clearCandidates(projectId: Id): Promise<void>;

  listJobs(projectId: Id): Promise<ExtractionJob[]>;
  saveJob(job: ExtractionJob): Promise<void>;
  getJob(id: Id): Promise<ExtractionJob | undefined>;

  getPreferences(): Promise<Preferences>;
  savePreferences(patch: Partial<Preferences>): Promise<void>;
}

const now = () => Date.now();

function emptyCell(projectId: Id, rowId: Id, columnId: Id): Cell {
  return {
    id: cellId(rowId, columnId),
    projectId,
    rowId,
    columnId,
    status: "empty",
    history: [],
    updatedAt: now(),
  };
}

export class IndexedDBRepository implements Repository {
  constructor(private readonly open: () => Promise<PaploraDB> = getDB) {}

  private db() {
    return this.open();
  }

  // -- projects ------------------------------------------------------------

  async listProjects() {
    const db = await this.db();
    const all = await db.getAll("projects");
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getProject(id: Id) {
    return (await this.db()).get("projects", id);
  }

  async createProject(input: { title: string; question?: string; kind?: Project["kind"] }) {
    const project: Project = {
      id: newId("prj"),
      kind: input.kind ?? "user",
      title: input.title.trim() || "Untitled project",
      question: input.question?.trim() ?? "",
      createdAt: now(),
      updatedAt: now(),
    };
    await (await this.db()).put("projects", project);
    return project;
  }

  async updateProject(id: Id, patch: Partial<Omit<Project, "id" | "createdAt">>) {
    const db = await this.db();
    const existing = await db.get("projects", id);
    if (!existing) return;
    await db.put("projects", { ...existing, ...patch, updatedAt: now() });
  }

  /**
   * Deletes the project and everything that belongs to it alone. Source documents
   * are shared library objects and always survive; only the membership goes.
   */
  async deleteProject(id: Id) {
    const db = await this.db();
    const tx = db.transaction(
      ["projects", "columns", "rows", "cells", "jobs", "projectSources"],
      "readwrite",
    );
    await tx.objectStore("projects").delete(id);
    for (const store of ["columns", "rows", "cells", "jobs"] as const) {
      const keys = await tx.objectStore(store).index("projectId").getAllKeys(id);
      for (const key of keys) await tx.objectStore(store).delete(key);
    }
    const links = await tx.objectStore("projectSources").index("projectId").getAllKeys(id);
    for (const key of links) await tx.objectStore("projectSources").delete(key);
    await tx.done;
  }

  // -- sources -------------------------------------------------------------

  async listSources() {
    const all = await (await this.db()).getAll("sources");
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getSource(id: Id) {
    return (await this.db()).get("sources", id);
  }

  async findSourceByHash(hash: string) {
    return (await this.db()).getFromIndex("sources", "contentHash", hash);
  }

  /**
   * A paper already in the library is never stored twice: identity is its DOI,
   * then its arXiv id, then its canonical URL, then the bytes' hash.
   */
  async findSourceByIdentity(identity: { doi?: string; arxivId?: string; url?: string }) {
    const all = await this.listSources();
    const url = identity.url?.toLowerCase();
    return all.find(
      (source) =>
        (identity.doi && source.doi && source.doi.toLowerCase() === identity.doi.toLowerCase()) ||
        (identity.arxivId && source.arxivId === identity.arxivId) ||
        (url && source.url?.toLowerCase() === url),
    );
  }

  async createSource(
    input: {
      title: string;
      filename: string;
      contentHash: string;
      bytes: ArrayBuffer;
    } & Partial<Pick<SourceDocument, "kind" | "url" | "doi" | "arxivId" | "venue" | "abstract" | "codeUrl" | "authors" | "year" | "metadataSource" | "coverage">>,
  ) {
    const db = await this.db();
    const sourceId = newId("src");
    const versionId = newId("ver");
    const version: DocumentVersion = {
      id: versionId,
      sourceId,
      createdAt: now(),
      pageCount: 0,
      parseStatus: "pending",
      pagesWithText: 0,
    };
    const source: SourceDocument = {
      id: sourceId,
      title: input.title,
      filename: input.filename,
      contentHash: input.contentHash,
      byteSize: input.bytes.byteLength,
      createdAt: now(),
      currentVersionId: versionId,
      kind: input.kind ?? "upload",
      url: input.url,
      doi: input.doi,
      arxivId: input.arxivId,
      venue: input.venue,
      abstract: input.abstract,
      codeUrl: input.codeUrl,
      authors: input.authors,
      year: input.year,
      metadataSource: input.metadataSource,
      coverage: input.coverage ?? "metadata",
    };
    const tx = db.transaction(["sources", "versions", "blobs"], "readwrite");
    await tx.objectStore("sources").put(source);
    await tx.objectStore("versions").put(version);
    await tx.objectStore("blobs").put({ id: versionId, bytes: input.bytes });
    await tx.done;
    return { source, version };
  }

  async updateSource(id: Id, patch: Partial<SourceDocument>) {
    const db = await this.db();
    const existing = await db.get("sources", id);
    if (!existing) return;
    await db.put("sources", { ...existing, ...patch });
  }

  /** Explicit library deletion: removes the document, its versions, pages, bytes and every row built on it. */
  async deleteSource(id: Id) {
    const db = await this.db();
    const versions = await db.getAllFromIndex("versions", "sourceId", id);
    const rows = await db.getAllFromIndex("rows", "sourceId", id);
    const tx = db.transaction(
      ["sources", "versions", "pages", "blobs", "projectSources", "rows", "cells"],
      "readwrite",
    );
    await tx.objectStore("sources").delete(id);
    for (const version of versions) {
      await tx.objectStore("versions").delete(version.id);
      await tx.objectStore("blobs").delete(version.id);
      const pageKeys = await tx.objectStore("pages").index("versionId").getAllKeys(version.id);
      for (const key of pageKeys) await tx.objectStore("pages").delete(key);
    }
    const links = await tx.objectStore("projectSources").index("sourceId").getAllKeys(id);
    for (const key of links) await tx.objectStore("projectSources").delete(key);
    for (const row of rows) {
      await tx.objectStore("rows").delete(row.id);
      const cellKeys = await tx.objectStore("cells").index("rowId").getAllKeys(row.id);
      for (const key of cellKeys) await tx.objectStore("cells").delete(key);
    }
    await tx.done;
  }

  async getVersion(id: Id) {
    return (await this.db()).get("versions", id);
  }

  async updateVersion(id: Id, patch: Partial<DocumentVersion>) {
    const db = await this.db();
    const existing = await db.get("versions", id);
    if (!existing) return;
    await db.put("versions", { ...existing, ...patch });
  }

  async getBytes(versionId: Id) {
    const record = await (await this.db()).get("blobs", versionId);
    return record?.bytes;
  }

  async savePages(versionId: Id, pages: ParsedPage[]) {
    const db = await this.db();
    const tx = db.transaction("pages", "readwrite");
    const existing = await tx.store.index("versionId").getAllKeys(versionId);
    for (const key of existing) await tx.store.delete(key);
    for (const page of pages) await tx.store.put(page);
    await tx.done;
  }

  async getPages(versionId: Id) {
    const pages = await (await this.db()).getAllFromIndex("pages", "versionId", versionId);
    return pages.sort((a, b) => a.pageNumber - b.pageNumber);
  }

  async getPage(versionId: Id, pageNumber: number) {
    return (await this.db()).get("pages", `${versionId}:${pageNumber}`);
  }

  // -- membership ----------------------------------------------------------

  async listProjectSources(projectId: Id) {
    const db = await this.db();
    const links = await db.getAllFromIndex("projectSources", "projectId", projectId);
    const sources: SourceDocument[] = [];
    for (const link of links) {
      const source = await db.get("sources", link.sourceId);
      if (source) sources.push(source);
    }
    return sources;
  }

  async listProjectsForSource(sourceId: Id) {
    const db = await this.db();
    const links = await db.getAllFromIndex("projectSources", "sourceId", sourceId);
    const projects: Project[] = [];
    for (const link of links) {
      const project = await db.get("projects", link.projectId);
      if (project) projects.push(project);
    }
    return projects;
  }

  /** Adding a source to a project also creates its default row. Existing data is untouched. */
  async addSourceToProject(projectId: Id, sourceId: Id) {
    const db = await this.db();
    const source = await db.get("sources", sourceId);
    if (!source) return undefined;
    const existing = await db.get("projectSources", [projectId, sourceId]);
    if (!existing) {
      await db.put("projectSources", { projectId, sourceId, addedAt: now() });
    }
    const rows = await db.getAllFromIndex("rows", "projectId", projectId);
    const already = rows.find((r) => r.sourceId === sourceId);
    if (already) return already;
    const row: Row = {
      id: newId("row"),
      projectId,
      sourceId,
      versionId: source.currentVersionId,
      position: rows.length,
    };
    await db.put("rows", row);
    return row;
  }

  /**
   * Removes the membership and the project's rows for that source. The source
   * document itself stays in the library, along with every other project's rows.
   */
  async removeSourceFromProject(projectId: Id, sourceId: Id) {
    const db = await this.db();
    const rows = (await db.getAllFromIndex("rows", "projectId", projectId)).filter(
      (r) => r.sourceId === sourceId,
    );
    const tx = db.transaction(["projectSources", "rows", "cells"], "readwrite");
    await tx.objectStore("projectSources").delete([projectId, sourceId]);
    for (const row of rows) {
      await tx.objectStore("rows").delete(row.id);
      const cellKeys = await tx.objectStore("cells").index("rowId").getAllKeys(row.id);
      for (const key of cellKeys) await tx.objectStore("cells").delete(key);
    }
    await tx.done;
  }

  // -- columns -------------------------------------------------------------

  async listColumns(projectId: Id) {
    const columns = await (await this.db()).getAllFromIndex("columns", "projectId", projectId);
    return columns.sort((a, b) => a.position - b.position);
  }

  async createColumn(input: Omit<Column, "id" | "position" | "schemaVersion"> & { position?: number }) {
    const db = await this.db();
    const siblings = await db.getAllFromIndex("columns", "projectId", input.projectId);
    const column: Column = {
      ...input,
      id: newId("col"),
      position: input.position ?? siblings.length,
      schemaVersion: 1,
    };
    await db.put("columns", column);
    return column;
  }

  /**
   * Changing what the extractor is asked to find invalidates AI answers but never
   * user edits: those cells go `stale`, reviewed cells keep their value and status.
   */
  async updateColumn(id: Id, patch: Partial<Column>) {
    const db = await this.db();
    const existing = await db.get("columns", id);
    if (!existing) return undefined;
    const semantic =
      (patch.instruction !== undefined && patch.instruction !== existing.instruction) ||
      (patch.answerType !== undefined && patch.answerType !== existing.answerType) ||
      (patch.unit !== undefined && patch.unit !== existing.unit);
    const updated: Column = {
      ...existing,
      ...patch,
      schemaVersion: semantic ? existing.schemaVersion + 1 : existing.schemaVersion,
    };
    await db.put("columns", updated);
    if (semantic) {
      const cells = await db.getAllFromIndex("cells", "columnId", id);
      const tx = db.transaction("cells", "readwrite");
      for (const cell of cells) {
        if (!cell.proposal) continue;
        if (cell.status === "reviewed" || cell.userValue) continue;
        await tx.store.put({ ...cell, status: "stale", updatedAt: now() });
      }
      await tx.done;
    }
    return updated;
  }

  async moveColumn(projectId: Id, columnId: Id, delta: number) {
    const db = await this.db();
    const columns = await this.listColumns(projectId);
    const index = columns.findIndex((c) => c.id === columnId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= columns.length) return;
    const reordered = [...columns];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    const tx = db.transaction("columns", "readwrite");
    for (const [position, column] of reordered.entries()) {
      await tx.store.put({ ...column, position });
    }
    await tx.done;
  }

  async deleteColumn(id: Id) {
    const db = await this.db();
    const cells = await db.getAllFromIndex("cells", "columnId", id);
    const tx = db.transaction(["columns", "cells"], "readwrite");
    await tx.objectStore("columns").delete(id);
    for (const cell of cells) await tx.objectStore("cells").delete(cell.id);
    await tx.done;
  }

  // -- rows ----------------------------------------------------------------

  async listRows(projectId: Id) {
    const rows = await (await this.db()).getAllFromIndex("rows", "projectId", projectId);
    return rows.sort((a, b) => a.position - b.position);
  }

  /** A second row over the same paper, for a different reported configuration. */
  async splitRow(rowId: Id, label: string) {
    const db = await this.db();
    const source = await db.get("rows", rowId);
    if (!source) return undefined;
    const siblings = await db.getAllFromIndex("rows", "projectId", source.projectId);
    const row: Row = {
      id: newId("row"),
      projectId: source.projectId,
      sourceId: source.sourceId,
      versionId: source.versionId,
      configurationLabel: label,
      position: siblings.length,
    };
    await db.put("rows", row);
    return row;
  }

  async updateRow(id: Id, patch: Partial<Pick<Row, "configurationLabel">>) {
    const db = await this.db();
    const existing = await db.get("rows", id);
    if (!existing) return;
    await db.put("rows", { ...existing, ...patch });
  }

  async deleteRow(id: Id) {
    const db = await this.db();
    const cells = await db.getAllFromIndex("cells", "rowId", id);
    const tx = db.transaction(["rows", "cells"], "readwrite");
    await tx.objectStore("rows").delete(id);
    for (const cell of cells) await tx.objectStore("cells").delete(cell.id);
    await tx.done;
  }

  // -- cells ---------------------------------------------------------------

  async listCells(projectId: Id) {
    return (await this.db()).getAllFromIndex("cells", "projectId", projectId);
  }

  async getCell(rowId: Id, columnId: Id) {
    return (await this.db()).get("cells", cellId(rowId, columnId));
  }

  private async upsert(projectId: Id, rowId: Id, columnId: Id, mutate: (cell: Cell) => Cell) {
    const db = await this.db();
    const existing = (await db.get("cells", cellId(rowId, columnId))) ?? emptyCell(projectId, rowId, columnId);
    const updated = mutate(existing);
    await db.put("cells", updated);
    return updated;
  }

  async setUserValue(
    projectId: Id,
    rowId: Id,
    columnId: Id,
    patch: { value?: string; unit?: string; conditions?: string; reviewed?: boolean },
  ) {
    return this.upsert(projectId, rowId, columnId, (cell) => ({
      ...cell,
      userValue: patch.value ?? cell.userValue,
      userUnit: patch.unit ?? cell.userUnit,
      userConditions: patch.conditions ?? cell.userConditions,
      status: "reviewed",
      reviewedAt: now(),
      flagNote: undefined,
      history: [
        ...cell.history,
        { at: now(), by: "user" as const, status: "reviewed" as CellStatus, value: patch.value ?? cell.userValue },
      ].slice(-20),
      updatedAt: now(),
    }));
  }

  /**
   * Transient machine states ("processing", "failed") must never overwrite a
   * durable human one. A reviewed cell stays reviewed while a re-extraction runs
   * over it, and stays reviewed if that run then fails; job progress is reported
   * at the job level instead.
   */
  async setCellStatus(projectId: Id, rowId: Id, columnId: Id, status: CellStatus, flagNote?: string) {
    if (status === "processing" || status === "failed") {
      const existing = await (await this.db()).get("cells", cellId(rowId, columnId));
      const humanOwned =
        existing && (existing.userValue !== undefined || existing.status === "reviewed" || existing.status === "flagged");
      if (humanOwned) return existing;
    }
    return this.upsert(projectId, rowId, columnId, (cell) => ({
      ...cell,
      status,
      flagNote: status === "flagged" ? flagNote : undefined,
      reviewedAt: status === "reviewed" ? now() : cell.reviewedAt,
      history: [...cell.history, { at: now(), by: "user" as const, status }].slice(-20),
      updatedAt: now(),
    }));
  }

  /**
   * A new AI answer never overwrites a human one. If the cell was reviewed or edited,
   * the proposal is parked in `pendingProposal` until the user applies it.
   */
  async applyProposal(projectId: Id, rowId: Id, columnId: Id, proposal: Proposal, status: CellStatus) {
    return this.upsert(projectId, rowId, columnId, (cell) => {
      const humanOwned = Boolean(cell.userValue) || cell.status === "reviewed" || cell.status === "flagged";
      if (humanOwned) {
        return {
          ...cell,
          pendingProposal: proposal,
          history: [...cell.history, { at: now(), by: "ai" as const, status, value: proposal.value }].slice(-20),
          updatedAt: now(),
        };
      }
      return {
        ...cell,
        proposal,
        status,
        history: [...cell.history, { at: now(), by: "ai" as const, status, value: proposal.value }].slice(-20),
        updatedAt: now(),
      };
    });
  }

  async acceptPendingProposal(rowId: Id, columnId: Id) {
    const db = await this.db();
    const cell = await db.get("cells", cellId(rowId, columnId));
    if (!cell?.pendingProposal) return cell;
    const updated: Cell = {
      ...cell,
      proposal: cell.pendingProposal,
      pendingProposal: undefined,
      userValue: undefined,
      userUnit: undefined,
      userConditions: undefined,
      status: "extracted",
      history: [
        ...cell.history,
        { at: now(), by: "user" as const, status: "extracted" as CellStatus, value: cell.pendingProposal.value },
      ].slice(-20),
      updatedAt: now(),
    };
    await db.put("cells", updated);
    return updated;
  }

  async dismissPendingProposal(rowId: Id, columnId: Id) {
    const db = await this.db();
    const cell = await db.get("cells", cellId(rowId, columnId));
    if (!cell) return undefined;
    const updated: Cell = { ...cell, pendingProposal: undefined, updatedAt: now() };
    await db.put("cells", updated);
    return updated;
  }

  // -- discovery candidates -------------------------------------------------

  async listCandidates(projectId: Id) {
    const all = await (await this.db()).getAllFromIndex("candidates", "projectId", projectId);
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Saves a discovery run's results, skipping papers the session already has. */
  async saveCandidates(
    projectId: Id,
    candidates: Omit<PaperCandidate, "id" | "projectId" | "createdAt">[],
  ) {
    const db = await this.db();
    const existing = await this.listCandidates(projectId);
    const seen = new Set(existing.map((c) => c.doi || c.arxivId || c.url.toLowerCase()));
    const created: PaperCandidate[] = [];
    for (const candidate of candidates) {
      const key = candidate.doi || candidate.arxivId || candidate.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const record: PaperCandidate = {
        ...candidate,
        id: newId("cnd"),
        projectId,
        createdAt: now() + created.length,
      };
      await db.put("candidates", record);
      created.push(record);
    }
    return created;
  }

  async updateCandidate(id: Id, patch: Partial<PaperCandidate>) {
    const db = await this.db();
    const existing = await db.get("candidates", id);
    if (!existing) return;
    await db.put("candidates", { ...existing, ...patch });
  }

  async clearCandidates(projectId: Id) {
    const db = await this.db();
    const keys = await db.getAllKeysFromIndex("candidates", "projectId", projectId);
    const tx = db.transaction("candidates", "readwrite");
    for (const key of keys) await tx.store.delete(key);
    await tx.done;
  }

  // -- jobs and preferences ------------------------------------------------

  async listJobs(projectId: Id) {
    return (await this.db()).getAllFromIndex("jobs", "projectId", projectId);
  }

  async saveJob(job: ExtractionJob) {
    await (await this.db()).put("jobs", { ...job, updatedAt: now() });
  }

  async getJob(id: Id) {
    return (await this.db()).get("jobs", id);
  }

  async getPreferences() {
    const stored = await (await this.db()).get("preferences", "preferences");
    return stored ?? { id: "preferences" as const };
  }

  async savePreferences(patch: Partial<Preferences>) {
    const db = await this.db();
    const current = await this.getPreferences();
    await db.put("preferences", { ...current, ...patch, id: "preferences" });
  }
}

export const repo: Repository = new IndexedDBRepository();

export type { EvidenceSpan };
