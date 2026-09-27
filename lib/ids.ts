/** Id and hashing helpers. Both run in the browser and in Node's test runner. */

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(16).slice(2).padEnd(16, "0").slice(0, 16);
  return `${prefix}_${rand}`;
}

export function cellId(rowId: string, columnId: string): string {
  return `${rowId}:${columnId}`;
}

export function pageId(versionId: string, pageNumber: number): string {
  return `${versionId}:${pageNumber}`;
}

/** SHA-256 of the file bytes. Byte-identical uploads resolve to the same source. */
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
