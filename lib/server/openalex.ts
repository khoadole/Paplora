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

const STOP = new Set(["a", "an", "the", "for", "of", "on", "in", "and", "with", "to", "via", "using", "based"]);

/** Words that describe the request rather than the subject; they match no abstract. */
const QUERY_VERBS = new Set([
  "compare", "comparison", "comparing", "vs", "versus", "find", "search", "look",
  "paper", "papers", "study", "studies", "article", "articles", "work", "works",
  "method", "methods", "approach", "approaches", "recent", "latest", "best", "new",
  "review", "between", "difference", "differences", "against",
]);

function tokens(title: string): string[] {
  // "ST-GCN: Spatial Temporal…" — the acronym before the colon is a label, not
  // vocabulary, and counting it made a paper fail to match its own title.
  const withoutLabel = /^[^:]{2,12}:\s/.test(title) ? title.slice(title.indexOf(":") + 1) : title;
  return titleKey(withoutLabel)
    .split(" ")
    .filter((word) => word.length > 1 && !STOP.has(word));
}

/**
 * Do two titles name the same paper?
 *
 * Measured by how much of the shorter title's vocabulary the longer one
 * contains, because the same paper is routinely cited with an acronym prefix
 * ("ST-GCN: Spatial Temporal…"), a subtitle dropped, or different hyphenation.
 * A prefix comparison rejected exactly those, which silently threw away real
 * papers the model had named correctly.
 */
export function titlesMatch(a: string, b: string): boolean {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.length || !right.length) return false;
  if (titleKey(a) === titleKey(b)) return true;

  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (short.length < 3) return false;
  const vocabulary = new Set(long);
  const shared = short.filter((word) => vocabulary.has(word)).length;
  // Nearly all of the shorter title must appear in the longer one, and the two
  // must not differ wildly in length (a paper is not its own survey).
  return shared / short.length >= 0.8 && long.length <= short.length * 2.2;
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One index request, with backoff.
 *
 * A burst of lookups gets 429ed, and an empty result then reads exactly like
 * "no such paper" — which is how a rate limit quietly turned into "we could not
 * find the paper you asked for". Retrying is what keeps those two apart.
 */
async function query(url: string, signal?: AbortSignal): Promise<OpenAlexWork[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": `Paplora (mailto:${MAILTO})` },
      signal: signal ?? AbortSignal.timeout(15_000),
    });
    if (response.status === 429 || response.status === 503) {
      await sleep(400 * (attempt + 1));
      continue;
    }
    if (!response.ok) return [];
    const payload = (await response.json()) as { results?: OpenAlexWork[] } | OpenAlexWork;
    if ("results" in payload) return payload.results ?? [];
    return [payload as OpenAlexWork];
  }
  return [];
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
    const title = input.title;

    // Try the whole title, then its most distinctive words. OpenAlex ANDs the
    // terms it is given, so one stray word from a citation style returns nothing.
    const core = tokens(title).slice(0, 10).join(" ");
    const attempts = [
      `${API}?filter=title.search:${encodeURIComponent(title.slice(0, 180))}&per-page=5&mailto=${MAILTO}`,
      core && core !== titleKey(title)
        ? `${API}?filter=title.search:${encodeURIComponent(core)}&per-page=8&mailto=${MAILTO}`
        : null,
      `${API}?search=${encodeURIComponent(title.slice(0, 180))}&per-page=8&mailto=${MAILTO}`,
    ].filter(Boolean) as string[];

    for (const attempt of attempts) {
      const works = await query(attempt, signal);
      const hit = works.find((work) => work.display_name && titlesMatch(work.display_name, title));
      if (hit) return toRecord(hit);
    }
    return null;
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
  // Terms are ANDed, so a long query matches nothing. Drop the words that
  // describe the request, then try progressively smaller windows — including
  // the tail, because "compare X vs Y in skeleton action recognition" carries
  // its real subject at the end.
  const words = tokens(text).filter((word) => !QUERY_VERBS.has(word));
  // Never fewer than three words: "ctr gcn" matches click-through-rate papers,
  // which is how a skeleton-action query came back full of recommender systems.
  const variants = [words, words.slice(0, 6), words.slice(-5), words.slice(-4), words.slice(-3)]
    .filter((set) => set.length >= Math.min(3, words.length))
    .map((set) => set.join(" "))
    .filter((value, index, all) => value && all.indexOf(value) === index);

  for (const variant of variants) {
    const filters = [`title_and_abstract.search:${variant}`];
    if (fromYear) filters.push(`publication_year:>${fromYear - 1}`);
    try {
      const works = await query(
        `${API}?filter=${encodeURIComponent(filters.join(","))}&per-page=${Math.min(limit, 25)}&sort=relevance_score:desc&mailto=${MAILTO}`,
        signal,
      );
      const records = works.filter((work) => work.display_name).map(toRecord);
      if (records.length) return records;
    } catch {
      // try the next, shorter variant
    }
  }
  return [];
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
