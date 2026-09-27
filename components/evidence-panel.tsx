"use client";

import { useEffect, useMemo, useState } from "react";
import { cellFor, useWorkspace } from "@/lib/workspace";
import { STATUS_TEXT, StatusChip } from "./status";
import { PdfView } from "./pdf-view";
import { displayValue, rowLabel } from "@/lib/export/run";

/**
 * The right-hand panel: the selected cell's answer, its evidence, the review
 * actions, and the document itself opened at the cited passage.
 */
export function EvidencePanel({ onClose }: { onClose?: () => void }) {
  const ws = useWorkspace();
  const [pageNumber, setPageNumber] = useState(1);
  const [activeSpan, setActiveSpan] = useState(0);
  const [draft, setDraft] = useState<{ value: string; unit: string; conditions: string } | null>(null);
  const [flagNote, setFlagNote] = useState("");
  const [showFlag, setShowFlag] = useState(false);

  const row = ws.rows.find((r) => r.id === ws.selected?.rowId);
  const column = ws.columns.find((c) => c.id === ws.selected?.columnId);
  const cell = ws.selected ? cellFor(ws.cells, ws.selected.rowId, ws.selected.columnId) : undefined;
  const source = ws.sources.find((s) => s.id === row?.sourceId);
  const version = source ? ws.versions[source.id] : undefined;
  const spans = useMemo(() => cell?.proposal?.evidence ?? [], [cell]);

  // Opening a different cell (or one whose evidence actually changed) jumps the
  // document to the first citation. Keyed on content, not array identity, so a
  // background reload during extraction cannot wipe an edit in progress.
  const spanKey = spans.map((s) => `${s.pageNumber}:${s.quote}`).join("|");
  useEffect(() => {
    setActiveSpan(0);
    setDraft(null);
    setShowFlag(false);
    setFlagNote("");
    setPageNumber(Number(spanKey.split(":")[0]) || 1);
  }, [ws.selected?.rowId, ws.selected?.columnId, spanKey]);

  if (!ws.selected || !row || !column) {
    return (
      <aside className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-[13px] font-medium">No cell selected</p>
        <p className="text-[12.5px]" style={{ color: "var(--color-muted)" }}>
          Pick a cell in the table to read its answer, check the passage it came from, and mark it reviewed.
        </p>
      </aside>
    );
  }

  const shown = displayValue(cell);
  const status = cell?.status ?? "empty";
  const answeredBy = cell?.userValue !== undefined ? "you" : cell?.proposal ? cell.proposal.model : null;

  return (
    <aside className="flex h-full flex-col" aria-label="Evidence">
      <header className="flex items-start justify-between gap-2 border-b px-3 py-2" style={{ borderColor: "var(--color-line)" }}>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{column.label}</p>
          <p className="truncate text-[12px]" style={{ color: "var(--color-muted)" }}>
            {rowLabel(row, source)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <StatusChip status={status} />
          {onClose ? (
            <button className="btn btn-ghost px-2 py-1 lg:hidden" onClick={onClose} aria-label="Close evidence">
              ✕
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <section className="border-b px-3 py-3" style={{ borderColor: "var(--color-line)" }}>
          {draft ? (
            <div className="space-y-2">
              <label className="label-text" htmlFor="cell-value">
                Answer
              </label>
              <textarea
                id="cell-value"
                className="field min-h-[64px]"
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label-text" htmlFor="cell-unit">
                    Unit
                  </label>
                  <input
                    id="cell-unit"
                    className="field"
                    value={draft.unit}
                    onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label-text" htmlFor="cell-conditions">
                    Conditions
                  </label>
                  <input
                    id="cell-conditions"
                    className="field"
                    value={draft.conditions}
                    onChange={(e) => setDraft({ ...draft, conditions: e.target.value })}
                    placeholder="dataset, split, hardware"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    await ws.saveCell(row.id, column.id, {
                      value: draft.value,
                      unit: draft.unit,
                      conditions: draft.conditions,
                    });
                    setDraft(null);
                  }}
                >
                  Save as my answer
                </button>
                <button className="btn" onClick={() => setDraft(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[15px] font-medium" style={{ wordBreak: "break-word" }}>
                {shown.value || <span style={{ color: "var(--color-faint)" }}>No answer</span>}
                {shown.unit ? <span className="ml-1 text-[13px]" style={{ color: "var(--color-muted)" }}>{shown.unit}</span> : null}
              </p>
              {shown.conditions ? (
                <p className="text-[12.5px]" style={{ color: "var(--color-muted)" }}>
                  <span className="font-medium">Conditions:</span> {shown.conditions}
                </p>
              ) : null}
              {cell?.proposal?.note ? (
                <p className="text-[12.5px]" style={{ color: "var(--color-muted)" }}>
                  {cell.proposal.note}
                </p>
              ) : null}
              <p className="text-[12px]" style={{ color: "var(--color-faint)" }}>
                {STATUS_TEXT[status].help}
              </p>
              {answeredBy ? (
                <p className="text-[11.5px]" style={{ color: "var(--color-faint)" }}>
                  Answered by {answeredBy}
                  {cell?.proposal?.partialCoverage ? " · some pages were not read" : ""}
                  {cell?.proposal?.pagesConsidered?.length
                    ? ` · pages read: ${cell.proposal.pagesConsidered.join(", ")}`
                    : ""}
                </p>
              ) : null}
              {cell?.flagNote ? (
                <p className="text-[12.5px]" style={{ color: "var(--color-alarm)" }}>
                  Flagged: {cell.flagNote}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  className="btn"
                  onClick={() =>
                    setDraft({ value: shown.value, unit: shown.unit ?? "", conditions: shown.conditions ?? "" })
                  }
                >
                  Edit answer
                </button>
                <button
                  className="btn"
                  onClick={() => ws.markReviewed(row.id, column.id)}
                  disabled={status === "reviewed"}
                >
                  Mark reviewed
                </button>
                <button className="btn" onClick={() => setShowFlag((v) => !v)}>
                  Flag a problem
                </button>
                <button
                  className="btn"
                  onClick={() => ws.extract([{ rowId: row.id, columnId: column.id }])}
                  disabled={!ws.aiStatus?.configured || Boolean(ws.job && ws.job.stage === "extracting")}
                  title={ws.aiStatus?.configured ? "Ask the model for a new answer" : ws.aiStatus?.reason}
                >
                  Ask AI again
                </button>
              </div>

              {showFlag ? (
                <div className="flex gap-2 pt-1">
                  <input
                    className="field"
                    value={flagNote}
                    onChange={(e) => setFlagNote(e.target.value)}
                    placeholder="What is wrong with this answer?"
                    aria-label="Flag note"
                  />
                  <button
                    className="btn"
                    onClick={async () => {
                      await ws.flagCell(row.id, column.id, flagNote);
                      setShowFlag(false);
                      setFlagNote("");
                    }}
                  >
                    Save flag
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </section>

        {cell?.pendingProposal ? (
          <section
            className="border-b px-3 py-3"
            style={{ borderColor: "var(--color-line)", background: "var(--color-warn-soft)" }}
          >
            <p className="text-[12.5px] font-medium" style={{ color: "var(--color-warn)" }}>
              A newer AI answer is waiting
            </p>
            <p className="mt-1 text-[13px]">{cell.pendingProposal.value || "(no value)"}</p>
            <p className="mt-1 text-[12px]" style={{ color: "var(--color-muted)" }}>
              Your own answer is being kept. Applying this replaces it.
            </p>
            <div className="mt-2 flex gap-2">
              <button className="btn" onClick={() => ws.acceptProposal(row.id, column.id)}>
                Replace mine
              </button>
              <button className="btn btn-ghost" onClick={() => ws.dismissProposal(row.id, column.id)}>
                Keep mine
              </button>
            </div>
          </section>
        ) : null}

        <section className="border-b px-3 py-3" style={{ borderColor: "var(--color-line)" }}>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
            Evidence
          </h3>
          {spans.length === 0 ? (
            <p className="mt-2 text-[12.5px]" style={{ color: "var(--color-muted)" }}>
              No passage is attached to this answer.
              {status === "extracted" ? " That is why it cannot be treated as grounded." : ""}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {spans.map((span, index) => (
                <li key={`${span.pageNumber}-${index}`}>
                  <button
                    className="w-full rounded-md border p-2 text-left transition-colors"
                    style={{
                      borderColor: index === activeSpan ? "var(--color-accent)" : "var(--color-line)",
                      background: index === activeSpan ? "var(--color-accent-soft)" : "transparent",
                    }}
                    onClick={() => {
                      setActiveSpan(index);
                      setPageNumber(span.pageNumber);
                    }}
                  >
                    <span className="block text-[12.5px] leading-snug" style={{ whiteSpace: "pre-wrap" }}>
                      “{span.quote}”
                    </span>
                    <span className="mt-1 block text-[11px]" style={{ color: "var(--color-muted)" }}>
                      Page {span.pageNumber} ·{" "}
                      {span.location === "span"
                        ? "exact passage, highlighted"
                        : "page-level: the exact position could not be resolved"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11.5px]" style={{ color: "var(--color-faint)" }}>
            A quote proves the text is in the document. It does not prove the text supports the answer — that is what
            your review is for.
          </p>
        </section>

        <section className="h-[60vh] min-h-[320px]">
          {version && source ? (
            <PdfView
              versionId={source.currentVersionId}
              pageNumber={pageNumber}
              pageCount={version.pageCount}
              onPageChange={setPageNumber}
              highlights={
                spans[activeSpan] && spans[activeSpan].pageNumber === pageNumber
                  ? [{ start: spans[activeSpan].start, end: spans[activeSpan].end }]
                  : []
              }
            />
          ) : (
            <p className="p-4 text-[13px]" style={{ color: "var(--color-muted)" }}>
              This row&apos;s document is not available.
            </p>
          )}
        </section>
      </div>
    </aside>
  );
}
