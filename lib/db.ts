import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  Cell,
  Column,
  DocumentVersion,
  ExtractionJob,
  ParsedPage,
  Preferences,
  Project,
  ProjectSource,
  Row,
  SourceDocument,
} from "./types";

export const DB_NAME = "paplora";
export const DB_VERSION = 1;

export interface PaploraSchema extends DBSchema {
  projects: { key: string; value: Project };
  sources: { key: string; value: SourceDocument; indexes: { contentHash: string } };
  versions: { key: string; value: DocumentVersion; indexes: { sourceId: string } };
  pages: { key: string; value: ParsedPage; indexes: { versionId: string } };
  /** Original PDF bytes, keyed by version id. Kept out of the page store to keep reads cheap. */
  blobs: { key: string; value: { id: string; bytes: ArrayBuffer } };
  projectSources: {
    key: [string, string];
    value: ProjectSource;
    indexes: { projectId: string; sourceId: string };
  };
  columns: { key: string; value: Column; indexes: { projectId: string } };
  rows: { key: string; value: Row; indexes: { projectId: string; sourceId: string } };
  cells: {
    key: string;
    value: Cell;
    indexes: { projectId: string; rowId: string; columnId: string };
  };
  jobs: { key: string; value: ExtractionJob; indexes: { projectId: string } };
  preferences: { key: string; value: Preferences };
}

export type PaploraDB = IDBPDatabase<PaploraSchema>;

let cached: Promise<PaploraDB> | null = null;

export function getDB(): Promise<PaploraDB> {
  if (!cached) {
    cached = openDB<PaploraSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("projects", { keyPath: "id" });

        const sources = db.createObjectStore("sources", { keyPath: "id" });
        sources.createIndex("contentHash", "contentHash", { unique: false });

        const versions = db.createObjectStore("versions", { keyPath: "id" });
        versions.createIndex("sourceId", "sourceId");

        const pages = db.createObjectStore("pages", { keyPath: "id" });
        pages.createIndex("versionId", "versionId");

        db.createObjectStore("blobs", { keyPath: "id" });

        const ps = db.createObjectStore("projectSources", {
          keyPath: ["projectId", "sourceId"],
        });
        ps.createIndex("projectId", "projectId");
        ps.createIndex("sourceId", "sourceId");

        const columns = db.createObjectStore("columns", { keyPath: "id" });
        columns.createIndex("projectId", "projectId");

        const rows = db.createObjectStore("rows", { keyPath: "id" });
        rows.createIndex("projectId", "projectId");
        rows.createIndex("sourceId", "sourceId");

        const cells = db.createObjectStore("cells", { keyPath: "id" });
        cells.createIndex("projectId", "projectId");
        cells.createIndex("rowId", "rowId");
        cells.createIndex("columnId", "columnId");

        const jobs = db.createObjectStore("jobs", { keyPath: "id" });
        jobs.createIndex("projectId", "projectId");

        db.createObjectStore("preferences", { keyPath: "id" });
      },
    });
  }
  return cached;
}

/** Tests open their own database per case; this drops the module-level handle. */
export function resetDBHandle() {
  cached = null;
}
