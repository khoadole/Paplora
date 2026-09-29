import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

/**
 * Outbound fetch for paper sources, ported from an audited implementation and
 * widened to accept PDFs.
 *
 * Protections: https/http only, no credentials in the URL, ports 80/443 only,
 * every resolved address checked against the private ranges, the validated
 * address pinned so DNS cannot rebind between check and connect, redirects
 * capped and re-validated, a content-type allow-list, a hard size cap enforced
 * while streaming, and a request timeout.
 */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 0 && c === 2))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Canonicalize IPv6 before excluding transition, benchmark and documentation ranges.
  if (isIP(address) !== 6) return false;
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  return (
    /^[23]/i.test(normalized) &&
    !/^(2001:(?::|0*:|db8:|2:|[12][0-9a-f]:)|2002:|3fff:)/i.test(normalized)
  );
}

export function parsePublicUrl(value: string) {
  const url = new URL(
    /^https?:\/\//i.test(value.trim())
      ? value.trim()
      : `https://${value.trim()}`,
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error("Use a public HTTP or HTTPS URL.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (isIP(host) ? !isPublicAddress(host) : !host.includes("."))
  )
    throw new Error("This address is not a public website.");
  return url;
}

export const MAX_BYTES = 12 * 1024 * 1024;

export interface FetchedSource {
  contentType: string;
  /** The URL actually delivered, after any redirects. */
  url: string;
  bytes: Buffer;
}

export async function safeFetch(
  value: string,
  init?: RequestInit,
  redirects = 0,
): Promise<FetchedSource> {
  const url = parsePublicUrl(value);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  )
    throw new Error("This address is not a public website.");
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: init?.method || "GET",
        family: address.family,
        lookup: (_host, _options, callback) =>
          callback(null, address.address, address.family),
        headers: {
          "User-Agent": "Paplora/1.0 (research comparison tool)",
          Accept: "text/html,application/pdf,application/json,text/plain",
          ...Object.fromEntries(new Headers(init?.headers)),
        },
        signal: AbortSignal.timeout(25_000),
      },
      (response) => {
        const status = response.statusCode || 500;
        if (
          [301, 302, 303, 307, 308].includes(status) &&
          response.headers.location
        ) {
          response.resume();
          if (redirects >= 4) return reject(new Error("Too many redirects."));
          void safeFetch(new URL(response.headers.location, url).href, undefined, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`The source returned HTTP ${status}.`));
          return;
        }
        const contentType = (response.headers["content-type"] || "").toLowerCase();
        if (!/text\/|json|xml|javascript|application\/pdf/.test(contentType)) {
          response.resume();
          reject(new Error(`That source is a ${contentType || "unknown"} file, which cannot be read here.`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            request.destroy(new Error("That source is larger than the 12 MB limit."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({ contentType, url: url.href, bytes: Buffer.concat(chunks) }),
        );
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    if (typeof init?.body === "string") request.write(init.body);
    request.end();
  });
}
