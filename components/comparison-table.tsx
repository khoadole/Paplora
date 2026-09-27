"use client";

import { useMemo, useState } from "react";
import { bulkTargets, cellFor, useWorkspace } from "@/lib/workspace";
import { StatusChip } from "./status";
import { displayValue } from "@/lib/export/run";
import type { CellStatus, Column } from "@/lib/types";

/**
 * The comparison table.
 *
 * Sorting a number column orders the values; it is NOT a ranking, and the header
 * says so. Missing, ambiguous and unreadable cells never sort as if they were
 * zero — they collect at the end, keeping "no information" distinct from "low".
 */

type SortState = { columnId: string; direction: "asc" | "desc" } | null;

const NUMBER_PATTERN = /-?\d+(\.\d+)?/;

function numericValue(text: string): number | null {
  const match = NUMBER_PATTERN.exec(text.replace(/,/g, ""));
  return match ? Number(match[0]) : null;
}

export function ComparisonTable() {
  const ws = useWorkspace();
  const [sort, setSort] = useState<SortState>(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "unreviewed" | "needs_attention">("all");
  const [editingColumn, setEditingColumn] = useState<Column | null>(null);
  const [splitFor, setSplitFor] = useState<string | null>(null);
  const [splitLabel, setSplitLabel] = useState("");
  const running = ws.job?.stage === "extracting" || ws.job?.stage === "queued";

  const visibleRows = useMemo(() => {
    let list = ws.rows;
    if (filter.trim()) {
      const needle = filter.toLowerCase();
      list = list.filter((row) => {
        const source = ws.sources.find((s) => s.id === row.sourceId);
        const inTitle = (source?.title ?? "").toLowerCase().includes(needle);
        const inConfig = (row.configurationLabel ?? "").toLowerCase().includes(needle);
        const inCells = ws.columns.some((column) => {
          const shown = displayValue(cellFor(ws.cells, row.id, column.id));
          return shown.value.toLowerCase().includes(needle) || (shown.conditions ?? "").toLowerCase().includes(needle);
        });
        return inTitle || inConfig || inCells;
      });
    }
    if (statusFilter !== "all") {
      list = list.filter((row) =>
        ws.columns.some((column) => {
          const status = cellFor(ws.cells, row.id, column.id)?.status ?? "empty";
          return statusFilter === "unreviewed"
            ? status === "extracted" || status === "stale"
            : status === "flagged" || status === "failed" || status === "ambiguous" || status === "unreadable";
        }),
      );
    }
    if (sort) {
      const column = ws.columns.find((c) => c.id === sort.columnId);
      list = [...list].sort((a, b) => {
        const left = displayValue(cellFor(ws.cells, a.id, sort.columnId));
        const right = displayValue(cellFor(ws.cells, b.id, sort.columnId));
        const leftMissing = !left.value.trim();
        const rightMissing = !right.value.trim();
        // Missing information always sinks, in both directions.
        if (leftMissing && rightMissing) return 0;
        if (leftMissing) return 1;
        if (rightMissing) return -1;
        if (column?.answerType === "number") {
          const ln = numericValue(left.value);
          const rn = numericValue(right.value);
          if (ln === null && rn === null) return 0;
          if (ln === null) return 1;
          if (rn === null) return -1;
          return sort.direction === "asc" ? ln - rn : rn - ln;
        }
        return sort.direction === "asc"
          ? left.value.localeCompare(right.value)
          : right.value.localeCompare(left.value);
      });
    }
    return list;
  }, [ws.rows, ws.sources, ws.columns, ws.cells, filter, statusFilter, sort]);

  if (!ws.columns.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="text-[14px] font-medium">No columns yet</p>
        <p className="max-w-sm text-[13px]" style={{ color: "var(--color-muted)" }}>
          A column is one question you want answered for every paper — the method, the evaluation split, the reported
          number. Add one to start the table.
        </p>
      </div>
    );
  }

  if (!ws.rows.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="text-[14px] font-medium">No papers in this project</p>
        <p className="max-w-sm text-[13px]" style={{ color: "var(--color-muted)" }}>
          Add PDFs with “Add papers”. Each paper becomes one row; you can split a paper into several rows later if it
          reports more than one configuration.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--color-line)" }}>
        <input
          className="field max-w-[15rem]"
          placeholder="Filter rows…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter rows"
        />
        <select
          className="field max-w-[12rem]"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          aria-label="Filter by review state"
        >
          <option value="all">All rows</option>
          <option value="unreviewed">Has unreviewed answers</option>
          <option value="needs_attention">Needs attention</option>
        </select>
        {sort ? (
          <button className="btn btn-ghost" onClick={() => setSort(null)}>
            Clear sort
          </button>
        ) : null}
        <span className="ml-auto text-[12px]" style={{ color: "var(--color-muted)" }}>
          {visibleRows.length} of {ws.rows.length} rows
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-max min-w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-20 min-w-[15rem] max-w-[22rem] border-b border-r px-3 py-2 text-left align-bottom"
                style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}
                scope="col"
              >
                Paper
              </th>
              {ws.columns.map((column, index) => {
                const sorted = sort?.columnId === column.id;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    className="sticky top-0 z-10 min-w-[13rem] max-w-[20rem] border-b border-r px-2 py-1.5 text-left align-bottom"
                    style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <button
                        className="btn btn-ghost px-1 py-0.5 text-left text-[12.5px] font-semibold"
                        onClick={() =>
                          setSort((current) =>
                            current?.columnId === column.id && current.direction === "asc"
                              ? { columnId: column.id, direction: "desc" }
                              : { columnId: column.id, direction: "asc" },
                          )
                        }
                        title={
                          column.answerType === "number"
                            ? "Order by this value. Ordering is not a scientific ranking: conditions differ between papers."
                            : "Order by this column"
                        }
                      >
                        {column.label}
                        {sorted ? <span aria-hidden>{sort?.direction === "asc" ? " ↑" : " ↓"}</span> : null}
                        {column.unit ? (
                          <span className="ml-1 font-normal" style={{ color: "var(--color-faint)" }}>
                            ({column.unit})
                          </span>
                        ) : null}
                      </button>
                      <span className="flex shrink-0 items-center">
                        <button
                          className="btn btn-ghost px-1 py-0.5"
                          onClick={() => ws.moveColumn(column.id, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${column.label} left`}
                        >
                          ‹
                        </button>
                        <button
                          className="btn btn-ghost px-1 py-0.5"
                          onClick={() => ws.moveColumn(column.id, 1)}
                          disabled={index === ws.columns.length - 1}
                          aria-label={`Move ${column.label} right`}
                        >
                          ›
                        </button>
                        <button
                          className="btn btn-ghost px-1 py-0.5"
                          onClick={() => setEditingColumn(column)}
                          aria-label={`Edit ${column.label}`}
                        >
                          ⋯
                        </button>
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const source = ws.sources.find((s) => s.id === row.sourceId);
              const version = source ? ws.versions[source.id] : undefined;
              return (
                <tr key={row.id}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-r px-3 py-2 text-left align-top font-normal"
                    style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium" title={source?.title}>
                          {source?.title ?? "Unknown document"}
                        </p>
                        {row.configurationLabel ? (
                          <p className="truncate text-[12px]" style={{ color: "var(--color-accent)" }}>
                            {row.configurationLabel}
                          </p>
                        ) : null}
                        <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11.5px]" style={{ color: "var(--color-faint)" }}>
                          {version ? <span>{version.pageCount} pages</span> : null}
                          {version?.parseStatus === "no_text_layer" ? (
                            <span className="chip" style={{ color: "var(--color-alarm)" }}>
                              no text layer
                            </span>
                          ) : null}
                          {version && version.pagesWithText > 0 && version.pagesWithText < version.pageCount ? (
                            <span className="chip" title={version.parseMessage}>
                              {version.pagesWithText}/{version.pageCount} readable
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <button
                        className="btn btn-ghost shrink-0 px-1 py-0.5"
                        onClick={() => {
                          setSplitFor(row.id);
                          setSplitLabel(row.configurationLabel ?? "");
                        }}
                        aria-label={`Row options for ${source?.title ?? "row"}`}
                        title="Split into configuration rows, rename, or remove"
                      >
                        ⋯
                      </button>
                    </div>

                    {splitFor === row.id ? (
                      <div className="mt-2 space-y-1.5 rounded-md border p-2" style={{ borderColor: "var(--color-line)" }}>
                        <label className="label-text" htmlFor={`config-${row.id}`}>
                          Configuration label for this row
                        </label>
                        <input
                          id={`config-${row.id}`}
                          className="field"
                          value={splitLabel}
                          onChange={(e) => setSplitLabel(e.target.value)}
                          placeholder="e.g. ViT-L, 16 frames"
                        />
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            className="btn"
                            onClick={async () => {
                              await ws.editRowLabel(row.id, splitLabel.trim());
                              setSplitFor(null);
                            }}
                          >
                            Label this row
                          </button>
                          <button
                            className="btn"
                            onClick={async () => {
                              await ws.splitRow(row.id, splitLabel.trim() || "second configuration");
                              setSplitFor(null);
                            }}
                            title="Adds another row over the same paper, so two configurations can be compared separately"
                          >
                            Add a configuration row
                          </button>
                          <button
                            className="btn"
                            onClick={() => ws.extract(bulkTargets(ws.cells, [row], ws.columns))}
                            disabled={!ws.aiStatus?.configured || running}
                            title={ws.aiStatus?.configured ? "Extract every unanswered cell in this row" : ws.aiStatus?.reason}
                          >
                            Extract this paper
                          </button>
                          <button className="btn btn-ghost" onClick={() => setSplitFor(null)}>
                            Cancel
                          </button>
                          {row.configurationLabel ? (
                            <button
                              className="btn btn-ghost"
                              style={{ color: "var(--color-alarm)" }}
                              onClick={async () => {
                                await ws.removeRow(row.id);
                                setSplitFor(null);
                              }}
                            >
                              Remove this row
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </th>

                  {ws.columns.map((column) => {
                    const cell = cellFor(ws.cells, row.id, column.id);
                    const shown = displayValue(cell);
                    const status: CellStatus = cell?.status ?? "empty";
                    const isSelected = ws.selected?.rowId === row.id && ws.selected?.columnId === column.id;
                    return (
                      <td
                        key={column.id}
                        className="border-b border-r p-0 align-top"
                        style={{ borderColor: "var(--color-line)" }}
                      >
                        <button
                          className="h-full w-full px-2 py-2 text-left"
                          style={{
                            background: isSelected ? "var(--color-accent-soft)" : "transparent",
                            outline: isSelected ? "2px solid var(--color-accent)" : "none",
                            outlineOffset: "-2px",
                          }}
                          onClick={() => ws.selectCell({ rowId: row.id, columnId: column.id })}
                          aria-label={`${column.label} for ${source?.title ?? "row"}: ${shown.value || "empty"}`}
                        >
                          <span className="flex items-start justify-between gap-1">
                            <span className="line-clamp-3 min-w-0 break-words">
                              {shown.value || <span style={{ color: "var(--color-faint)" }}>—</span>}
                              {shown.unit && shown.value ? (
                                <span className="ml-1 text-[11.5px]" style={{ color: "var(--color-muted)" }}>
                                  {shown.unit}
                                </span>
                              ) : null}
                            </span>
                            {cell?.pendingProposal ? (
                              <span className="chip shrink-0" style={{ color: "var(--color-warn)" }} title="A newer AI answer is waiting for your decision">
                                new
                              </span>
                            ) : null}
                          </span>
                          {shown.conditions ? (
                            <span className="mt-1 line-clamp-2 block text-[11.5px]" style={{ color: "var(--color-muted)" }}>
                              {shown.conditions}
                            </span>
                          ) : null}
                          <span className="mt-1 flex items-center gap-1">
                            <StatusChip status={status} />
                            {cell?.proposal?.partialCoverage ? (
                              <span className="chip" title="Some pages of this document were not read for this answer.">
                                partial read
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ColumnEditor column={editingColumn} onClose={() => setEditingColumn(null)} />
    </div>
  );
}

function ColumnEditor({ column, onClose }: { column: Column | null; onClose: () => void }) {
  const ws = useWorkspace();
  const [draft, setDraft] = useState<Column | null>(column);

  if (column && (!draft || draft.id !== column.id)) setDraft(column);
  if (!column || !draft) return null;

  const instructionChanged = draft.instruction !== column.instruction || draft.answerType !== column.answerType;

  return (
    <div className="border-t px-3 py-3" style={{ borderColor: "var(--color-line)", background: "var(--color-sunken)" }}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem] flex-1">
          <label className="label-text" htmlFor="col-label">
            Label
          </label>
          <input
            id="col-label"
            className="field"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />
        </div>
        <div className="min-w-[8rem]">
          <label className="label-text" htmlFor="col-type">
            Answer type
          </label>
          <select
            id="col-type"
            className="field"
            value={draft.answerType}
            onChange={(e) => setDraft({ ...draft, answerType: e.target.value as Column["answerType"] })}
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="categorical">Categorical</option>
          </select>
        </div>
        <div className="w-24">
          <label className="label-text" htmlFor="col-unit">
            Unit
          </label>
          <input
            id="col-unit"
            className="field"
            value={draft.unit ?? ""}
            onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
          />
        </div>
      </div>
      <div className="mt-2">
        <label className="label-text" htmlFor="col-instruction">
          Extraction instruction
        </label>
        <textarea
          id="col-instruction"
          className="field min-h-[56px]"
          value={draft.instruction}
          onChange={(e) => setDraft({ ...draft, instruction: e.target.value })}
        />
      </div>
      {instructionChanged ? (
        <p className="mt-1.5 text-[12px]" style={{ color: "var(--color-warn)" }}>
          Saving this marks unreviewed AI answers in this column as stale. Your own edits and reviewed cells are kept.
        </p>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button
          className="btn btn-primary"
          onClick={async () => {
            await ws.editColumn(draft.id, {
              label: draft.label,
              instruction: draft.instruction,
              answerType: draft.answerType,
              unit: draft.unit,
            });
            onClose();
          }}
        >
          Save column
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn"
          onClick={() => ws.extract(bulkTargets(ws.cells, ws.rows, [draft]))}
          disabled={!ws.aiStatus?.configured || !ws.rows.length}
          title={ws.aiStatus?.configured ? "Extract this column for every paper" : ws.aiStatus?.reason}
        >
          Extract this column
        </button>
        <button
          className="btn btn-ghost ml-auto"
          style={{ color: "var(--color-alarm)" }}
          onClick={async () => {
            await ws.removeColumn(draft.id);
            onClose();
          }}
        >
          Delete column
        </button>
      </div>
    </div>
  );
}
