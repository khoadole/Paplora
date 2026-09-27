import type { CellStatus, EvidenceSpan, Proposal } from "../types";
import { resolveEvidence, type PageLike } from "./match";
import type { ModelAnswer } from "./schema";

/**
 * Deterministic verification of a model answer.
 *
 * The model proposes; this function decides what the table is allowed to show.
 * Every quote must be locatable in the page text that was actually supplied.
 * Quotes that do not resolve are dropped, and an answer claiming `found` with no
 * surviving evidence never becomes a value — it is reported as unverified.
 *
 * A resolvable quote proves only that the text exists in the document. It does
 * NOT prove the text supports the answer, and nothing here marks a cell reviewed.
 * Only a human can do that.
 */

export interface VerifiedAnswer {
  status: CellStatus;
  proposal?: Proposal;
  /** Quotes the model supplied that could not be found in the document. */
  rejectedQuotes: string[];
  message?: string;
}

export interface VerifyContext {
  versionId: string;
  pages: PageLike[];
  consideredPages: number[];
  partialCoverage: boolean;
  /** True when the document produced no usable text at all. */
  noTextLayer: boolean;
  model: string;
  schemaVersion: number;
  now?: number;
}

export function verifyAnswer(answer: ModelAnswer, ctx: VerifyContext): VerifiedAnswer {
  const at = ctx.now ?? Date.now();
  const rejected: string[] = [];
  const spans: EvidenceSpan[] = [];

  for (const item of answer.evidence) {
    const resolved = resolveEvidence(ctx.pages, item.page, item.quote);
    if (!resolved) {
      rejected.push(item.quote);
      continue;
    }
    spans.push({
      versionId: ctx.versionId,
      pageNumber: resolved.pageNumber,
      quote: resolved.quote,
      start: resolved.start,
      end: resolved.end,
      location: resolved.location,
    });
  }

  const base = {
    unit: answer.unit || undefined,
    conditions: answer.conditions || undefined,
    note: answer.note || undefined,
    model: ctx.model,
    schemaVersion: ctx.schemaVersion,
    createdAt: at,
    pagesConsidered: ctx.consideredPages,
    partialCoverage: ctx.partialCoverage,
  };

  if (ctx.noTextLayer) {
    return {
      status: "unreadable",
      rejectedQuotes: rejected,
      message: "This document has no extractable text, so nothing could be read from it.",
      proposal: { ...base, value: "", evidence: [] },
    };
  }

  if (answer.outcome === "not_found") {
    return {
      status: "not_found",
      rejectedQuotes: rejected,
      proposal: { ...base, value: "", evidence: spans },
      message: ctx.partialCoverage
        ? "Not found in the pages that were read. Some pages were not sent."
        : undefined,
    };
  }

  if (answer.outcome === "ambiguous") {
    return {
      status: "ambiguous",
      rejectedQuotes: rejected,
      proposal: { ...base, value: answer.value, evidence: spans },
      message: answer.note || "The document reports several conflicting values.",
    };
  }

  // outcome === "found"
  if (!answer.value.trim()) {
    return {
      status: "not_found",
      rejectedQuotes: rejected,
      proposal: { ...base, value: "", evidence: spans },
      message: "The model reported a result but returned no value.",
    };
  }

  if (spans.length === 0) {
    return {
      status: "failed",
      rejectedQuotes: rejected,
      message:
        rejected.length > 0
          ? "The quoted evidence is not present in this document, so the answer was rejected."
          : "The answer arrived without evidence, so it was rejected.",
    };
  }

  return {
    status: "extracted",
    rejectedQuotes: rejected,
    proposal: { ...base, value: answer.value, evidence: spans },
  };
}
