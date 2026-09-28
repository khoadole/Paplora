"use client";

import type { ParsedItem, ParsedPage, ParseStatus } from "../types";
import { pageId } from "../ids";

/**
 * PDF parsing, browser-side.
 *
 * pdf.js is loaded lazily so it never enters the server bundle, and the worker is
 * served from /pdf.worker.min.mjs (copied out of node_modules by scripts/copy-pdf-worker).
 *
 * We keep, per page: the text exactly as extracted, and a box per text item with
 * the character offset it starts at. Highlighting maps a character range back to
 * the boxes that cover it — which is why no bounding box is ever invented.
 */

export interface ParseResult {
  status: ParseStatus;
  message?: string;
  pageCount: number;
  pages: ParsedPage[];
  pagesWithText: number;
  /** Author and year exactly as the file declares them, when it declares them. */
  meta?: { title?: string; authors?: string; year?: number };
}

type PdfModule = typeof import("pdfjs-dist");

let pdfjs: PdfModule | null = null;

async function loadPdfjs(): Promise<PdfModule> {
  if (pdfjs) return pdfjs;
  const mod = await import("pdfjs-dist");
  mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  pdfjs = mod;
  return mod;
}

/** A PDF must start with %PDF-. We check bytes, not the filename. */
export function looksLikePdf(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes.slice(0, 5));
  return (
    head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d
  );
}

export async function parsePdf(bytes: ArrayBuffer, versionId: string): Promise<ParseResult> {
  if (!looksLikePdf(bytes)) {
    return {
      status: "failed",
      message: "This file is not a PDF. Its first bytes are not the PDF signature.",
      pageCount: 0,
      pages: [],
      pagesWithText: 0,
    };
  }

  const mod = await loadPdfjs();
  let doc: Awaited<ReturnType<typeof mod.getDocument>["promise"]>;
  try {
    // pdf.js transfers the buffer, so hand it a copy and keep the original bytes intact.
    doc = await mod.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === "PasswordException") {
      return {
        status: "encrypted",
        message: "This PDF is password protected, so its text cannot be read.",
        pageCount: 0,
        pages: [],
        pagesWithText: 0,
      };
    }
    return {
      status: "failed",
      message: `This PDF could not be opened (${(error as Error)?.message ?? "unknown error"}).`,
      pageCount: 0,
      pages: [],
      pagesWithText: 0,
    };
  }

  // The file's own Info dictionary. Absent in most PDFs, so this stays optional
  // and nothing downstream guesses a value when it is missing.
  let meta: ParseResult["meta"];
  try {
    const info = (await doc.getMetadata())?.info as
      | { Title?: string; Author?: string; CreationDate?: string }
      | undefined;
    const year = /^D:(\d{4})/.exec(info?.CreationDate ?? "")?.[1];
    const parsedYear = year ? Number(year) : undefined;
    meta = {
      title: info?.Title?.trim() || undefined,
      authors: info?.Author?.trim() || undefined,
      // Ignore the epoch default that generators write when they have no real date.
      year: parsedYear && parsedYear > 1990 && parsedYear <= new Date().getFullYear() + 1 ? parsedYear : undefined,
    };
    if (!meta.title && !meta.authors && !meta.year) meta = undefined;
  } catch {
    meta = undefined;
  }

  const pages: ParsedPage[] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    let text = "";
    const items: ParsedItem[] = [];
    let lastY: number | null = null;

    for (const item of content.items) {
      if (!("str" in item)) continue;
      const str = item.str;
      const [, , , , x, y] = item.transform as number[];
      const height = Math.abs(item.height || 0) || 10;
      // pdf.js emits items in reading order; a y shift means a new line.
      if (lastY !== null && Math.abs(y - lastY) > height * 0.6) {
        text += "\n";
      } else if (text && !text.endsWith(" ") && !text.endsWith("\n") && !str.startsWith(" ")) {
        text += " ";
      }
      const start = text.length;
      text += str;
      if (str.trim()) {
        items.push({
          start,
          length: str.length,
          x,
          // PDF origin is bottom-left; store top-left so the overlay can use it directly.
          y: viewport.height - y - height,
          w: item.width || 0,
          h: height,
        });
      }
      lastY = y;
      if (item.hasEOL) {
        text += "\n";
        lastY = null;
      }
    }

    pages.push({
      id: pageId(versionId, number),
      versionId,
      pageNumber: number,
      text,
      width: viewport.width,
      height: viewport.height,
      items,
    });
  }

  const pagesWithText = pages.filter((p) => p.text.trim().length > 0).length;
  if (pagesWithText === 0) {
    return {
      meta,
      status: "no_text_layer",
      message:
        "No text layer found. This looks like a scanned document: you can read it here, but nothing can be extracted from it until it is run through OCR.",
      pageCount: doc.numPages,
      pages,
      pagesWithText,
    };
  }

  return {
    meta,
    status: "parsed",
    message:
      pagesWithText < doc.numPages
        ? `${doc.numPages - pagesWithText} of ${doc.numPages} pages carry no text layer and will be skipped by extraction.`
        : undefined,
    pageCount: doc.numPages,
    pages,
    pagesWithText,
  };
}

/** Character range → boxes to draw. Returns nothing when the range is unknown. */
export function boxesForRange(page: ParsedPage, start?: number, end?: number) {
  if (start === undefined || end === undefined) return [];
  return page.items
    .filter((item) => item.start < end && item.start + item.length > start)
    .map((item) => ({
      left: item.x / page.width,
      top: item.y / page.height,
      width: item.w / page.width,
      height: item.h / page.height,
    }));
}
