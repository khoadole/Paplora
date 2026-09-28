"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspace";
import { ComparisonTable } from "./comparison-table";
import { EvidencePanel } from "./evidence-panel";

const PANEL_MIN = 340;
const PANEL_MAX = 720;

/**
 * The comparison surface: table plus an evidence panel that stays closed until a
 * cell is chosen. The chosen cell lives in the URL, so a link reopens it.
 */
export function CompareTab({ onAddPapers }: { onAddPapers: () => void }) {
  const ws = useWorkspace();
  const params = useParams<{ projectId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const panelWidth = Math.min(PANEL_MAX, Math.max(PANEL_MIN, ws.prefs.evidencePanelWidth ?? 410));
  const cellParam = search.get("cell");

  // A ?cell= link selects that cell and opens the panel on arrival.
  useEffect(() => {
    if (!cellParam) return;
    const [rowId, columnId] = cellParam.split("~");
    if (!rowId || !columnId) return;
    if (ws.selected?.rowId !== rowId || ws.selected?.columnId !== columnId) {
      ws.selectCell({ rowId, columnId });
    }
    setOpen(true);
  }, [cellParam, ws]);

  const showPanel = open && Boolean(ws.selected);

  const select = (rowId: string, columnId: string) => {
    ws.selectCell({ rowId, columnId });
    setOpen(true);
    const next = new URLSearchParams(search.toString());
    next.set("tab", "compare");
    next.set("cell", `${rowId}~${columnId}`);
    router.replace(`/p/${params.projectId}?${next}`, { scroll: false });
  };

  const close = () => {
    setOpen(false);
    const next = new URLSearchParams(search.toString());
    next.delete("cell");
    router.replace(`/p/${params.projectId}?${next}`, { scroll: false });
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ComparisonTable onSelectCell={select} onAddPapers={onAddPapers} />
      </div>

      {showPanel ? (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize evidence panel"
            aria-valuenow={panelWidth}
            aria-valuemin={PANEL_MIN}
            aria-valuemax={PANEL_MAX}
            tabIndex={0}
            className="hidden w-1 shrink-0 cursor-col-resize lg:block"
            style={{ background: "var(--border)" }}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") ws.setPrefs({ evidencePanelWidth: Math.min(PANEL_MAX, panelWidth + 24) });
              if (e.key === "ArrowRight") ws.setPrefs({ evidencePanelWidth: Math.max(PANEL_MIN, panelWidth - 24) });
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = panelWidth;
              const move = (event: PointerEvent) =>
                ws.setPrefs({
                  evidencePanelWidth: Math.max(PANEL_MIN, Math.min(PANEL_MAX, startWidth - (event.clientX - startX))),
                });
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          />
          <aside
            className="hidden shrink-0 lg:block"
            style={{ width: panelWidth, background: "var(--surface)" }}
            aria-label="Evidence"
          >
            <EvidencePanel onClose={close} />
          </aside>

          {/* Below lg the panel is a full-screen sheet, never a squeezed third column. */}
          <div className="fixed inset-0 z-40 lg:hidden" style={{ background: "var(--surface)" }}>
            <EvidencePanel onClose={close} />
          </div>
        </>
      ) : null}
    </div>
  );
}
