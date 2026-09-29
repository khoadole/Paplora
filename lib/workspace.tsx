"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { repo } from "./repo";
import { parsePdf, looksLikePdf } from "./pdf/parse";
import { sha256 } from "./ids";
import { resumeExtraction, startExtraction, type RunHandle } from "./runner";
import { importCandidate, runDiscovery, type ProgressEvent } from "./research";
import { createSampleProject, resetSampleProject } from "./sample/create";
import type {
  Cell,
  Column,
  PaperCandidate,
  DocumentVersion,
  ExtractionJob,
  Preferences,
  Project,
  Row,
  SourceDocument,
} from "./types";

/**
 * One store for the whole workspace. Mutations go through the repository and
 * then reload the active project: at this scale a reload is cheaper to reason
 * about than incremental state patching, and it cannot drift from what is on disk.
 */

export const MAX_FILES_PER_BATCH = 10;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export interface UploadOutcome {
  filename: string;
  status: "added" | "reused" | "rejected";
  message?: string;
}

export interface SelectedCell {
  rowId: string;
  columnId: string;
}

interface WorkspaceValue {
  ready: boolean;
  storageError: string | null;
  projects: Project[];
  project: Project | null;
  rows: Row[];
  columns: Column[];
  cells: Cell[];
  sources: SourceDocument[];
  versions: Record<string, DocumentVersion>;
  library: SourceDocument[];
  libraryMembership: Record<string, Project[]>;
  /** Papers per project, for the home screen. */
  projectPaperCount: Record<string, number>;
  /** First lines of each paper's first page, used as an abstract preview. */
  previews: Record<string, string>;
  /** Papers found by discovery but not yet imported. */
  candidates: PaperCandidate[];
  /** Live progress of the current research run, from real steps. */
  progress: ProgressEvent[];
  researching: boolean;
  researchError: string | null;
  selected: SelectedCell | null;
  job: ExtractionJob | null;
  resumable: ExtractionJob | null;
  aiStatus: { configured: boolean; model: string | null; reason?: string } | null;
  busy: string | null;
  /** UI preferences: sidebar, panel width, density, theme, column layout. */
  prefs: Preferences;
  setPrefs: (patch: Partial<Preferences>) => void;

  selectProject: (id: string | null) => void;
  selectCell: (selection: SelectedCell | null) => void;
  createProject: (input: { title: string; question: string }) => Promise<Project>;
  renameProject: (id: string, patch: { title?: string; question?: string }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  openSample: () => Promise<Project | null>;
  resetSample: () => Promise<void>;

  uploadFiles: (files: File[], intoProjectId?: string) => Promise<UploadOutcome[]>;
  addFromLibrary: (sourceId: string) => Promise<void>;
  removeSource: (sourceId: string) => Promise<void>;
  deleteFromLibrary: (sourceId: string) => Promise<void>;
  renameSource: (sourceId: string, title: string) => Promise<void>;
  retryParse: (sourceId: string) => Promise<void>;

  addColumn: (input: { label: string; instruction: string; answerType: Column["answerType"]; unit?: string; options?: string[] }) => Promise<void>;
  editColumn: (id: string, patch: Partial<Column>) => Promise<void>;
  moveColumn: (id: string, delta: number) => Promise<void>;
  removeColumn: (id: string) => Promise<void>;

  saveCell: (rowId: string, columnId: string, patch: { value?: string; unit?: string; conditions?: string }) => Promise<void>;
  markReviewed: (rowId: string, columnId: string) => Promise<void>;
  flagCell: (rowId: string, columnId: string, note: string) => Promise<void>;
  acceptProposal: (rowId: string, columnId: string) => Promise<void>;
  dismissProposal: (rowId: string, columnId: string) => Promise<void>;
  splitRow: (rowId: string, label: string) => Promise<void>;
  editRowLabel: (rowId: string, label: string) => Promise<void>;
  removeRow: (rowId: string) => Promise<void>;

  /** Runs discovery for a session, saving the candidates it resolves. */
  research: (projectId: string, question: string) => Promise<void>;
  cancelResearch: () => void;
  importCandidates: (ids: string[]) => Promise<{ imported: number; messages: string[] }>;
  suggestColumns: () => Promise<number>;

  extract: (targets: SelectedCell[]) => Promise<void>;
  cancelExtraction: () => void;
  resumeJob: () => Promise<void>;
  dismissResumable: () => Promise<void>;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [versions, setVersions] = useState<Record<string, DocumentVersion>>({});
  const [library, setLibrary] = useState<SourceDocument[]>([]);
  const [libraryMembership, setLibraryMembership] = useState<Record<string, Project[]>>({});
  const [projectPaperCount, setProjectPaperCount] = useState<Record<string, number>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [candidates, setCandidates] = useState<PaperCandidate[]>([]);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const research = useRef<AbortController | null>(null);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [job, setJob] = useState<ExtractionJob | null>(null);
  const [resumable, setResumable] = useState<ExtractionJob | null>(null);
  const [aiStatus, setAiStatus] = useState<WorkspaceValue["aiStatus"]>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<Preferences>({ id: "preferences" });
  const handle = useRef<RunHandle | null>(null);

  /** Preference writes are optimistic: the UI must never wait on IndexedDB to move. */
  const setPrefs = useCallback((patch: Partial<Preferences>) => {
    setPrefsState((current) => {
      const next = { ...current, ...patch, id: "preferences" as const };
      void repo.savePreferences(patch);
      return next;
    });
  }, []);

  const loadLibrary = useCallback(async () => {
    const all = await repo.listSources();
    setLibrary(all);
    const membership: Record<string, Project[]> = {};
    const counts: Record<string, number> = {};
    for (const source of all) {
      const projects = await repo.listProjectsForSource(source.id);
      membership[source.id] = projects;
      for (const project of projects) counts[project.id] = (counts[project.id] ?? 0) + 1;
    }
    setLibraryMembership(membership);
    setProjectPaperCount(counts);
  }, []);

  const loadProject = useCallback(async (id: string | null) => {
    if (!id) {
      setProject(null);
      setRows([]);
      setColumns([]);
      setCells([]);
      setSources([]);
      setVersions({});
      return;
    }
    const loaded = await repo.getProject(id);
    if (!loaded) {
      setProject(null);
      return;
    }
    const [projectRows, projectColumns, projectCells, projectSources] = await Promise.all([
      repo.listRows(id),
      repo.listColumns(id),
      repo.listCells(id),
      repo.listProjectSources(id),
    ]);
    const versionMap: Record<string, DocumentVersion> = {};
    const previewMap: Record<string, string> = {};
    for (const source of projectSources) {
      const version = await repo.getVersion(source.currentVersionId);
      if (version) versionMap[source.id] = version;
      // A preview of what the document actually says, taken from its own first page.
      const first = await repo.getPage(source.currentVersionId, 1);
      if (first?.text.trim()) previewMap[source.id] = firstPagePreview(first.text, source.title);
    }
    setProject(loaded);
    setRows(projectRows);
    setColumns(projectColumns);
    setCells(projectCells);
    setSources(projectSources);
    setVersions(versionMap);
    setPreviews(previewMap);

    setCandidates(await repo.listCandidates(id));

    const jobs = await repo.listJobs(id);
    const unfinished = jobs
      .filter((j) => j.stage === "extracting" || j.stage === "queued")
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    setResumable(unfinished ?? null);
  }, []);

  const refresh = useCallback(async () => {
    const all = await repo.listProjects();
    setProjects(all);
    await loadProject(projectId);
    await loadLibrary();
  }, [projectId, loadLibrary, loadProject]);

  // First load: restore the last project and ask the server what AI is configured.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [all, prefs] = await Promise.all([repo.listProjects(), repo.getPreferences()]);
        if (cancelled) return;
        setProjects(all);
        setPrefsState(prefs);
        const initial = prefs.lastProjectId && all.some((p) => p.id === prefs.lastProjectId)
          ? prefs.lastProjectId
          : all[0]?.id ?? null;
        setProjectId(initial);
        await loadProject(initial);
        await loadLibrary();
      } catch (error) {
        if (!cancelled) {
          setStorageError(
            error instanceof Error
              ? `This browser would not open local storage (${error.message}). Private windows and blocked site data both cause this.`
              : "This browser would not open local storage.",
          );
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    fetch("/api/ai-status")
      .then((r) => r.json())
      .then((status) => !cancelled && setAiStatus(status))
      .catch(() => !cancelled && setAiStatus({ configured: false, model: null, reason: "Could not reach the server." }));

    return () => {
      cancelled = true;
    };
  }, [loadLibrary, loadProject]);

  const selectProject = useCallback(
    (id: string | null) => {
      setProjectId(id);
      setSelected(null);
      setJob(null);
      void loadProject(id);
      void repo.savePreferences({ lastProjectId: id ?? undefined });
    },
    [loadProject],
  );

  const withBusy = useCallback(async <T,>(label: string, work: () => Promise<T>): Promise<T> => {
    setBusy(label);
    try {
      return await work();
    } finally {
      setBusy(null);
    }
  }, []);

  const value: WorkspaceValue = useMemo(
    () => ({
      ready,
      storageError,
      projects,
      project,
      rows,
      columns,
      cells,
      sources,
      versions,
      library,
      libraryMembership,
      projectPaperCount,
      previews,
      candidates,
      progress,
      researching,
      researchError,
      selected,
      job,
      resumable,
      aiStatus,
      busy,
      prefs,
      setPrefs,

      selectProject,
      selectCell: setSelected,

      createProject: async (input) => {
        const created = await repo.createProject(input);
        setProjects(await repo.listProjects());
        selectProject(created.id);
        return created;
      },
      renameProject: async (id, patch) => {
        await repo.updateProject(id, patch);
        setProjects(await repo.listProjects());
        if (id === projectId) await loadProject(id);
      },
      deleteProject: async (id) => {
        await repo.deleteProject(id);
        const all = await repo.listProjects();
        setProjects(all);
        if (id === projectId) selectProject(all[0]?.id ?? null);
        await loadLibrary();
      },
      openSample: async () =>
        withBusy("Building the sample project…", async () => {
          const sample = await createSampleProject(repo);
          setProjects(await repo.listProjects());
          selectProject(sample.id);
          await loadLibrary();
          return sample;
        }),
      resetSample: async () =>
        withBusy("Removing the sample project…", async () => {
          await resetSampleProject(repo);
          const all = await repo.listProjects();
          setProjects(all);
          if (project?.kind === "sample") selectProject(all[0]?.id ?? null);
          await loadLibrary();
        }),

      uploadFiles: async (files, intoProjectId) => {
        const target = intoProjectId ?? projectId;
        if (!target) return [];
        return withBusy("Reading PDFs…", async () => {
          const outcomes: UploadOutcome[] = files.slice(MAX_FILES_PER_BATCH).map((file) => ({
            filename: file.name,
            status: "rejected" as const,
            message: `Over the ${MAX_FILES_PER_BATCH}-file batch limit. Add it in the next batch.`,
          }));
          for (const file of files.slice(0, MAX_FILES_PER_BATCH)) {
            if (file.size > MAX_FILE_BYTES) {
              outcomes.push({
                filename: file.name,
                status: "rejected",
                message: `Larger than the ${MAX_FILE_BYTES / 1024 / 1024} MB limit for one file.`,
              });
              continue;
            }
            const bytes = await file.arrayBuffer();
            if (!looksLikePdf(bytes)) {
              outcomes.push({
                filename: file.name,
                status: "rejected",
                message: "This file's contents are not a PDF, whatever its name says.",
              });
              continue;
            }
            const hash = await sha256(bytes);
            const existing = await repo.findSourceByHash(hash);
            if (existing) {
              await repo.addSourceToProject(target, existing.id);
              outcomes.push({
                filename: file.name,
                status: "reused",
                message: `Identical to "${existing.title}" already in your library, so that copy was reused.`,
              });
              continue;
            }
            const { source, version } = await repo.createSource({
              title: file.name.replace(/\.pdf$/i, ""),
              filename: file.name,
              contentHash: hash,
              bytes,
            });
            await repo.addSourceToProject(target, source.id);
            await repo.updateVersion(version.id, { parseStatus: "parsing" });
            const parsed = await parsePdf(bytes, version.id);
            await repo.savePages(version.id, parsed.pages);
            // Title, author and year only when the file itself declares them.
            if (parsed.meta?.title || parsed.meta?.authors || parsed.meta?.year) {
              await repo.updateSource(source.id, {
                title: parsed.meta.title || source.title,
                authors: parsed.meta.authors,
                year: parsed.meta.year,
              });
            }
            await repo.updateVersion(version.id, {
              pageCount: parsed.pageCount,
              parseStatus: parsed.status,
              parseMessage: parsed.message,
              pagesWithText: parsed.pagesWithText,
            });
            await repo.updateSource(source.id, {
              coverage: parsed.pagesWithText > 0 ? "fulltext" : "metadata",
            });
            outcomes.push({
              filename: file.name,
              status: "added",
              message: parsed.message,
            });
          }
          await refresh();
          return outcomes;
        });
      },
      addFromLibrary: async (sourceId) => {
        if (!projectId) return;
        await repo.addSourceToProject(projectId, sourceId);
        await refresh();
      },
      removeSource: async (sourceId) => {
        if (!projectId) return;
        await repo.removeSourceFromProject(projectId, sourceId);
        setSelected(null);
        await refresh();
      },
      deleteFromLibrary: async (sourceId) => {
        await repo.deleteSource(sourceId);
        setSelected(null);
        await refresh();
      },
      renameSource: async (sourceId, title) => {
        await repo.updateSource(sourceId, { title });
        await refresh();
      },
      retryParse: async (sourceId) => {
        const source = await repo.getSource(sourceId);
        if (!source) return;
        await withBusy("Re-reading the PDF…", async () => {
          const bytes = await repo.getBytes(source.currentVersionId);
          if (!bytes) return;
          await repo.updateVersion(source.currentVersionId, { parseStatus: "parsing" });
          const parsed = await parsePdf(bytes, source.currentVersionId);
          await repo.savePages(source.currentVersionId, parsed.pages);
          await repo.updateVersion(source.currentVersionId, {
            pageCount: parsed.pageCount,
            parseStatus: parsed.status,
            parseMessage: parsed.message,
            pagesWithText: parsed.pagesWithText,
          });
          await refresh();
        });
      },

      addColumn: async (input) => {
        if (!projectId) return;
        await repo.createColumn({ projectId, ...input });
        await loadProject(projectId);
      },
      editColumn: async (id, patch) => {
        await repo.updateColumn(id, patch);
        await loadProject(projectId);
      },
      moveColumn: async (id, delta) => {
        if (!projectId) return;
        await repo.moveColumn(projectId, id, delta);
        await loadProject(projectId);
      },
      removeColumn: async (id) => {
        await repo.deleteColumn(id);
        setSelected((current) => (current?.columnId === id ? null : current));
        await loadProject(projectId);
      },

      saveCell: async (rowId, columnId, patch) => {
        if (!projectId) return;
        await repo.setUserValue(projectId, rowId, columnId, patch);
        await loadProject(projectId);
      },
      markReviewed: async (rowId, columnId) => {
        if (!projectId) return;
        const cell = await repo.getCell(rowId, columnId);
        // Reviewing an AI answer means adopting it as yours, on the record.
        if (cell?.proposal && cell.userValue === undefined) {
          await repo.setUserValue(projectId, rowId, columnId, {
            value: cell.proposal.value,
            unit: cell.proposal.unit,
            conditions: cell.proposal.conditions,
          });
        } else {
          await repo.setCellStatus(projectId, rowId, columnId, "reviewed");
        }
        await loadProject(projectId);
      },
      flagCell: async (rowId, columnId, note) => {
        if (!projectId) return;
        await repo.setCellStatus(projectId, rowId, columnId, "flagged", note);
        await loadProject(projectId);
      },
      acceptProposal: async (rowId, columnId) => {
        await repo.acceptPendingProposal(rowId, columnId);
        await loadProject(projectId);
      },
      dismissProposal: async (rowId, columnId) => {
        await repo.dismissPendingProposal(rowId, columnId);
        await loadProject(projectId);
      },
      splitRow: async (rowId, label) => {
        await repo.splitRow(rowId, label);
        await loadProject(projectId);
      },
      editRowLabel: async (rowId, label) => {
        await repo.updateRow(rowId, { configurationLabel: label || undefined });
        await loadProject(projectId);
      },
      removeRow: async (rowId) => {
        await repo.deleteRow(rowId);
        setSelected((current) => (current?.rowId === rowId ? null : current));
        await loadProject(projectId);
      },

      research: async (targetProjectId, question) => {
        const controller = new AbortController();
        research.current = controller;
        setResearching(true);
        setResearchError(null);
        setProgress([{ type: "start", message: "Starting" }]);
        try {
          const result = await runDiscovery(question, {
            signal: controller.signal,
            onEvent: (event) => setProgress((current) => [...current.slice(-6), event]),
          });
          await repo.saveCandidates(targetProjectId, result.papers);
          const project = await repo.getProject(targetProjectId);
          // The interpreted topic makes a better session title than the raw question.
          const autoTitle =
            project && result.scope.topic && project.title.length > 40 && project.question.startsWith(project.title.slice(0, 30))
              ? result.scope.topic.slice(0, 70)
              : undefined;
          await repo.updateProject(targetProjectId, {
            ...(autoTitle ? { title: autoTitle } : {}),
            interpretedScope: result.scope.topic,
            constraints: result.scope.constraints,
            overview: result.overview,
            usage: {
              input: (project?.usage?.input ?? 0) + result.usage.input,
              output: (project?.usage?.output ?? 0) + result.usage.output,
              calls: (project?.usage?.calls ?? 0) + result.usage.calls,
            },
          });
          setProgress((current) => [
            ...current.slice(-6),
            { type: "done", message: `${result.papers.length} papers found` },
          ]);
          await loadProject(targetProjectId);
          setProjects(await repo.listProjects());
        } catch (error) {
          const message = error instanceof Error ? error.message : "Research failed.";
          setResearchError(controller.signal.aborted ? "Research cancelled." : message);
        } finally {
          setResearching(false);
          research.current = null;
        }
      },
      cancelResearch: () => {
        research.current?.abort();
        research.current = null;
      },
      importCandidates: async (ids) => {
        if (!projectId) return { imported: 0, messages: [] };
        return withBusy("Reading papers…", async () => {
          const messages: string[] = [];
          let imported = 0;
          const all = await repo.listCandidates(projectId);
          for (const id of ids) {
            const candidate = all.find((c) => c.id === id);
            if (!candidate) continue;
            setProgress((current) => [
              ...current.slice(-6),
              { type: "reading", message: `Reading ${candidate.title.slice(0, 48)}` },
            ]);
            try {
              const outcome = await importCandidate(repo, projectId, candidate);
              if (outcome.sourceId) imported += 1;
              if (outcome.message) messages.push(`${candidate.title.slice(0, 48)}: ${outcome.message}`);
            } catch (error) {
              // One paper failing must not lose the others.
              messages.push(
                `${candidate.title.slice(0, 48)}: ${error instanceof Error ? error.message : "could not be imported"}`,
              );
            }
          }
          await refresh();
          return { imported, messages };
        });
      },
      suggestColumns: async () => {
        if (!projectId || !project) return 0;
        return withBusy("Suggesting comparison criteria…", async () => {
          const existing = (await repo.listColumns(projectId)).map((c) => c.label);
          const response = await fetch("/api/research/columns", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ question: project.question || project.title, existing }),
          });
          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(payload.error ?? "Could not suggest criteria.");
          }
          const payload = (await response.json()) as {
            columns: { label: string; instruction: string; answerType: Column["answerType"]; unit?: string }[];
          };
          for (const column of payload.columns) {
            await repo.createColumn({
              projectId,
              label: column.label,
              instruction: column.instruction,
              answerType: column.answerType,
              unit: column.unit || undefined,
            });
          }
          await loadProject(projectId);
          return payload.columns.length;
        });
      },

      extract: async (targets) => {
        if (!projectId || !project || !targets.length) return;
        const run = await startExtraction({
          repo,
          projectId,
          question: project.question,
          rows,
          columns,
          targets,
          onUpdate: (updated) => {
            setJob((previous) => {
              // Reload the table whenever another cell finishes, not only at the end.
              if (!previous || updated.completed + updated.failed !== previous.completed + previous.failed) {
                void loadProject(projectId);
              }
              return updated;
            });
          },
        });
        handle.current = run;
        await run.done;
        handle.current = null;
        await loadProject(projectId);
      },
      cancelExtraction: () => {
        handle.current?.cancel();
        handle.current = null;
      },
      resumeJob: async () => {
        if (!resumable || !project || !projectId) return;
        const run = await resumeExtraction(resumable, {
          repo,
          projectId,
          question: project.question,
          rows,
          columns,
          onUpdate: (updated) => {
            setJob((previous) => {
              if (!previous || updated.completed + updated.failed !== previous.completed + previous.failed) {
                void loadProject(projectId);
              }
              return updated;
            });
          },
        });
        handle.current = run;
        setResumable(null);
        await run.done;
        handle.current = null;
        await loadProject(projectId);
      },
      dismissResumable: async () => {
        if (!resumable) return;
        await repo.saveJob({ ...resumable, stage: "cancelled" });
        setResumable(null);
      },
      refresh,
    }),
    [
      ready,
      storageError,
      projects,
      project,
      projectId,
      rows,
      columns,
      cells,
      sources,
      versions,
      library,
      libraryMembership,
      projectPaperCount,
      previews,
      candidates,
      progress,
      researching,
      researchError,
      selected,
      job,
      resumable,
      aiStatus,
      busy,
      prefs,
      setPrefs,
      selectProject,
      loadProject,
      loadLibrary,
      refresh,
      withBusy,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/**
 * A readable preview of a paper's first page: start at the abstract when the
 * document has one, and never echo the title back at the reader.
 */
export function firstPagePreview(text: string, title: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const abstract = /\babstract\b[:.\s-]*/i.exec(flat);
  let body = abstract ? flat.slice(abstract.index + abstract[0].length) : flat;
  const head = title.replace(/\s+/g, " ").trim().slice(0, 40);
  if (head.length > 12) {
    const at = body.toLowerCase().indexOf(head.toLowerCase());
    // The title usually reappears at the top of the page; start after it.
    if (at >= 0 && at < 400) body = body.slice(at + head.length);
  }
  return body.replace(/^[\s:.\-—]+/, "").slice(0, 260);
}

export function cellFor(cells: Cell[], rowId: string, columnId: string) {
  return cells.find((c) => c.rowId === rowId && c.columnId === columnId);
}

/** A cell the user owns is never re-extracted in bulk: it would only park a proposal nobody asked for. */
export function isHumanOwned(cell: Cell | undefined) {
  return Boolean(cell && (cell.userValue !== undefined || cell.status === "reviewed" || cell.status === "flagged"));
}

/** Targets for a bulk run: everything except cells the user has already answered. */
export function bulkTargets(
  cells: Cell[],
  rows: { id: string }[],
  columns: { id: string }[],
): SelectedCell[] {
  return rows.flatMap((row) =>
    columns
      .filter((column) => !isHumanOwned(cellFor(cells, row.id, column.id)))
      .map((column) => ({ rowId: row.id, columnId: column.id })),
  );
}
