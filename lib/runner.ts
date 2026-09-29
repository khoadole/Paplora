"use client";

import { newId } from "./ids";
import { planExtraction } from "./extract/plan";
import { verifyAnswer } from "./extract/verify";
import { answerSchema } from "./extract/schema";
import type { Repository } from "./repo";
import type { Column, ExtractionJob, JobTarget, ParsedPage, Row } from "./types";

/**
 * The extraction runner.
 *
 * One work unit is one (row, column) pair. Each unit walks the document's page
 * windows in order and stops at the first window that yields a verified answer,
 * so a long paper costs bounded requests instead of one enormous one.
 *
 * Job state lives in IndexedDB, so closing the tab pauses the work and reopening
 * the project offers to resume exactly the units that never finished. Cancelled
 * jobs ignore any response that arrives late.
 */

const CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;

export interface RunHandle {
  jobId: string;
  cancel: () => void;
  done: Promise<ExtractionJob>;
}

export interface RunContext {
  repo: Repository;
  projectId: string;
  question: string;
  rows: Row[];
  columns: Column[];
  targets: { rowId: string; columnId: string }[];
  onUpdate: (job: ExtractionJob) => void;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function targetKey(jobId: string, rowId: string, columnId: string) {
  return `${jobId}:${rowId}:${columnId}`;
}

export async function startExtraction(ctx: RunContext): Promise<RunHandle> {
  const jobId = newId("job");
  const controller = new AbortController();
  const targets: JobTarget[] = ctx.targets.map((t) => ({
    rowId: t.rowId,
    columnId: t.columnId,
    key: targetKey(jobId, t.rowId, t.columnId),
    state: "pending",
  }));

  const job: ExtractionJob = {
    id: jobId,
    projectId: ctx.projectId,
    stage: "queued",
    total: targets.length,
    completed: 0,
    failed: 0,
    targets,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await ctx.repo.saveJob(job);
  ctx.onUpdate(job);

  const done = drive(job, ctx, controller.signal);
  return { jobId, cancel: () => controller.abort(), done };
}

/** Re-drives a job that was interrupted, skipping everything already finished. */
export async function resumeExtraction(job: ExtractionJob, ctx: Omit<RunContext, "targets">) {
  const controller = new AbortController();
  const revived: ExtractionJob = {
    ...job,
    stage: "queued",
    targets: job.targets.map((t) => (t.state === "running" ? { ...t, state: "pending" } : t)),
  };
  await ctx.repo.saveJob(revived);
  const done = drive(revived, { ...ctx, targets: [] }, controller.signal);
  return { jobId: job.id, cancel: () => controller.abort(), done };
}

async function drive(job: ExtractionJob, ctx: RunContext, signal: AbortSignal): Promise<ExtractionJob> {
  let current: ExtractionJob = { ...job, stage: "extracting" };
  await ctx.repo.saveJob(current);
  ctx.onUpdate(current);

  const pending = current.targets.filter((t) => t.state === "pending");
  const queue = [...pending];

  const pageCache = new Map<string, ParsedPage[]>();

  const worker = async () => {
    while (queue.length) {
      if (signal.aborted) return;
      const target = queue.shift();
      if (!target) return;
      const row = ctx.rows.find((r) => r.id === target.rowId);
      const column = ctx.columns.find((c) => c.id === target.columnId);
      if (!row || !column) {
        current = patchTarget(current, target.key, { state: "failed", error: "This row or column no longer exists." });
        continue;
      }

      current = patchTarget(current, target.key, { state: "running" });
      await ctx.repo.setCellStatus(ctx.projectId, row.id, column.id, "processing");
      ctx.onUpdate(current);

      try {
        const pages =
          pageCache.get(row.versionId) ?? (await ctx.repo.getPages(row.versionId));
        pageCache.set(row.versionId, pages);
        await runUnit({ ctx, row, column, pages, signal });
        if (signal.aborted) return;
        current = patchTarget(current, target.key, { state: "done" });
        current = { ...current, completed: current.completed + 1 };
      } catch (error) {
        if (signal.aborted) return;
        const message = error instanceof Error ? error.message : "Extraction failed.";
        await ctx.repo.setCellStatus(ctx.projectId, row.id, column.id, "failed");
        current = patchTarget(current, target.key, { state: "failed", error: message });
        current = { ...current, failed: current.failed + 1 };
      }
      await ctx.repo.saveJob(current);
      ctx.onUpdate(current);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(queue.length, 1)) }, worker));

  const finished: ExtractionJob = {
    ...current,
    stage: signal.aborted ? "cancelled" : current.failed > 0 && current.completed === 0 ? "failed" : "done",
  };
  await ctx.repo.saveJob(finished);
  ctx.onUpdate(finished);
  return finished;
}

function patchTarget(job: ExtractionJob, key: string, patch: Partial<JobTarget>): ExtractionJob {
  return {
    ...job,
    targets: job.targets.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    updatedAt: Date.now(),
  };
}

async function runUnit(input: {
  ctx: RunContext;
  row: Row;
  column: Column;
  pages: ParsedPage[];
  signal: AbortSignal;
}) {
  const { ctx, row, column, pages, signal } = input;
  const version = await ctx.repo.getVersion(row.versionId);
  const source = await ctx.repo.getSource(row.sourceId);
  const plan = planExtraction(
    pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text, label: p.label })),
  );
  const coverage = source?.coverage ?? "fulltext";
  const noTextLayer = plan.windows.length === 0;

  if (noTextLayer) {
    const verified = verifyAnswer(answerSchema.parse({ outcome: "not_found" }), {
      versionId: row.versionId,
      pages: [],
      consideredPages: [],
      partialCoverage: true,
      noTextLayer: true,
      coverage,
      model: "none",
      schemaVersion: column.schemaVersion,
    });
    await ctx.repo.applyProposal(ctx.projectId, row.id, column.id, verified.proposal!, verified.status);
    return;
  }

  let lastVerified: ReturnType<typeof verifyAnswer> | null = null;

  for (const window of plan.windows) {
    if (signal.aborted) return;
    const answer = await callWithRetry(
      {
        instruction: column.instruction,
        columnLabel: column.label,
        answerType: column.answerType,
        unit: column.unit,
        options: column.options,
        question: ctx.question || undefined,
        configurationLabel: row.configurationLabel,
        documentTitle: source?.title ?? "Untitled document",
        pages: window.pages,
      },
      signal,
      ctx.fetchImpl,
    );

    const verified = verifyAnswer(answer.answer, {
      versionId: row.versionId,
      pages: window.pages,
      consideredPages: plan.consideredPages,
      partialCoverage: plan.partialCoverage,
      noTextLayer: false,
      coverage,
      model: answer.model,
      schemaVersion: column.schemaVersion,
    });
    lastVerified = verified;

    // A verified answer or a genuine ambiguity ends the search; "not found" moves on.
    if (verified.status === "extracted" || verified.status === "ambiguous") break;
  }

  if (!lastVerified) throw new Error("No pages could be sent for this document.");

  if (lastVerified.status === "failed" && !lastVerified.proposal) {
    await ctx.repo.setCellStatus(ctx.projectId, row.id, column.id, "failed");
    return;
  }

  const status =
    lastVerified.status === "not_found" && version?.parseStatus === "no_text_layer"
      ? "unreadable"
      : lastVerified.status;
  await ctx.repo.applyProposal(ctx.projectId, row.id, column.id, lastVerified.proposal!, status);
}

async function callWithRetry(
  body: Record<string, unknown>,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
) {
  let lastError = "Extraction failed.";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal.aborted) throw new Error("Cancelled.");
    const response = await fetchImpl("/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (response.ok) {
      const payload = (await response.json()) as { answer: unknown; model: string };
      return { answer: answerSchema.parse(payload.answer), model: payload.model };
    }
    const payload = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    lastError = payload.error ?? `Request failed with ${response.status}.`;
    if (payload.code !== "retryable" || attempt === MAX_ATTEMPTS) throw new Error(lastError);
    await sleep(500 * 2 ** (attempt - 1));
  }
  throw new Error(lastError);
}
