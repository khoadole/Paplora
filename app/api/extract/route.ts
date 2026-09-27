import { NextResponse } from "next/server";
import { callModel, ExtractionError } from "@/lib/extract/client";
import { readAiConfig } from "@/lib/extract/model";
import { extractRequestSchema } from "@/lib/extract/schema";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Hard ceiling on one request's payload, checked before anything is parsed. */
const MAX_BODY_BYTES = 400_000;

/**
 * Live extraction. One (row, column, page window) per call.
 *
 * This endpoint is for local development with the owner's own key. It has no
 * authentication and no per-user quota: see README, "Before deploying this".
 */
export async function POST(request: Request) {
  const config = readAiConfig();
  if (!config.configured || !config.model) {
    return NextResponse.json(
      { error: config.reason ?? "Automatic extraction is not configured.", code: "not_configured" },
      { status: 503 },
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "That request is too large. Extraction sends a few pages at a time.", code: "too_large" },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body.", code: "bad_request" }, { status: 400 });
  }

  const parsed = extractRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "That request does not match the expected shape.", code: "bad_request" },
      { status: 400 },
    );
  }

  try {
    const { answer, model } = await callModel(parsed.data, {
      apiKey: process.env.OPENAI_API_KEY as string,
      model: config.model,
      signal: request.signal,
    });
    // The answer is returned unverified on purpose: the client resolves every quote
    // against the page text it holds, so the evidence check cannot be skipped.
    return NextResponse.json({ answer, model });
  } catch (error) {
    if (error instanceof ExtractionError) {
      return NextResponse.json(
        { error: error.message, code: error.retryable ? "retryable" : "fatal" },
        { status: error.retryable ? 502 : 400 },
      );
    }
    return NextResponse.json({ error: "Extraction failed.", code: "retryable" }, { status: 502 });
  }
}
