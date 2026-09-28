"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspace";
import { PapersTab } from "./papers-tab";
import { CompareTab } from "./compare-tab";
import { AddPapersDialog } from "./dialogs";
import { Menu, MenuItem, MenuSeparator } from "./ui/menu";
import { IconEdit, IconMore, IconSettings, IconTrash, IconUpload } from "./icons";

export type Tab = "papers" | "compare";

/**
 * The project surface: a compact header, two tabs, and whichever tab is active.
 *
 * The route carries the state that matters — /p/<id>?tab=compare&cell=<row>:<col>
 * — so a link into a specific comparison cell survives a reload and a share.
 */
export function ProjectWorkspace() {
  const ws = useWorkspace();
  const params = useParams<{ projectId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const projectId = params.projectId;

  const [addPapers, setAddPapers] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [questionOpen, setQuestionOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The route is the source of truth for which project is open.
  useEffect(() => {
    if (projectId && ws.project?.id !== projectId) ws.selectProject(projectId);
  }, [projectId, ws]);

  // ?add=1 comes from "Upload papers" on the home screen.
  useEffect(() => {
    if (search.get("add") === "1") {
      setAddPapers(true);
      router.replace(`/p/${projectId}`);
    }
  }, [search, projectId, router]);

  const project = ws.project?.id === projectId ? ws.project : null;
  const storedTab = ws.prefs.lastTab?.[projectId];
  const tabParam = search.get("tab") as Tab | null;
  const tab: Tab = tabParam ?? storedTab ?? "papers";

  useEffect(() => {
    setTitle(project?.title ?? "");
    setQuestion(project?.question ?? "");
    setEditing(false);
    setConfirmDelete(false);
  }, [project?.id, project?.title, project?.question]);

  const setTab = (next: Tab) => {
    ws.setPrefs({ lastTab: { ...(ws.prefs.lastTab ?? {}), [projectId]: next } });
    router.replace(`/p/${projectId}?tab=${next}`, { scroll: false });
  };

  if (!ws.ready) {
    return (
      <p className="p-6 text-[13px]" style={{ color: "var(--text-2)" }} role="status">
        Opening your workspace…
      </p>
    );
  }

  if (!project) {
    return (
      <div className="p-8">
        <p className="text-[14px] font-medium">This project is not on this device</p>
        <p className="mt-1 text-[13px]" style={{ color: "var(--text-2)" }}>
          Projects live in the browser that created them. If this link came from another machine or another browser, the
          data is not here.
        </p>
        <Link href="/" className="btn mt-3 inline-flex">
          Back to home
        </Link>
      </div>
    );
  }

  const longQuestion = project.question.length > 150;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="shrink-0 border-b px-4 pt-3 sm:px-6" style={{ borderColor: "var(--border)" }}>
        <nav className="flex items-center gap-1 text-[12px]" style={{ color: "var(--text-3)" }} aria-label="Breadcrumb">
          <Link href="/" className="hover:underline">
            Projects
          </Link>
          <span aria-hidden>/</span>
          <span className="truncate" style={{ color: "var(--text-2)" }}>
            {project.title}
          </span>
        </nav>

        <div className="mt-1 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="max-w-2xl space-y-2 pb-2">
                <input
                  className="field text-[16px] font-medium"
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
                      await ws.renameProject(project.id, {
                        title: title.trim() || project.title,
                        question: question.trim(),
                      });
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
                  <h1 className="min-w-0 truncate text-[24px] font-semibold tracking-[-0.02em]" title={project.title}>
                    {project.title}
                  </h1>
                  {project.kind === "sample" ? (
                    <span
                      className="badge"
                      title="The documents in this project are fictional demos written for Paplora. Nothing in them is a real paper or a real result."
                    >
                      Sample
                    </span>
                  ) : null}
                </div>
                {project.question ? (
                  <p
                    className={`mt-0.5 max-w-3xl text-[13.5px] leading-snug ${questionOpen ? "" : "line-clamp-2"}`}
                    style={{ color: "var(--text-2)" }}
                  >
                    {project.question}
                    {longQuestion ? (
                      <button
                        className="ml-1 align-baseline text-[12.5px] font-medium"
                        style={{ color: "var(--accent)" }}
                        onClick={() => setQuestionOpen((v) => !v)}
                        aria-expanded={questionOpen}
                      >
                        {questionOpen ? "Show less" : "Show more"}
                      </button>
                    ) : null}
                  </p>
                ) : (
                  <button
                    className="mt-0.5 text-[13px] underline-offset-2 hover:underline"
                    style={{ color: "var(--text-3)" }}
                    onClick={() => setEditing(true)}
                  >
                    Add a research question
                  </button>
                )}
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {tab === "papers" ? (
              <button className="btn btn-primary" onClick={() => setAddPapers(true)}>
                <IconUpload size={15} />
                <span className="hidden sm:inline">Add papers</span>
              </button>
            ) : null}
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
              <MenuItem icon={<IconUpload />} onSelect={() => setAddPapers(true)}>
                Add papers
              </MenuItem>
              <MenuItem icon={<IconSettings />} onSelect={() => document.dispatchEvent(new CustomEvent("paplora:settings"))}>
                Settings and backup
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<IconTrash />} danger onSelect={() => setConfirmDelete(true)}>
                Delete project
              </MenuItem>
            </Menu>
          </div>
        </div>

        <div className="mt-2 flex gap-4" role="tablist" aria-label="Project sections">
          <TabButton active={tab === "papers"} onClick={() => setTab("papers")} id="tab-papers" controls="panel-papers">
            Papers
            <span className="ml-1.5 text-[12px] tabular-nums" style={{ color: "var(--text-3)" }}>
              {ws.sources.length}
            </span>
          </TabButton>
          <TabButton active={tab === "compare"} onClick={() => setTab("compare")} id="tab-compare" controls="panel-compare">
            Compare
          </TabButton>
        </div>
      </header>

      {confirmDelete ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-[12.5px] sm:px-6"
          style={{ borderColor: "var(--border)", background: "var(--danger-weak)", color: "var(--danger)" }}
          role="alertdialog"
          aria-label="Confirm project deletion"
        >
          <span>Delete “{project.title}”? Its columns and answers go with it. The PDFs stay in your library.</span>
          <button
            className="btn btn-sm"
            onClick={async () => {
              await ws.deleteProject(project.id);
              router.push("/");
            }}
          >
            Delete project
          </button>
          <button className="btn btn-quiet btn-sm" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        </div>
      ) : null}

      {tab === "papers" ? (
        <div id="panel-papers" role="tabpanel" aria-labelledby="tab-papers" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PapersTab onAddPapers={() => setAddPapers(true)} onCompare={() => setTab("compare")} />
        </div>
      ) : (
        <div id="panel-compare" role="tabpanel" aria-labelledby="tab-compare" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CompareTab onAddPapers={() => setAddPapers(true)} />
        </div>
      )}

      <AddPapersDialog open={addPapers} onOpenChange={setAddPapers} />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  id,
  controls,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  id: string;
  controls: string;
}) {
  return (
    <button
      role="tab"
      id={id}
      aria-controls={controls}
      aria-selected={active}
      onClick={onClick}
      className="relative -mb-px px-0.5 pb-2 pt-1 text-[14px]"
      style={{
        color: active ? "var(--text)" : "var(--text-2)",
        fontWeight: active ? 500 : 400,
        borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
      }}
    >
      {children}
    </button>
  );
}
