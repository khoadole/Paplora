// Keeps public/pdf.worker.min.mjs in step with the installed pdfjs-dist.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public", { recursive: true });
copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/pdf.worker.min.mjs");
console.log("copied pdf.worker.min.mjs into public/");
