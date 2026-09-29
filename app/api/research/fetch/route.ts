import { safeFetch } from "@/lib/server/safe-fetch";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Fetches one paper source for the client to ingest.
 *
 * PDFs come back as base64 so the browser can parse them with the same code
 * path as an upload, which keeps page numbering and stored bytes identical.
 * HTML comes back as text for section splitting. Everything goes through the
 * SSRF-safe fetcher: public hosts only, validated redirects, size and type caps.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { url?: string };
  const url = (body.url ?? "").trim();
  if (!url) return Response.json({ error: "No URL supplied.", code: "bad_request" }, { status: 400 });

  try {
    const fetched = await safeFetch(url, undefined, 0);
    const isPdf = fetched.contentType.includes("application/pdf");
    return Response.json({
      url: fetched.url,
      contentType: fetched.contentType,
      kind: isPdf ? "pdf" : "text",
      bytes: isPdf ? fetched.bytes.toString("base64") : undefined,
      text: isPdf ? undefined : fetched.bytes.toString("utf8").slice(0, 2_000_000),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "That source could not be read.", code: "fetch_failed" },
      { status: 502 },
    );
  }
}
