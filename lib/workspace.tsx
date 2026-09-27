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
import { createSampleProject, resetSampleProject } from "./sample/create";
import type {
  Cell,
  Column,
  DocumentVersion,
  ExtractionJob,
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
  selected: SelectedCell | null;
  job: ExtractionJob | null;
  resumable: ExtractionJob | null;
  aiStatus: { configured: boolean; model: string | null; reason?: string } | null;
  busy: string | null;

  selectProject: (id: string | null) => void;
  selectCell: (selection: SelectedCell | null) => void;
  createProject: (input: { title: string; question: string }) => Promise<Project>;
  renameProject: (id: string, patch: { title?: string; question?: string }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  openSample: () => Promise<Project | null>;
  resetSample: () => Promise<void>;

  uploadFiles: (files: File[]) => Promise<UploadOutcome[]>;
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
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [job, setJob] = useState<ExtractionJob | null>(null);
  const [resumable, setResumable] = useState<ExtractionJob | null>(null);
  const [aiStatus, setAiStatus] = useState<WorkspaceValue["aiStatus"]>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const handle = useRef<RunHandle | null>(null);

  const loadLibrary = useCallback(async () => {
    const all = await repo.listSources();
    setLibrary(all);
    const membership: Record<string, Project[]> = {};
    for (const source of all) membership[source.id] = await repo.listProjectsForSource(source.id);
    setLibraryMembership(membership);
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
    for (const source of projectSources) {
      const version = await repo.getVersion(source.currentVersionId);
      if (version) versionMap[source.id] = version;
    }
    setProject(loaded);
    setRows(projectRows);
    setColumns(projectColumns);
    setCells(projectCells);
    setSources(projectSources);
    setVersions(versionMap);

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
      selected,
      job,
      resumable,
      aiStatus,
      busy,

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

      uploadFiles: async (files) => {
        if (!projectId) return [];
        return withBusy("Reading PDFs…", async () => {
          const outcomes: UploadOutcome[] = [];
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
              await repo.addSourceToProject(projectId, existing.id);
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
            await repo.addSourceToProject(projectId, source.id);
            await repo.updateVersion(version.id, { parseStatus: "parsing" });
            const parsed = await parsePdf(bytes, version.id);
            await repo.savePages(version.id, parsed.pages);
            await repo.updateVersion(version.id, {
              pageCount: parsed.pageCount,
              parseStatus: parsed.status,
              parseMessage: parsed.message,
              pagesWithText: parsed.pagesWithText,
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

      extract: async (targets) => {
        if (!projectId || !project || !targets.length) return;
        const run = await startExtraction({
          repo,
          projectId,
          question: project.question,
          rows,
          columns,
          targets,
          onUpdate: (updated) => setJob(updated),
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
          onUpdate: (updated) => setJob(updated),
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
      selected,
      job,
      resumable,
      aiStatus,
      busy,
      selectProject,
      loadProject,
      loadLibrary,
      refresh,
      withBusy,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function cellFor(cells: Cell[], rowId: string, columnId: string) {
  return cells.find((c) => c.rowId === rowId && c.columnId === columnId);
}
