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
}

/** A source document is the paper; a version is one immutable upload of its bytes. */
export interface SourceDocument {
  id: Id;
  title: string;
  filename: string;
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
  pageNumber: number;
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
  | "not_found" // searched the processed text, genuinely absent
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

export type EvidenceLocation = "span" | "page";

export interface EvidenceSpan {
  versionId: Id;
  pageNumber: number;
  /** The exact text as it appears in the document, never a paraphrase. */
  quote: string;
  /** Character range within ParsedPage.text when the quote was located exactly. */
  start?: number;
  end?: number;
  /**
   * "span" — the quote was found in the page text and can be highlighted.
   * "page" — the quote could not be located exactly; only the page is known.
   */
  location: EvidenceLocation;
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
  evidencePanelWidth?: number;
}
