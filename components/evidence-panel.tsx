"use client";

import { useEffect, useMemo, useState } from "react";
import { cellFor, useWorkspace } from "@/lib/workspace";
import { STATUS_TEXT, StatusBadge } from "./status";
import { PdfView } from "./pdf-view";
import { displayValue, rowLabel } from "@/lib/export/run";
import { Menu, MenuItem } from "./ui/menu";
import {
  IconChevronLeft,
  IconChevronRight,
  IconCheck,
  IconClose,
  IconCollapse,
  IconEdit,
  IconExpand,
  IconFlag,
  IconMore,
  IconSparkle,
} from "./icons";

/**
 * Evidence for the selected cell.
 *
 * The answer and its review actions sit in one compact block at the top; the
 * document takes the rest of the height, because reading the passage is the job.
 * Nothing here marks a cell reviewed on its own — that requires the user to act.
 */
export function EvidencePanel({
  onClose,
  onExpandDocument,
  expanded,
}: {
  onClose?: () => void;
  onExpandDocument?: () => void;
  expanded?: boolean;
}) {
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
  const spanKey = spans.map((s) => `${s.pageNumber}:${s.quote}`).join("|");

  // Changing cell (or genuinely different evidence) resets the reader. Keyed on
  // content, so a background refresh during extraction cannot wipe an edit.
  useEffect(() => {
    setActiveSpan(0);
    setDraft(null);
    setShowFlag(false);
    setFlagNote("");
    setPageNumber(Number(spanKey.split(":")[0]) || 1);
  }, [ws.selected?.rowId, ws.selected?.columnId, spanKey]);

  if (!ws.selected || !row || !column) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-[13px] font-medium">No cell selected</p>
        <p className="max-w-[16rem] text-[12.5px]" style={{ color: "var(--text-2)" }}>
          Choose a cell to read its answer, check the passage behind it, and mark it reviewed.
        </p>
      </div>
    );
  }

  const shown = displayValue(cell);
  const status = cell?.status ?? "empty";
  const answeredBy = cell?.userValue !== undefined ? "you" : cell?.proposal ? cell.proposal.model : null;
  const span = spans[activeSpan];
  const running = ws.job?.stage === "extracting" || ws.job?.stage === "queued";

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="Evidence">
      <header className="flex items-start gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold" title={column.label}>
            {column.label}
          </p>
          <p className="truncate text-[12px]" style={{ color: "var(--text-2)" }} title={rowLabel(row, source)}>
            {rowLabel(row, source)}
          </p>
        </div>
        <button
          className="btn btn-quiet btn-icon"
          onClick={onExpandDocument}
          aria-label={expanded ? "Exit full-screen document" : "Expand document"}
          title={expanded ? "Exit full-screen document" : "Expand document"}
        >
          {expanded ? <IconCollapse /> : <IconExpand />}
        </button>
        <button className="btn btn-quiet btn-icon" onClick={onClose} aria-label="Close evidence panel" title="Close">
          <IconClose />
        </button>
      </header>

      <section className="border-b px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
        {draft ? (
          <div className="space-y-2">
            <div>
              <label className="label-text" htmlFor="cell-value">
                Answer
              </label>
              <textarea
                id="cell-value"
                className="field min-h-[58px]"
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                autoFocus
              />
            </div>
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
          <>
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-[15px] font-medium leading-snug" style={{ wordBreak: "break-word" }}>
                {shown.value || <span style={{ color: "var(--text-3)" }}>No answer yet</span>}
                {shown.unit && shown.value ? (
                  <span className="ml-1 text-[13px]" style={{ color: "var(--text-2)" }}>
                    {shown.unit}
                  </span>
                ) : null}
              </p>
              <StatusBadge status={status} />
            </div>

            {shown.conditions ? (
              <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-2)" }}>
                <span className="font-medium">Conditions:</span> {shown.conditions}
              </p>
            ) : null}
            {cell?.proposal?.note ? (
              <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-2)" }}>
                {cell.proposal.note}
              </p>
            ) : null}
            <p className="mt-1 text-[12px]" style={{ color: "var(--text-3)" }}>
              {STATUS_TEXT[status].help}
            </p>
            {answeredBy ? (
              <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--text-3)" }}>
                Answered by {answeredBy}
                {cell?.proposal?.pagesConsidered?.length
                  ? ` · read pages ${cell.proposal.pagesConsidered.join(", ")}`
                  : ""}
                {cell?.proposal?.partialCoverage ? " · some pages were not read" : ""}
              </p>
            ) : null}
            {cell?.flagNote ? (
              <p className="mt-1 text-[12.5px]" style={{ color: "var(--danger)" }}>
                Flagged: {cell.flagNote}
              </p>
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                className="btn btn-sm"
                onClick={() =>
                  setDraft({ value: shown.value, unit: shown.unit ?? "", conditions: shown.conditions ?? "" })
                }
              >
                <IconEdit size={14} />
                Edit
              </button>
              <button
                className="btn btn-sm"
                onClick={() => ws.markReviewed(row.id, column.id)}
                disabled={status === "reviewed"}
                title={status === "reviewed" ? "Already reviewed" : "Adopt this answer as checked by you"}
              >
                <IconCheck size={14} />
                Mark reviewed
              </button>
              <button className="btn btn-sm" onClick={() => setShowFlag((v) => !v)}>
                <IconFlag size={14} />
                Flag
              </button>
              <Menu
                label="More cell actions"
                align="end"
                trigger={
                  <button className="btn btn-quiet btn-icon btn-sm" aria-label="More cell actions">
                    <IconMore size={15} />
                  </button>
                }
              >
                <MenuItem
                  icon={<IconSparkle />}
                  disabled={!ws.aiStatus?.configured || running}
                  onSelect={() => ws.extract([{ rowId: row.id, columnId: column.id }])}
                >
                  Re-extract this cell
                </MenuItem>
              </Menu>
            </div>

            {showFlag ? (
              <div className="mt-2 flex gap-2">
                <input
                  className="field"
                  value={flagNote}
                  onChange={(e) => setFlagNote(e.target.value)}
                  placeholder="What is wrong with this answer?"
                  aria-label="Flag note"
                  autoFocus
                />
                <button
                  className="btn"
                  onClick={async () => {
                    await ws.flagCell(row.id, column.id, flagNote);
                    setShowFlag(false);
                    setFlagNote("");
                  }}
                >
                  Save
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {cell?.pendingProposal ? (
        <section className="border-b px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--warn-weak)" }}>
          <p className="text-[12px] font-medium" style={{ color: "var(--warn)" }}>
            A newer AI answer is waiting
          </p>
          <p className="mt-0.5 text-[13px]">{cell.pendingProposal.value || "(no value)"}</p>
          <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--text-2)" }}>
            Your answer is kept until you decide.
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <button className="btn btn-sm" onClick={() => ws.acceptProposal(row.id, column.id)}>
              Use the new one
            </button>
            <button className="btn btn-quiet btn-sm" onClick={() => ws.dismissProposal(row.id, column.id)}>
              Keep mine
            </button>
          </div>
        </section>
      ) : null}

      <section className="border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>
            {spans.length ? `Evidence ${activeSpan + 1} of ${spans.length}` : "Evidence"}
          </h3>
          {spans.length > 1 ? (
            <div className="flex items-center gap-0.5">
              <button
                className="btn btn-quiet btn-icon btn-sm"
                onClick={() => {
                  const next = (activeSpan - 1 + spans.length) % spans.length;
                  setActiveSpan(next);
                  setPageNumber(spans[next].pageNumber);
                }}
                aria-label="Previous passage"
              >
                <IconChevronLeft size={15} />
              </button>
              <button
                className="btn btn-quiet btn-icon btn-sm"
                onClick={() => {
                  const next = (activeSpan + 1) % spans.length;
                  setActiveSpan(next);
                  setPageNumber(spans[next].pageNumber);
                }}
                aria-label="Next passage"
              >
                <IconChevronRight size={15} />
              </button>
            </div>
          ) : null}
        </div>

        {spans.length === 0 ? (
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-2)" }}>
            No passage is attached to this answer.
            {status === "extracted" ? " That is why it cannot be treated as grounded." : ""}
          </p>
        ) : (
          <>
            <blockquote
              className="mt-1.5 rounded-md border-l-2 px-2.5 py-1.5 text-[12.5px] leading-snug"
              style={{ borderColor: "var(--accent)", background: "var(--surface-2)", whiteSpace: "pre-wrap" }}
            >
              {span?.quote}
            </blockquote>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px]" style={{ color: "var(--text-3)" }}>
              <button
                className="underline-offset-2 hover:underline"
                onClick={() => span && setPageNumber(span.pageNumber)}
                style={{ color: "var(--accent)" }}
              >
                Go to page {span?.pageNumber}
              </button>
              <span>
                {span?.location === "span" ? "exact passage, highlighted" : "page-level: exact position not resolved"}
              </span>
            </div>
            {spans.length > 1 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {spans.map((item, index) => (
                  <button
                    key={`${item.pageNumber}-${index}`}
                    className="badge"
                    style={
                      index === activeSpan
                        ? { background: "var(--accent-weak)", color: "var(--accent)", borderColor: "var(--accent-border)" }
                        : undefined
                    }
                    onClick={() => {
                      setActiveSpan(index);
                      setPageNumber(item.pageNumber);
                    }}
                    aria-label={`Passage ${index + 1}, page ${item.pageNumber}`}
                  >
                    p.{item.pageNumber}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
        <p className="mt-1.5 text-[11px]" style={{ color: "var(--text-3)" }}>
          A quote proves the text is in the document — not that it supports the answer. That is what your review is for.
        </p>
      </section>

      <section className="min-h-0 flex-1">
        {version && source ? (
          <PdfView
            versionId={source.currentVersionId}
            pageNumber={pageNumber}
            pageCount={version.pageCount}
            onPageChange={setPageNumber}
            highlights={span && span.pageNumber === pageNumber ? [{ start: span.start, end: span.end }] : []}
          />
        ) : (
          <p className="p-4 text-[13px]" style={{ color: "var(--text-2)" }}>
            This row&apos;s document is not available.
          </p>
        )}
      </section>
    </div>
  );
}
