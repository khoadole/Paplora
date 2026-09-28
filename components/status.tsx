import type { CellStatus } from "@/lib/types";
import { IconAlert, IconCheck, IconDot, IconFlag, IconQuestion, IconRetry, IconSparkle } from "./icons";
import type { ReactNode } from "react";

/**
 * Cell status vocabulary, in one place.
 *
 * Each state carries an icon and a word, so the distinctions survive greyscale,
 * colour blindness and a small badge. No confidence percentages: a number nobody
 * can calibrate reads as precision that does not exist.
 */

type Tone = "neutral" | "ok" | "warn" | "bad" | "busy";

export const STATUS_TEXT: Record<CellStatus, { label: string; help: string; tone: Tone }> = {
  empty: { label: "Empty", help: "Nothing extracted or written here yet.", tone: "neutral" },
  processing: { label: "Working", help: "Extraction is running for this cell.", tone: "busy" },
  extracted: {
    label: "Unreviewed",
    help: "An AI answer nobody has checked. A quote proves the text exists, not that it supports this answer.",
    tone: "warn",
  },
  reviewed: { label: "Reviewed", help: "You checked this against the source and approved it.", tone: "ok" },
  flagged: { label: "Flagged", help: "You marked this as wrong or suspect.", tone: "bad" },
  not_found: {
    label: "Not reported",
    help: "The pages that were read do not answer this. The document was readable; the answer is not in it.",
    tone: "neutral",
  },
  unreadable: {
    label: "Unreadable",
    help: "The document could not be processed — usually a scan with no text layer. Different from 'not reported'.",
    tone: "bad",
  },
  ambiguous: {
    label: "Ambiguous",
    help: "The paper reports several conflicting values or configurations. Split the row to separate them.",
    tone: "warn",
  },
  failed: { label: "Failed", help: "The attempt failed, or its evidence did not check out.", tone: "bad" },
  stale: {
    label: "Stale",
    help: "The column instruction changed after this answer was produced. Re-extract to refresh it.",
    tone: "warn",
  },
};

const TONE: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: "var(--surface-2)", fg: "var(--text-2)" },
  ok: { bg: "var(--ok-weak)", fg: "var(--ok)" },
  warn: { bg: "var(--warn-weak)", fg: "var(--warn)" },
  bad: { bg: "var(--danger-weak)", fg: "var(--danger)" },
  busy: { bg: "var(--accent-weak)", fg: "var(--accent)" },
};

const ICON: Record<CellStatus, ReactNode> = {
  empty: <IconDot size={9} />,
  processing: <IconRetry size={11} />,
  extracted: <IconSparkle size={11} />,
  reviewed: <IconCheck size={11} />,
  flagged: <IconFlag size={11} />,
  not_found: <IconDot size={9} />,
  unreadable: <IconAlert size={11} />,
  ambiguous: <IconQuestion size={11} />,
  failed: <IconAlert size={11} />,
  stale: <IconRetry size={11} />,
};

export function StatusBadge({ status, title }: { status: CellStatus; title?: string }) {
  const meta = STATUS_TEXT[status];
  const tone = TONE[meta.tone];
  // "Empty" is the default state of most cells; showing a badge for it is noise.
  if (status === "empty") return null;
  return (
    <span
      className="badge"
      style={{ background: tone.bg, color: tone.fg, borderColor: "transparent" }}
      title={title ?? meta.help}
    >
      {ICON[status]}
      {meta.label}
    </span>
  );
}
