"use client";

import { useState } from "react";
import { useWorkspace } from "@/lib/workspace";
import { IconAlert, IconCheck, IconFile, IconSearch, IconSparkle } from "./icons";

/**
 * Discovery results inside the Papers tab.
 *
 * Every row here resolved to a record in a scholarly index — that is the only
 * way a paper reaches this list. Availability says what Paplora has actually
 * read so far, which is "metadata" until the paper is imported and fetched.
 */
export function DiscoveryList({ onCompare }: { onCompare: () => void }) {
  const ws = useWorkspace();
  const [selected, setSelected] = useState<string[]>([]);
  const [messages, setMessages] = useState<string[]>([]);

  const pending = ws.candidates.filter((c) => !c.importedSourceId);
  if (!ws.candidates.length && !ws.researching && !ws.researchError) return null;

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  return (
    <section className="w-full max-w-[900px] px-4 pb-4 sm:px-6">
      {ws.project?.overview ? (
        <p className="mb-3 text-[13.5px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          {ws.project.overview}
        </p>
      ) : null}

      {ws.project?.constraints?.length ? (
        <p className="mb-3 flex flex-wrap items-center gap-1 text-[12px]" style={{ color: "var(--text-3)" }}>
          <span>Read as:</span>
          {ws.project.constraints.slice(0, 6).map((constraint) => (
            <span key={constraint} className="badge">
              {constraint}
            </span>
          ))}
        </p>
      ) : null}

      {ws.researching ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px]" role="status" aria-live="polite">
          <IconSearch size={14} style={{ color: "var(--accent)" }} />
          <span style={{ color: "var(--text-2)" }}>{ws.progress[ws.progress.length - 1]?.message ?? "Working"}…</span>
          <button className="btn btn-quiet btn-sm" onClick={ws.cancelResearch}>
            Stop
          </button>
        </div>
      ) : null}

      {ws.researchError ? (
        <p
          className="mb-3 flex items-start gap-2 rounded-md px-2 py-1.5 text-[12.5px]"
          role="alert"
          style={{ background: "var(--danger-weak)", color: "var(--danger)" }}
        >
          <IconAlert size={14} />
          <span>
            {ws.researchError}{" "}
            {ws.project ? (
              <button
                className="underline underline-offset-2"
                onClick={() => ws.research(ws.project!.id, ws.project!.question || ws.project!.title)}
              >
                Try again
              </button>
            ) : null}
          </span>
        </p>
      ) : null}

      {pending.length ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
            <h2 className="text-[13px] font-medium" style={{ color: "var(--text-2)" }}>
              Found {pending.length} paper{pending.length === 1 ? "" : "s"}
            </h2>
            <div className="flex items-center gap-1.5">
              {selected.length ? (
                <button className="btn btn-quiet btn-sm" onClick={() => setSelected([])}>
                  Clear
                </button>
              ) : null}
              <button
                className="btn btn-primary"
                disabled={!selected.length || Boolean(ws.busy)}
                onClick={async () => {
                  const result = await ws.importCandidates(selected);
                  setMessages(result.messages);
                  setSelected([]);
                  if (result.imported) onCompare();
                }}
              >
                <IconSparkle size={15} />
                Compare selected{selected.length ? ` (${selected.length})` : ""}
              </button>
            </div>
          </div>

          {ws.busy ? (
            <p className="pb-1 text-[12.5px]" role="status" style={{ color: "var(--text-2)" }}>
              {ws.progress[ws.progress.length - 1]?.message ?? ws.busy}
            </p>
          ) : null}

          {messages.length ? (
            <ul className="pb-2">
              {messages.map((message) => (
                <li key={message} className="text-[12.5px]" style={{ color: "var(--warn)" }}>
                  {message}
                </li>
              ))}
            </ul>
          ) : null}

          <ul>
            {pending.map((candidate) => (
              <li key={candidate.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-start gap-3 py-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.includes(candidate.id)}
                    onChange={() => toggle(candidate.id)}
                    aria-label={`Select ${candidate.title}`}
                  />
                  <div className="min-w-0 flex-1">
                    <a
                      href={candidate.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[15px] font-medium leading-snug hover:underline"
                    >
                      {candidate.title}
                    </a>
                    <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--text-2)" }}>
                      {[candidate.authors, candidate.year ? String(candidate.year) : null, candidate.venue]
                        .filter(Boolean)
                        .join(" · ") || "No indexed metadata"}
                    </p>
                    {candidate.why ? (
                      <p className="mt-1 text-[13px] leading-snug" style={{ color: "var(--text)" }}>
                        <span style={{ color: "var(--accent)" }}>Why: </span>
                        {candidate.why}
                      </p>
                    ) : null}
                    {candidate.description ? (
                      <p className="mt-1 line-clamp-2 text-[13px] leading-snug" style={{ color: "var(--text-2)" }}>
                        {candidate.description}
                      </p>
                    ) : null}
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px]" style={{ color: "var(--text-3)" }}>
                      <span className="badge" title="What Paplora has read so far. Importing the paper fetches more.">
                        <IconFile size={11} />
                        {candidate.coverage === "abstract"
                          ? "Abstract available"
                          : candidate.coverage === "fulltext"
                            ? "Full text available"
                            : "Metadata only"}
                      </span>
                      {candidate.pdfUrl ? <span className="badge">Open-access PDF</span> : null}
                      {candidate.doi ? <span>doi:{candidate.doi}</span> : null}
                      {candidate.codeUrl ? (
                        <a className="underline underline-offset-2" href={candidate.codeUrl} target="_blank" rel="noreferrer noopener">
                          code
                        </a>
                      ) : null}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {ws.candidates.some((c) => c.importedSourceId) && !pending.length ? (
        <p className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--text-2)" }}>
          <IconCheck size={14} />
          Every paper found has been added to this session.
        </p>
      ) : null}
    </section>
  );
}
