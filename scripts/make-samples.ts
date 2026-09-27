/**
 * Renders the demo documents in lib/sample/documents.ts into public/samples/*.pdf.
 * Run with `npm run samples` after editing the text. Output is deterministic.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { SAMPLE_DOCS } from "../lib/sample/documents";

const PAGE_WIDTH = 595; // A4 at 72dpi
const PAGE_HEIGHT = 842;
const MARGIN = 64;
const LINE_HEIGHT = 16;

async function build() {
  mkdirSync("public/samples", { recursive: true });
  for (const doc of SAMPLE_DOCS) {
    const pdf = await PDFDocument.create();
    pdf.setTitle(doc.title);
    pdf.setSubject("Demo document generated for the Paplora sample project. Not a real publication.");
    pdf.setCreationDate(new Date(0));
    pdf.setModificationDate(new Date(0));
    const body = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    for (const lines of doc.pages) {
      const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      let y = PAGE_HEIGHT - MARGIN;
      for (const [index, line] of lines.entries()) {
        const isBanner = index === 0;
        const isHeading = /^\d+\.\s|^Abstract$/.test(line);
        const font = isBanner || isHeading ? bold : body;
        const size = isBanner ? 9 : 11;
        // pdf-lib's standard fonts are WinAnsi; the em dash is fine, other exotica is not.
        page.drawText(line, {
          x: MARGIN,
          y,
          size,
          font,
          color: isBanner ? rgb(0.55, 0.2, 0.1) : rgb(0.1, 0.1, 0.12),
        });
        y -= isBanner ? LINE_HEIGHT * 1.5 : LINE_HEIGHT;
      }
    }

    const bytes = await pdf.save();
    writeFileSync(`public/samples/${doc.filename}`, bytes);
    console.log(`wrote public/samples/${doc.filename} (${bytes.length} bytes)`);
  }
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
