"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { useWorkspace } from "@/lib/workspace";
import { Menu, MenuItem, MenuSeparator } from "./ui/menu";
import { IconAlert, IconMore, IconRetry, IconTrash, IconUpload } from "./icons";
import { MAX_FILES_PER_BATCH, MAX_FILE_BYTES } from "@/lib/workspace";

/**
 * The papers list: a reading surface, not a grid.
 *
 * The title is the loudest thing on the row. Authors and year appear only when
 * the PDF itself declares them — nothing is inferred from the filename.
 */
export function PapersTab({ onAddPapers, onCompare }: { onAddPapers: () => void; onCompare: () => void }) {
  const ws = useWorkspace();
  const params = useParams<{ projectId: string }>();
  const [selected, setSelected] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const upload = async (files: File[]) => {
    const outcomes = await ws.uploadFiles(files);
    const rejected = outcomes.filter((o) => o.status === "rejected");
    setNotice(
      rejected.length
        ? `${rejected.length} file${rejected.length === 1 ? "" : "s"} not added — ${rejected[0].message}`
        : `${outcomes.length} paper${outcomes.length === 1 ? "" : "s"} added.`,
    );
  };

  if (!ws.sources.length) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div
          className="w-full max-w-[520px] rounded-lg border-2 border-dashed p-10 text-center"
          style={{
            borderColor: dragging ? "var(--accent)" : "var(--border-2)",
            background: dragging ? "var(--accent-weak)" : "transparent",
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragging(false);
            await upload(Array.from(e.dataTransfer.files));
          }}
        >
          <h2 className="text-[16px] font-medium">Add papers to start your comparison.</h2>
          <p className="mx-auto mt-1.5 max-w-[22rem] text-[13.5px] leading-relaxed" style={{ color: "var(--text-2)" }}>
            PDFs only, up to {MAX_FILES_PER_BATCH} at a time and {MAX_FILE_BYTES / 1024 / 1024} MB each. They are read
            in this browser and stay on this device.
          </p>
          <button className="btn btn-primary mt-4" onClick={() => fileRef.current?.click()}>
            <IconUpload size={15} />
            Upload PDFs
          </button>
          {ws.busy ? (
            <p className="mt-3 text-[12.5px]" role="status" style={{ color: "var(--text-2)" }}>
              {ws.busy}
            </p>
          ) : null}
          {notice ? (
            <p className="mt-3 text-[12.5px]" role="status" style={{ color: "var(--text-2)" }}>
              {notice}
            </p>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="sr-only"
            onChange={(e) => e.target.files && upload(Array.from(e.target.files))}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="scroll-area min-h-0 flex-1 overflow-y-auto">
      <div className="w-full max-w-[900px] px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-2 pb-1">
          <p className="text-[12.5px]" style={{ color: "var(--text-3)" }}>
            {ws.sources.length} paper{ws.sources.length === 1 ? "" : "s"} in this project
          </p>
          <button className="btn" onClick={onCompare}>
            Compare papers
          </button>
        </div>

        {selected.length ? (
          <div
            className="sticky top-0 z-10 -mx-2 mb-1 flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5"
            style={{ background: "var(--accent-weak)" }}
            role="toolbar"
            aria-label="Selection actions"
          >
            <span className="text-[12.5px] font-medium" style={{ color: "var(--accent)" }}>
              {selected.length} selected
            </span>
            <button
              className="btn btn-sm"
              onClick={async () => {
                for (const id of selected) await ws.removeSource(id);
                setSelected([]);
              }}
            >
              Remove from project
            </button>
            <button className="btn btn-quiet btn-sm" onClick={() => setSelected([])}>
              Clear selection
            </button>
          </div>
        ) : null}

        {notice ? (
          <p className="pb-1 text-[12.5px]" role="status" style={{ color: "var(--text-2)" }}>
            {notice}
          </p>
        ) : null}

        <ul>
          {ws.sources.map((source) => {
            const version = ws.versions[source.id];
            const checked = selected.includes(source.id);
            const preview = ws.previews[source.id];
            const trouble =
              version?.parseStatus === "no_text_layer" ||
              version?.parseStatus === "encrypted" ||
              version?.parseStatus === "failed";
            return (
              <li key={source.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-start gap-3 py-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={() => toggle(source.id)}
                    aria-label={`Select ${source.title}`}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/p/${params.projectId}/paper/${source.id}`}
                      className="text-[15px] font-medium leading-snug hover:underline"
                    >
                      {source.title}
                    </Link>
                    <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--text-2)" }}>
                      {[source.authors, source.year ? String(source.year) : null].filter(Boolean).join(" · ") ||
                        source.filename}
                      {version?.pageCount ? ` · ${version.pageCount} pages` : ""}
                    </p>
                    {preview ? (
                      <p className="mt-1 line-clamp-2 text-[13px] leading-snug" style={{ color: "var(--text-2)" }}>
                        {preview}
                      </p>
                    ) : null}
                    {version?.parseStatus === "parsing" || version?.parseStatus === "pending" ? (
                      <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-3)" }}>
                        Reading the PDF…
                      </p>
                    ) : null}
                    {trouble ? (
                      <p className="mt-1 flex items-start gap-1.5 text-[12.5px]" style={{ color: "var(--danger)" }}>
                        <IconAlert size={14} />
                        <span>
                          {version?.parseMessage ?? "This PDF could not be read."}{" "}
                          <button className="underline underline-offset-2" onClick={() => ws.retryParse(source.id)}>
                            Try again
                          </button>
                        </span>
                      </p>
                    ) : null}
                  </div>

                  <Menu
                    label={`Actions for ${source.title}`}
                    align="end"
                    trigger={
                      <button className="btn btn-quiet btn-icon btn-sm" aria-label={`Actions for ${source.title}`}>
                        <IconMore size={15} />
                      </button>
                    }
                  >
                    <MenuItem icon={<IconRetry />} onSelect={() => ws.retryParse(source.id)}>
                      Read the PDF again
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<IconTrash />} danger onSelect={() => ws.removeSource(source.id)}>
                      Remove from project
                    </MenuItem>
                  </Menu>
                </div>
              </li>
            );
          })}
        </ul>

        <button className="btn mt-4" onClick={onAddPapers}>
          <IconUpload size={15} />
          Add papers
        </button>
      </div>
    </div>
  );
}
