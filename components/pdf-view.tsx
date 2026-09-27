"use client";

import { useEffect, useRef, useState } from "react";
import { repo } from "@/lib/repo";
import { boxesForRange } from "@/lib/pdf/parse";
import type { ParsedPage } from "@/lib/types";

/**
 * Renders one page of a PDF with optional highlight boxes.
 *
 * Boxes come from the text items recorded at parse time, so a highlight is only
 * ever drawn where real characters were found. When a quote could not be located
 * the caller passes no range and the page opens without a box — labelled
 * page-level rather than faked.
 */

interface Highlight {
  start?: number;
  end?: number;
}

export function PdfView({
  versionId,
  pageNumber,
  highlights,
  onPageChange,
  pageCount,
}: {
  versionId: string;
  pageNumber: number;
  highlights: Highlight[];
  onPageChange: (page: number) => void;
  pageCount: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState<ParsedPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const renderTask = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [bytes, parsed] = await Promise.all([
          repo.getBytes(versionId),
          repo.getPage(versionId, pageNumber),
        ]);
        if (cancelled) return;
        setPage(parsed ?? null);
        if (!bytes) {
          setError("The original file for this document is no longer in local storage.");
          setLoading(false);
          return;
        }

        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const doc = await pdfjs.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
        if (cancelled) return;
        const pdfPage = await doc.getPage(Math.min(Math.max(pageNumber, 1), doc.numPages));
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const width = containerRef.current?.clientWidth ?? 640;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = Math.max(0.3, Math.min(2.4, (width - 8) / base.width));
        const viewport = pdfPage.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${base.width * scale}px`;
        canvas.style.height = `${base.height * scale}px`;

        const context = canvas.getContext("2d");
        if (!context) return;
        renderTask.current?.cancel();
        const task = pdfPage.render({ canvasContext: context, viewport });
        renderTask.current = task;
        await task.promise;
        if (!cancelled) setLoading(false);
      } catch (cause) {
        if (cancelled) return;
        const name = (cause as { name?: string })?.name;
        if (name === "RenderingCancelledException") return;
        setError(`This page could not be rendered (${(cause as Error)?.message ?? "unknown error"}).`);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      renderTask.current?.cancel();
      renderTask.current = null;
    };
  }, [versionId, pageNumber]);

  const boxes = page ? highlights.flatMap((h) => boxesForRange(page, h.start, h.end)) : [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5" style={{ borderColor: "var(--color-line)" }}>
        <div className="flex items-center gap-1">
          <button
            className="btn btn-ghost px-2 py-1"
            onClick={() => onPageChange(Math.max(1, pageNumber - 1))}
            disabled={pageNumber <= 1}
            aria-label="Previous page"
          >
            ←
          </button>
          <span className="text-[12px] tabular-nums" style={{ color: "var(--color-muted)" }}>
            Page {pageNumber}
            {pageCount ? ` of ${pageCount}` : ""}
          </span>
          <button
            className="btn btn-ghost px-2 py-1"
            onClick={() => onPageChange(Math.min(pageCount || pageNumber + 1, pageNumber + 1))}
            disabled={Boolean(pageCount) && pageNumber >= pageCount}
            aria-label="Next page"
          >
            →
          </button>
        </div>
        {boxes.length > 0 ? (
          <span className="chip" title="The highlighted characters are where this quote was found.">
            passage highlighted
          </span>
        ) : null}
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto p-2" style={{ background: "var(--color-sunken)" }}>
        {error ? (
          <p className="p-4 text-[13px]" style={{ color: "var(--color-alarm)" }} role="alert">
            {error}
          </p>
        ) : (
          <div className="relative mx-auto w-fit">
            <canvas ref={canvasRef} className="block shadow-sm" />
            {boxes.map((box, index) => (
              <div
                key={index}
                className="evidence-box"
                style={{
                  left: `${box.left * 100}%`,
                  top: `${box.top * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                }}
              />
            ))}
            {loading ? (
              <p className="absolute inset-0 flex items-center justify-center text-[13px]" style={{ color: "var(--color-muted)" }}>
                Rendering page…
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
