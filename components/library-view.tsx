"use client";

import { useMemo, useState } from "react";
import { useWorkspace } from "@/lib/workspace";

/**
 * The library: every document this browser holds, which projects use it, and
 * what can still be read out of it. Keyword search over titles and filenames —
 * enough for a local MVP, no embeddings involved.
 */
export function LibraryView() {
  const ws = useWorkspace();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ws.library;
    return ws.library.filter(
      (s) => s.title.toLowerCase().includes(needle) || s.filename.toLowerCase().includes(needle),
    );
  }, [ws.library, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b px-4 py-3" style={{ borderColor: "var(--color-line)" }}>
        <h1 className="text-[15px] font-semibold">Library</h1>
        <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--color-muted)" }}>
          Every PDF stored in this browser. A paper can sit in several projects without being uploaded twice.
        </p>
        <input
          className="field mt-2 max-w-md"
          placeholder="Search by title or filename…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search library"
        />
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!ws.library.length ? (
          <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
            No documents yet. Add PDFs from inside a project and they will appear here.
          </p>
        ) : !results.length ? (
          <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
            Nothing matches “{query}”.
          </p>
        ) : (
          <ul className="space-y-2">
            {results.map((source) => {
              const projects = ws.libraryMembership[source.id] ?? [];
              const inCurrent = ws.sources.some((s) => s.id === source.id);
              return (
                <li key={source.id} className="card p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      {renaming === source.id ? (
                        <div className="flex gap-2">
                          <input
                            className="field max-w-sm"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            aria-label="Document title"
                            autoFocus
                          />
                          <button
                            className="btn"
                            onClick={async () => {
                              await ws.renameSource(source.id, title.trim() || source.title);
                              setRenaming(null);
                            }}
                          >
                            Save
                          </button>
                          <button className="btn btn-ghost" onClick={() => setRenaming(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <p className="truncate text-[13.5px] font-medium">{source.title}</p>
                      )}
                      <p className="mt-0.5 truncate text-[11.5px]" style={{ color: "var(--color-faint)" }}>
                        {source.filename} · {(source.byteSize / 1024).toFixed(0)} KB · hash {source.contentHash.slice(0, 10)}…
                      </p>
                      <p className="mt-1 flex flex-wrap gap-1 text-[11.5px]">
                        {projects.length ? (
                          projects.map((project) => (
                            <button
                              key={project.id}
                              className="chip"
                              onClick={() => ws.selectProject(project.id)}
                              title="Open this project"
                            >
                              {project.title}
                            </button>
                          ))
                        ) : (
                          <span className="chip">in no project</span>
                        )}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {ws.project && !inCurrent ? (
                        <button className="btn" onClick={() => ws.addFromLibrary(source.id)}>
                          Add to “{ws.project.title}”
                        </button>
                      ) : null}
                      <button
                        className="btn btn-ghost"
                        onClick={() => {
                          setRenaming(source.id);
                          setTitle(source.title);
                        }}
                      >
                        Rename
                      </button>
                      <button className="btn btn-ghost" onClick={() => ws.retryParse(source.id)} title="Read the PDF again">
                        Re-read
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ color: "var(--color-alarm)" }}
                        onClick={() => setConfirmDelete(source.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {confirmDelete === source.id ? (
                    <div
                      className="mt-2 rounded-md border p-2 text-[12.5px]"
                      style={{ borderColor: "var(--color-alarm)", background: "var(--color-alarm-soft)" }}
                    >
                      <p>
                        Delete this document everywhere? It is used by {projects.length} project
                        {projects.length === 1 ? "" : "s"}, and their rows and answers for it will go too.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          className="btn"
                          onClick={async () => {
                            await ws.deleteFromLibrary(source.id);
                            setConfirmDelete(null);
                          }}
                        >
                          Delete everywhere
                        </button>
                        <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
