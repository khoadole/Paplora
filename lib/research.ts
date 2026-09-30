"use client";

import { parsePdf, looksLikePdf } from "./pdf/parse";
import { sha256, pageId } from "./ids";
import type { Repository } from "./repo";
import type { Coverage, PaperCandidate, ParsedPage } from "./types";

/**
 * Client-side research actions: run a discovery stream, import a candidate as a
 * real document, and read its content.
 *
 * Reading is deliberately staged. A candidate starts at coverage "metadata".
 * Fetching an abstract lifts it to "abstract"; fetching a PDF or an article page
 * lifts it to "fulltext". Nothing claims a level it has not actually read.
 */

export interface ProgressEvent {
  type: string;
  message: string;
}

export interface DiscoveryPayload {
  scope: {
    topic: string;
    constraints: string[];
    searchQuery: string;
    ambiguity?: string;
    ambiguityOptions?: string[];
  };
  overview: string;
  papers: Omit<PaperCandidate, "id" | "projectId" | "createdAt">[];
  usage: { input: number; output: number; calls: number };
  searchSkipped: boolean;
  unresolved: string[];
}

/** Streams newline-delimited events from the discovery route. */
export async function runDiscovery(
  question: string,
  handlers: { onEvent?: (event: ProgressEvent) => void; signal?: AbortSignal },
): Promise<DiscoveryPayload> {
  const response = await fetch("/api/research/discover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
    signal: handlers.signal,
  });

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Discovery failed (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: DiscoveryPayload | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as ProgressEvent & Partial<DiscoveryPayload> & { type: string };
      if (event.type === "result") result = event as unknown as DiscoveryPayload;
      else if (event.type === "error") throw new Error(event.message);
      else handlers.onEvent?.(event);
    }
  }

  if (!result) throw new Error("Discovery ended without a result.");
  return result;
}

/** Splits an HTML article into sections so evidence can point at a heading. */
export function sectionsFromHtml(html: string): { label?: string; text: string }[] {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");

  const parts = body.split(/<h[1-3][^>]*>/i);
  const sections: { label?: string; text: string }[] = [];
  for (const [index, part] of parts.entries()) {
    const close = /<\/h[1-3]>/i.exec(part);
    const label = index === 0 || !close ? undefined : stripTags(part.slice(0, close.index)).slice(0, 120);
    const text = stripTags(close ? part.slice(close.index) : part);
    if (text.trim().length > 120) sections.push({ label, text });
  }
  if (!sections.length) {
    const text = stripTags(body);
    if (text.trim().length > 120) sections.push({ text });
  }
  return sections.slice(0, 60);
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ImportOutcome {
  sourceId?: string;
  coverage: Coverage;
  reused: boolean;
  message?: string;
}

/**
 * Turns a discovered candidate into a document in the library and a row in the
 * project. Tries the PDF first, then the landing page, and falls back to the
 * abstract — recording honestly which of those actually happened.
 */
export async function importCandidate(
  repo: Repository,
  projectId: string,
  candidate: PaperCandidate,
  signal?: AbortSignal,
): Promise<ImportOutcome> {
  const existing = await repo.findSourceByIdentity({
    doi: candidate.doi,
    arxivId: candidate.arxivId,
    url: candidate.url,
  });
  if (existing) {
    await repo.addSourceToProject(projectId, existing.id);
    await repo.updateCandidate(candidate.id, { importedSourceId: existing.id });
    return { sourceId: existing.id, coverage: existing.coverage ?? "metadata", reused: true };
  }

  const shared = {
    kind: "web" as const,
    url: candidate.url,
    doi: candidate.doi,
    arxivId: candidate.arxivId,
    venue: candidate.venue,
    abstract: candidate.description,
    codeUrl: candidate.codeUrl,
    authors: candidate.authors,
    year: candidate.year,
    metadataSource: candidate.metadataSource === "openalex" ? ("openalex" as const) : undefined,
  };

  // 1. The PDF, when the index knows of an open-access copy.
  if (candidate.pdfUrl) {
    const fetched = await fetchSource(candidate.pdfUrl, signal);
    if (fetched?.kind === "pdf" && fetched.bytes && looksLikePdf(fetched.bytes)) {
      const hash = await sha256(fetched.bytes);
      const { source, version } = await repo.createSource({
        ...shared,
        title: candidate.title,
        filename: `${slug(candidate.title)}.pdf`,
        contentHash: hash,
        bytes: fetched.bytes,
        coverage: "fulltext",
      });
      const parsed = await parsePdf(fetched.bytes, version.id);
      await repo.savePages(version.id, parsed.pages);
      await repo.updateVersion(version.id, {
        pageCount: parsed.pageCount,
        parseStatus: parsed.status,
        parseMessage: parsed.message,
        pagesWithText: parsed.pagesWithText,
      });
      const readable = parsed.pagesWithText > 0;
      if (!readable) await repo.updateSource(source.id, { coverage: "metadata" });
      await repo.addSourceToProject(projectId, source.id);
      await repo.updateCandidate(candidate.id, { importedSourceId: source.id, coverage: readable ? "fulltext" : "metadata" });
      return {
        sourceId: source.id,
        coverage: readable ? "fulltext" : "metadata",
        reused: false,
        message: readable ? undefined : "The PDF has no text layer, so only its metadata is available.",
      };
    }
  }

  // 2. The landing page, as sections.
  const page = await fetchSource(candidate.url, signal);
  if (page?.kind === "text" && page.text) {
    const sections = sectionsFromHtml(page.text);
    const words = sections.reduce((total, section) => total + section.text.length, 0);
    if (words > 1500) {
      const bytes = new TextEncoder().encode(page.text).buffer as ArrayBuffer;
      const hash = await sha256(bytes);
      const { source, version } = await repo.createSource({
        ...shared,
        title: candidate.title,
        filename: `${slug(candidate.title)}.html`,
        contentHash: hash,
        bytes,
        coverage: "fulltext",
      });
      const pages: ParsedPage[] = sections.map((section, index) => ({
        id: pageId(version.id, index + 1),
        versionId: version.id,
        pageNumber: index + 1,
        label: section.label,
        text: section.text,
        width: 0,
        height: 0,
        items: [],
      }));
      await repo.savePages(version.id, pages);
      await repo.updateVersion(version.id, {
        pageCount: pages.length,
        parseStatus: "parsed",
        parseMessage: "Read from the article page; locations are sections, not printed pages.",
        pagesWithText: pages.length,
      });
      await repo.addSourceToProject(projectId, source.id);
      await repo.updateCandidate(candidate.id, { importedSourceId: source.id, coverage: "fulltext" });
      return { sourceId: source.id, coverage: "fulltext", reused: false };
    }
  }

  // 3. The abstract alone, clearly marked as such.
  const abstract = candidate.description;
  if (!abstract || abstract.length < 80) {
    return {
      coverage: "metadata",
      reused: false,
      message: "No readable content could be retrieved. Upload the PDF to compare this paper.",
    };
  }
  const bytes = new TextEncoder().encode(abstract).buffer as ArrayBuffer;
  const hash = await sha256(bytes);
  const { source, version } = await repo.createSource({
    ...shared,
    title: candidate.title,
    filename: `${slug(candidate.title)}-abstract.txt`,
    contentHash: hash,
    bytes,
    coverage: "abstract",
  });
  await repo.savePages(version.id, [
    {
      id: pageId(version.id, 1),
      versionId: version.id,
      pageNumber: 1,
      label: "Abstract",
      text: abstract,
      width: 0,
      height: 0,
      items: [],
    },
  ]);
  await repo.updateVersion(version.id, {
    pageCount: 1,
    parseStatus: "parsed",
    parseMessage: "Only the abstract was available.",
    pagesWithText: 1,
  });
  await repo.addSourceToProject(projectId, source.id);
  await repo.updateCandidate(candidate.id, { importedSourceId: source.id, coverage: "abstract" });
  return {
    sourceId: source.id,
    coverage: "abstract",
    reused: false,
    message: "Only the abstract was available for this paper.",
  };
}

async function fetchSource(url: string, signal?: AbortSignal) {
  try {
    const response = await fetch("/api/research/fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
      signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      kind: "pdf" | "text";
      bytes?: string;
      text?: string;
    };
    if (payload.kind === "pdf" && payload.bytes) {
      const binary = atob(payload.bytes);
      const buffer = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
      return { kind: "pdf" as const, bytes: buffer.buffer as ArrayBuffer };
    }
    return { kind: "text" as const, text: payload.text };
  } catch {
    return null;
  }
}

function slug(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "paper"
  );
}
