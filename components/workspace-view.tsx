"use client";

import { useEffect, useRef, useState } from "react";
import { bulkTargets, useWorkspace } from "@/lib/workspace";
import { ComparisonTable } from "./comparison-table";
import { EvidencePanel } from "./evidence-panel";
import { LibraryView } from "./library-view";
import { AddColumnDialog, AddPapersDialog, NewProjectDialog, SettingsDialog } from "./dialogs";
import { Menu, MenuItem, MenuSeparator } from "./ui/menu";
import {
  IconAlert,
  IconClose,
  IconColumns,
  IconDownload,
  IconEdit,
  IconLibrary,
  IconMenu,
  IconMore,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconSparkle,
  IconTrash,
  IconUpload,
} from "./icons";
import { comparisonCsv, downloadCsv, evidenceCsv, evidenceJson, download } from "@/lib/export/run";

/**
 * The workspace shell: navigation, main column, evidence panel.
 *
 * Two rules drive the layout. Every flex ancestor of the table carries min-w-0,
 * so the table's horizontal scroll belongs to the table and never to the page.
 * And the evidence panel is only mounted when it is open, so a closed panel
 * gives all of its width back instead of reserving an empty third of the screen.
 */

type View = "project" | "library";

const PANEL_MIN = 360;
const PANEL_MAX = 760;

export function WorkspaceView() {
  const ws = useWorkspace();
  const [view, setView] = useState<View>("project");
  const [newProject, setNewProject] = useState(false);
  const [addPapers, setAddPapers] = useState(false);
  const [addColumn, setAddColumn] = useState(false);
  const [settings, setSettings] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [documentExpanded, setDocumentExpanded] = useState(false);

  const collapsed = ws.prefs.sidebarCollapsed ?? false;
  const panelWidth = Math.min(PANEL_MAX, Math.max(PANEL_MIN, ws.prefs.evidencePanelWidth ?? 440));

  // Selecting a cell opens the panel; the user can close it and keep the selection.
  useEffect(() => {
    if (ws.selected) setEvidenceOpen(true);
  }, [ws.selected]);

  // A stored theme wins over the system setting; "system" removes the attribute.
  useEffect(() => {
    const root = document.documentElement;
    const theme = ws.prefs.theme ?? "system";
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    root.setAttribute("data-density", ws.prefs.density ?? "comfortable");
  }, [ws.prefs.theme, ws.prefs.density]);

  if (!ws.ready) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <p className="text-[13px]" style={{ color: "var(--text-2)" }} role="status">
          Opening your workspace…
        </p>
      </div>
    );
  }

  const showPanel = evidenceOpen && Boolean(ws.selected) && view === "project";

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={navOpen}
        view={view}
        onView={(next) => {
          setView(next);
          setNavOpen(false);
        }}
        onNewProject={() => setNewProject(true)}
        onSettings={() => setSettings(true)}
        onCloseMobile={() => setNavOpen(false)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {ws.storageError ? (
          <div
            className="flex items-start gap-2 border-b px-4 py-2 text-[12.5px]"
            role="alert"
            style={{ borderColor: "var(--border)", background: "var(--danger-weak)", color: "var(--danger)" }}
          >
            <IconAlert size={15} />
            <span>{ws.storageError}</span>
          </div>
        ) : null}

        {view === "library" ? (
          <LibraryView />
        ) : !ws.project ? (
          <EmptyWorkspace onCreate={() => setNewProject(true)} onOpenNav={() => setNavOpen(true)} />
        ) : (
          <>
            <ProjectHeader
              onAddPapers={() => setAddPapers(true)}
              onAddColumn={() => setAddColumn(true)}
              onToggleNav={() => setNavOpen(true)}
              onSettings={() => setSettings(true)}
            />
            <div className="flex min-h-0 min-w-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ComparisonTable onOpenEvidence={() => setEvidenceOpen(true)} evidenceOpen={showPanel} />
              </div>

              {showPanel ? (
                <>
                  <ResizeHandle
                    width={panelWidth}
                    onChange={(next) => ws.setPrefs({ evidencePanelWidth: next })}
                  />
                  <aside
                    className="hidden shrink-0 border-l lg:block"
                    style={{ width: panelWidth, borderColor: "var(--border)", background: "var(--surface)" }}
                  >
                    <EvidencePanel
                      onClose={() => setEvidenceOpen(false)}
                      onExpandDocument={() => setDocumentExpanded(true)}
                    />
                  </aside>
                </>
              ) : null}

              {/* Below lg the panel is a full-screen sheet rather than a third column. */}
              {showPanel ? (
                <div className="fixed inset-0 z-40 lg:hidden" style={{ background: "var(--surface)" }}>
                  <EvidencePanel
                    onClose={() => setEvidenceOpen(false)}
                    onExpandDocument={() => setDocumentExpanded(true)}
                  />
                </div>
              ) : null}
            </div>
          </>
        )}
      </main>

      {documentExpanded && ws.selected ? (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--surface)" }}>
          <EvidencePanel
            expanded
            onClose={() => setDocumentExpanded(false)}
            onExpandDocument={() => setDocumentExpanded(false)}
          />
        </div>
      ) : null}

      <NewProjectDialog open={newProject} onOpenChange={setNewProject} />
      <AddPapersDialog open={addPapers} onOpenChange={setAddPapers} />
      <AddColumnDialog open={addColumn} onOpenChange={setAddColumn} />
      <SettingsDialog open={settings} onOpenChange={setSettings} />
    </div>
  );
}

/** Drag or arrow-key the boundary between table and evidence. */
function ResizeHandle({ width, onChange }: { width: number; onChange: (next: number) => void }) {
  const [active, setActive] = useState(false);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize evidence panel"
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      tabIndex={0}
      data-active={active}
      className="hidden w-1 cursor-col-resize lg:block"
      style={{ background: active ? "var(--accent)" : "var(--border)" }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(Math.min(PANEL_MAX, width + 24));
        if (e.key === "ArrowRight") onChange(Math.max(PANEL_MIN, width - 24));
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        setActive(true);
        const startX = e.clientX;
        const startWidth = width;
        const move = (event: PointerEvent) =>
          onChange(Math.max(PANEL_MIN, Math.min(PANEL_MAX, startWidth - (event.clientX - startX))));
        const up = () => {
          setActive(false);
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    />
  );
}

function Sidebar({
  collapsed,
  mobileOpen,
  view,
  onView,
  onNewProject,
  onSettings,
  onCloseMobile,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  view: View;
  onView: (view: View) => void;
  onNewProject: () => void;
  onSettings: () => void;
  onCloseMobile: () => void;
}) {
  const ws = useWorkspace();
  const [query, setQuery] = useState("");
  const searchable = ws.projects.length > 7;
  const projects = query.trim()
    ? ws.projects.filter((p) => p.title.toLowerCase().includes(query.trim().toLowerCase()))
    : ws.projects;

  return (
    <nav
      className={`${mobileOpen ? "fixed inset-y-0 left-0 z-40 w-[240px] shadow-lg" : "hidden"} flex shrink-0 flex-col border-r lg:static lg:flex`}
      style={{
        width: mobileOpen ? 240 : collapsed ? 56 : 232,
        borderColor: "var(--border)",
        background: "var(--surface)",
      }}
      aria-label="Workspace navigation"
    >
      <div className="flex h-12 items-center gap-1 px-2">
        {!collapsed || mobileOpen ? (
          <span className="flex-1 truncate px-1 text-[14.5px] font-semibold tracking-[-0.01em]">Paplora</span>
        ) : null}
        <button
          className="btn btn-quiet btn-icon hidden lg:inline-flex"
          onClick={() => ws.setPrefs({ sidebarCollapsed: !collapsed })}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <IconSidebar />
        </button>
        <button className="btn btn-quiet btn-icon lg:hidden" onClick={onCloseMobile} aria-label="Close navigation">
          <IconClose />
        </button>
      </div>

      <div className="px-2 pb-2">
        <button
          className={`btn w-full ${collapsed && !mobileOpen ? "btn-icon" : ""}`}
          onClick={onNewProject}
          aria-label="New project"
          title="New project"
        >
          <IconPlus />
          {!collapsed || mobileOpen ? <span>New project</span> : null}
        </button>
      </div>

      {searchable && (!collapsed || mobileOpen) ? (
        <div className="relative px-2 pb-2">
          <IconSearch size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
          <input
            className="field pl-7"
            placeholder="Find project…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find project"
          />
        </div>
      ) : null}

      <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-2">
        {!collapsed || mobileOpen ? (
          <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>
            Projects
          </p>
        ) : null}
        {projects.length === 0 ? (
          !collapsed || mobileOpen ? (
            <p className="px-2 text-[12.5px]" style={{ color: "var(--text-3)" }}>
              {ws.projects.length ? "No match." : "No projects yet."}
            </p>
          ) : null
        ) : (
          <ul className="space-y-px">
            {projects.map((project) => {
              const active = view === "project" && ws.project?.id === project.id;
              return (
                <li key={project.id}>
                  <button
                    className="relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]"
                    style={{
                      background: active ? "var(--accent-weak)" : "transparent",
                      color: active ? "var(--accent)" : "var(--text)",
                      fontWeight: active ? 600 : 400,
                    }}
                    onClick={() => {
                      ws.selectProject(project.id);
                      onView("project");
                    }}
                    title={project.title}
                  >
                    {active ? (
                      <span
                        aria-hidden
                        className="absolute inset-y-1 left-0 w-[2.5px] rounded-full"
                        style={{ background: "var(--accent)" }}
                      />
                    ) : null}
                    {collapsed && !mobileOpen ? (
                      <span className="mx-auto text-[12px] font-semibold uppercase">{project.title.slice(0, 2)}</span>
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{project.title}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t p-2" style={{ borderColor: "var(--border)" }}>
        <button
          className={`menu-item ${collapsed && !mobileOpen ? "justify-center" : ""}`}
          style={{
            background: view === "library" ? "var(--accent-weak)" : "transparent",
            color: view === "library" ? "var(--accent)" : "var(--text)",
          }}
          onClick={() => onView("library")}
          title="Library"
        >
          <IconLibrary />
          {!collapsed || mobileOpen ? (
            <>
              <span className="flex-1">Library</span>
              <span className="text-[11.5px]" style={{ color: "var(--text-3)" }}>
                {ws.library.length}
              </span>
            </>
          ) : null}
        </button>
        <button
          className={`menu-item ${collapsed && !mobileOpen ? "justify-center" : ""}`}
          onClick={onSettings}
          title="Settings"
        >
          <IconSettings />
          {!collapsed || mobileOpen ? <span>Settings</span> : null}
        </button>
      </div>
    </nav>
  );
}

function ProjectHeader({
  onAddPapers,
  onAddColumn,
  onToggleNav,
  onSettings,
}: {
  onAddPapers: () => void;
  onAddColumn: () => void;
  onToggleNav: () => void;
  onSettings: () => void;
}) {
  const ws = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(ws.project?.title ?? "");
  const [question, setQuestion] = useState(ws.project?.question ?? "");
  const [questionOpen, setQuestionOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setTitle(ws.project?.title ?? "");
    setQuestion(ws.project?.question ?? "");
    setEditing(false);
    setConfirmDelete(false);
    setQuestionOpen(false);
  }, [ws.project?.id, ws.project?.title, ws.project?.question]);

  if (!ws.project) return null;
  const project = ws.project;
  const running = ws.job?.stage === "extracting" || ws.job?.stage === "queued";
  const pending = bulkTargets(ws.cells, ws.rows, ws.columns);
  const hasPapers = ws.rows.length > 0;
  const aiReady = Boolean(ws.aiStatus?.configured);
  const longQuestion = project.question.length > 120;

  const exportInput = { project, rows: ws.rows, columns: ws.columns, cells: ws.cells, sources: ws.sources };
  const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "project";

  return (
    <header className="border-b" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex items-start gap-3 px-3 py-3 sm:px-4">
        <button className="btn btn-quiet btn-icon lg:hidden" onClick={onToggleNav} aria-label="Open navigation">
          <IconMenu />
        </button>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="max-w-2xl space-y-2">
              <input
                className="field text-[16px] font-semibold"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-label="Project title"
                autoFocus
              />
              <textarea
                className="field min-h-[60px]"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                aria-label="Research question"
                placeholder="What are you trying to find out across these papers?"
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
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h1
                  className="min-w-0 truncate text-[22px] font-semibold leading-tight tracking-[-0.015em]"
                  title={project.title}
                >
                  {project.title}
                </h1>
                {project.kind === "sample" ? (
                  <span
                    className="badge"
                    style={{ background: "var(--warn-weak)", color: "var(--warn)", borderColor: "transparent" }}
                    title="The three documents in this project are fictional demos written for Paplora. Nothing in them is a real paper or a real result."
                  >
                    Sample project
                  </span>
                ) : null}
                <button
                  className="btn btn-quiet btn-icon btn-sm"
                  onClick={() => setEditing(true)}
                  aria-label="Edit title and research question"
                  title="Edit title and research question"
                >
                  <IconEdit size={15} />
                </button>
              </div>

              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                {project.question ? (
                  <p
                    className={`max-w-3xl text-[13px] ${questionOpen ? "" : "line-clamp-1"}`}
                    style={{ color: "var(--text-2)" }}
                  >
                    {project.question}
                  </p>
                ) : (
                  <button className="text-[13px] underline-offset-2 hover:underline" style={{ color: "var(--text-3)" }} onClick={() => setEditing(true)}>
                    Add a research question
                  </button>
                )}
                {longQuestion ? (
                  <button
                    className="text-[12px] font-medium"
                    style={{ color: "var(--accent)" }}
                    onClick={() => setQuestionOpen((v) => !v)}
                  >
                    {questionOpen ? "Less" : "More"}
                  </button>
                ) : null}
              </div>

              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" style={{ color: "var(--text-3)" }}>
                <span>
                  {ws.sources.length} paper{ws.sources.length === 1 ? "" : "s"}
                </span>
                <span>
                  {ws.rows.length} row{ws.rows.length === 1 ? "" : "s"}
                </span>
                <span>
                  {ws.columns.length} column{ws.columns.length === 1 ? "" : "s"}
                </span>
                {!aiReady ? (
                  <button
                    className="badge"
                    onClick={onSettings}
                    title={ws.aiStatus?.reason ?? "Automatic extraction is not configured."}
                  >
                    <IconSparkle size={12} />
                    AI not connected
                  </button>
                ) : null}
              </p>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button className={hasPapers ? "btn" : "btn btn-primary"} onClick={onAddPapers}>
            <IconUpload size={15} />
            <span className="hidden sm:inline">Add papers</span>
          </button>

          <button
            className={hasPapers && aiReady ? "btn btn-primary" : "btn"}
            onClick={() => ws.extract(pending)}
            disabled={!aiReady || running || !pending.length}
            title={
              !aiReady
                ? (ws.aiStatus?.reason ?? "Automatic extraction is not configured.")
                : !hasPapers
                  ? "Add a paper first."
                  : !pending.length
                    ? "Every cell already has an answer you wrote or reviewed."
                    : `Extract ${pending.length} unanswered cell${pending.length === 1 ? "" : "s"}`
            }
          >
            <IconSparkle size={15} />
            <span className="hidden sm:inline">{running ? "Extracting…" : "Extract data"}</span>
          </button>

          <button className="btn" onClick={onAddColumn}>
            <IconColumns size={15} />
            <span className="hidden md:inline">Add column</span>
          </button>

          <Menu
            label="Export"
            align="end"
            trigger={
              <button className="btn" aria-label="Export">
                <IconDownload size={15} />
                <span className="hidden md:inline">Export</span>
              </button>
            }
          >
            <MenuItem onSelect={() => downloadCsv(`${slug}-comparison.csv`, comparisonCsv(exportInput))}>
              Comparison table (CSV)
            </MenuItem>
            <MenuItem onSelect={() => downloadCsv(`${slug}-evidence.csv`, evidenceCsv(exportInput))}>
              Evidence, one quote per line (CSV)
            </MenuItem>
            <MenuItem
              onSelect={() =>
                download(`${slug}-evidence.json`, new Blob([evidenceJson(exportInput)], { type: "application/json" }))
              }
            >
              Evidence with full context (JSON)
            </MenuItem>
          </Menu>

          <Menu
            label="Project actions"
            align="end"
            trigger={
              <button className="btn btn-quiet btn-icon" aria-label="Project actions">
                <IconMore />
              </button>
            }
          >
            <MenuItem icon={<IconEdit />} onSelect={() => setEditing(true)}>
              Rename project
            </MenuItem>
            <MenuItem icon={<IconSettings />} onSelect={onSettings}>
              Settings and backup
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<IconTrash />} danger onSelect={() => setConfirmDelete(true)}>
              Delete project
            </MenuItem>
          </Menu>
        </div>
      </div>

      {running || ws.job?.stage === "done" || ws.job?.stage === "failed" ? (
        <div
          className="flex flex-wrap items-center gap-2 border-t px-3 py-1.5 text-[12px] sm:px-4"
          style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
          role="status"
          aria-live="polite"
        >
          <span style={{ color: "var(--text-2)" }}>
            {ws.job!.completed + ws.job!.failed} of {ws.job!.total} cells
            {ws.job!.failed ? ` · ${ws.job!.failed} failed` : ""}
            {ws.job!.stage === "done" ? " · finished" : ws.job!.stage === "failed" ? " · stopped" : ""}
          </span>
          <span className="h-1 w-36 overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
            <span
              className="block h-full rounded-full transition-[width] duration-300"
              style={{
                width: `${Math.round(((ws.job!.completed + ws.job!.failed) / Math.max(ws.job!.total, 1)) * 100)}%`,
                background: "var(--accent)",
              }}
            />
          </span>
          {running ? (
            <>
              <button className="btn btn-quiet btn-sm" onClick={ws.cancelExtraction}>
                Cancel
              </button>
              <span style={{ color: "var(--text-3)" }}>
                Runs in this tab. Closing it pauses the work; you can resume when you return.
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      {ws.resumable && !running ? (
        <div
          className="flex flex-wrap items-center gap-2 border-t px-3 py-1.5 text-[12.5px] sm:px-4"
          style={{ borderColor: "var(--border)", background: "var(--warn-weak)", color: "var(--warn)" }}
        >
          <IconAlert size={14} />
          <span>
            An earlier run stopped with{" "}
            {ws.resumable.targets.filter((t) => t.state === "pending" || t.state === "running").length} cells unfinished.
          </span>
          <button className="btn btn-sm" onClick={() => ws.resumeJob()} disabled={!aiReady}>
            Resume
          </button>
          <button className="btn btn-quiet btn-sm" onClick={() => ws.dismissResumable()}>
            Discard
          </button>
        </div>
      ) : null}

      {confirmDelete ? (
        <div
          className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-[12.5px] sm:px-4"
          style={{ borderColor: "var(--border)", background: "var(--danger-weak)", color: "var(--danger)" }}
          role="alertdialog"
          aria-label="Confirm project deletion"
        >
          <span>
            Delete “{project.title}”? Its columns and answers go with it. The PDFs stay in your library.
          </span>
          <button className="btn btn-sm" onClick={() => ws.deleteProject(project.id)}>
            Delete project
          </button>
          <button className="btn btn-quiet btn-sm" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        </div>
      ) : null}
    </header>
  );
}

function EmptyWorkspace({ onCreate, onOpenNav }: { onCreate: () => void; onOpenNav: () => void }) {
  const ws = useWorkspace();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 items-center px-3 lg:hidden">
        <button className="btn btn-quiet btn-icon" onClick={onOpenNav} aria-label="Open navigation">
          <IconMenu />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-[30rem]">
          <h1 className="text-[20px] font-semibold tracking-[-0.015em]">Compare papers, and keep the receipts</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: "var(--text-2)" }}>
            Put a set of PDFs in a project, decide what to extract from each one, and check every answer against the
            passage it came from. Everything stays in this browser.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={onCreate}>
              <IconPlus size={15} />
              Create a project
            </button>
            <button className="btn" onClick={() => ws.openSample()} disabled={Boolean(ws.busy)}>
              {ws.busy ?? "Explore sample project"}
            </button>
          </div>
          <p className="mt-3 text-[12px]" style={{ color: "var(--text-3)" }}>
            The sample uses three fictional demo documents, kept separate from your own work.
          </p>
        </div>
      </div>
    </div>
  );
}
