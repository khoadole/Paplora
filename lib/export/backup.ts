import { z } from "zod";

/**
 * Versioned local backup.
 *
 * A backup is a ZIP: `manifest.json` plus `pdfs/<versionId>.pdf` for the original
 * bytes. Import validates the manifest with zod before anything is written, caps
 * the uncompressed size, and only ever parses JSON — nothing in a backup is
 * executed, and unknown fields are dropped rather than trusted.
 */

export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 300 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 40 * 1024 * 1024;

const evidenceSpanSchema = z.object({
  versionId: z.string(),
  pageNumber: z.number().int().min(1),
  quote: z.string(),
  start: z.number().int().optional(),
  end: z.number().int().optional(),
  location: z.enum(["span", "page"]),
});

const proposalSchema = z.object({
  value: z.string(),
  unit: z.string().optional(),
  conditions: z.string().optional(),
  evidence: z.array(evidenceSpanSchema).default([]),
  note: z.string().optional(),
  model: z.string(),
  schemaVersion: z.number(),
  createdAt: z.number(),
  pagesConsidered: z.array(z.number()).default([]),
  partialCoverage: z.boolean().default(false),
});

export const manifestSchema = z.object({
  backupVersion: z.literal(BACKUP_VERSION),
  exportedAt: z.number(),
  projects: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["user", "sample"]).default("user"),
      title: z.string(),
      question: z.string().default(""),
      createdAt: z.number(),
      updatedAt: z.number(),
    }),
  ),
  sources: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      filename: z.string(),
      contentHash: z.string(),
      byteSize: z.number(),
      createdAt: z.number(),
      currentVersionId: z.string(),
    }),
  ),
  versions: z.array(
    z.object({
      id: z.string(),
      sourceId: z.string(),
      createdAt: z.number(),
      pageCount: z.number(),
      parseStatus: z.enum(["pending", "parsing", "parsed", "no_text_layer", "encrypted", "failed"]),
      parseMessage: z.string().optional(),
      pagesWithText: z.number().default(0),
    }),
  ),
  pages: z.array(
    z.object({
      id: z.string(),
      versionId: z.string(),
      pageNumber: z.number().int().min(1),
      text: z.string(),
      width: z.number(),
      height: z.number(),
      items: z
        .array(
          z.object({
            start: z.number(),
            length: z.number(),
            x: z.number(),
            y: z.number(),
            w: z.number(),
            h: z.number(),
          }),
        )
        .default([]),
    }),
  ),
  projectSources: z.array(
    z.object({ projectId: z.string(), sourceId: z.string(), addedAt: z.number() }),
  ),
  columns: z.array(
    z.object({
      id: z.string(),
      projectId: z.string(),
      label: z.string(),
      instruction: z.string(),
      answerType: z.enum(["text", "number", "categorical"]),
      unit: z.string().optional(),
      options: z.array(z.string()).optional(),
      position: z.number(),
      schemaVersion: z.number(),
    }),
  ),
  rows: z.array(
    z.object({
      id: z.string(),
      projectId: z.string(),
      sourceId: z.string(),
      versionId: z.string(),
      configurationLabel: z.string().optional(),
      position: z.number(),
    }),
  ),
  cells: z.array(
    z.object({
      id: z.string(),
      projectId: z.string(),
      rowId: z.string(),
      columnId: z.string(),
      status: z.string(),
      userValue: z.string().optional(),
      userUnit: z.string().optional(),
      userConditions: z.string().optional(),
      proposal: proposalSchema.optional(),
      pendingProposal: proposalSchema.optional(),
      reviewedAt: z.number().optional(),
      flagNote: z.string().optional(),
      history: z
        .array(
          z.object({
            at: z.number(),
            by: z.enum(["user", "ai"]),
            status: z.string(),
            value: z.string().optional(),
          }),
        )
        .default([]),
      updatedAt: z.number(),
    }),
  ),
});

export type BackupManifest = z.infer<typeof manifestSchema>;

export function parseManifest(bytes: Uint8Array): BackupManifest {
  if (bytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error("This backup's manifest is larger than the 40 MB limit.");
  }
  const text = new TextDecoder().decode(bytes);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("manifest.json is not valid JSON.");
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `This backup does not match the expected format (${first?.path.join(".") || "root"}: ${first?.message ?? "invalid"}).`,
    );
  }
  return parsed.data;
}

/** PDF entries must look like `pdfs/<id>.pdf` — no directory traversal, no other types. */
export function isAllowedEntry(name: string): boolean {
  if (name === "manifest.json") return true;
  return /^pdfs\/[A-Za-z0-9_-]+\.pdf$/.test(name);
}

export function versionIdFromEntry(name: string): string | null {
  const match = /^pdfs\/([A-Za-z0-9_-]+)\.pdf$/.exec(name);
  return match ? match[1] : null;
}
