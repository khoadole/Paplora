/**
 * OpenAlex lookups.
 *
 * Bibliographic fields — authors, year, venue, DOI, open-access PDF, abstract —
 * come from here, never from the model. When a search result cannot be matched
 * to a record with confidence, the fields stay blank rather than being guessed.
 */

const API = "https://api.openalex.org/works";
// OpenAlex asks for a contact address in the polite pool.
const MAILTO = process.env.OPENALEX_MAILTO || "paplora@localhost";

export interface ScholarlyRecord {
  title: string;
  authors?: string;
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  pdfUrl?: string;
  landingUrl?: string;
  abstract?: string;
}

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  display_name?: string;
  publication_year?: number;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string } | null; landing_page_url?: string | null } | null;
  best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  ids?: { doi?: string; openalex?: string };
}

/** OpenAlex stores abstracts as a word → positions index; rebuild the text. */
export function abstractFromIndex(index: Record<string, number[]> | null | undefined): string | undefined {
  if (!index) return undefined;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word;
  }
  const text = words.filter(Boolean).join(" ").trim();
  return text.length > 40 ? text.slice(0, 4000) : undefined;
}

/** Comparable form of a title: lowercase, letters and digits only. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A match is accepted only when the normalised titles agree on their first 60
 * characters. Attaching the wrong paper's authors is worse than showing none.
 */
export function titlesMatch(a: string, b: string): boolean {
  const left = titleKey(a);
  const right = titleKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const head = Math.min(60, left.length, right.length);
  return head >= 25 && left.slice(0, head) === right.slice(0, head);
}

function toRecord(work: OpenAlexWork): ScholarlyRecord {
  const doi = (work.doi ?? work.ids?.doi ?? undefined)?.replace(/^https?:\/\/doi\.org\//, "");
  const pdfUrl = work.best_oa_location?.pdf_url ?? undefined;
  const arxiv = /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})/i.exec(
    `${pdfUrl ?? ""} ${work.best_oa_location?.landing_page_url ?? ""} ${work.primary_location?.landing_page_url ?? ""}`,
  );
  return {
    title: work.display_name ?? "",
    authors:
      work.authorships
        ?.map((a) => a.author?.display_name)
        .filter(Boolean)
        .slice(0, 6)
        .join(", ") || undefined,
    year: work.publication_year,
    venue: work.primary_location?.source?.display_name ?? undefined,
    doi,
    arxivId: arxiv?.[1],
    pdfUrl: pdfUrl ?? undefined,
    landingUrl: work.primary_location?.landing_page_url ?? work.best_oa_location?.landing_page_url ?? undefined,
    abstract: abstractFromIndex(work.abstract_inverted_index),
  };
}

async function query(url: string, signal?: AbortSignal): Promise<OpenAlexWork[]> {
  const response = await fetch(url, {
    headers: { "User-Agent": `Paplora (mailto:${MAILTO})` },
    signal: signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { results?: OpenAlexWork[] } | OpenAlexWork;
  if ("results" in payload) return payload.results ?? [];
  return [payload as OpenAlexWork];
}

/** Looks a paper up by DOI first, then by title, and returns nothing if unsure. */
export async function lookupWork(
  input: { title?: string; doi?: string },
  signal?: AbortSignal,
): Promise<ScholarlyRecord | null> {
  try {
    if (input.doi) {
      const works = await query(`${API}/https://doi.org/${encodeURIComponent(input.doi)}?mailto=${MAILTO}`, signal);
      if (works[0]?.display_name) return toRecord(works[0]);
    }
    if (!input.title) return null;
    const works = await query(
      `${API}?filter=title.search:${encodeURIComponent(input.title.slice(0, 180))}&per-page=5&mailto=${MAILTO}`,
      signal,
    );
    const hit = works.find((work) => work.display_name && titlesMatch(work.display_name, input.title!));
    return hit ? toRecord(hit) : null;
  } catch {
    return null;
  }
}

/**
 * Topic search over titles and abstracts. Far more precise than the plain
 * `search` parameter, which ranks by citation weight and drifts to famous
 * surveys regardless of the question.
 */
export async function searchWorks(
  text: string,
  limit = 8,
  signal?: AbortSignal,
  fromYear?: number,
): Promise<ScholarlyRecord[]> {
  const filters = [`title_and_abstract.search:${text.slice(0, 250)}`];
  if (fromYear) filters.push(`publication_year:>${fromYear - 1}`);
  try {
    const works = await query(
      `${API}?filter=${encodeURIComponent(filters.join(","))}&per-page=${Math.min(limit, 25)}&sort=relevance_score:desc&mailto=${MAILTO}`,
      signal,
    );
    return works.filter((work) => work.display_name).map(toRecord);
  } catch {
    return [];
  }
}

/** DOI embedded in a URL, when the URL carries one. */
export function doiFromUrl(url: string): string | undefined {
  const match = /doi\.org\/(10\.[^\s?#]+)/i.exec(url);
  return match?.[1];
}

export function arxivIdFromUrl(url: string): string | undefined {
  const match = /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})/i.exec(url);
  return match?.[1];
}
