"use client";

import { useRef, useState } from "react";
import { Dialog } from "./ui/dialog";
import { MAX_FILES_PER_BATCH, MAX_FILE_BYTES, useWorkspace, type UploadOutcome } from "@/lib/workspace";
import { BLANK_COLUMN, PRESETS } from "@/lib/presets";
import { createBackup, download, restoreBackup } from "@/lib/export/run";
import { repo } from "@/lib/repo";
import type { AnswerType } from "@/lib/types";

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const ws = useWorkspace();
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");

  const submit = async () => {
    if (!title.trim()) return;
    await ws.createProject({ title: title.trim(), question: question.trim() });
    setTitle("");
    setQuestion("");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New project"
      description="A project holds a set of papers and the questions you are asking of all of them."
      footer={
        <>
          <button className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!title.trim()}>
            Create project
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label-text" htmlFor="project-title">
            Title
          </label>
          <input
            id="project-title"
            className="field"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Edge action recognition"
          />
        </div>
        <div>
          <label className="label-text" htmlFor="project-question">
            Research question <span style={{ color: "var(--text-3)" }}>(optional)</span>
          </label>
          <textarea
            id="project-question"
            className="field min-h-[72px]"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Which methods run in real time on embedded hardware without losing accuracy?"
          />
          <p className="mt-1 text-[11.5px]" style={{ color: "var(--text-3)" }}>
            Passed to the model as context when you extract, so answers stay on topic.
          </p>
        </div>
      </div>
    </Dialog>
  );
}

export function AddPapersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const ws = useWorkspace();
  const [outcomes, setOutcomes] = useState<UploadOutcome[]>([]);
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handle = async (files: FileList | File[]) => {
    const list = Array.from(files);
    setOutcomes(await ws.uploadFiles(list));
  };

  const inProject = new Set(ws.sources.map((s) => s.id));
  const reusable = ws.library
    .filter((s) => !inProject.has(s.id))
    .filter((s) => s.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) setOutcomes([]);
      }}
      title="Add papers"
      description={`PDFs are read in your browser and stored on this device. Up to ${MAX_FILES_PER_BATCH} files at a time, ${MAX_FILE_BYTES / 1024 / 1024} MB each.`}
      wide
      footer={
        <button className="btn" onClick={() => onOpenChange(false)}>
          Done
        </button>
      }
    >
      <div
        className="rounded-lg border-2 border-dashed p-6 text-center"
        style={{
          borderColor: dragging ? "var(--accent)" : "var(--border-2)",
          background: dragging ? "var(--accent-weak)" : "transparent",
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handle(e.dataTransfer.files);
        }}
      >
        <p className="text-[13px] font-medium">Drop PDFs here</p>
        <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-2)" }}>
          or
        </p>
        <button className="btn mt-2" onClick={() => inputRef.current?.click()}>
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          onChange={(e) => e.target.files && handle(e.target.files)}
        />
      </div>

      {ws.busy ? (
        <p className="mt-3 text-[12.5px]" style={{ color: "var(--text-2)" }} role="status">
          {ws.busy}
        </p>
      ) : null}

      {outcomes.length ? (
        <ul className="mt-3 space-y-1.5" aria-live="polite">
          {outcomes.map((outcome) => (
            <li key={outcome.filename} className="text-[12.5px]">
              <span className="font-medium">{outcome.filename}</span>{" "}
              <span
                style={{
                  color:
                    outcome.status === "rejected"
                      ? "var(--danger)"
                      : outcome.status === "reused"
                        ? "var(--warn)"
                        : "var(--accent)",
                }}
              >
                {outcome.status === "added" ? "added" : outcome.status === "reused" ? "reused" : "not added"}
              </span>
              {outcome.message ? (
                <span style={{ color: "var(--text-2)" }}> — {outcome.message}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {ws.library.length ? (
        <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-2)" }}>
            Reuse from your library
          </h3>
          <input
            className="field mt-2"
            placeholder="Search saved papers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search library"
          />
          {reusable.length ? (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {reusable.map((source) => (
                <li key={source.id} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="min-w-0 truncate text-[12.5px]" title={source.filename}>
                    {source.title}
                  </span>
                  <button className="btn shrink-0" onClick={() => ws.addFromLibrary(source.id)}>
                    Add
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12.5px]" style={{ color: "var(--text-2)" }}>
              Every paper in your library is already in this project.
            </p>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}

export function AddColumnDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const ws = useWorkspace();
  const [label, setLabel] = useState(BLANK_COLUMN.label);
  const [instruction, setInstruction] = useState(BLANK_COLUMN.instruction);
  const [answerType, setAnswerType] = useState<AnswerType>("text");
  const [unit, setUnit] = useState("");

  const addPreset = async (presetId: string) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    for (const column of preset.columns) {
      await ws.addColumn({
        label: column.label,
        instruction: column.instruction,
        answerType: column.answerType,
        unit: column.unit,
        options: column.options,
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a column"
      description="A column is one question asked of every paper. Everything here stays editable afterwards."
      wide
      footer={
        <>
          <button className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!label.trim() || !instruction.trim()}
            onClick={async () => {
              await ws.addColumn({
                label: label.trim(),
                instruction: instruction.trim(),
                answerType,
                unit: unit.trim() || undefined,
              });
              setLabel(BLANK_COLUMN.label);
              setInstruction(BLANK_COLUMN.instruction);
              setUnit("");
              onOpenChange(false);
            }}
          >
            Add column
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1">
            <label className="label-text" htmlFor="new-col-label">
              Label
            </label>
            <input id="new-col-label" className="field" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="min-w-[8rem]">
            <label className="label-text" htmlFor="new-col-type">
              Answer type
            </label>
            <select
              id="new-col-type"
              className="field"
              value={answerType}
              onChange={(e) => setAnswerType(e.target.value as AnswerType)}
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="categorical">Categorical</option>
            </select>
          </div>
          <div className="w-24">
            <label className="label-text" htmlFor="new-col-unit">
              Unit
            </label>
            <input id="new-col-unit" className="field" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%" />
          </div>
        </div>
        <div>
          <label className="label-text" htmlFor="new-col-instruction">
            Extraction instruction
          </label>
          <textarea
            id="new-col-instruction"
            className="field min-h-[72px]"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <p className="mt-1 text-[11.5px]" style={{ color: "var(--text-3)" }}>
            Be specific about conditions — “which split was this measured on” finds more honest answers than “accuracy”.
          </p>
        </div>

        <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-2)" }}>
            Or start from a preset
          </h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {PRESETS.map((preset) => (
              <div key={preset.id} className="card p-3">
                <p className="text-[13px] font-medium">{preset.name}</p>
                <p className="mt-1 text-[12px]" style={{ color: "var(--text-2)" }}>
                  {preset.description}
                </p>
                <p className="mt-1 text-[11.5px]" style={{ color: "var(--text-3)" }}>
                  {preset.columns.map((c) => c.label).join(" · ")}
                </p>
                <button className="btn mt-2" onClick={() => addPreset(preset.id)}>
                  Add {preset.columns.length} columns
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const ws = useWorkspace();
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      wide
      footer={
        <button className="btn" onClick={() => onOpenChange(false)}>
          Close
        </button>
      }
    >
      <div className="space-y-5">
        <section>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-2)" }}>
            Appearance
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <div>
              <label className="label-text" htmlFor="pref-theme">
                Theme
              </label>
              <select
                id="pref-theme"
                className="field w-auto"
                value={ws.prefs.theme ?? "system"}
                onChange={(e) => ws.setPrefs({ theme: e.target.value as "system" | "light" | "dark" })}
              >
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
            <div>
              <label className="label-text" htmlFor="pref-density">
                Table density
              </label>
              <select
                id="pref-density"
                className="field w-auto"
                value={ws.prefs.density ?? "comfortable"}
                onChange={(e) => ws.setPrefs({ density: e.target.value as "comfortable" | "compact" })}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-2)" }}>
            Automatic extraction
          </h3>
          <p className="mt-1.5 text-[13px]">
            {ws.aiStatus?.configured ? (
              <>
                Configured, using model <span className="font-mono text-[12.5px]">{ws.aiStatus.model}</span>.
              </>
            ) : (
              <>Not configured.</>
            )}
          </p>
          {ws.aiStatus?.reason ? (
            <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-2)" }}>
              {ws.aiStatus.reason}
            </p>
          ) : null}
          <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--text-3)" }}>
            The key is read on the server only and is never sent to the browser or stored here.
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-[12.5px]" style={{ color: "var(--accent)" }}>
              How to turn it on
            </summary>
            <p className="mt-1.5 text-[12px]" style={{ color: "var(--text-2)" }}>
              Add these to <code className="font-mono">.env.local</code> in the project folder and restart the dev
              server. There is no default model on purpose: an unverified model name would misreport what produced your
              answers.
            </p>
            <pre
              className="mt-1.5 overflow-x-auto rounded-md p-2 font-mono text-[11.5px]"
              style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
            >{`OPENAI_API_KEY=sk-...
OPENAI_MODEL=<a model your account can call>`}</pre>
          </details>
        </section>

        <section>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-2)" }}>
            Backup
          </h3>
          <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--text-2)" }}>
            Everything lives in this browser on this device. Clearing site data erases it. A backup is a ZIP holding your
            projects, columns, cells, evidence and the original PDFs.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className="btn"
              disabled={working}
              onClick={async () => {
                setWorking(true);
                setMessage(null);
                try {
                  const blob = await createBackup(repo);
                  download(`paplora-backup-${new Date().toISOString().slice(0, 10)}.zip`, blob);
                  setMessage("Backup downloaded.");
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "Backup failed.");
                } finally {
                  setWorking(false);
                }
              }}
            >
              Download backup
            </button>
            <button className="btn" disabled={working} onClick={() => fileRef.current?.click()}>
              Restore from backup
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setWorking(true);
                setMessage(null);
                try {
                  const summary = await restoreBackup(repo, file);
                  await ws.refresh();
                  setMessage(
                    `Restored ${summary.projects} project(s), ${summary.sources} document(s), ${summary.cells} cell(s).` +
                      (summary.skippedEntries.length ? ` Skipped ${summary.skippedEntries.length} unexpected file(s).` : ""),
                  );
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "Restore failed.");
                } finally {
                  setWorking(false);
                  e.target.value = "";
                }
              }}
            />
          </div>
        </section>

        <section>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-2)" }}>
            Sample project
          </h3>
          <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--text-2)" }}>
            The sample project uses three short documents written for this demo. They are fictional: the papers, the
            authors and every number in them are invented, and nothing in them refers to real research. They stay
            separate from your own projects.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn" onClick={() => ws.openSample()}>
              Open sample project
            </button>
            <button className="btn" onClick={() => ws.resetSample()}>
              Remove sample project
            </button>
          </div>
        </section>

        {message ? (
          <p className="text-[12.5px]" role="status" style={{ color: "var(--accent)" }}>
            {message}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
