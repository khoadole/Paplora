/**
 * Evidence resolution.
 *
 * A quote is only ever accepted if it is present in the page text we extracted.
 * We match against a normalized copy (whitespace collapsed, ligatures and dashes
 * folded, soft hyphens dropped) but every offset we return points into the
 * ORIGINAL text, so highlights land on the real characters and the stored quote
 * stays verbatim.
 *
 * If the quote cannot be located, the span degrades to page-level. We never
 * invent an offset or a bounding box.
 */

export interface NormalizedText {
  normalized: string;
  /** map[i] is the index in the original string of normalized character i. */
  map: number[];
}

const FOLD: Record<string, string> = {
  "­": "", // soft hyphen
  "ﬀ": "ff",
  "ﬁ": "fi",
  "ﬂ": "fl",
  "ﬃ": "ffi",
  "ﬄ": "ffl",
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "−": "-",
  "‘": "'",
  "’": "'",
  "‚": "'",
  "“": '"',
  "”": '"',
  " ": " ",
};

/** Lowercased, whitespace-collapsed copy plus an index map back to the original. */
export function normalize(input: string): NormalizedText {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    const folded = FOLD[raw] ?? raw;
    if (folded === "") continue;
    if (/\s/.test(folded)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out.push(" ");
      map.push(i);
      pendingSpace = false;
    }
    for (const char of folded.toLowerCase()) {
      out.push(char);
      map.push(i);
    }
  }
  return { normalized: out.join(""), map };
}

export interface QuoteMatch {
  start: number;
  end: number;
  /** The exact original substring, which is what gets stored as the quote. */
  text: string;
}

/**
 * Locates `quote` inside `pageText`. Returns original-text offsets, or null when
 * the quote is not present. A short quote (< 12 normalized chars) is rejected:
 * it would match too much to be evidence.
 */
export function findQuote(pageText: string, quote: string): QuoteMatch | null {
  const haystack = normalize(pageText);
  const needle = normalize(quote);
  if (needle.normalized.length < 12) return null;

  let at = haystack.normalized.indexOf(needle.normalized);
  if (at < 0) {
    const trimmed = trimToCore(needle.normalized);
    if (trimmed.length < 12) return null;
    at = haystack.normalized.indexOf(trimmed);
    if (at < 0) return null;
    return spanFrom(pageText, haystack, at, trimmed.length);
  }
  return spanFrom(pageText, haystack, at, needle.normalized.length);
}

function spanFrom(
  pageText: string,
  haystack: NormalizedText,
  at: number,
  length: number,
): QuoteMatch {
  const start = haystack.map[at];
  const lastIndex = haystack.map[at + length - 1];
  const end = Math.min(pageText.length, lastIndex + 1);
  return { start, end, text: pageText.slice(start, end) };
}

/**
 * Models sometimes wrap a real quote in leading/trailing fragments. Drop the
 * outer 15% of words (never the middle) and retry once. This keeps the anchor
 * genuine rather than fuzzy-matching arbitrary text.
 */
function trimToCore(normalized: string): string {
  const words = normalized.split(" ");
  if (words.length < 8) return normalized;
  const cut = Math.max(1, Math.floor(words.length * 0.15));
  return words.slice(cut, words.length - cut).join(" ");
}

export interface ResolvedSpan {
  pageNumber: number;
  quote: string;
  start?: number;
  end?: number;
  location: "span" | "section" | "page";
  sectionLabel?: string;
}

export interface PageLike {
  pageNumber: number;
  text: string;
  /** Section heading for web sources; absent for PDF pages. */
  label?: string;
}

/**
 * Resolves one model-supplied quote against the pages that were actually sent.
 * The claimed page is tried first; if the quote lives on another supplied page we
 * accept that page instead (models miscount pages more often than they fabricate).
 * Returns null when the quote appears nowhere — the caller must then drop the claim.
 */
export function resolveEvidence(
  pages: PageLike[],
  claimedPage: number,
  quote: string,
): ResolvedSpan | null {
  const ordered = [
    ...pages.filter((p) => p.pageNumber === claimedPage),
    ...pages.filter((p) => p.pageNumber !== claimedPage),
  ];
  for (const page of ordered) {
    const hit = findQuote(page.text, quote);
    if (hit) {
      return {
        pageNumber: page.pageNumber,
        quote: hit.text,
        start: hit.start,
        end: hit.end,
        // A web section has no coordinates to highlight, only a heading.
        location: page.label ? "section" : "span",
        sectionLabel: page.label,
      };
    }
  }
  return null;
}
