"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspace";
import { PdfView } from "./pdf-view";
import { IconArrowLeft } from "./icons";

/**
 * The full-height reader for one paper.
 *
 * It keeps the way back: the link returns to the tab the reader was opened from,
 * and to the cell whose evidence was being inspected when there was one.
 */
export function Reader() {
  const ws = useWorkspace();
  const params = useParams<{ projectId: string; sourceId: string }>();
  const search = useSearchParams();
  const [pageNumber, setPageNumber] = useState(Number(search.get("page")) || 1);

  const selectProject = ws.selectProject;
  const openProjectId = ws.project?.id;
  useEffect(() => {
    if (params.projectId && openProjectId !== params.projectId) selectProject(params.projectId);
  }, [params.projectId, openProjectId, selectProject]);

  const source = ws.sources.find((s) => s.id === params.sourceId) ?? ws.library.find((s) => s.id === params.sourceId);
  const version = source ? ws.versions[source.id] : undefined;

  const cell = search.get("cell");
  const backHref = `/p/${params.projectId}?tab=${search.get("tab") ?? "papers"}${cell ? `&cell=${cell}` : ""}`;

  if (!ws.ready) {
    return (
      <p className="p-6 text-[13px]" style={{ color: "var(--text-2)" }} role="status">
        Opening paper…
      </p>
    );
  }

  if (!source) {
    return (
      <div className="p-8">
        <p className="text-[14px] font-medium">This paper is not on this device</p>
        <Link href={backHref} className="btn mt-3 inline-flex">
          Back to the project
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        className="flex shrink-0 items-center gap-3 border-b px-3 py-2 sm:px-4"
        style={{ borderColor: "var(--border)" }}
      >
        <Link href={backHref} className="btn btn-quiet btn-icon" aria-label="Back to the project">
          <IconArrowLeft />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-medium" title={source.title}>
            {source.title}
          </h1>
          <p className="truncate text-[12px]" style={{ color: "var(--text-2)" }}>
            {[source.authors, source.year ? String(source.year) : null].filter(Boolean).join(" · ") || source.filename}
            {version?.pageCount ? ` · ${version.pageCount} pages` : ""}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {version ? (
          <PdfView
            versionId={source.currentVersionId}
            pageNumber={pageNumber}
            pageCount={version.pageCount}
            onPageChange={setPageNumber}
            highlights={[]}
          />
        ) : (
          <p className="p-6 text-[13px]" style={{ color: "var(--text-2)" }}>
            This document has not been read yet.
          </p>
        )}
      </div>
    </div>
  );
}
