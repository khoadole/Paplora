// Domain entities. Everything the workspace stores is one of these.

export type Id = string;

export type ProjectKind = "user" | "sample";

export interface Project {
  id: Id;
  kind: ProjectKind;
  title: string;
  question: string;
  createdAt: number;
  updatedAt: number;
  /** The model's reading of the request, shown to the user as editable text. */
  interpretedScope?: string;
  constraints?: string[];
  /** Short overview written from the retrieved results. */
  overview?: string;
  /** Cumulative token usage for this session. */
  usage?: { input: number; output: number; calls: number };
}

/**
 * A paper found by discovery but not yet imported into the comparison.
 * A candidate exists only if search returned a real URL for it.
 */
export interface PaperCandidate {
  id: Id;
  projectId: Id;
  title: string;
  url: string;
  /** One line on why this result matches the request, from the search step. */
  why?: string;
  /** Description grounded in retrieved content, never invented. */
  description?: string;
  authors?: string;
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  pdfUrl?: string;
  codeUrl?: string;
  metadataSource?: "openalex" | "search";
  coverage: Coverage;
  /** Set once the candidate has been imported as a source document. */
  importedSourceId?: Id;
  createdAt: number;
}

/** A source document is the paper; a version is one immutable upload of its bytes. */
/** How much of a paper Paplora has actually read. Never what a provider promises. */
export type Coverage = "metadata" | "abstract" | "fulltext";

export interface SourceDocument {
  id: Id;
  title: string;
  filename: string;
  /** "upload" for a user's PDF, "web" for a paper fetched from a URL. */
  kind?: "upload" | "web";
  /** Canonical page for the paper, when it came from discovery. */
  url?: string;
  doi?: string;
  arxivId?: string;
  venue?: string;
  abstract?: string;
  /** Repository link, only when an inspected source stated one. */
  codeUrl?: string;
  /** Where the bibliographic fields came from. Never the model. */
  metadataSource?: "openalex" | "crossref" | "pdf" | "user";
  /** What has been read: metadata only until content is actually fetched. */
  coverage?: Coverage;
  /** Only ever set from the PDF's own metadata. Never inferred, never invented. */
  authors?: string;
  year?: number;
  /** SHA-256 of the original bytes. Byte-identical uploads reuse the same source. */
  contentHash: string;
  byteSize: number;
  createdAt: number;
  currentVersionId: Id;
}

export type ParseStatus =
  | "pending"
  | "parsing"
  | "parsed"
  | "no_text_layer"
  | "encrypted"
  | "failed";

export interface DocumentVersion {
  id: Id;
  sourceId: Id;
  createdAt: number;
  pageCount: number;
  parseStatus: ParseStatus;
  /** Honest, user-readable limitation, e.g. "scanned pages carry no text layer". */
  parseMessage?: string;
  /** Pages that produced usable text. Extraction coverage is computed from this. */
  pagesWithText: number;
}

/** One page of parsed text. Original text is kept verbatim; matching uses a normalized copy. */
export interface ParsedPage {
  id: Id; // `${versionId}:${pageNumber}`
  versionId: Id;
  /** PDF page index (1-based), or section index for an HTML source. Not a printed page number. */
  pageNumber: number;
  /** Section heading, when the unit is a section rather than a PDF page. */
  label?: string;
  text: string;
  width: number;
  height: number;
  /** Text items with PDF-space boxes, used to place highlights. */
  items: ParsedItem[];
}

export interface ParsedItem {
  /** Character offset of this item's text within ParsedPage.text. */
  start: number;
  length: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProjectSource {
  projectId: Id;
  sourceId: Id;
  addedAt: number;
}

export type AnswerType = "text" | "number" | "categorical";

export interface Column {
  id: Id;
  projectId: Id;
  label: string;
  /** What the extractor is asked to find. Editing this marks AI cells stale. */
  instruction: string;
  answerType: AnswerType;
  unit?: string;
  /** Allowed values when answerType is categorical. Empty means free categorical. */
  options?: string[];
  position: number;
  /** Bumped whenever instruction/answerType/unit changes. Cells carry the version they were made with. */
  schemaVersion: number;
}

/**
 * One row is one paper by default. A paper reporting several configurations can be
 * split into labeled configuration rows that reuse the same source.
 */
export interface Row {
  id: Id;
  projectId: Id;
  sourceId: Id;
  versionId: Id;
  /** e.g. "ViT-B, 8 frames" — included in the extraction request when set. */
  configurationLabel?: string;
  position: number;
}

export type CellStatus =
  | "empty"
  | "processing"
  | "extracted" // AI proposed, not yet reviewed
  | "reviewed" // a human approved or wrote the value
  | "flagged" // a human marked it wrong
  | "not_found" // full text was reviewed and genuinely does not contain it
  | "not_in_reviewed_content" // absent from what was reviewed, but the full text was not read
  | "unreadable" // the relevant content could not be read (no text layer, unprocessed pages)
  | "ambiguous" // several conflicting candidates
  | "failed"
  | "stale"; // the column instruction changed after this was produced

export interface Proposal {
  value: string;
  /** Number answers keep their unit and the conditions they were reported under. */
  unit?: string;
  conditions?: string;
  /** Verbatim spans from the document. Never model paraphrase. */
  evidence: EvidenceSpan[];
  /** What the model said it could not determine, in its own words. */
  note?: string;
  model: string;
  schemaVersion: number;
  createdAt: number;
  /** Pages actually sent to the model for this proposal. */
  pagesConsidered: number[];
  /** True when some pages of the document were not sent (bounded requests). */
  partialCoverage: boolean;
  /** What was actually available to read when this answer was produced. */
  coverage?: Coverage;
  /** Model-reported token usage, for the session's usage record. */
  usage?: { input: number; output: number };
}

export interface Cell {
  id: Id; // `${rowId}:${columnId}`
  projectId: Id;
  rowId: Id;
  columnId: Id;
  status: CellStatus;
  /** The human's approved answer. Always wins over `proposal` in the table. */
  userValue?: string;
  userUnit?: string;
  userConditions?: string;
  /** The latest AI proposal, kept separately so re-extraction never overwrites a human edit. */
  proposal?: Proposal;
  /** A newer proposal waiting for the user to apply it over their own edit. */
  pendingProposal?: Proposal;
  reviewedAt?: number;
  flagNote?: string;
  history: CellRevision[];
  updatedAt: number;
}

export interface CellRevision {
  at: number;
  by: "user" | "ai";
  status: CellStatus;
  value?: string;
}

export type EvidenceLocation = "span" | "section" | "page";

export interface EvidenceSpan {
  versionId: Id;
  pageNumber: number;
  /** The exact text as it appears in the document, never a paraphrase. */
  quote: string;
  /** Character range within ParsedPage.text when the quote was located exactly. */
  start?: number;
  end?: number;
  /**
   * "span" — the quote was found and can be highlighted.
   * "section" — located within a named section of a web source.
   * "page" — the quote could not be placed exactly; only the unit is known.
   */
  location: EvidenceLocation;
  /** Heading of the section the quote sits in, for web sources. */
  sectionLabel?: string;
}

export type JobStage =
  | "queued"
  | "reading"
  | "extracting"
  | "done"
  | "failed"
  | "cancelled";

export interface ExtractionJob {
  id: Id;
  projectId: Id;
  stage: JobStage;
  /** Work units are one (row, column) pair each. */
  total: number;
  completed: number;
  failed: number;
  targets: JobTarget[];
  createdAt: number;
  updatedAt: number;
  error?: string;
  model?: string;
}

export interface JobTarget {
  rowId: Id;
  columnId: Id;
  /** Idempotency key so a resumed job never redoes finished work. */
  key: string;
  state: "pending" | "running" | "done" | "failed";
  error?: string;
}

export interface Preferences {
  id: "preferences";
  lastProjectId?: Id;
  /** Width of the evidence panel when it is open, in px. */
  evidencePanelWidth?: number;
  sidebarCollapsed?: boolean;
  density?: "comfortable" | "compact";
  /** "system" unless the user picked one explicitly. */
  theme?: "system" | "light" | "dark";
  /** Per-column widths in px, keyed by column id, so a layout survives a reload. */
  columnWidths?: Record<Id, number>;
  /** Column ids hidden from the table, keyed by project id. */
  hiddenColumns?: Record<Id, Id[]>;
  /** Which tab a project was last left on. */
  lastTab?: Record<Id, "papers" | "compare">;
}
