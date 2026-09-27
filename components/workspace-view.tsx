"use client";

import { useEffect, useState } from "react";
import { bulkTargets, useWorkspace } from "@/lib/workspace";
import { ComparisonTable } from "./comparison-table";
import { EvidencePanel } from "./evidence-panel";
import { LibraryView } from "./library-view";
import { AddColumnDialog, AddPapersDialog, NewProjectDialog, SettingsDialog } from "./dialogs";
import { comparisonCsv, downloadCsv, evidenceCsv, evidenceJson, download } from "@/lib/export/run";

type View = "project" | "library";

export function WorkspaceView() {
  const ws = useWorkspace();
  const [view, setView] = useState<View>("project");
  const [newProject, setNewProject] = useState(false);
  const [addPapers, setAddPapers] = useState(false);
  const [addColumn, setAddColumn] = useState(false);
  const [settings, setSettings] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(420);

  // On narrow screens the evidence panel is a sheet, opened by selecting a cell.
  useEffect(() => {
    if (ws.selected) setEvidenceOpen(true);
  }, [ws.selected]);

  if (!ws.ready) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }} role="status">
          Opening your workspace…
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar */}
      <nav
        className={`${navOpen ? "fixed inset-y-0 left-0 z-30 w-64 shadow-xl" : "hidden"} flex shrink-0 flex-col border-r lg:static lg:flex lg:w-60`}
        style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}
        aria-label="Projects"
      >
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-[15px] font-semibold tracking-tight">
            Paplora
          </span>
          <button className="btn btn-ghost px-2 py-1 lg:hidden" onClick={() => setNavOpen(false)} aria-label="Close navigation">
            ✕
          </button>
        </div>

        <div className="px-3">
          <button className="btn btn-primary w-full justify-center" onClick={() => setNewProject(true)}>
            New project
          </button>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2">
          <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-faint)" }}>
            Projects
          </p>
          {ws.projects.length === 0 ? (
            <p className="px-1 text-[12.5px]" style={{ color: "var(--color-muted)" }}>
              None yet.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {ws.projects.map((project) => {
                const active = view === "project" && ws.project?.id === project.id;
                return (
                  <li key={project.id}>
                    <button
                      className="w-full rounded-md px-2 py-1.5 text-left text-[13px]"
                      style={{
                        background: active ? "var(--color-accent-soft)" : "transparent",
                        color: active ? "var(--color-accent)" : "var(--color-ink)",
                        fontWeight: active ? 600 : 400,
                      }}
                      onClick={() => {
                        ws.selectProject(project.id);
                        setView("project");
                        setNavOpen(false);
                      }}
                    >
                      <span className="block truncate">{project.title}</span>
                      {project.kind === "sample" ? (
                        <span className="text-[11px]" style={{ color: "var(--color-faint)" }}>
                          sample · fictional documents
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t px-2 py-2" style={{ borderColor: "var(--color-line)" }}>
          <button
            className="w-full rounded-md px-2 py-1.5 text-left text-[13px]"
            style={{
              background: view === "library" ? "var(--color-accent-soft)" : "transparent",
              color: view === "library" ? "var(--color-accent)" : "var(--color-ink)",
            }}
            onClick={() => {
              setView("library");
              setNavOpen(false);
            }}
          >
            Library
            <span className="ml-1 text-[11px]" style={{ color: "var(--color-faint)" }}>
              {ws.library.length}
            </span>
          </button>
          <button
            className="w-full rounded-md px-2 py-1.5 text-left text-[13px]"
            onClick={() => setSettings(true)}
          >
            Settings
          </button>
          <p className="px-2 pt-1 text-[11px]" style={{ color: "var(--color-faint)" }}>
            {ws.aiStatus?.configured ? `AI: ${ws.aiStatus.model}` : "AI extraction off"}
          </p>
        </div>
      </nav>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        {ws.storageError ? (
          <p
            className="border-b px-4 py-2 text-[12.5px]"
            role="alert"
            style={{ borderColor: "var(--color-alarm)", background: "var(--color-alarm-soft)", color: "var(--color-alarm)" }}
          >
            {ws.storageError}
          </p>
        ) : null}

        {view === "library" ? (
          <LibraryView />
        ) : !ws.project ? (
          <EmptyWorkspace onCreate={() => setNewProject(true)} />
        ) : (
          <>
            <ProjectHeader
              onAddPapers={() => setAddPapers(true)}
              onAddColumn={() => setAddColumn(true)}
              onToggleNav={() => setNavOpen(true)}
              onExportComparison={() => {
                if (!ws.project) return;
                downloadCsv(
                  `${slug(ws.project.title)}-comparison.csv`,
                  comparisonCsv({ project: ws.project, rows: ws.rows, columns: ws.columns, cells: ws.cells, sources: ws.sources }),
                );
              }}
              onExportEvidenceCsv={() => {
                if (!ws.project) return;
                downloadCsv(
                  `${slug(ws.project.title)}-evidence.csv`,
                  evidenceCsv({ project: ws.project, rows: ws.rows, columns: ws.columns, cells: ws.cells, sources: ws.sources }),
                );
              }}
              onExportEvidenceJson={() => {
                if (!ws.project) return;
                download(
                  `${slug(ws.project.title)}-evidence.json`,
                  new Blob(
                    [evidenceJson({ project: ws.project, rows: ws.rows, columns: ws.columns, cells: ws.cells, sources: ws.sources })],
                    { type: "application/json" },
                  ),
                );
              }}
            />
            <div className="flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col border-r" style={{ borderColor: "var(--color-line)" }}>
                <ComparisonTable />
              </div>

              {/* Evidence: docked on desktop, a sheet on narrow screens. */}
              <div
                className="hidden shrink-0 lg:block"
                style={{ width: panelWidth, background: "var(--color-surface)" }}
              >
                <div className="flex h-full">
                  <div
                    role="separator"
                    aria-label="Resize evidence panel"
                    aria-orientation="vertical"
                    tabIndex={0}
                    className="w-1 cursor-col-resize"
                    style={{ background: "var(--color-line)" }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowLeft") setPanelWidth((w) => Math.min(720, w + 24));
                      if (e.key === "ArrowRight") setPanelWidth((w) => Math.max(320, w - 24));
                    }}
                    onPointerDown={(e) => {
                      const startX = e.clientX;
                      const startWidth = panelWidth;
                      const move = (event: PointerEvent) =>
                        setPanelWidth(Math.max(320, Math.min(720, startWidth - (event.clientX - startX))));
                      const up = () => {
                        window.removeEventListener("pointermove", move);
                        window.removeEventListener("pointerup", up);
                      };
                      window.addEventListener("pointermove", move);
                      window.addEventListener("pointerup", up);
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <EvidencePanel />
                  </div>
                </div>
              </div>

              {evidenceOpen && ws.selected ? (
                <div className="fixed inset-0 z-40 lg:hidden" style={{ background: "var(--color-surface)" }}>
                  <EvidencePanel onClose={() => setEvidenceOpen(false)} />
                </div>
              ) : null}
            </div>
          </>
        )}
      </main>

      <NewProjectDialog open={newProject} onOpenChange={setNewProject} />
      <AddPapersDialog open={addPapers} onOpenChange={setAddPapers} />
      <AddColumnDialog open={addColumn} onOpenChange={setAddColumn} />
      <SettingsDialog open={settings} onOpenChange={setSettings} />
    </div>
  );
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "project";
}

function ProjectHeader({
  onAddPapers,
  onAddColumn,
  onToggleNav,
  onExportComparison,
  onExportEvidenceCsv,
  onExportEvidenceJson,
}: {
  onAddPapers: () => void;
  onAddColumn: () => void;
  onToggleNav: () => void;
  onExportComparison: () => void;
  onExportEvidenceCsv: () => void;
  onExportEvidenceJson: () => void;
}) {
  const ws = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(ws.project?.title ?? "");
  const [question, setQuestion] = useState(ws.project?.question ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    setTitle(ws.project?.title ?? "");
    setQuestion(ws.project?.question ?? "");
    setEditing(false);
    setConfirmDelete(false);
  }, [ws.project?.id, ws.project?.title, ws.project?.question]);

  if (!ws.project) return null;
  const project = ws.project;
  const running = ws.job?.stage === "extracting" || ws.job?.stage === "queued";
  // Cells the user has already answered are left alone; the tooltip says so.
  const allTargets = bulkTargets(ws.cells, ws.rows, ws.columns);

  return (
    <header className="border-b px-3 py-2.5 sm:px-4" style={{ borderColor: "var(--color-line)" }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <button className="btn btn-ghost px-2 py-1 lg:hidden" onClick={onToggleNav} aria-label="Open navigation">
            ☰
          </button>
          <div className="min-w-0">
            {editing ? (
              <div className="space-y-1.5">
                <input
                  className="field max-w-md"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="Project title"
                  autoFocus
                />
                <textarea
                  className="field min-h-[52px] max-w-2xl"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  aria-label="Research question"
                  placeholder="Research question"
                />
                <div className="flex gap-2">
                  <button
                    className="btn btn-primary"
                    onClick={async () => {
                      await ws.renameProject(project.id, { title: title.trim() || project.title, question: question.trim() });
                      setEditing(false);
                    }}
                  >
                    Save
                  </button>
                  <button className="btn" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button className="min-w-0 text-left" onClick={() => setEditing(true)} title="Edit title and question">
                <h1 className="truncate text-[15px] font-semibold">
                  {project.title}
                  {project.kind === "sample" ? (
                    <span className="chip ml-2 align-middle" style={{ color: "var(--color-warn)" }}>
                      sample · fictional documents
                    </span>
                  ) : null}
                </h1>
                <p className="line-clamp-2 max-w-2xl text-[12.5px]" style={{ color: "var(--color-muted)" }}>
                  {project.question || "Add a research question"}
                </p>
              </button>
            )}
            <p className="mt-1 text-[11.5px]" style={{ color: "var(--color-faint)" }}>
              {ws.sources.length} paper{ws.sources.length === 1 ? "" : "s"} · {ws.rows.length} row
              {ws.rows.length === 1 ? "" : "s"} · {ws.columns.length} column{ws.columns.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button className="btn" onClick={onAddPapers}>
            Add papers
          </button>
          <button className="btn" onClick={onAddColumn}>
            Add column
          </button>
          <button
            className="btn btn-primary"
            onClick={() => ws.extract(allTargets)}
            disabled={!ws.aiStatus?.configured || running || !allTargets.length}
            title={
              ws.aiStatus?.configured
                ? `Extract the ${allTargets.length} cell(s) you have not answered yourself`
                : ws.aiStatus?.reason
            }
          >
            {running ? "Extracting…" : "Extract"}
          </button>
          <div className="relative">
            <button className="btn" onClick={() => setExportOpen((v) => !v)} aria-expanded={exportOpen}>
              Export
            </button>
            {exportOpen ? (
              <div
                className="card absolute right-0 z-30 mt-1 w-64 p-1 shadow-lg"
                onMouseLeave={() => setExportOpen(false)}
              >
                <button className="btn btn-ghost w-full justify-start" onClick={() => { onExportComparison(); setExportOpen(false); }}>
                  Comparison table (CSV)
                </button>
                <button className="btn btn-ghost w-full justify-start" onClick={() => { onExportEvidenceCsv(); setExportOpen(false); }}>
                  Evidence, one quote per line (CSV)
                </button>
                <button className="btn btn-ghost w-full justify-start" onClick={() => { onExportEvidenceJson(); setExportOpen(false); }}>
                  Evidence with full context (JSON)
                </button>
              </div>
            ) : null}
          </div>
          <button className="btn btn-ghost" style={{ color: "var(--color-alarm)" }} onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        </div>
      </div>

      {!ws.aiStatus?.configured && ws.aiStatus?.reason ? (
        <p className="mt-2 rounded-md px-2 py-1.5 text-[12px]" style={{ background: "var(--color-sunken)", color: "var(--color-muted)" }}>
          {ws.aiStatus.reason}
        </p>
      ) : null}

      {ws.job && (running || ws.job.stage === "done" || ws.job.stage === "failed") ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]" role="status" aria-live="polite">
          <span style={{ color: "var(--color-muted)" }}>
            {ws.job.completed + ws.job.failed} of {ws.job.total} cells
            {ws.job.failed ? ` · ${ws.job.failed} failed` : ""}
            {ws.job.stage === "done" ? " · finished" : ws.job.stage === "failed" ? " · stopped" : ""}
          </span>
          <span className="h-1.5 w-40 overflow-hidden rounded" style={{ background: "var(--color-sunken)" }}>
            <span
              className="block h-full rounded transition-[width]"
              style={{
                width: `${Math.round(((ws.job.completed + ws.job.failed) / Math.max(ws.job.total, 1)) * 100)}%`,
                background: "var(--color-accent)",
              }}
            />
          </span>
          {running ? (
            <button className="btn btn-ghost" onClick={ws.cancelExtraction}>
              Cancel
            </button>
          ) : null}
          {running ? (
            <span style={{ color: "var(--color-faint)" }}>
              Runs in this tab — closing it pauses the work, and you can resume when you come back.
            </span>
          ) : null}
        </div>
      ) : null}

      {ws.resumable && !running ? (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px]"
          style={{ background: "var(--color-warn-soft)", color: "var(--color-warn)" }}
        >
          <span>
            An extraction run was interrupted with{" "}
            {ws.resumable.targets.filter((t) => t.state === "pending" || t.state === "running").length} cells unfinished.
          </span>
          <button className="btn" onClick={() => ws.resumeJob()} disabled={!ws.aiStatus?.configured}>
            Resume
          </button>
          <button className="btn btn-ghost" onClick={() => ws.dismissResumable()}>
            Discard
          </button>
        </div>
      ) : null}

      {confirmDelete ? (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px]"
          style={{ background: "var(--color-alarm-soft)", color: "var(--color-alarm)" }}
        >
          <span>Delete “{project.title}”? Its columns and answers go too; the PDFs stay in your library.</span>
          <button className="btn" onClick={() => ws.deleteProject(project.id)}>
            Delete project
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        </div>
      ) : null}
    </header>
  );
}

function EmptyWorkspace({ onCreate }: { onCreate: () => void }) {
  const ws = useWorkspace();
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-lg">
        <h1 className="text-[18px] font-semibold tracking-tight">Compare papers, and keep the receipts</h1>
        <p className="mt-2 text-[13px]" style={{ color: "var(--color-muted)" }}>
          Paplora turns a stack of PDFs into a comparison table where every extracted answer can be traced back to the
          passage it came from. Everything is stored in this browser: no account, no upload to a server unless you turn
          on automatic extraction.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={onCreate}>
            Create a project
          </button>
          <button className="btn" onClick={() => ws.openSample()} disabled={Boolean(ws.busy)}>
            {ws.busy ? ws.busy : "Explore sample project"}
          </button>
        </div>
        <p className="mt-3 text-[12px]" style={{ color: "var(--color-faint)" }}>
          The sample uses three short fictional demo documents, kept separate from your own work. Nothing is added to
          your projects unless you ask for it.
        </p>
      </div>
    </div>
  );
}
