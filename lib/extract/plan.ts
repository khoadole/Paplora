/**
 * Bounded requests and honest coverage.
 *
 * A document is never truncated at a fixed character count and silently sent.
 * It is split into page windows; each window is one request. What a proposal
 * was actually allowed to see is recorded on the proposal, and anything left
 * unsent is reported as partial coverage rather than hidden.
 */

export interface PlanPage {
  pageNumber: number;
  text: string;
  /** Section heading, for web sources split by heading rather than page. */
  label?: string;
}

export interface Window {
  pages: PlanPage[];
  pageNumbers: number[];
}

export interface Plan {
  windows: Window[];
  /** Pages with usable text that fit inside the request budget. */
  consideredPages: number[];
  /** Pages with text that did not fit and were not sent. */
  skippedPages: number[];
  /** Pages carrying no extractable text at all (scanned or empty). */
  emptyPages: number[];
  partialCoverage: boolean;
}

export const MAX_CHARS_PER_WINDOW = 12000;
export const MAX_PAGES_PER_WINDOW = 8;
/** Ceiling per (row, column) unit, so one cell can never fan out unboundedly. */
export const MAX_WINDOWS_PER_CELL = 4;

export function planExtraction(
  pages: PlanPage[],
  limits: { maxWindows?: number; maxChars?: number; maxPages?: number } = {},
): Plan {
  const maxWindows = limits.maxWindows ?? MAX_WINDOWS_PER_CELL;
  const maxChars = limits.maxChars ?? MAX_CHARS_PER_WINDOW;
  const maxPages = limits.maxPages ?? MAX_PAGES_PER_WINDOW;

  const ordered = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const empty = ordered.filter((p) => p.text.trim().length === 0);
  const withText = ordered.filter((p) => p.text.trim().length > 0);

  const windows: Window[] = [];
  let current: PlanPage[] = [];
  let size = 0;

  const flush = () => {
    if (!current.length) return;
    windows.push({ pages: current, pageNumbers: current.map((p) => p.pageNumber) });
    current = [];
    size = 0;
  };

  for (const page of withText) {
    const text = page.text.length > maxChars ? page.text.slice(0, maxChars) : page.text;
    if (current.length >= maxPages || (size > 0 && size + text.length > maxChars)) flush();
    current.push({ pageNumber: page.pageNumber, text, label: page.label });
    size += text.length;
  }
  flush();

  const kept = windows.slice(0, maxWindows);
  const dropped = windows.slice(maxWindows);
  const considered = kept.flatMap((w) => w.pageNumbers);
  const skipped = dropped.flatMap((w) => w.pageNumbers);

  return {
    windows: kept,
    consideredPages: considered,
    skippedPages: skipped,
    emptyPages: empty.map((p) => p.pageNumber),
    partialCoverage: skipped.length > 0 || empty.length > 0,
  };
}

/** One line for the UI: what the model was actually able to look at. */
export function describeCoverage(plan: Plan, pageCount: number): string {
  const seen = plan.consideredPages.length;
  if (seen === pageCount) return `Read all ${pageCount} pages.`;
  const parts = [`Read ${seen} of ${pageCount} pages.`];
  if (plan.emptyPages.length)
    parts.push(
      `${plan.emptyPages.length} page${plan.emptyPages.length === 1 ? "" : "s"} carried no extractable text.`,
    );
  if (plan.skippedPages.length)
    parts.push(`${plan.skippedPages.length} beyond the request limit were not sent.`);
  return parts.join(" ");
}
