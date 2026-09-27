import type { CellStatus } from "@/lib/types";

/**
 * Cell status vocabulary, in one place.
 *
 * Deliberately no confidence percentages: a number no one can calibrate reads as
 * precision that does not exist. Each state says what is actually known.
 */

export const STATUS_TEXT: Record<CellStatus, { label: string; help: string; tone: "neutral" | "ok" | "warn" | "bad" | "busy" }> = {
  empty: { label: "Empty", help: "Nothing extracted or written here yet.", tone: "neutral" },
  processing: { label: "Working", help: "Extraction is running for this cell.", tone: "busy" },
  extracted: {
    label: "Unreviewed",
    help: "An AI answer that nobody has checked. The quote proves the text exists, not that it supports this answer.",
    tone: "warn",
  },
  reviewed: { label: "Reviewed", help: "You checked this against the source and approved it.", tone: "ok" },
  flagged: { label: "Flagged", help: "You marked this as wrong or suspect.", tone: "bad" },
  not_found: {
    label: "Not found",
    help: "The pages that were read do not answer this. Different from unreadable.",
    tone: "neutral",
  },
  unreadable: {
    label: "Unreadable",
    help: "The relevant content could not be read at all — usually a scan with no text layer.",
    tone: "bad",
  },
  ambiguous: {
    label: "Ambiguous",
    help: "The paper reports several conflicting values or configurations. Split the row to separate them.",
    tone: "warn",
  },
  failed: { label: "Failed", help: "The extraction attempt failed, or its evidence did not check out.", tone: "bad" },
  stale: {
    label: "Stale",
    help: "The column instruction changed after this answer was produced. Re-extract to refresh it.",
    tone: "warn",
  },
};

const TONE_STYLE: Record<string, { background: string; color: string; border: string }> = {
  neutral: { background: "var(--color-sunken)", color: "var(--color-muted)", border: "var(--color-line)" },
  ok: { background: "var(--color-accent-soft)", color: "var(--color-accent)", border: "var(--color-accent-soft)" },
  warn: { background: "var(--color-warn-soft)", color: "var(--color-warn)", border: "var(--color-warn-soft)" },
  bad: { background: "var(--color-alarm-soft)", color: "var(--color-alarm)", border: "var(--color-alarm-soft)" },
  busy: { background: "var(--color-sunken)", color: "var(--color-ink)", border: "var(--color-line)" },
};

export function StatusChip({ status, title }: { status: CellStatus; title?: string }) {
  const meta = STATUS_TEXT[status];
  const tone = TONE_STYLE[meta.tone];
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-[1px] text-[10.5px] font-medium"
      style={{ background: tone.background, color: tone.color, border: `1px solid ${tone.border}` }}
      title={title ?? meta.help}
    >
      {meta.label}
    </span>
  );
}
