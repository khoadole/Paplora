"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { bulkTargets, cellFor, useWorkspace } from "@/lib/workspace";
import { StatusDot } from "./status";
import { displayValue } from "@/lib/export/run";
import { Menu, MenuItem, MenuSeparator } from "./ui/menu";
import { AddColumnDialog } from "./dialogs";
import { comparisonCsv, downloadCsv, evidenceCsv, evidenceJson, download } from "@/lib/export/run";
import {
  IconChevronDown,
  IconDownload,
  IconPlus,
  IconChevronLeft,
  IconChevronRight,
  IconColumns,
  IconEdit,
  IconMore,
  IconSearch,
  IconSparkle,
  IconSplit,
  IconTrash,
} from "./icons";
import type { CellStatus, Column } from "@/lib/types";

/**
 * The comparison table.
 *
 * `table-layout: fixed` with an explicit <colgroup> is what makes this readable:
 * without it one long answer stretches its column and pushes every other column
 * off screen — the single biggest cause of "only one comparison column visible".
 * Widths are user-adjustable and persisted.
 *
 * Sorting a number column orders values; it is not a ranking, and the header says
 * so. Missing and ambiguous values sort to the end rather than behaving like zero.
 */

type SortState = { columnId: string; direction: "asc" | "desc" } | null;

const PAPER_MIN = 200;
const PAPER_DEFAULT = 288;
const DATA_MIN = 140;
const DATA_DEFAULT = 208;
const COLUMN_MAX = 640;
const PAPER_KEY = "__paper__";

const NUMBER_PATTERN = /-?\d+(\.\d+)?/;

/** True below the sm breakpoint. Drives the narrow-screen table behaviour. */
function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return narrow;
}

function numericValue(text: string): number | null {
  const match = NUMBER_PATTERN.exec(text.replace(/,/g, ""));
  return match ? Number(match[0]) : null;
}

export function ComparisonTable({
  onSelectCell,
  onAddPapers,
}: {
  onSelectCell: (rowId: string, columnId: string) => void;
  onAddPapers: () => void;
}) {
  const ws = useWorkspace();
  const [sort, setSort] = useState<SortState>(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "unreviewed" | "attention">("all");
  const [editingColumn, setEditingColumn] = useState<Column | null>(null);
  const [rowMenuFor, setRowMenuFor] = useState<string | null>(null);
  const [splitLabel, setSplitLabel] = useState("");
  const scroller = useRef<HTMLDivElement | null>(null);

  const running = ws.job?.stage === "extracting" || ws.job?.stage === "queued";
  const projectId = ws.project?.id ?? "";
  const storedHidden = ws.prefs.hiddenColumns?.[projectId];
  // First visit to a project shows Paper plus three columns. Nothing is renamed
  // or deleted — the rest are hidden, listed in Columns, and one click away.
  const hidden = storedHidden ?? ws.columns.slice(3).map((column) => column.id);
  const widths = ws.prefs.columnWidths ?? {};
  const visibleColumns = ws.columns.filter((column) => !hidden.includes(column.id));
  const narrow = useNarrow();
  const storedPaperWidth = widths[PAPER_KEY] ?? PAPER_DEFAULT;
  const paperWidth = narrow ? Math.min(storedPaperWidth, 150) : storedPaperWidth;
  /** Freezing the paper column only helps when there is room left to read. */
  const stickyPaper = narrow ? "" : "sticky left-0";

  const setWidth = (key: string, value: number) =>
    ws.setPrefs({ columnWidths: { ...widths, [key]: Math.round(value) } });

  const toggleHidden = (columnId: string) => {
    const projectId = ws.project?.id;
    if (!projectId) return;
    const next = hidden.includes(columnId) ? hidden.filter((id) => id !== columnId) : [...hidden, columnId];
    ws.setPrefs({ hiddenColumns: { ...(ws.prefs.hiddenColumns ?? {}), [projectId]: next } });
  };

  const visibleRows = useMemo(() => {
    let list = ws.rows;
    if (filter.trim()) {
      const needle = filter.toLowerCase();
      list = list.filter((row) => {
        const source = ws.sources.find((s) => s.id === row.sourceId);
        return (
          (source?.title ?? "").toLowerCase().includes(needle) ||
          (row.configurationLabel ?? "").toLowerCase().includes(needle) ||
          ws.columns.some((column) => {
            const shown = displayValue(cellFor(ws.cells, row.id, column.id));
            return (
              shown.value.toLowerCase().includes(needle) || (shown.conditions ?? "").toLowerCase().includes(needle)
            );
          })
        );
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

  if (!ws.rows.length) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-center">
        <div className="max-w-sm">
          <h2 className="text-[15px] font-medium">Nothing to compare yet</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--text-2)" }}>
            Add papers first; each one becomes a row here.
          </p>
          <button className="btn btn-primary mt-3" onClick={onAddPapers}>
            Add papers
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Toolbar
        filter={filter}
        onFilter={setFilter}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        hidden={hidden}
        onToggleHidden={toggleHidden}
        onEditColumn={setEditingColumn}
        sorted={Boolean(sort)}
        onClearSort={() => setSort(null)}
        visible={visibleRows.length}
        total={ws.rows.length}
      />

      <div ref={scroller} className="scroll-area min-h-0 min-w-0 flex-1 overflow-auto">
        <table
          className="border-separate border-spacing-0 text-[14px]"
          style={{
            tableLayout: "fixed",
            // Never narrower than its container, so a short table does not leave a
            // dead band of background to the right of the last column.
            width: Math.max(paperWidth + visibleColumns.length * DATA_DEFAULT, 1),
            minWidth: "100%",
          }}
        >
          <colgroup>
            <col style={{ width: paperWidth }} />
            {visibleColumns.map((column) => (
              <col key={column.id} style={{ width: widths[column.id] ?? DATA_DEFAULT }} />
            ))}
          </colgroup>

          <thead>
            <tr>
              <th
                scope="col"
                className={`${stickyPaper} top-0 z-30 overflow-hidden border-b border-r px-3 py-1.5 text-left align-bottom text-[12.5px] font-semibold sticky`}
                style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-3)" }}
              >
                <div className="relative flex items-end justify-between gap-1">
                  <span className="truncate">Paper</span>
                  {narrow ? null : (
                    <ResizeGrip
                      label="Resize paper column"
                      width={paperWidth}
                      min={PAPER_MIN}
                      onChange={(next) => setWidth(PAPER_KEY, next)}
                    />
                  )}
                </div>
              </th>

              {visibleColumns.map((column, index) => {
                const sorted = sort?.columnId === column.id;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    className="sticky top-0 z-20 overflow-hidden border-b px-2 py-1.5 text-left align-bottom"
                    style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                  >
                    <div className="relative flex items-end justify-between gap-1">
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() =>
                          setSort((current) =>
                            current?.columnId === column.id && current.direction === "asc"
                              ? { columnId: column.id, direction: "desc" }
                              : { columnId: column.id, direction: "asc" },
                          )
                        }
                        title={
                          column.answerType === "number"
                            ? `Sort by ${column.label}. Ordering is not a ranking: conditions differ between papers.`
                            : `Sort by ${column.label}`
                        }
                      >
                        <span className="flex items-center gap-1">
                          <span className="truncate text-[12.5px] font-semibold">{column.label}</span>
                          {sorted ? (
                            <IconChevronDown
                              size={13}
                              style={{
                                color: "var(--accent)",
                                transform: sort?.direction === "asc" ? "rotate(180deg)" : undefined,
                              }}
                            />
                          ) : null}
                        </span>
                        {column.unit ? (
                          <span className="block truncate text-[11.5px] font-normal" style={{ color: "var(--text-3)" }}>
                            {column.unit}
                          </span>
                        ) : null}
                      </button>

                      <Menu
                        label={`${column.label} column actions`}
                        align="end"
                        trigger={
                          <button className="btn btn-quiet btn-icon btn-sm" aria-label={`${column.label} column actions`}>
                            <IconMore size={15} />
                          </button>
                        }
                      >
                        <MenuItem icon={<IconEdit />} onSelect={() => setEditingColumn(column)}>
                          Edit column…
                        </MenuItem>
                        <MenuItem
                          icon={<IconSparkle />}
                          disabled={!ws.aiStatus?.configured || running}
                          onSelect={() => ws.extract(bulkTargets(ws.cells, ws.rows, [column]))}
                        >
                          Extract this column
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem
                          icon={<IconChevronLeft />}
                          disabled={index === 0}
                          onSelect={() => ws.moveColumn(column.id, -1)}
                        >
                          Move left
                        </MenuItem>
                        <MenuItem
                          icon={<IconChevronRight />}
                          disabled={index === visibleColumns.length - 1}
                          onSelect={() => ws.moveColumn(column.id, 1)}
                        >
                          Move right
                        </MenuItem>
                        <MenuItem icon={<IconColumns />} onSelect={() => toggleHidden(column.id)}>
                          Hide column
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem icon={<IconTrash />} danger onSelect={() => ws.removeColumn(column.id)}>
                          Delete column
                        </MenuItem>
                      </Menu>

                      <ResizeGrip
                        label={`Resize ${column.label}`}
                        width={widths[column.id] ?? DATA_DEFAULT}
                        min={DATA_MIN}
                        onChange={(next) => setWidth(column.id, next)}
                      />
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
                <tr key={row.id} className="group">
                  <th
                    scope="row"
                    className={`${stickyPaper} z-10 overflow-hidden border-b border-r px-3 text-left align-top font-normal`}
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--surface)",
                      paddingTop: "var(--cell-pad-y)",
                      paddingBottom: "var(--cell-pad-y)",
                    }}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-[13.5px] font-medium leading-snug" title={source?.title}>
                          {source?.title ?? "Unknown document"}
                        </p>
                        {row.configurationLabel ? (
                          <p className="mt-0.5 truncate text-[12px]" style={{ color: "var(--accent)" }}>
                            {row.configurationLabel}
                          </p>
                        ) : null}
                        <p className="mt-1 flex flex-wrap items-center gap-1 text-[11.5px]" style={{ color: "var(--text-3)" }}>
                          {version ? <span>{version.pageCount} pages</span> : null}
                          {version?.parseStatus === "no_text_layer" ? (
                            <span className="badge" style={{ background: "var(--danger-weak)", color: "var(--danger)", borderColor: "transparent" }}>
                              no text layer
                            </span>
                          ) : null}
                          {version && version.pagesWithText > 0 && version.pagesWithText < version.pageCount ? (
                            <span className="badge" title={version.parseMessage}>
                              {version.pagesWithText}/{version.pageCount} readable
                            </span>
                          ) : null}
                        </p>
                      </div>

                      <Menu
                        label="Row actions"
                        align="end"
                        trigger={
                          <button
                            className="btn btn-quiet btn-icon btn-sm opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                            aria-label={`Actions for ${source?.title ?? "row"}`}
                          >
                            <IconMore size={15} />
                          </button>
                        }
                      >
                        <MenuItem
                          icon={<IconSparkle />}
                          disabled={!ws.aiStatus?.configured || running}
                          onSelect={() => ws.extract(bulkTargets(ws.cells, [row], ws.columns))}
                        >
                          Extract this paper
                        </MenuItem>
                        <MenuItem
                          icon={<IconSplit />}
                          onSelect={() => {
                            setRowMenuFor(row.id);
                            setSplitLabel(row.configurationLabel ?? "");
                          }}
                        >
                          {row.configurationLabel ? "Rename configuration…" : "Split into configurations…"}
                        </MenuItem>
                        <MenuSeparator />
                        {row.configurationLabel ? (
                          <MenuItem icon={<IconTrash />} danger onSelect={() => ws.removeRow(row.id)}>
                            Remove this row
                          </MenuItem>
                        ) : (
                          <MenuItem icon={<IconTrash />} danger onSelect={() => ws.removeSource(row.sourceId)}>
                            Remove paper from project
                          </MenuItem>
                        )}
                      </Menu>
                    </div>

                    {rowMenuFor === row.id ? (
                      <div className="mt-2 rounded-md border p-2" style={{ borderColor: "var(--border)" }}>
                        <label className="label-text" htmlFor={`config-${row.id}`}>
                          Configuration label
                        </label>
                        <input
                          id={`config-${row.id}`}
                          className="field"
                          value={splitLabel}
                          onChange={(e) => setSplitLabel(e.target.value)}
                          placeholder="e.g. ViT-L, 16 frames"
                          autoFocus
                        />
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <button
                            className="btn btn-sm"
                            onClick={async () => {
                              await ws.editRowLabel(row.id, splitLabel.trim());
                              setRowMenuFor(null);
                            }}
                          >
                            Label this row
                          </button>
                          <button
                            className="btn btn-sm"
                            title="Adds a second row over the same paper so two configurations can be compared separately"
                            onClick={async () => {
                              await ws.splitRow(row.id, splitLabel.trim() || "second configuration");
                              setRowMenuFor(null);
                            }}
                          >
                            Add a row
                          </button>
                          <button className="btn btn-quiet btn-sm" onClick={() => setRowMenuFor(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </th>

                  {visibleColumns.map((column) => {
                    const cell = cellFor(ws.cells, row.id, column.id);
                    const shown = displayValue(cell);
                    const status: CellStatus = cell?.status ?? "empty";
                    const selected = ws.selected?.rowId === row.id && ws.selected?.columnId === column.id;
                    const citations = cell?.proposal?.evidence.length ?? 0;
                    return (
                      <td
                        key={column.id}
                        className="overflow-hidden border-b p-0 align-top"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <button
                          className="h-full w-full px-2 text-left transition-colors"
                          style={{
                            minHeight: "var(--row-height)",
                            paddingTop: "var(--cell-pad-y)",
                            paddingBottom: "var(--cell-pad-y)",
                            background: selected ? "var(--accent-weak)" : undefined,
                            boxShadow: selected ? "inset 0 0 0 2px var(--accent)" : undefined,
                            // Focusing a cell that sits partly under the frozen paper
                            // column makes the browser scroll it into view; without this
                            // margin it yanks the table all the way back to the left.
                            scrollMarginLeft: narrow ? undefined : paperWidth + 8,
                          }}
                          onClick={() => onSelectCell(row.id, column.id)}
                          aria-label={`${column.label} for ${source?.title ?? "row"}: ${shown.value || "empty"}. ${status}.`}
                          aria-pressed={selected}
                        >
                          <span className="flex items-start gap-1.5">
                            <span className="line-clamp-3 min-w-0 flex-1 break-words leading-snug">
                              {shown.value || (
                                <span style={{ color: "var(--text-3)" }}>
                                  {status === "not_found"
                                    ? "Not reported"
                                    : status === "unreadable"
                                      ? "Could not be read"
                                      : status === "failed"
                                        ? "Extraction failed"
                                        : "Needs extraction"}
                                </span>
                              )}
                              {shown.unit && shown.value ? (
                                <span className="ml-1 text-[12px]" style={{ color: "var(--text-2)" }}>
                                  {shown.unit}
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-[3px]">
                              <StatusDot status={status} />
                            </span>
                          </span>
                          {shown.conditions ? (
                            <span className="mt-0.5 line-clamp-1 block text-[11.5px]" style={{ color: "var(--text-2)" }} title={shown.conditions}>
                              {shown.conditions}
                            </span>
                          ) : null}
                          {citations || cell?.pendingProposal ? (
                            <span className="mt-1 flex items-center gap-2 text-[11.5px]" style={{ color: "var(--text-3)" }}>
                              {citations ? (
                                <span title={`${citations} supporting passage${citations === 1 ? "" : "s"}`}>
                                  {citations === 1 && cell?.proposal?.evidence[0]
                                    ? `p. ${cell.proposal.evidence[0].pageNumber}`
                                    : `${citations} sources`}
                                </span>
                              ) : null}
                              {cell?.pendingProposal ? (
                                <span style={{ color: "var(--warn)" }}>new answer</span>
                              ) : null}
                            </span>
                          ) : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* With only a few rows the rest of the surface stays quiet. */}
        <div aria-hidden style={{ height: 24 }} />
      </div>

      {editingColumn ? <ColumnEditor column={editingColumn} onClose={() => setEditingColumn(null)} /> : null}
    </div>
  );
}

function ResizeGrip({
  label,
  width,
  min,
  onChange,
}: {
  label: string;
  width: number;
  min: number;
  onChange: (next: number) => void;
}) {
  const [active, setActive] = useState(false);
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={COLUMN_MAX}
      tabIndex={0}
      data-active={active}
      className="resize-handle"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(Math.max(min, width - 24));
        if (e.key === "ArrowRight") onChange(Math.min(COLUMN_MAX, width + 24));
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setActive(true);
        const startX = e.clientX;
        const startWidth = width;
        const move = (event: PointerEvent) =>
          onChange(Math.max(min, Math.min(COLUMN_MAX, startWidth + (event.clientX - startX))));
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

function Toolbar({
  filter,
  onFilter,
  statusFilter,
  onStatusFilter,
  hidden,
  onToggleHidden,
  onEditColumn,
  sorted,
  onClearSort,
  visible,
  total,
}: {
  filter: string;
  onFilter: (value: string) => void;
  statusFilter: "all" | "unreviewed" | "attention";
  onStatusFilter: (value: "all" | "unreviewed" | "attention") => void;
  hidden: string[];
  onToggleHidden: (columnId: string) => void;
  onEditColumn: (column: Column) => void;
  sorted: boolean;
  onClearSort: () => void;
  visible: number;
  total: number;
}) {
  const ws = useWorkspace();
  const [addColumn, setAddColumn] = useState(false);
  const density = ws.prefs.density ?? "comfortable";
  const running = ws.job?.stage === "extracting" || ws.job?.stage === "queued";
  const pending = bulkTargets(ws.cells, ws.rows, ws.columns);
  const aiReady = Boolean(ws.aiStatus?.configured);
  const project = ws.project;
  const slug = (project?.title ?? "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "project";
  const exportInput = project
    ? { project, rows: ws.rows, columns: ws.columns, cells: ws.cells, sources: ws.sources }
    : null;

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-2 border-b px-4 py-2 sm:px-6"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="relative">
          <IconSearch
            size={14}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-3)" }}
          />
          <input
            className="field w-[13rem] pl-7"
            placeholder="Search papers, answers"
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
            aria-label="Search papers and answers"
          />
        </div>

        <Menu
          label="Columns"
          trigger={
            <button className="btn" aria-label="Columns">
              <IconColumns size={15} />
              <span className="hidden sm:inline">Columns</span>
              {hidden.length ? (
                <span className="text-[11.5px]" style={{ color: "var(--text-3)" }}>
                  {ws.columns.length - hidden.length}/{ws.columns.length}
                </span>
              ) : null}
            </button>
          }
        >
          <MenuItem icon={<IconPlus />} onSelect={() => setAddColumn(true)}>
            New column…
          </MenuItem>
          <MenuSeparator />
          {ws.columns.map((column) => (
            <MenuItem key={column.id} onSelect={() => onToggleHidden(column.id)}>
              <span className="flex w-full items-center gap-2">
                <input
                  type="checkbox"
                  readOnly
                  checked={!hidden.includes(column.id)}
                  aria-label={`Show ${column.label}`}
                  tabIndex={-1}
                />
                <span className="min-w-0 flex-1 truncate">{column.label}</span>
                <span
                  role="button"
                  tabIndex={0}
                  className="shrink-0 text-[11.5px]"
                  style={{ color: "var(--text-3)" }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onEditColumn(column);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.stopPropagation();
                      onEditColumn(column);
                    }
                  }}
                >
                  edit
                </span>
              </span>
            </MenuItem>
          ))}
        </Menu>

        <select
          className="field w-auto"
          value={statusFilter}
          onChange={(e) => onStatusFilter(e.target.value as typeof statusFilter)}
          aria-label="Filter by review state"
        >
          <option value="all">All rows</option>
          <option value="unreviewed">Unreviewed answers</option>
          <option value="attention">Needs attention</option>
        </select>

        {sorted ? (
          <button className="btn btn-quiet" onClick={onClearSort}>
            Clear sort
          </button>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[12px] tabular-nums sm:inline" style={{ color: "var(--text-3)" }}>
            {visible === total ? `${total} rows` : `${visible} of ${total} rows`}
          </span>

          <Menu
            label="More"
            align="end"
            trigger={
              <button className="btn btn-quiet btn-icon" aria-label="More table actions">
                <IconMore />
              </button>
            }
          >
            <MenuItem
              icon={<IconDownload />}
              disabled={!exportInput}
              onSelect={() => exportInput && downloadCsv(`${slug}-comparison.csv`, comparisonCsv(exportInput))}
            >
              Export comparison (CSV)
            </MenuItem>
            <MenuItem
              icon={<IconDownload />}
              disabled={!exportInput}
              onSelect={() => exportInput && downloadCsv(`${slug}-evidence.csv`, evidenceCsv(exportInput))}
            >
              Export evidence (CSV)
            </MenuItem>
            <MenuItem
              icon={<IconDownload />}
              disabled={!exportInput}
              onSelect={() =>
                exportInput &&
                download(`${slug}-evidence.json`, new Blob([evidenceJson(exportInput)], { type: "application/json" }))
              }
            >
              Export evidence (JSON)
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => ws.setPrefs({ density: density === "compact" ? "comfortable" : "compact" })}>
              {density === "compact" ? "Comfortable rows" : "Compact rows"}
            </MenuItem>
          </Menu>

          <button
            className={aiReady ? "btn btn-primary" : "btn"}
            onClick={() => ws.extract(pending)}
            disabled={!aiReady || running || !pending.length}
            title={
              !aiReady
                ? (ws.aiStatus?.reason ?? "Automatic extraction is not configured.")
                : !pending.length
                  ? "Every cell already has an answer you wrote or reviewed."
                  : `Extract ${pending.length} unanswered cell${pending.length === 1 ? "" : "s"}`
            }
          >
            <IconSparkle size={15} />
            {running ? "Extracting…" : "Extract answers"}
          </button>
        </div>
      </div>

      {!aiReady ? (
        <p
          className="border-b px-4 py-1.5 text-[12px] sm:px-6"
          style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-2)" }}
        >
          {ws.aiStatus?.reason ?? "Automatic extraction is not configured."}{" "}
          <button
            className="font-medium underline underline-offset-2"
            style={{ color: "var(--accent)" }}
            onClick={() => document.dispatchEvent(new CustomEvent("paplora:settings"))}
          >
            Open settings
          </button>
        </p>
      ) : null}

      {ws.job && (running || ws.job.stage === "done" || ws.job.stage === "failed") ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b px-4 py-1.5 text-[12px] sm:px-6"
          style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
          role="status"
          aria-live="polite"
        >
          <span style={{ color: "var(--text-2)" }}>
            {ws.job.completed + ws.job.failed} of {ws.job.total} cells
            {ws.job.failed ? ` · ${ws.job.failed} failed` : ""}
            {ws.job.stage === "done" ? " · finished" : ws.job.stage === "failed" ? " · stopped" : ""}
          </span>
          <span className="h-1 w-32 overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
            <span
              className="block h-full rounded-full transition-[width] duration-300"
              style={{
                width: `${Math.round(((ws.job.completed + ws.job.failed) / Math.max(ws.job.total, 1)) * 100)}%`,
                background: "var(--accent)",
              }}
            />
          </span>
          {running ? (
            <button className="btn btn-quiet btn-sm" onClick={ws.cancelExtraction}>
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      {ws.resumable && !running ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b px-4 py-1.5 text-[12.5px] sm:px-6"
          style={{ borderColor: "var(--border)", background: "var(--warn-weak)", color: "var(--warn)" }}
        >
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

      <AddColumnDialog open={addColumn} onOpenChange={setAddColumn} />
    </>
  );
}

function EmptyProject({ hasColumns, hasRows }: { hasColumns: boolean; hasRows: boolean }) {
  const ws = useWorkspace();
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (hasRows && !hasColumns) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <div className="max-w-sm text-center">
          <h2 className="text-[15px] font-semibold">Decide what to compare</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--text-2)" }}>
            A column is one question asked of every paper — the method, the evaluation split, the number they report.
            Add one from a preset or write your own.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div
        className="w-full max-w-lg rounded-lg border-2 border-dashed p-8 text-center"
        style={{
          borderColor: dragging ? "var(--accent)" : "var(--border-2)",
          background: dragging ? "var(--accent-weak)" : "var(--surface)",
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragging(false);
          const outcomes = await ws.uploadFiles(Array.from(e.dataTransfer.files));
          const rejected = outcomes.filter((o) => o.status === "rejected");
          setMessage(
            rejected.length
              ? `${rejected.length} file(s) were not added: ${rejected[0].message}`
              : `${outcomes.length} paper(s) added.`,
          );
        }}
      >
        <h2 className="text-[15px] font-semibold">Add the papers you want to compare</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          Drop PDFs here, or use <span className="font-medium">Add papers</span> above. Each paper becomes a row; then
          add columns for what you want to pull out of every one of them.
        </p>
        {ws.busy ? (
          <p className="mt-3 text-[12.5px]" role="status" style={{ color: "var(--text-2)" }}>
            {ws.busy}
          </p>
        ) : null}
        {message ? (
          <p className="mt-3 text-[12.5px]" role="status" style={{ color: "var(--text-2)" }}>
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ColumnEditor({ column, onClose }: { column: Column; onClose: () => void }) {
  const ws = useWorkspace();
  const [draft, setDraft] = useState<Column>(column);
  const instructionChanged = draft.instruction !== column.instruction || draft.answerType !== column.answerType;

  return (
    <div
      className="border-t px-3 py-3"
      style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
      aria-label={`Edit column ${column.label}`}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem] flex-1">
          <label className="label-text" htmlFor="col-label">
            Label
          </label>
          <input id="col-label" className="field" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        </div>
        <div className="w-36">
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
          <input id="col-unit" className="field" value={draft.unit ?? ""} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
        </div>
      </div>
      <div className="mt-2 max-w-3xl">
        <label className="label-text" htmlFor="col-instruction">
          Extraction instruction
        </label>
        <textarea
          id="col-instruction"
          className="field min-h-[54px]"
          value={draft.instruction}
          onChange={(e) => setDraft({ ...draft, instruction: e.target.value })}
        />
      </div>
      {instructionChanged ? (
        <p className="mt-1.5 text-[12px]" style={{ color: "var(--warn)" }}>
          Saving marks unreviewed AI answers in this column stale. Your own edits and reviewed cells are kept.
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
      </div>
    </div>
  );
}
