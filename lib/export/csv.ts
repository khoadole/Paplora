/**
 * CSV writing.
 *
 * Two separate concerns, both easy to get wrong:
 *  1. RFC4180 quoting, so commas, quotes, newlines and Unicode survive a round trip.
 *  2. Formula injection: a cell starting =, +, -, @, tab or CR is executable in
 *     Excel/Sheets. We prefix those with a single quote so the text stays visible
 *     and inert. This is applied to every field, including headers.
 */

const RISKY = /^[=+\-@\t\r]/;

export function escapeField(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (RISKY.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(escapeField).join(",")).join("\r\n");
}

/** Excel needs the BOM to read UTF-8 correctly. */
export function csvBlob(csv: string): Blob {
  return new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
}
